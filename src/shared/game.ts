/** 앱과 게임(게임 안 플러그인) 사이의 연결, 그리고 지금 쓰고 있는 세이브의 상태 */

/** 켜져 있는 게임이 알려 주는 것 */
export interface GameStatus {
  /** 게임이 켜져 있고 게임 안 플러그인이 대답하는지 */
  connected: boolean
  pluginVersion: string
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

export const NO_GAME: GameStatus = { connected: false, pluginVersion: '', loaded: false, manager: '', team: '', teamShort: '' }

export const NO_DATA: DataStatus = {
  save: null,
  players: 0,
  hasTeam: false,
  club: '',
  source: 'save',
  liveAt: null,
  liveMatched: 0,
  note: ''
}
