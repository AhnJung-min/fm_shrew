import type { LinkStatus, SaveFileInfo } from '@shared/game'
import type { Api, BackupEntry, Settings } from '@shared/types'
import { mockCandidates, mockEditorList, mockEditorPlayer, mockSquad } from './lib/mockWorld'

declare global {
  interface Window {
    api?: Api
  }
}

/**
 * 브라우저에서 화면만 볼 때 쓰는 가짜 구현(`npm run web`).
 * 실제 앱에서는 preload가 넣어 준 window.api를 쓴다.
 * 주소에 ?empty를 붙이면 세이브를 적용하기 전, ?off를 붙이면 게임이 꺼진 상태,
 * ?old를 붙이면 게임에 옛 플러그인이 올라가 있는 상태를 본다.
 */
function createMockApi(): Api {
  let settings: Settings = {
    saveDir: 'C:\\Users\\me\\Documents\\Sports Interactive\\Football Manager 26\\games',
    saveTeams: {},
    activeSave: '',
    density: 'compact',
    formation: '4-2-3-1',
    slotRoles: {},
    roleWeights: {},
    talkModel: 'claude-sonnet-5-5',
    talkEffort: 'medium',
    talkStats: { requests: 3, inputTokens: 5400, outputTokens: 900 },
    matchPairs: [],
    keepRunning: true,
    backupEnabled: true,
    backupKeep: 10
  }
  const params = new URLSearchParams(location.search)
  const gameOff = params.has('off')
  const oldPlugin = params.has('old')
  const hour = 3_600_000
  const names = ['리버풀 2025', '리버풀 2025 (v02)', '뉴캐슬 시작']
  const saves: SaveFileInfo[] = [0.4, 26, 50].map((ago, i) => ({
    path: `${settings.saveDir}\\${names[i]}.fm`,
    name: `${names[i]}.fm`,
    savedAt: new Date(Date.now() - ago * hour).toISOString(),
    bytes: 145_000_000 - i * 1_300_000
  }))
  let applied: SaveFileInfo | null = params.has('empty') ? null : saves[0]
  let mockBackups: BackupEntry[] = [0.4, 2.1, 26, 27.5, 50].map((ago, i) => ({
    id: `sample-${i}`,
    saveName: '리버풀 2025.fm',
    savedAt: new Date(Date.now() - ago * hour).toISOString(),
    beforeRestore: i === 2,
    bytes: 141_000_000 + i * 310_000
  }))
  let mockHasKey = !params.has('nokey')
  const listeners = new Set<(status: LinkStatus) => void>()
  /** 게임의 지금 값을 쓰고 있는 상태인지 */
  const live = (): boolean => applied !== null && !gameOff && !oldPlugin
  const linkStatus = (busy = false): LinkStatus => ({
    game: gameOff
      ? { connected: false, pluginVersion: '', pluginOld: false, loaded: false, manager: '', team: '', teamShort: '' }
      : { connected: true, pluginVersion: oldPlugin ? '0.8.0' : '0.9.0', pluginOld: oldPlugin, loaded: true, manager: '김 감독', team: '리버풀', teamShort: 'LIV' },
    data: {
      save: applied,
      players: applied ? 99_892 : 0,
      hasTeam: applied !== null,
      club: applied ? '리버풀' : '',
      source: live() ? 'game' : 'save',
      liveAt: live() ? new Date(Date.now() - 40_000).toISOString() : null,
      liveMatched: live() ? 99_888 : 0,
      note: applied && gameOff ? '게임이 꺼져 있어 세이브에 저장된 값을 보여 줍니다.' : '',
      namesStage: live() ? 3 : 0
    },
    busy
  })
  const tell = (busy = false): void => listeners.forEach((listener) => listener(linkStatus(busy)))

  return {
    getStatus: async () => ({
      saveDir: { dir: settings.saveDir, exists: true },
      dataDir: 'C:\\Users\\me\\AppData\\Roaming\\fm-bojwagwan',
      version: '0.1.0'
    }),
    getSettings: async () => settings,
    setSettings: async (patch) => (settings = { ...settings, ...patch }),
    openPath: async () => undefined,

    linkStatus: async () => linkStatus(),
    listSaves: async () => saves,
    applySave: async (path) => {
      tell(true)
      await new Promise((resolve) => setTimeout(resolve, 900))
      applied = saves.find((save) => save.path === path) ?? applied
      tell()
      return { ok: true, message: `“${applied?.name}”을 적용했습니다. 선수 99,892명을 읽었습니다.` }
    },
    refreshLive: async () => {
      tell(true)
      await new Promise((resolve) => setTimeout(resolve, 700))
      tell()
    },
    onLinkChanged: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    worldSquad: async () => mockSquad(applied === null),

    // 세이브 전체: 미리보기에서는 지어낸 선수들로 화면만 보여 준다
    worldCandidates: async (query) => mockCandidates(query, applied === null),
    worldMarket: async (uids) => {
      if (gameOff) return { ok: false, message: '게임이 꺼져 있어 몸값과 주급은 세이브에 적힌 값(파운드)으로 보여 줍니다.', players: [] }
      if (oldPlugin) return { ok: false, message: '몸값과 주급은 세이브에 적힌 값(파운드)입니다. 게임이 보여 주는 금액과 나라·구단 이름은 FM을 완전히 껐다가 다시 켜면 채워집니다.', players: [] }
      await new Promise((resolve) => setTimeout(resolve, 400))
      const nations = ['대한민국', '브라질', '프랑스', '잉글랜드', '아르헨티나', '독일']
      return {
        ok: true,
        players: uids.map((uid, i) => {
          const low = 20 + ((uid * 7) % 180)
          return {
            uid,
            value: `${low}억 원 - ${low + 15 + (uid % 40)}억 원`,
            valueSort: low * 55_000,
            wage: `주급 ${(0.3 + ((uid * 3) % 50) / 10).toFixed(1)}억 원`,
            wageSort: 15_000 + ((uid * 3) % 50) * 5_000,
            contractEnd: { year: 2026 + (uid % 5), month: 6, day: 30 },
            nation: nations[(uid + i) % nations.length],
            female: false
          }
        })
      }
    },
    editorList: async (search) => mockEditorList(search, applied === null),
    editorPlayer: async (uid) => mockEditorPlayer(uid, !gameOff && !oldPlugin),
    editorApply: async (edits) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return { ok: true, message: `선수 ${edits.length}명의 값을 게임에 반영했습니다. 게임에서 그 선수 화면을 다시 열면 보입니다.` }
    },

    talkStatus: async () => ({ hasKey: mockHasKey, game: !gameOff }),
    talkSetKey: async () => ({ hasKey: (mockHasKey = true), game: !gameOff }),
    talkClearKey: async () => ({ hasKey: (mockHasKey = false), game: !gameOff }),
    backupList: async () => ({
      dir: 'C:\\Users\\me\\AppData\\Roaming\\fm-bojwagwan\\backups',
      entries: mockBackups,
      totalBytes: mockBackups.reduce((sum, entry) => sum + entry.bytes, 0)
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
