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
    talkModel: 'claude-sonnet-5-5',
    talkEffort: 'medium',
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
    talkStatus: async () => ({ hasKey: mockHasKey, hotkey: 'Ctrl+Shift+Space', game: true }),
    talkSetKey: async () => ({ hasKey: (mockHasKey = true), hotkey: 'Ctrl+Shift+Space', game: true }),
    talkClearKey: async () => ({ hasKey: (mockHasKey = false), hotkey: 'Ctrl+Shift+Space', game: true }),
    talkCapture: async () => ({
      ok: true,
      capture: { id: 1, preview: '', capturedAt: new Date().toISOString(), source: 'game', width: 0, height: 0 }
    }),
    talkRead: async (captureId) => ({
      ok: true,
      scene: {
        id: captureId,
        screen: 'press_conference',
        readable: true,
        situation: '경기 전 기자회견입니다. 다음 상대는 브라이턴입니다.',
        speaker: '제임스 피어스 (디 애슬레틱)',
        question: '최근 세 경기에서 실점이 많았습니다. 수비진에 변화를 줄 계획이 있습니까?',
        options: [
          { text: '수비진을 전적으로 신뢰한다.', tone: '긍정적', ref: 11 },
          { text: '몇 자리는 경쟁이 필요하다.', tone: '중립적', ref: 12 },
          { text: '그 질문에는 답하지 않겠다.', tone: '부정적', ref: 13 },
          { text: '기자회견장을 떠난다', tone: '', ref: 14 }
        ],
        facts: [],
        source: 'game'
      },
      usage: { inputTokens: 2140, outputTokens: 310, model: 'claude-sonnet-5-5' }
    }),
    talkSay: async () => ({
      ok: true,
      turn: {
        pickIndex: 1,
        confidence: 0.82,
        reason: '믿지만 긴장감은 필요하다는 말이라, 경쟁을 언급하는 선택지가 가장 가깝습니다.',
        replies: [{ speaker: '제임스 피어스 (디 애슬레틱)', text: '그렇다면 브라이턴전 선발 명단에 변화가 있다고 봐도 되겠습니까?' }],
        nextAction: '',
        offer: { opening: '', structure: '', walkAway: '' },
        caution: ''
      },
      usage: { inputTokens: 640, outputTokens: 180, model: 'claude-sonnet-5-5' }
    }),
    talkPress: async () => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return { ok: true }
    },
    onTalkCaptured: () => () => undefined,
    hideWindow: async () => undefined
  }
}

export const api: Api = window.api ?? createMockApi()
export const isPreview = !window.api
