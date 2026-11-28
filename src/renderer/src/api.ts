import type { ClubChoice, EditorApplyReport, ExtendedLinkStatus, ExtraApi } from '@shared/connect'
import { CLUB_PLUGIN, type SaveFileInfo } from '@shared/game'
import type { SaveRecords } from '@shared/records'
import type { Api, BackupEntry, Settings } from '@shared/types'
import { mockCandidates, mockClub, mockDashboard, mockEditorList, mockEditorPlayer, mockProfile, mockSeason, mockSquad } from './lib/mockWorld'
import { mockRoleToolsApi } from './lib/mock/roleTools'
import { mockTacticsApi } from './lib/mock/tactics'
import { mockTacticToolsApi } from './lib/mock/tacticTools'
import { WON_RATE_TEXT } from '@shared/playerView'

declare global {
  interface Window {
    api?: Api & ExtraApi
  }
}

/**
 * 브라우저에서 화면만 볼 때 쓰는 가짜 구현(`npm run web`).
 * 실제 앱에서는 preload가 넣어 준 window.api를 쓴다.
 * 주소에 ?empty를 붙이면 세이브를 적용하기 전, ?off를 붙이면 게임이 꺼진 상태,
 * ?old를 붙이면 게임에 옛 플러그인이 올라가 있는 상태, ?noteam을 붙이면 내 구단을 아직 모르는 상태, ?badformat을 붙이면 세이브 형식 점검에 걸린 상태를 본다.
 */
function createMockApi(): Api & ExtraApi {
  let settings: Settings = {
    saveDir: 'C:\\Users\\me\\Documents\\Sports Interactive\\Football Manager 26\\games',
    saveTeams: {},
    activeSave: '',
    density: 'compact',
    theme: 'blue',
    formation: '4-2-3-1',
    slotRoles: {},
    roleWeights: {},
    talkModel: 'claude-sonnet-5-5',
    talkEffort: 'medium',
    talkStats: { requests: 3, inputTokens: 5400, outputTokens: 900 },
    matchPairs: [],
    keepRunning: true,
    backupEnabled: true,
    backupKeep: 3
  }
  const params = new URLSearchParams(location.search)
  const gameOff = params.has('off')
  const oldPlugin = params.has('old')
  let teamKnown = !params.has('noteam')
  const badFormat = params.has('badformat')
  /** 지어낸 구단들(고르기 화면용) */
  const clubs: ClubChoice[] = [
    { teamId: 1, uid: 0, name: '가온 시티', short: 'GAO', nation: '가상 나라', women: false, players: 27, strength: 132, human: true },
    { teamId: 2, uid: 0, name: '나루 유나이티드', short: 'NAR', nation: '가상 나라', women: false, players: 25, strength: 128, human: false },
    { teamId: 3, uid: 0, name: '다솜 로버스', short: 'DAS', nation: '', women: false, players: 31, strength: 104, human: false },
    { teamId: 4, uid: 0, name: '라온 레이디스', short: 'RAO', nation: '가상 나라', women: true, players: 24, strength: 96, human: false }
  ]
  const hour = 3_600_000
  const names = ['가온 시티 2025', '가온 시티 2025 (v02)', '새 시작']
  const saves: SaveFileInfo[] = [0.4, 26, 50].map((ago, i) => ({
    path: `${settings.saveDir}\\${names[i]}.fm`,
    name: `${names[i]}.fm`,
    savedAt: new Date(Date.now() - ago * hour).toISOString(),
    bytes: 145_000_000 - i * 1_300_000
  }))
  let applied: SaveFileInfo | null = params.has('empty') ? null : saves[0]
  let mockBackups: BackupEntry[] = [0.4, 2.1, 26, 27.5, 50].map((ago, i) => ({
    id: `sample-${i}`,
    saveName: '가온 시티 2025.fm',
    savedAt: new Date(Date.now() - ago * hour).toISOString(),
    beforeRestore: i === 2,
    bytes: 141_000_000 + i * 310_000
  }))
  let mockRecords: SaveRecords[] = [
    { id: 'a1b2c3d4', label: '내 세이브 A', teamId: 101, created: '2026-11-01', bytes: 3_400_000, snapshots: 6, lastSnapshot: '2027-01-15', ratedMatches: 24 },
    { id: 'e5f6a7b8', label: '내 세이브 B', teamId: 202, created: '2026-11-20', bytes: 620_000, snapshots: 1, lastSnapshot: '2026-07-01', ratedMatches: 0 }
  ]
  let mockHasKey = !params.has('nokey')
  const listeners = new Set<(status: ExtendedLinkStatus) => void>()
  /** 게임의 지금 값을 쓰고 있는 상태인지 */
  const live = (): boolean => applied !== null && !gameOff && !oldPlugin
  const linkStatus = (busy = false): ExtendedLinkStatus => ({
    game: gameOff
      ? { connected: false, pluginVersion: '', pluginOld: false, loaded: false, manager: '', team: '', teamShort: '' }
      : { connected: true, pluginVersion: oldPlugin ? '0.8.0' : CLUB_PLUGIN, pluginOld: oldPlugin, loaded: true, manager: '김 감독', team: '가온 시티', teamShort: 'GAO' },
    data: {
      save: applied,
      players: applied ? 99_892 : 0,
      hasTeam: applied !== null && teamKnown,
      club: applied && teamKnown ? '가온 시티' : '',
      clubUid: null,
      source: live() ? 'game' : 'save',
      liveAt: live() ? new Date(Date.now() - 40_000).toISOString() : null,
      liveMatched: live() ? 99_888 : 0,
      note: applied && gameOff ? '게임이 꺼져 있어 세이브에 저장된 값을 보여 줍니다.' : '',
      namesStage: live() ? 3 : 0
    },
    busy,
    check: badFormat && applied ? { ok: false, problems: ['이름을 읽지 못한 선수가 41,200명(41.2%)입니다. 보통은 0.1% 미만입니다.', '현재 능력과 능력치 평균의 관계가 약합니다(상관 0.05, 보통 0.9 안팎). 두 값이 어긋나게 읽혔을 수 있습니다.'] } : { ok: true, problems: [] },
    teamNote: ''
  })
  const tell = (busy = false): void => listeners.forEach((listener) => listener(linkStatus(busy)))
  /** 전술·역할 도구의 목업이 설정을 읽고 바꾸는 길 */
  const state = {
    getSettings: (): Settings => settings,
    setSettings: (next: Settings): void => {
      settings = next
    }
  }

  return {
    // 2단계 새 창구의 목업(각 단위가 자기 파일을 채운다)
    ...mockTacticsApi(state),
    ...mockTacticToolsApi(state),
    ...mockRoleToolsApi(state),

    getStatus: async () => ({
      saveDir: { dir: settings.saveDir, exists: true },
      dataDir: 'C:\\Users\\me\\AppData\\Roaming\\fm-bojwagwan',
      version: '0.1.0'
    }),
    getSettings: async () => settings,
    setSettings: async (patch) => (settings = { ...settings, ...patch }),
    openPath: async () => undefined,

    linkStatus: async () => linkStatus(),
    worldClubs: async () => ({ ok: applied !== null, clubs: applied ? clubs : [] }),
    chooseTeam: async (teamId) => {
      tell(true)
      await new Promise((resolve) => setTimeout(resolve, 600))
      teamKnown = true
      tell()
      return { ok: true, message: `내 구단을 ${clubs.find((club) => club.teamId === teamId)?.name ?? ''}(으)로 정했습니다.` }
    },
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
    worldSeason: async () => mockSeason(applied === null),
    worldDashboard: async () => mockDashboard(applied === null, settings),
    worldClub: async () => {
      await new Promise((resolve) => setTimeout(resolve, 350))
      return mockClub({ empty: applied === null, off: gameOff, old: oldPlugin })
    },

    // 세이브 전체: 미리보기에서는 지어낸 선수들로 화면만 보여 준다
    worldCandidates: async (query) => mockCandidates(query, applied === null),
    worldMarket: async (uids) => {
      if (gameOff) return { ok: false, message: `게임이 꺼져 있어 몸값과 주급은 세이브에 적힌 값(파운드)을 원화로 바꿔(${WON_RATE_TEXT}) 보여 줍니다.`, players: [] }
      if (oldPlugin) return { ok: false, message: `몸값과 주급은 세이브에 적힌 값(파운드)을 원화로 바꿔(${WON_RATE_TEXT}) 보여 줍니다. 게임이 보여 주는 금액과 나라·구단 이름은 FM을 완전히 껐다가 다시 켜면 채워집니다.`, players: [] }
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
    worldProfile: async (uid) => mockProfile(uid, !gameOff && !oldPlugin),
    faceUrl: () => null,
    clubLogoUrl: () => null,
    editorList: async (search) => mockEditorList(search, applied === null),
    editorPlayer: async (uid) => mockEditorPlayer(uid, !gameOff && !oldPlugin),
    editorApplyReport: async (edits): Promise<EditorApplyReport> => ({
      ok: true,
      message: `선수 ${edits.length}명의 값을 게임에 반영했습니다.`,
      players: edits.map((edit) => ({ uid: edit.uid, name: String(edit.uid), status: 'written', written: ['ca'], failed: [] }))
    }),
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
    recordsList: async () => mockRecords,
    recordsRemove: async (id) => {
      mockRecords = mockRecords.filter((entry) => entry.id !== id)
      return { ok: true }
    },
    onBackupChanged: () => () => undefined,
    onSettingsChanged: () => () => undefined
  }
}

export const api: Api & ExtraApi = window.api ?? createMockApi()
export const isPreview = !window.api
