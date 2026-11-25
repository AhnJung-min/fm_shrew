import { parseExport } from '@shared/parse'
import { sampleSquadCsv } from '@shared/sample'
import type { Api, ImportResult, Settings, Snapshot } from '@shared/types'

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
    columnOverrides: {}
  }
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
    onImported: () => () => undefined
  }
}

export const api: Api = window.api ?? createMockApi()
export const isPreview = !window.api
