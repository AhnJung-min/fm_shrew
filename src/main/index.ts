import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, protocol, session, shell, Tray } from 'electron'
import type { AppStatus, Settings } from '@shared/types'
import type { CandidateQuery, EditorEdit } from '@shared/world'
import { BackupManager } from './backup'
import { ClubService } from './clubService'
import { DashboardService } from './dashboardService'
import { GameLink } from './gameLink'
import { FaceFinder, imageRequestFrom, LogoFinder } from './graphics'
import { isLocalRequest } from './netGuard'
import { openableFolder } from './pathGuard'
import { SeasonService } from './seasonService'
import { SettingsStore } from './settings'
import { TalkController } from './talk/controller'
import { KeyStore } from './talk/keyStore'
import { TRAY_ICON } from './trayIcon'
import { SaveWatcher } from './watcher'
import { WorldService } from './worldService'

// 검증용 환경 변수: 데이터 폴더와 세이브 폴더를 바꾸고, 화면을 PNG로 찍은 뒤 종료한다
const SMOKE_OUT = process.env.FMB_SMOKE_OUT
const USER_DATA_OVERRIDE = process.env.FMB_USER_DATA
const SAVE_DIR_OVERRIDE = process.env.FMB_SAVE_DIR

if (USER_DATA_OVERRIDE) app.setPath('userData', USER_DATA_OVERRIDE)
// 검증 화면을 찍을 때 창이 게임 뒤에 가려 있어도 계속 그리게 한다(Windows는 가려진 창을 다시 그리지 않아 예전 화면이 찍힌다)
if (SMOKE_OUT) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// 프로젝트 폴더의 .env 파일이 있으면 읽는다(ANTHROPIC_API_KEY=...). 이 파일은 git에 올리지 않는다.
try {
  process.loadEnvFile(join(app.getAppPath(), '.env'))
} catch {
  // 파일이 없으면 앱 설정에 저장한 키를 쓴다
}

// 선수 얼굴 사진을 화면에 주는 주소(fmface://face/<선수 번호>). 앱이 준비되기 전에 등록해야 한다
protocol.registerSchemesAsPrivileged([{ scheme: 'fmface', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

let mainWindow: BrowserWindow | null = null
let settings: SettingsStore
let saveWatcher: SaveWatcher
let talk: TalkController
let keys: KeyStore
let backups: BackupManager
let world: WorldService
let season: SeasonService
let dashboard: DashboardService
let club: ClubService
let link: GameLink
let tray: Tray | null = null
/** 정말 끄는 중인지(트레이 메뉴의 종료, 시스템 종료). 아니면 창을 닫아도 앱은 남는다 */
let quitting = false
let toldAboutTray = false

function getStatus(): AppStatus {
  const { saveDir } = settings.get()
  return {
    saveDir: { dir: saveDir, exists: existsSync(saveDir) },
    dataDir: app.getPath('userData'),
    version: app.getVersion()
  }
}

/** 저장된 세이브의 사본을 남긴다(자동 백업이 켜져 있을 때). 같은 저장은 한 번만 남는다. */
async function backupSave(path: string): Promise<void> {
  if (!settings.get().backupEnabled) return
  try {
    if (await backups.backup(path)) mainWindow?.webContents.send('backup:changed')
  } catch (error) {
    console.error('[backup]', error)
  }
}

/** 지난번에 적용했던 세이브가 그대로 있으면 다시 적용한다(앱을 켤 때마다 고르지 않아도 되게). */
function applyLastSave(): void {
  const last = settings.get().activeSave
  if (last && existsSync(last)) void link.apply(last)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 380,
    minHeight: 520,
    show: false,
    // 화면이 뜨기 전 잠깐 보이는 바탕. app.css의 --bg와 같은 색
    backgroundColor: settings.get().theme === 'black' ? '#08090b' : '#0a1324',
    title: 'FM 보좌관',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))
  // 창을 닫아도 앱은 알림 영역에 남는다. 게임 안 "직접 답변"과 자동 백업이 앱이 켜져 있어야 돌기 때문이다
  mainWindow.on('close', (event) => {
    if (quitting || !tray || !settings.get().keepRunning) return
    event.preventDefault()
    mainWindow?.hide()
    if (!toldAboutTray) {
      toldAboutTray = true
      tray.displayBalloon({
        title: 'FM 보좌관이 계속 켜져 있습니다',
        content: '게임 안 직접 답변과 세이브 백업이 계속 동작합니다. 끄려면 이 아이콘을 오른쪽 클릭해 "종료"를 누르세요.'
      })
    }
  })

  // 새 창은 열지 않는다. 화면에 바깥 링크는 없고, 바깥 주소로는 나가지 않는다(N-08)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const devUrl = process.env.ELECTRON_RENDERER_URL
  const route = process.env.FMB_SMOKE_ROUTE ? `#${process.env.FMB_SMOKE_ROUTE}` : ''
  if (devUrl) void mainWindow.loadURL(devUrl + route)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: route.slice(1) })
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** 알림 영역 아이콘. 창을 닫은 뒤에도 앱을 다시 열거나 끌 수 있게 한다. */
function createTray(): void {
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON))
  tray.setToolTip('FM 보좌관')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'FM 보좌관 열기', click: showWindow },
      { type: 'separator' },
      {
        label: '종료',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', showWindow)
}

function registerIpc(): void {
  ipcMain.handle('status:get', () => getStatus())
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:set', async (_event, patch: Partial<Settings>) => {
    const before = settings.get()
    const next = settings.set(patch)
    if (next.saveDir !== before.saveDir) await saveWatcher.start(next.saveDir)
    return next
  })
  ipcMain.handle('shell:openPath', async (_event, path: unknown) => {
    // 세이브 폴더, 앱 데이터 폴더(백업 폴더가 그 안에 있다), 그 안의 폴더만 연다. 파일과 그 밖의 경로는 거절한다(N-03)
    const folder = openableFolder(path, [settings.get().saveDir, join(app.getPath('userData'), 'backups'), app.getPath('userData')])
    if (folder) await shell.openPath(folder)
  })

  // 게임 연결과 세이브 적용
  ipcMain.handle('link:status', () => link.status())
  ipcMain.handle('link:saves', () => link.saves())
  ipcMain.handle('link:apply', async (_event, path: string) => {
    const result = await link.apply(String(path))
    if (result.ok) settings.set({ activeSave: String(path) })
    return result
  })
  ipcMain.handle('link:refresh', (_event, rescan: boolean) => link.refresh(rescan === true))
  ipcMain.handle('world:squad', () => world.squad())
  ipcMain.handle('world:season', () => season.season())
  ipcMain.handle('world:dashboard', () => dashboard.dashboard())
  ipcMain.handle('world:club', (_event, force: boolean) => club.snapshot(force === true))

  ipcMain.handle('backup:list', () => backups.list())
  ipcMain.handle('backup:now', async () => {
    const newest = world.path ?? link.saves()[0]?.path
    if (!newest) return { ok: false, message: '세이브 폴더에 세이브가 없습니다.' }
    try {
      const made = await backups.backup(newest)
      mainWindow?.webContents.send('backup:changed')
      return { ok: true, message: made ? `“${basename(newest)}”의 사본을 남겼습니다.` : '가장 최근 저장은 이미 사본이 있습니다.' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('backup:restore', async (_event, id: string) => {
    const result = await backups.restore(id)
    mainWindow?.webContents.send('backup:changed')
    return { ok: result.ok, message: result.message }
  })
  ipcMain.handle('backup:delete', async (_event, id: string) => {
    await backups.remove(id)
    mainWindow?.webContents.send('backup:changed')
  })

  ipcMain.handle('world:candidates', async (_event, query: CandidateQuery) => {
    // 자유 계약 선수의 주급 어림에 쓰는 리그 주급 모델을 먼저 계산해 둔다(한 번만 계산한다)
    await dashboard.prepareWageModel()
    return world.candidates(query)
  })
  ipcMain.handle('world:market', (_event, uids: number[]) => world.market(Array.isArray(uids) ? uids.map(Number) : []))
  ipcMain.handle('world:profile', (_event, uid: number) => world.playerProfile(Number(uid)))
  ipcMain.handle('editor:list', (_event, search: string) => world.editorList(String(search ?? '')))
  ipcMain.handle('editor:player', (_event, uid: number) => world.editorPlayer(Number(uid)))
  ipcMain.handle('editor:apply', (_event, edits: EditorEdit[]) => world.applyEdits(edits))

  ipcMain.handle('talk:status', () => talk.status())
  ipcMain.handle('talk:setKey', (_event, key: string) => {
    keys.save(key)
    return talk.status()
  })
  ipcMain.handle('talk:clearKey', () => {
    keys.clear()
    return talk.status()
  })
}

async function runSmoke(outFile: string): Promise<void> {
  if (!mainWindow) return
  const delay = Number(process.env.FMB_SMOKE_DELAY ?? 3500)
  await new Promise((resolve) => setTimeout(resolve, delay))
  // 검증할 때 특정 상태(행 선택 등)를 만들기 위한 스크립트
  if (process.env.FMB_SMOKE_JS) {
    const result: unknown = await mainWindow.webContents.executeJavaScript(process.env.FMB_SMOKE_JS, true)
    console.log('[smoke] script result:', JSON.stringify(result))
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  // 창이 다른 창에 가려 있으면 예전 화면이 찍힐 수 있어, 다시 그리게 한 뒤 찍는다
  mainWindow.webContents.invalidate()
  await new Promise((resolve) => setTimeout(resolve, 300))
  const image = await mainWindow.webContents.capturePage()
  writeFileSync(outFile, image.toPNG())
  console.log('[smoke] saved', outFile)
  app.quit()
}

// 앱을 두 번 켜면 폴더 감시와 게임 안 직접 답변이 겹치므로, 이미 떠 있으면 그 창을 앞으로 가져오고 끝낸다
if (!SMOKE_OUT && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

/** 화면(렌더러)이 이 PC 밖으로 요청을 보내거나 바깥 페이지로 옮겨 가는 것을 막는다(N-08). Claude 요청은 앱 본체가 따로 보낸다 */
function guardOutbound(): void {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const local = isLocalRequest(details.url)
    if (!local) console.warn('[net] 바깥 주소 요청을 막았습니다:', details.url)
    callback({ cancel: !local })
  })
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isLocalRequest(url)) event.preventDefault()
    })
  })
}

app.whenReady().then(async () => {
  guardOutbound()
  // 사용자가 설치해 둔 얼굴 사진(페이스팩)과 구단 엠블럼. 파일을 읽기만 하고, 번호가 숫자일 때만 찾는다
  const graphicsDir = join(app.getPath('documents'), 'Sports Interactive', 'Football Manager 26', 'graphics')
  const finders = { face: new FaceFinder(graphicsDir), club: new LogoFinder(graphicsDir) }
  protocol.handle('fmface', (request) => {
    const wanted = imageRequestFrom(request.url)
    const file = wanted === null ? null : finders[wanted.kind].find(wanted.uid)
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response(null, { status: 404 })
  })
  setTimeout(() => {
    finders.face.folders()
    finders.club.folders()
  }, 1500)
  const dataDir = app.getPath('userData')
  mkdirSync(dataDir, { recursive: true })
  settings = new SettingsStore(join(dataDir, 'settings.json'), app.getPath('documents'), SAVE_DIR_OVERRIDE)
  backups = new BackupManager(
    join(dataDir, 'backups'),
    () => settings.get().saveDir,
    () => settings.get().backupKeep
  )
  world = new WorldService({
    knownTeam: (fileName) => settings.get().saveTeams[fileName],
    rosterNames: () => link.rosterNames(),
    rememberTeam: (fileName, teamId) => {
      if (settings.get().saveTeams[fileName] !== teamId) {
        settings.set({ saveTeams: { ...settings.get().saveTeams, [fileName]: teamId } })
      }
    },
    roleWeights: () => settings.get().roleWeights,
    // 아래에서 만드는 대시보드가 계산해 둔 리그 주급 모델(자유 계약 선수의 주급 어림). 부를 때 이미 만들어져 있다
    wageModel: () => dashboard.currentWageModel(),
    namesDir: join(dataDir, 'names')
  })
  season = new SeasonService({
    // 적용해 둔 세이브의 자료를 그대로 쓴다. 파일이 바뀌면 GameLink가 다시 읽고, 그때 자료 객체가 바뀌어 순위·일정도 다시 읽힌다
    current: () => (world.path && world.world ? { path: world.path, world: world.world } : null),
    namesDir: join(dataDir, 'names')
  })
  dashboard = new DashboardService({ world, season, settings: () => settings.get(), namesDir: join(dataDir, 'names') })
  link = new GameLink(
    world,
    () => settings.get().saveDir,
    (status) => mainWindow?.webContents.send('link:changed', status)
  )
  club = new ClubService(world, () => link.status())
  saveWatcher = new SaveWatcher((path) => {
    void backupSave(path)
    // 적용해 둔 세이브를 게임이 다시 저장했으면 그 내용을 다시 읽는다
    void link.saved(path)
  })
  keys = new KeyStore(join(dataDir, 'claude-key.bin'))
  talk = new TalkController(keys, settings, () => world.myNames())

  registerIpc()
  createWindow()
  if (!SMOKE_OUT) createTray()
  // 게임 안 "직접 답변" 칸을 맡는다(검사용 실행에서는 돌리지 않는다)
  if (!process.env.FMB_SMOKE_OUT) void talk.serveGame()
  await saveWatcher.start(settings.get().saveDir)
  // 게임이 켜져 있는지 계속 확인한다
  void link.run()
  // 창이 먼저 뜬 뒤에 읽는다(세이브 하나를 읽는 데 몇 초 걸린다)
  setTimeout(applyLastSave, 1200)

  if (SMOKE_OUT) void runSmoke(SMOKE_OUT)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  tray?.destroy()
  tray = null
  void saveWatcher?.stop()
  link?.stop()
  talk?.dispose()
  app.quit()
})
