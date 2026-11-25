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
    formation: '4-2-3-1',
    slotRoles: {},
    roleWeights: {},
    talkHotkey: 'CommandOrControl+Shift+Space',
    talkModel: 'claude-opus-5-5',
    talkPhrases: ['잘하고 있다, 이대로 계속 가자', '실망스럽다, 더 집중해야 한다'],
    talkAllowScreen: false,
    talkStats: { requests: 3, inputTokens: 5400, outputTokens: 900 },
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

    // 토크 도우미: 미리보기에서는 정해 둔 답을 돌려준다
    talkStatus: async () => ({ hasKey: mockHasKey, hotkey: 'Ctrl+Shift+Space' }),
    talkSetKey: async () => ({ hasKey: (mockHasKey = true), hotkey: 'Ctrl+Shift+Space' }),
    talkClearKey: async () => ({ hasKey: (mockHasKey = false), hotkey: 'Ctrl+Shift+Space' }),
    talkCapture: async () => ({
      ok: true,
      capture: { id: 1, preview: '', capturedAt: new Date().toISOString(), source: 'window', width: 1920, height: 1080 }
    }),
    talkAsk: async () => ({
      ok: true,
      advice: {
        screen: 'team_talk',
        situation: '하프타임, 0-1로 지고 있습니다. 어조와 말을 고르는 락커룸 토크 화면입니다.',
        readable: true,
        recommendation: {
          option: '아직 끝나지 않았다. 후반에 뒤집을 수 있다고 믿는다.',
          tone: '단호하게',
          reason: '실망을 드러내되 믿음을 주고 싶다는 뜻과 가장 가깝습니다.'
        },
        alternatives: [
          { option: '이런 경기력은 받아들일 수 없다.', tone: '공격적으로', reason: '실망은 전하지만 믿음의 뜻은 빠집니다.' }
        ],
        offer: { opening: '', structure: '', walkAway: '' },
        caution: ''
      },
      usage: { inputTokens: 1830, outputTokens: 260, model: 'claude-opus-5-5' }
    }),
    onTalkCaptured: () => () => undefined,
    hideWindow: async () => undefined
  }
}

export const api: Api = window.api ?? createMockApi()
export const isPreview = !window.api
