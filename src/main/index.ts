import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { deriveColumns } from '@shared/parse'
import type { AppStatus, ImportResult, Settings, SnapshotKind } from '@shared/types'
import type { CandidateQuery, EditorEdit } from '@shared/world'
import { BackupManager } from './backup'
import { Store } from './db'
import { importFile } from './importer'
import { importSave } from './saveImporter'
import { SettingsStore } from './settings'
import { TalkController } from './talk/controller'
import { KeyStore } from './talk/keyStore'
import { TRAY_ICON } from './trayIcon'
import { ExportWatcher, isSaveFile, SaveWatcher } from './watcher'
import { WorldService } from './worldService'

// 검증용 환경 변수: 데이터 폴더와 감시 폴더를 바꾸고, 화면을 PNG로 찍은 뒤 종료한다
const SMOKE_OUT = process.env.FMB_SMOKE_OUT
const USER_DATA_OVERRIDE = process.env.FMB_USER_DATA
const WATCH_DIR_OVERRIDE = process.env.FMB_WATCH_DIR
const SAVE_DIR_OVERRIDE = process.env.FMB_SAVE_DIR

if (USER_DATA_OVERRIDE) app.setPath('userData', USER_DATA_OVERRIDE)

// 프로젝트 폴더의 .env 파일이 있으면 읽는다(ANTHROPIC_API_KEY=...). 이 파일은 git에 올리지 않는다.
try {
  process.loadEnvFile(join(app.getAppPath(), '.env'))
} catch {
  // 파일이 없으면 앱 설정에 저장한 키를 쓴다
}

let mainWindow: BrowserWindow | null = null
let store: Store
let settings: SettingsStore
let watcher: ExportWatcher
let saveWatcher: SaveWatcher
let talk: TalkController
let keys: KeyStore
let backups: BackupManager
let world: WorldService
let tray: Tray | null = null
/** 정말 끄는 중인지(트레이 메뉴의 종료, 시스템 종료). 아니면 창을 닫아도 앱은 남는다 */
let quitting = false
let toldAboutTray = false
/** 내 팀을 몰라 미뤄 둔 세이브. 스쿼드 명단이 들어오면 다시 읽는다. */
let pendingSave: string | null = null

function getStatus(): AppStatus {
  const { watchDirs, saveDir } = settings.get()
  return {
    watchDirs: watchDirs.map((dir) => ({ dir, exists: existsSync(dir) })),
    saveDir: { dir: saveDir, exists: existsSync(saveDir) },
    dataDir: app.getPath('userData'),
    version: app.getVersion()
  }
}

async function handleExportFile(path: string): Promise<ImportResult> {
  const result = await importFile(store, path, settings.get().columnOverrides)
  // 이미 가져온 파일은 조용히 넘어간다
  if (!result.skipped) mainWindow?.webContents.send('import:done', result)
  if (result.ok && pendingSave) void handleSaveFile(pendingSave)
  return result
}

/** 게임에서 내보낸 가장 최근 스쿼드 명단의 선수 이름. 세이브에서 내 팀을 찾는 데 쓴다. */
function latestRosterNames(): string[] {
  const exported = store.listSnapshots().filter((snapshot) => !isSaveFile(snapshot.fileName))
  const roster = exported.find((snapshot) => snapshot.kind === 'squad') ?? exported[0]
  return roster ? (store.getSnapshot(roster.id)?.rows.map((row) => row.name) ?? []) : []
}

/** 세이브에서 읽은 가장 최근 내 스쿼드의 선수 이름 */
function latestSquadNames(): string[] {
  const squad = store.listSnapshots().find((snapshot) => isSaveFile(snapshot.fileName))
  return squad ? (store.getSnapshot(squad.id)?.rows.map((row) => row.name) ?? []) : []
}

async function handleSaveFile(path: string): Promise<void> {
  const result = await importSave(store, path, (file) => world.read(file))
  if (result.needsRoster) pendingSave = path
  else if (pendingSave === path) pendingSave = null
  if (!result.skipped) mainWindow?.webContents.send('import:done', result)
}

/** 세이브 폴더에서 가장 최근에 저장된 세이브. 없으면 null */
function newestSave(): string | null {
  const dir = settings.get().saveDir
  if (!existsSync(dir)) return null
  const newest = readdirSync(dir)
    .filter(isSaveFile)
    .map((name) => ({ path: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]
  return newest?.path ?? null
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

/** 앱이 꺼져 있던 동안 저장된 것이 있으면 가장 최근 세이브 하나만 읽고, 사본도 남긴다. */
function importNewestSave(): void {
  const newest = newestSave()
  if (!newest) return
  void handleSaveFile(newest)
  void backupSave(newest)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 380,
    minHeight: 520,
    show: false,
    backgroundColor: '#161c1a',
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

  // 바깥 링크는 앱 안에서 열지 않고 기본 브라우저로 보낸다
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

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
    if (next.watchDirs.join('|') !== before.watchDirs.join('|')) await watcher.start(next.watchDirs)
    if (next.saveDir !== before.saveDir) await saveWatcher.start(next.saveDir)
    return next
  })
  ipcMain.handle('snapshots:list', () => store.listSnapshots())
  ipcMain.handle('snapshots:get', (_event, id: number) => {
    const snapshot = store.getSnapshot(id)
    if (!snapshot) return null
    // 열 지정은 열 때마다 다시 계산해서, 설정을 바꾸면 예전 기록에도 적용되게 한다
    const headers = snapshot.columns.map((col) => col.header)
    snapshot.columns = deriveColumns(
      headers,
      (c) => snapshot.rows.map((row) => row.cells[headers[c]]),
      settings.get().columnOverrides
    )
    return snapshot
  })
  ipcMain.handle('snapshots:setKind', (_event, id: number, kind: SnapshotKind) => store.setKind(id, kind))
  ipcMain.handle('snapshots:delete', (_event, id: number) => store.deleteSnapshot(id))

  ipcMain.handle('import:pick', async () => {
    if (!mainWindow) return []
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: '내보내기 파일 가져오기',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '선수 목록 (CSV, HTML)', extensions: ['csv', 'html', 'htm'] }]
    })
    if (picked.canceled) return []
    return Promise.all(picked.filePaths.map((path) => importFile(store, path, settings.get().columnOverrides)))
  })
  ipcMain.handle('import:paths', (_event, paths: string[]) =>
    Promise.all(paths.map((path) => importFile(store, path, settings.get().columnOverrides)))
  )
  ipcMain.handle('dialog:pickFolder', async () => {
    if (!mainWindow) return null
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: '지켜볼 폴더 선택',
      properties: ['openDirectory']
    })
    return picked.canceled ? null : picked.filePaths[0]
  })
  ipcMain.handle('shell:openPath', async (_event, path: string) => {
    if (existsSync(path)) await shell.openPath(path)
  })

  ipcMain.handle('backup:list', () => backups.list())
  ipcMain.handle('backup:now', async () => {
    const newest = newestSave()
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

  // 세이브 전체를 읽어야 하는 일은 몇 초 걸린다. 화면이 "읽는 중"을 먼저 그릴 틈을 준 뒤 시작한다
  const soon = <T>(work: () => T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(work()), 30))
  ipcMain.handle('world:candidates', (_event, query: CandidateQuery) => soon(() => world.candidates(query)))
  ipcMain.handle('editor:list', (_event, search: string) => soon(() => world.editorList(String(search ?? ''))))
  ipcMain.handle('editor:player', (_event, uid: number) => world.editorPlayer(Number(uid)))
  ipcMain.handle('editor:save', (_event, edits: EditorEdit[]) => world.saveEdits(edits))

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
  console.log('[smoke] snapshots:', JSON.stringify(store.listSnapshots().map((s) => [s.fileName, s.rowCount, s.kind])))
  console.log('[smoke] saved', outFile)
  app.quit()
}

// 앱을 두 번 켜면 폴더 감시와 게임 안 직접 답변이 겹치므로, 이미 떠 있으면 그 창을 앞으로 가져오고 끝낸다
if (!SMOKE_OUT && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

app.whenReady().then(async () => {
  const dataDir = app.getPath('userData')
  mkdirSync(dataDir, { recursive: true })
  store = new Store(join(dataDir, 'fm-bojwagwan.db'))
  settings = new SettingsStore(
    join(dataDir, 'settings.json'),
    app.getPath('documents'),
    WATCH_DIR_OVERRIDE,
    SAVE_DIR_OVERRIDE
  )
  watcher = new ExportWatcher((path) => void handleExportFile(path))
  backups = new BackupManager(
    join(dataDir, 'backups'),
    () => settings.get().saveDir,
    () => settings.get().backupKeep
  )
  world = new WorldService({
    newestSave,
    knownTeam: (fileName) => settings.get().saveTeams[fileName],
    rosterNames: latestRosterNames,
    rememberTeam: (fileName, teamId) => {
      if (settings.get().saveTeams[fileName] !== teamId) {
        settings.set({ saveTeams: { ...settings.get().saveTeams, [fileName]: teamId } })
      }
    },
    roleWeights: () => settings.get().roleWeights,
    backup: async (path) => {
      await backups.backup(path)
      mainWindow?.webContents.send('backup:changed')
    }
  })
  saveWatcher = new SaveWatcher((path) => {
    void handleSaveFile(path)
    void backupSave(path)
  })
  keys = new KeyStore(join(dataDir, 'claude-key.bin'))
  talk = new TalkController(keys, settings, latestSquadNames)

  registerIpc()
  createWindow()
  if (!SMOKE_OUT) createTray()
  // 게임 안 "직접 답변" 칸을 맡는다(검사용 실행에서는 돌리지 않는다)
  if (!process.env.FMB_SMOKE_OUT) void talk.serveGame()
  await watcher.start(settings.get().watchDirs)
  await saveWatcher.start(settings.get().saveDir)
  // 창이 먼저 뜬 뒤에 읽는다(세이브 하나를 읽는 데 몇 초 걸린다)
  setTimeout(importNewestSave, 1200)

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
  void watcher?.stop()
  void saveWatcher?.stop()
  talk?.dispose()
  store?.close()
  app.quit()
})
