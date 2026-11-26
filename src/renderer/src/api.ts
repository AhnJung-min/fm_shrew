import { parseExport } from '@shared/parse'
import { sampleSquadCsv } from '@shared/sample'
import type { Api, BackupEntry, ImportResult, Settings, Snapshot } from '@shared/types'
import { mockCandidates, mockEditorList, mockEditorPlayer } from './lib/mockWorld'

declare global {
  interface Window {
    api?: Api
  }
}

/**
 * 브라우저에서 화면만 볼 때 쓰는 가짜 구현(`npm run web`).
 * 실제 앱에서는 preload가 넣어 준 window.api를 쓴다.
 */
function createMockApi(): Api {
  let settings: Settings = {
    watchDirs: [
      'C:\\Users\\me\\Documents\\Sports Interactive\\Football Manager 26',
      'C:\\Users\\me\\Documents\\Sports Interactive\\Football Manager 2026'
    ],
    saveDir: 'C:\\Users\\me\\Documents\\Sports Interactive\\Football Manager 26\\games',
    saveTeams: {},
    density: 'compact',
    formation: '4-2-3-1',
    slotRoles: {},
    roleWeights: {},
    talkModel: 'claude-sonnet-5-5',
    talkEffort: 'medium',
    talkStats: { requests: 3, inputTokens: 5400, outputTokens: 900 },
    columnOverrides: {},
    matchPairs: [],
    keepRunning: true,
    backupEnabled: true,
    backupKeep: 10
  }
  const hour = 3_600_000
  let mockBackups: BackupEntry[] = [0.4, 2.1, 26, 27.5, 50].map((ago, i) => ({
    id: `sample-${i}`,
    saveName: '리버풀 2025.fm',
    savedAt: new Date(Date.now() - ago * hour).toISOString(),
    beforeRestore: i === 2,
    bytes: 141_000_000 + i * 310_000
  }))
  const empty = new URLSearchParams(location.search).has('empty')
  const snapshots: Snapshot[] = []
  if (!empty) {
    const parsed = parseExport(sampleSquadCsv(), 'player_export_20261125_213045.csv')
    snapshots.push({
      id: 1,
      kind: 'squad',
      sourceFile: `${settings.watchDirs[0]}\\player_export_20261125_213045.csv`,
      fileName: 'player_export_20261125_213045.csv',
      importedAt: new Date().toISOString(),
      rowCount: parsed.rows.length,
      columnCount: parsed.columns.length,
      ...parsed
    })
  }
  let mockHasKey = !new URLSearchParams(location.search).has('nokey')
  const meta = ({ columns: _c, rows: _r, ...rest }: Snapshot) => rest
  const notSupported = async (): Promise<ImportResult[]> => [
    { ok: false, file: '', message: '브라우저 미리보기에서는 파일을 가져올 수 없습니다.' }
  ]

  return {
    getStatus: async () => ({
      watchDirs: settings.watchDirs.map((dir, i) => ({ dir, exists: i === 0 })),
      saveDir: { dir: settings.saveDir, exists: true },
      dataDir: 'C:\\Users\\me\\AppData\\Roaming\\fm-bojwagwan',
      version: '0.1.0'
    }),
    getSettings: async () => settings,
    setSettings: async (patch) => (settings = { ...settings, ...patch }),
    listSnapshots: async () => snapshots.map(meta),
    getSnapshot: async (id) => snapshots.find((s) => s.id === id) ?? null,
    setSnapshotKind: async (id, kind) => {
      const found = snapshots.find((s) => s.id === id)
      if (found) found.kind = kind
    },
    deleteSnapshot: async (id) => {
      const index = snapshots.findIndex((s) => s.id === id)
      if (index >= 0) snapshots.splice(index, 1)
    },
    pickAndImport: notSupported,
    importPaths: notSupported,
    pickFolder: async () => null,
    openPath: async () => undefined,
    pathForFile: () => '',
    onImported: () => () => undefined,

    // 세이브 전체: 미리보기에서는 지어낸 선수들로 화면만 보여 준다
    worldCandidates: async (query) => mockCandidates(query, empty),
    editorList: async (search) => mockEditorList(search, empty),
    editorPlayer: async (uid) => mockEditorPlayer(uid),
    editorApply: async (edits) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return { ok: true, message: `선수 ${edits.length}명의 값을 게임에 반영했습니다. 게임에서 그 선수 화면을 다시 열면 보입니다.` }
    },

    talkStatus: async () => ({ hasKey: mockHasKey, game: true }),
    talkSetKey: async () => ({ hasKey: (mockHasKey = true), game: true }),
    talkClearKey: async () => ({ hasKey: (mockHasKey = false), game: true }),
    backupList: async () => ({
      dir: 'C:\\Users\\me\\AppData\\Roaming\\fm-bojwagwan\\backups',
      entries: empty ? [] : mockBackups,
      totalBytes: empty ? 0 : mockBackups.reduce((sum, entry) => sum + entry.bytes, 0)
    }),
    backupNow: async () => ({ ok: true, message: '가장 최근 저장은 이미 사본이 있습니다.' }),
    backupRestore: async () => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      return { ok: true }
    },
    backupDelete: async (id) => {
      mockBackups = mockBackups.filter((entry) => entry.id !== id)
    },
    onBackupChanged: () => () => undefined
  }
}

export const api: Api = window.api ?? createMockApi()
export const isPreview = !window.api
