import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { deriveColumns } from '@shared/parse'
import type { AppStatus, ImportResult, Settings, SnapshotKind } from '@shared/types'
import { Store } from './db'
import { importFile } from './importer'
import { importSave } from './saveImporter'
import { SettingsStore } from './settings'
import { TalkController } from './talk/controller'
import { KeyStore } from './talk/keyStore'
import { ExportWatcher, isSaveFile, SaveWatcher } from './watcher'

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

async function handleSaveFile(path: string): Promise<void> {
  const fileName = basename(path)
  const result = await importSave(store, path, {
    knownTeamId: settings.get().saveTeams[fileName],
    rosterNames: latestRosterNames()
  })
  if (result.needsRoster) pendingSave = path
  else if (pendingSave === path) pendingSave = null
  if (result.teamId !== undefined && settings.get().saveTeams[fileName] !== result.teamId) {
    settings.set({ saveTeams: { ...settings.get().saveTeams, [fileName]: result.teamId } })
  }
  if (!result.skipped) mainWindow?.webContents.send('import:done', result)
}

/** 앱이 꺼져 있던 동안 저장된 것이 있으면 가장 최근 세이브 하나만 읽는다. */
function importNewestSave(): void {
  const dir = settings.get().saveDir
  if (!existsSync(dir)) return
  const newest = readdirSync(dir)
    .filter(isSaveFile)
    .map((name) => ({ path: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]
  if (newest) void handleSaveFile(newest.path)
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

function registerIpc(): void {
  ipcMain.handle('status:get', () => getStatus())
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:set', async (_event, patch: Partial<Settings>) => {
    const before = settings.get()
    const next = settings.set(patch)
    if (next.watchDirs.join('|') !== before.watchDirs.join('|')) await watcher.start(next.watchDirs)
    if (next.saveDir !== before.saveDir) await saveWatcher.start(next.saveDir)
    if (next.talkHotkey !== before.talkHotkey) talk.registerHotkey()
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

  ipcMain.handle('talk:status', () => talk.status())
  ipcMain.handle('talk:setKey', (_event, key: string) => {
    keys.save(key)
    return talk.status()
  })
  ipcMain.handle('talk:clearKey', () => {
    keys.clear()
    return talk.status()
  })
  ipcMain.handle('talk:capture', () => talk.capture())
  ipcMain.handle('talk:ask', (_event, captureId: number, intent: string) => talk.ask(captureId, intent))
  ipcMain.handle('window:hide', () => talk.hideWindow())
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
  saveWatcher = new SaveWatcher((path) => void handleSaveFile(path))
  keys = new KeyStore(join(dataDir, 'claude-key.bin'))
  talk = new TalkController(keys, settings, () => mainWindow)

  registerIpc()
  createWindow()
  talk.registerHotkey()
  await watcher.start(settings.get().watchDirs)
  await saveWatcher.start(settings.get().saveDir)
  // 창이 먼저 뜬 뒤에 읽는다(세이브 하나를 읽는 데 몇 초 걸린다)
  setTimeout(importNewestSave, 1200)

  if (SMOKE_OUT) void runSmoke(SMOKE_OUT)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  void watcher?.stop()
  void saveWatcher?.stop()
  talk?.dispose()
  store?.close()
  app.quit()
})
