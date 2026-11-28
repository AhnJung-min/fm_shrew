import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, session, shell, Tray } from 'electron'
import { activeCatalog } from '@shared/catalogs'
import { dropMainOwned, normsFailed } from '@shared/tacticApi'
import { resolveMainTactic, saveKeyOf } from '@shared/tacticModel'
import type { AppStatus, Settings } from '@shared/types'
import type { CandidateQuery, EditorEdit } from '@shared/world'
import { BackupManager } from './backup'
import { ClubService } from './clubService'
import { DashboardService } from './dashboardService'
import { GameLink } from './gameLink'
import { FaceFinder, imageRequestFrom, LogoFinder } from './graphics'
import { isLocalRequest } from './netGuard'
import { openableFolder } from './pathGuard'
import { RecordKeeper } from './records/keeper'
import { RecordStore } from './records/store'
import { SeasonService } from './seasonService'
import { SettingsStore } from './settings'
import { registerTacticIpc } from './tacticIpc'
import { TalkController } from './talk/controller'
import { KeyStore } from './talk/keyStore'
import { trayIconFor } from './trayIcon'
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
let records: RecordKeeper
let link: GameLink
let tray: Tray | null = null
/** 정말 끄는 중인지(트레이 메뉴의 종료, 시스템 종료). 아니면 창을 닫아도 앱은 남는다 */
let quitting = false
let toldAboutTray = false
let pluginWasConnected = false

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
  tray = new Tray(nativeImage.createFromDataURL(trayIconFor(settings.get().theme)))
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

/** 화면이 기준 분포(worldNorms)를 한 번에 물을 수 있는 프로파일 수(전술 묶음 3개 × 자리 11개) */
const NORMS_PROFILES_MAX = 33

/** 역할 가중치 묶음 파일의 대화상자 설정. 파일 경로는 화면이 정하지 않고 본체의 대화상자로만 받는다(N-03) */
const BUNDLE_FILTERS = [{ name: '역할 가중치 묶음(JSON)', extensions: ['json'] }]

/** 저장 대화상자. 취소하면 null */
async function pickSavePath(defaultName: string): Promise<string | null> {
  const options = { defaultPath: join(app.getPath('documents'), defaultName), filters: BUNDLE_FILTERS }
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

/** 열기 대화상자(파일 하나). 취소하면 null */
async function pickOpenPath(): Promise<string | null> {
  const options = { defaultPath: app.getPath('documents'), filters: BUNDLE_FILTERS, properties: ['openFile' as const] }
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

function registerIpc(): void {
  ipcMain.handle('status:get', () => getStatus())
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:set', async (_event, patch: Partial<Settings>) => {
    const before = settings.get()
    // 전술 묶음, 사용자 역할, 이전 기록처럼 본체만 쓰는 칸은 화면이 보낸 patch에서 버린다(오래된 설정 객체를 통째로 보내도 전술이 사라지지 않게).
    // 화면은 그 칸을 전용 창구(tacticsSave, customRolesSave, migrationAck)로만 쓴다
    const next = settings.set(dropMainOwned(patch))
    if (next.saveDir !== before.saveDir) await saveWatcher.start(next.saveDir)
    // 화면 색을 바꾸면 알림 영역 아이콘도 그 색으로 바꾼다
    if (next.theme !== before.theme) tray?.setImage(nativeImage.createFromDataURL(trayIconFor(next.theme)))
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
  // 앱이 확인하지 않은 게임 판의 세이브는 allowUnknownVersion을 줘야(사용자가 확인한 뒤) 적용한다. 앱을 켤 때의 자동 적용(applyLastSave)은 주지 않아 건너뛴다
  ipcMain.handle('link:apply', async (_event, path: string, options?: { allowUnknownVersion?: boolean }) => {
    const result = await link.apply(String(path), { allowUnknownVersion: options?.allowUnknownVersion === true })
    if (result.ok) settings.set({ activeSave: String(path) })
    return result
  })
  ipcMain.handle('link:chooseTeam', async (_event, teamId: number) => {
    const result = await link.chooseTeam(Number(teamId))
    return result
  })
  ipcMain.handle('link:refresh', (_event, rescan: boolean) => link.refresh(rescan === true))
  ipcMain.handle('world:clubs', () => world.clubs())
  ipcMain.handle('world:squad', () => world.squad())
  ipcMain.handle('world:season', () => season.season())
  ipcMain.handle('world:dashboard', () => dashboard.dashboard())
  ipcMain.handle('world:club', (_event, force: boolean) => club.snapshot(force === true))

  // 기록 보관: 세이브마다의 성장 스냅샷·경기 평점. 지울 때는 휴지통으로 보낸다
  ipcMain.handle('records:list', () => records.summaries())
  ipcMain.handle('records:remove', async (_event, id: string) => {
    const dir = records.store.folderOf(String(id))
    if (!dir) return { ok: false, message: '기록 폴더를 찾지 못했습니다.' }
    try {
      await shell.trashItem(dir)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

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

  // 2단계 새 창구(전술 저장, 기준 분포, 게임 전술 가져오기, 전술 추천, 사용자 역할과 가중치 묶음, 별점 대조, 이전 알림 확인).
  // 기준 분포는 본체의 world.normsFor가 구한다. 그 밖의 서비스는 아직 채우지 않은 곳이 있다
  registerTacticIpc(ipcMain, {
    settings,
    world,
    link,
    norms: (profiles) => {
      if (!world.world) return normsFailed('먼저 시작 화면에서 세이브를 골라 적용해 주세요.')
      const blocked = world.blocked()
      if (blocked) return normsFailed(blocked)
      // 화면이 한 번에 묻는 것은 전술 몇 개의 프로파일이다(전술 하나가 11개). 그 이상은 화면의 잘못이라 계산하지 않는다
      if (profiles.length > NORMS_PROFILES_MAX) return normsFailed('한 번에 구할 수 있는 자리 수를 넘었습니다.')
      return { ok: true, norms: world.normsFor(profiles) }
    },
    pickSavePath,
    pickOpenPath,
    dataDir: app.getPath('userData')
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
  // 기록 폴더와 플러그인의 평점 파일 위치는 환경 변수로 바꿀 수 있다(시험용)
  records = new RecordKeeper(
    new RecordStore(process.env.FMB_RECORDS_DIR ?? join(dataDir, 'records')),
    () => join(process.env.FMB_PLUGIN_RECORDS ?? join(process.env.LOCALAPPDATA ?? '', 'FmBojwagwan', 'records'), 'ratings.jsonl')
  )
  world = new WorldService({
    onRead: (path, loaded) => void records.onRead(path, loaded),
    knownTeam: (fileName) => settings.get().saveTeams[fileName],
    rosterNames: () => link.rosterNames(),
    rememberTeam: (fileName, teamId) => {
      if (settings.get().saveTeams[fileName] !== teamId) {
        settings.set({ saveTeams: { ...settings.get().saveTeams, [fileName]: teamId } })
      }
    },
    roleWeights: () => settings.get().roleWeights,
    // 쓰는 역할 카탈로그와 주 전술(스쿼드 결과의 기준 분포가 따른다). 부를 때마다 설정에서 읽는다
    catalog: () => activeCatalog(settings.get()),
    mainTactic: () => resolveMainTactic(settings.get(), saveKeyOf(world.path), activeCatalog(settings.get())),
    // 아래에서 만드는 대시보드가 계산해 둔 리그 주급 모델(자유 계약 선수의 주급 어림). 부를 때 이미 만들어져 있다
    wageModel: () => dashboard.currentWageModel(),
    namesDir: join(dataDir, 'names')
  })
  season = new SeasonService({
    // 적용해 둔 세이브의 자료를 그대로 쓴다. 파일이 바뀌면 GameLink가 다시 읽고, 그때 자료 객체가 바뀌어 순위·일정도 다시 읽힌다
    current: () => (world.path && world.world ? { path: world.path, world: world.world } : null),
    namesDir: join(dataDir, 'names')
  })
  dashboard = new DashboardService({
    world,
    season,
    // 대시보드와 영입 후보는 주 전술을 쓴다(A-03). 옛 카탈로그면 옛 설정(포메이션과 자리별 역할)에서 만든 전술이다
    settings: () => {
      const current = settings.get()
      const catalog = activeCatalog(current)
      return { tactic: resolveMainTactic(current, saveKeyOf(world.path), catalog), catalog, roleWeights: current.roleWeights }
    },
    namesDir: join(dataDir, 'names')
  })
  link = new GameLink(
    world,
    () => settings.get().saveDir,
    (status) => {
      mainWindow?.webContents.send('link:changed', status)
      // 플러그인이 연결되는 순간, 쌓인 경기 평점을 가져온다
      if (status.game.connected && !pluginWasConnected && world.path) records.importRatings(world.path, world.world?.teamId)
      pluginWasConnected = status.game.connected
    }
  )
  club = new ClubService(world, () => link.status())
  saveWatcher = new SaveWatcher((path) => {
    void backupSave(path)
    if (world.path === path) records.importRatings(path, world.world?.teamId)
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
