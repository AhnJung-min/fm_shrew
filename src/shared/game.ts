/** 앱과 게임(게임 안 플러그인) 사이의 연결, 그리고 지금 쓰고 있는 세이브의 상태 */

/**
 * 앱이 기대하는 게임 안 플러그인의 버전(plugin/Plugin.cs의 Version과 맞춘다).
 * 게임에 올라가 있는 플러그인이 이보다 낮으면, 게임의 지금 값을 읽고 고치는 일을 하지 않고 게임을 다시 켜 달라고 안내한다.
 * (플러그인 파일을 바꿔도 게임은 켤 때 읽은 것을 계속 쓴다)
 */
export const NEEDED_PLUGIN = '0.9.0'

/** 선수의 몸값·주급·계약을 게임에 물어 받는 기능이 들어간 플러그인 버전. 이보다 낮으면 영입 후보에 그 열이 비어 있다 */
export const MARKET_PLUGIN = '0.10.0'

/** 내 구단의 프로필·시설·재정과 선수단의 건강·경기력을 게임에 물어 받는 기능이 들어간 플러그인 버전. 이보다 낮으면 대시보드의 그 카드가 비어 있다 */
export const CLUB_PLUGIN = '0.11.0'

/** 버전 a가 b보다 낮은지("0.8.0" < "0.9.0"). 읽을 수 없는 버전은 낮은 것으로 본다 */
export function versionOlder(a: string, b: string): boolean {
  const parts = (text: string): number[] => text.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0)
  }
  return false
}

/** 켜져 있는 게임이 알려 주는 것 */
export interface GameStatus {
  /** 게임이 켜져 있고 게임 안 플러그인이 대답하는지 */
  connected: boolean
  pluginVersion: string
  /** 게임에 올라가 있는 플러그인이 앱이 기대하는 것보다 옛 버전인지(게임을 다시 켜야 바뀐다) */
  pluginOld: boolean
  /** 게임에서 세이브를 불러와 감독으로 들어가 있는지(메인 메뉴면 false) */
  loaded: boolean
  manager: string
  team: string
  teamShort: string
}

/** 세이브 폴더에 있는 세이브 파일 하나 */
export interface SaveFileInfo {
  /** 전체 경로 */
  path: string
  name: string
  /** 게임이 마지막으로 저장한 시각 */
  savedAt: string
  bytes: number
}

/** 적용해 둔 세이브와, 화면에 보이는 값이 어디서 온 것인지 */
export interface DataStatus {
  /** 적용한 세이브. 아직 고르지 않았으면 null */
  save: SaveFileInfo | null
  /** 세이브에서 읽은 선수 수 */
  players: number
  /** 세이브에서 내 팀을 찾았는지 */
  hasTeam: boolean
  /** 내 구단 이름(찾았을 때) */
  club: string
  /** 내 구단의 고유 번호(엠블럼). 모르면 null */
  clubUid: number | null
  /**
   * 능력치 값의 출처.
   * game: 켜져 있는 게임의 지금 값, save: 세이브에 저장된 값
   */
  source: 'game' | 'save'
  /** 게임에서 지금 값을 받은 시각과 그 선수 수 */
  liveAt: string | null
  liveMatched: number
  /** 게임의 값을 쓰지 못할 때 그 이유 */
  note: string
  /**
   * 세이브에 번호만 있는 이름(나라, 구단을 알아내지 못한 팀)을 게임에 물어 어디까지 알아냈는지.
   * 0 아직, 1 나라 이름, 2 구단을 못 찾던 팀, 3 모든 팀. 단계가 오르면 화면이 자료를 다시 읽는다.
   */
  namesStage: number
}

export interface LinkStatus {
  game: GameStatus
  data: DataStatus
  /** 세이브를 읽거나 게임에서 값을 받는 중 */
  busy: boolean
}

export interface ApplyResult {
  ok: boolean
  message: string
}

export const NO_GAME: GameStatus = { connected: false, pluginVersion: '', pluginOld: false, loaded: false, manager: '', team: '', teamShort: '' }

export const NO_DATA: DataStatus = {
  save: null,
  players: 0,
  hasTeam: false,
  club: '',
  clubUid: null,
  source: 'save',
  liveAt: null,
  liveMatched: 0,
  note: '',
  namesStage: 0
}
