/** 앱과 게임(게임 안 플러그인) 사이의 연결, 그리고 지금 쓰고 있는 세이브의 상태 */

/**
 * 앱이 기대하는 게임 안 플러그인의 버전(plugin/Plugin.cs의 Version과 맞춘다).
 * 게임에 올라가 있는 플러그인이 이보다 낮으면, 게임의 지금 값을 읽고 고치는 일을 하지 않고 게임을 다시 켜 달라고 안내한다.
 * (플러그인 파일을 바꿔도 게임은 켤 때 읽은 것을 계속 쓴다)
 */
export const NEEDED_PLUGIN = '0.9.0'

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

export const NO_GAME: GameStatus = { connected: false, pluginVersion: '', pluginOld: false, loaded: false, manager: '', team: '', teamShort: '' }

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
