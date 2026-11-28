import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parsePluginAnswer, type PluginAnswer } from '@shared/club'
import { parseTree, readGameScene, readMatchInfo, type GameScene } from '@shared/gameUi'
import { STARS_PER_REQUEST } from '@shared/limits'

/**
 * 게임 안 플러그인(plugin/)과 이야기하는 쪽.
 * 플러그인은 켜질 때 %LOCALAPPDATA%\FmBojwagwan\bridge.json에 접속할 주소와 암호를 적어 둔다.
 * 주소는 이 PC 안에서만 닿는다.
 */
interface BridgeInfo {
  host: string
  port: number
  token: string
}

async function info(): Promise<BridgeInfo | null> {
  const base = process.env.LOCALAPPDATA
  if (!base) return null
  try {
    const raw = JSON.parse(await readFile(join(base, 'FmBojwagwan', 'bridge.json'), 'utf8')) as Partial<BridgeInfo>
    if (typeof raw.port !== 'number' || typeof raw.token !== 'string') return null
    const host = raw.host === 'localhost' ? 'localhost' : '127.0.0.1'
    return { host, port: raw.port, token: raw.token }
  } catch {
    return null
  }
}

async function ask(path: string, timeoutMs = 12_000, body?: string): Promise<string | null> {
  const bridge = await info()
  if (!bridge) return null
  try {
    const response = await fetch(`http://${bridge.host}:${bridge.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      body,
      headers: { 'X-Bridge-Token': bridge.token },
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    // 게임이 꺼져 있으면 연결되지 않는다
    return null
  }
}

/** 상태 번호까지 돌려주는 요청. 연결하지 못하면 null (오류 응답도 본문을 돌려준다) */
async function askWithStatus(path: string, timeoutMs: number): Promise<{ status: number; text: string } | null> {
  const bridge = await info()
  if (!bridge) return null
  try {
    const response = await fetch(`http://${bridge.host}:${bridge.port}${path}`, {
      headers: { 'X-Bridge-Token': bridge.token },
      signal: AbortSignal.timeout(timeoutMs)
    })
    return { status: response.status, text: await response.text() }
  } catch {
    return null
  }
}

/** 게임이 켜져 있고 플러그인이 대답하는지 */
export async function bridgeAlive(): Promise<boolean> {
  return (await ask('/ping', 1500)) !== null
}

/** 지금 게임 화면의 토크 장면. 플러그인이 없거나 토크 화면이 아니면 null */
export async function readFromGame(): Promise<GameScene | null> {
  const tree = await ask('/tree')
  if (tree === null) return null
  return readGameScene(parseTree(tree))
}

export interface GameWords {
  seq: number
  /** 'talk'는 선택지가 있는 대화 화면, 'shout'는 경기 중(고를 것은 외침) */
  kind: 'talk' | 'shout'
  words: string
}

/**
 * 게임 안 칸에 새 말이 적힐 때까지 기다린다(최대 25초쯤).
 * 새 말이 없으면 null, 게임에 연결하지 못했으면 'offline'.
 */
export async function waitForWords(after: number): Promise<GameWords | null | 'offline'> {
  const text = await ask(`/talk/poll?after=${after}&wait=25`, 35_000)
  if (text === null) return 'offline'
  const cut = text.indexOf(String.fromCharCode(10))
  if (cut < 0) return null
  const seq = Number(text.slice(0, cut))
  if (!Number.isFinite(seq)) return null
  const rest = text.slice(cut + 1)
  // 둘째 줄은 종류다(예전 플러그인은 종류 없이 곧바로 말이 온다)
  const next = rest.indexOf(String.fromCharCode(10))
  const kind = next < 0 ? '' : rest.slice(0, next)
  if (kind === 'talk' || kind === 'shout') return { seq, kind, words: rest.slice(next + 1) }
  return { seq, kind: 'talk', words: rest }
}

/**
 * 경기 중 장면: 고를 것은 외침 메뉴의 항목이고, 상황은 점수판과 중계 문구에서 읽는다.
 * 플러그인이 외침 목록을 아직 읽지 못했으면 null.
 */
export async function readMatchFromGame(): Promise<GameScene | null> {
  const list = await ask('/talk/shouts')
  if (!list) return null
  const options = list
    .split(String.fromCharCode(10))
    .map((line) => line.split(String.fromCharCode(9)))
    .filter((cells) => cells.length === 2 && Number.isInteger(Number(cells[0])) && cells[1] !== '')
    .map((cells) => ({ text: cells[1], tone: '', ref: Number(cells[0]) }))
  if (options.length === 0) return null
  const tree = await ask('/tree')
  const info: ReturnType<typeof readMatchInfo> = tree === null ? { situation: '', facts: [] } : readMatchInfo(parseTree(tree))
  return {
    panel: 'Match',
    screen: 'touchline_shout',
    situation: info.situation,
    speaker: '경기장의 우리 선수들',
    question: '',
    options,
    facts: info.facts,
    teams: info.teams
  }
}

/** 게임 안 칸에 보여 줄 답 */
export interface GameReply {
  /** 적용할 선택지의 번호(ref). 고를 것이 없으면 0 */
  pick: number
  pickText: string
  /** 칸 아래에 보여 줄 한 줄 */
  note: string
  replies: Array<{ speaker: string; text: string }>
  /** 실패했을 때 보여 줄 말. 있으면 나머지는 쓰지 않는다 */
  error?: string
}

export async function sendReply(seq: number, reply: GameReply): Promise<void> {
  await ask(`/talk/reply?seq=${seq}`, 15_000, JSON.stringify(reply))
}

/** 게임이 알려 준 선수 한 명의 시장 정보(글자는 게임이 적어 준 그대로) */
export interface GamePerson {
  uid: number
  age?: number
  value?: string
  valueSort?: number
  wage?: string
  wageSort?: number
  contractEnd?: string
  nation?: string
  club?: string
  /** 게임의 성별 값: "True"면 여자 */
  gender?: string
}

/** 한 번에 물을 수 있는 선수 수(플러그인의 PersonInfo.MaxPerRequest와 맞춘다) */
export const PEOPLE_PER_REQUEST = 30

/**
 * 선수들의 몸값·주급·계약·국적을 켜져 있는 게임에 묻는다. 게임에서 찾지 못한 선수는 빠진다.
 * 게임이 꺼져 있거나 답하지 못하면 null.
 */
export async function gamePeople(uids: number[]): Promise<GamePerson[] | null> {
  if (uids.length === 0) return []
  const text = await ask(`/people?uids=${uids.slice(0, PEOPLE_PER_REQUEST).join(',')}`, 30_000)
  if (text === null) return null
  try {
    const raw = JSON.parse(text) as GamePerson[]
    return Array.isArray(raw) ? raw.filter((each) => typeof each?.uid === 'number') : null
  } catch {
    return null
  }
}

/** 게임이 알려 준 팀이나 나라 하나 */
export interface GameName {
  /** 세이브에 적힌 그 번호 */
  id: number
  name?: string
  /** 팀일 때: 속한 구단의 이름 */
  club?: string
  /** 팀일 때: 게임의 성별 값("True"면 여자 팀) */
  gender?: string
}

/** 한 번에 물을 수 있는 이름 수(플러그인의 PersonInfo.MaxNames와 맞춘다) */
export const NAMES_PER_REQUEST = 60

/** 팀이나 나라의 이름을 켜져 있는 게임에 묻는다. 게임이 꺼져 있거나 답하지 못하면 null */
export async function gameNames(kind: 'team' | 'nation', ids: number[]): Promise<GameName[] | null> {
  if (ids.length === 0) return []
  const text = await ask(`/names?kind=${kind}&ids=${ids.slice(0, NAMES_PER_REQUEST).join(',')}`, 30_000)
  if (text === null) return null
  try {
    const raw = JSON.parse(text) as GameName[]
    return Array.isArray(raw) ? raw.filter((each) => typeof each?.id === 'number') : null
  } catch {
    return null
  }
}

/** 게임 메모리에서 읽은 선수 한 명의 지금 값 */
export interface LivePlayer {
  /** 게임 메모리에서 찾은 이 선수의 기록 수. 1이어야 값을 믿을 수 있다 */
  found: number
  ca?: number
  pa?: number
  positions?: number[]
  attributes?: number[]
}

function parseLive(text: string | null): LivePlayer | null {
  if (text === null) return null
  try {
    const raw = JSON.parse(text) as LivePlayer
    return typeof raw.found === 'number' ? raw : null
  } catch {
    return null
  }
}

/** 켜져 있는 게임에서 선수의 지금 값을 읽는다. 게임이 꺼져 있으면 null. 처음 찾을 때는 몇 초 걸릴 수 있다 */
export async function livePlayer(uid: number): Promise<LivePlayer | null> {
  return parseLive(await ask(`/live/player?uid=${uid}`, 90_000))
}

/** 켜져 있는 게임에서 선수의 값을 고친다. 고친 뒤의 값을 돌려준다. 게임이 꺼져 있거나 값을 받지 않으면 null */
export async function liveSet(edit: {
  uid: number
  positions?: number[]
  attributes?: number[]
  ca?: number
  pa?: number
}): Promise<LivePlayer | null> {
  const query = new URLSearchParams({ uid: String(edit.uid) })
  if (edit.positions) query.set('positions', edit.positions.join(','))
  if (edit.attributes) query.set('attributes', edit.attributes.join(','))
  if (edit.ca !== undefined) query.set('ca', String(edit.ca))
  if (edit.pa !== undefined) query.set('pa', String(edit.pa))
  return parseLive(await ask(`/live/set?${query.toString()}`, 90_000))
}

/** 선수의 값을 쓴 결과(플러그인 0.13.0부터 실패 응답에 어디서 멈췄는지와 되돌림 결과가 담긴다) */
export type LiveSetOutcome =
  | { kind: 'ok'; player: LivePlayer }
  /** 게임이 꺼져 있거나 플러그인이 대답하지 않는다 */
  | { kind: 'offline' }
  /** 온라인(네트워크) 게임이라 플러그인이 쓰기를 막았다(403) */
  | { kind: 'online' }
  /** 쓰다가 실패했다. failedAt은 실패한 부분, rolledBack은 썼다가 되돌린 부분, restored가 false면 되돌리지도 못했다(옛 플러그인은 모른다) */
  | { kind: 'failed'; failedAt?: string; rolledBack: string[]; restored?: boolean; error: string }

/** 플러그인이 돌려준 오류 글을 화면에 보이기 좋게 짧게 줄인다(이 PC 안의 응답이지만 길이는 제한한다) */
const shortError = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 160)

/** liveSet과 같지만, 실패한 이유와 되돌림 결과까지 돌려준다 */
export async function liveSetOutcome(edit: {
  uid: number
  positions?: number[]
  attributes?: number[]
  ca?: number
  pa?: number
}): Promise<LiveSetOutcome> {
  const query = new URLSearchParams({ uid: String(edit.uid) })
  if (edit.positions) query.set('positions', edit.positions.join(','))
  if (edit.attributes) query.set('attributes', edit.attributes.join(','))
  if (edit.ca !== undefined) query.set('ca', String(edit.ca))
  if (edit.pa !== undefined) query.set('pa', String(edit.pa))
  const answer = await askWithStatus(`/live/set?${query.toString()}`, 90_000)
  if (answer === null) return { kind: 'offline' }
  if (answer.status === 403) return { kind: 'online' }
  if (answer.status >= 200 && answer.status < 300) {
    const player = parseLive(answer.text)
    return player ? { kind: 'ok', player } : { kind: 'failed', rolledBack: [], error: '게임의 대답을 읽지 못했습니다.' }
  }
  try {
    const raw = JSON.parse(answer.text) as { error?: unknown; failedAt?: unknown; rolledBack?: unknown; restored?: unknown }
    return {
      kind: 'failed',
      failedAt: typeof raw.failedAt === 'string' ? raw.failedAt : undefined,
      rolledBack: Array.isArray(raw.rolledBack) ? raw.rolledBack.filter((part): part is string => typeof part === 'string') : [],
      restored: typeof raw.restored === 'boolean' ? raw.restored : undefined,
      error: typeof raw.error === 'string' ? shortError(raw.error) : '값을 넣지 못했습니다.'
    }
  } catch {
    // 알 수 없는 오류는 "형식: 첫 줄" 요약만 온다
    return { kind: 'failed', rolledBack: [], error: shortError(answer.text) || '값을 넣지 못했습니다.' }
  }
}

/** 켜져 있는 게임이 알려 주는 상태 */
export interface GameState {
  /** 게임 안 플러그인의 버전 */
  version: string
  /** 게임의 버전 글자(플러그인 0.14.0부터. 게임이 알려 주지 못했으면 빈 글자, 옛 플러그인이면 없다) */
  gameVersion?: string
  /** 게임이 알려 준 오늘 날짜 "yyyy-MM-dd"(플러그인 0.14.0부터. 아직 모르거나 읽을 수 없는 글자면 빈 글자, 옛 플러그인이면 없다) */
  gameDate?: string
  /** 세이브를 불러와 감독으로 들어가 있는지 */
  loaded: boolean
  manager: string
  team: string
  teamShort: string
  /** 내 팀 선수 이름 */
  players: string[]
  /** 내 팀 선수의 게임 고유 번호(플러그인 0.14.0부터, 옛 플러그인이면 없다). players와 같은 순서·같은 수이고, 읽지 못한 선수는 0이다 */
  playerIds?: number[]
}

/** 플러그인이 주는 날짜 글자 */
const GAME_DATE = /^\d{4}-\d{2}-\d{2}$/

/** 게임의 상태. 게임이 꺼져 있으면 null. 옛 플러그인(상태를 모르는 것)이면 연결됐다는 것만 알려 준다 */
export async function gameState(): Promise<GameState | null> {
  const text = await ask('/state', 2500)
  if (text !== null) {
    try {
      const raw = JSON.parse(text) as Partial<GameState>
      return {
        version: String(raw.version ?? ''),
        // 옛 플러그인(0.14.0 미만)은 게임 버전을 알려 주지 않는다. 키가 없는 것과 빈 글자(읽지 못함)를 가른다
        ...(typeof raw.gameVersion === 'string' ? { gameVersion: raw.gameVersion } : {}),
        // 날짜도 0.14.0부터다. 읽을 수 없는 글자는 "아직 모름"(빈 글자)으로 둔다
        ...(typeof raw.gameDate === 'string' ? { gameDate: GAME_DATE.test(raw.gameDate) ? raw.gameDate : '' } : {}),
        loaded: raw.loaded === true,
        manager: String(raw.manager ?? ''),
        team: String(raw.team ?? ''),
        teamShort: String(raw.teamShort ?? ''),
        players: Array.isArray(raw.players) ? raw.players.map(String) : [],
        // 번호는 players와 같은 순서를 지킨다: 양의 정수가 아닌 값은 0(모름)으로 두고 빼지 않는다
        ...(Array.isArray(raw.playerIds) ? { playerIds: raw.playerIds.map((id) => (typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : 0)) } : {})
      }
    } catch {
      return null
    }
  }
  const ping = await ask('/ping', 1500)
  if (ping === null) return null
  return { version: ping.replace(/^\D*/, ''), loaded: false, manager: '', team: '', teamShort: '', players: [] }
}

/**
 * 켜져 있는 게임에서 모든 선수의 지금 값을 한 덩어리로 받는다.
 * 처음에는 게임이 메모리를 훑느라 수십 초 걸릴 수 있다. 게임이 꺼져 있거나 받지 못하면 null
 */
export async function liveAll(rescan = false): Promise<Buffer | null> {
  const bridge = await info()
  if (!bridge) return null
  try {
    const response = await fetch(`http://${bridge.host}:${bridge.port}/live/all${rescan ? '?rescan=1' : ''}`, {
      headers: { 'X-Bridge-Token': bridge.token },
      signal: AbortSignal.timeout(180_000)
    })
    if (!response.ok) return null
    return Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
}

/** 한 번에 물을 수 있는 선수 수(플러그인의 PersonInfo.MaxPeople과 맞춘다) */
export const HEALTH_BATCH = 30

/**
 * 내 구단의 프로필·시설·재정을 켜져 있는 게임에 묻는다(플러그인 0.11.0 이상).
 * 게임이 꺼져 있거나 답하지 못하면 null.
 */
export async function gameClub(teamId: number): Promise<PluginAnswer | null> {
  const text = await ask(`/club?team=${Math.trunc(teamId)}`, 40_000)
  return text === null ? null : parsePluginAnswer(text)
}

/** 1군 선수들의 건강·경기력을 켜져 있는 게임에 묻는다. 게임에서 찾지 못한 선수는 빠진다. 게임이 꺼져 있거나 답하지 못하면 null */
export async function gameHealth(uids: number[], teamId?: number): Promise<PluginAnswer | null> {
  if (uids.length === 0) return { records: [], paths: {}, skipped: [] }
  const team = teamId !== undefined && teamId > 0 ? `&team=${Math.trunc(teamId)}` : ''
  const text = await ask(`/health?uids=${uids.slice(0, HEALTH_BATCH).join(',')}${team}`, 60_000)
  return text === null ? null : parsePluginAnswer(text)
}

/** 게임 전술을 읽는 시간 한도. 자리마다 역할 목록까지 읽으면(roles=1) 22번을 더 묻기 때문에 훨씬 오래 걸린다 */
const TACTIC_WAIT_MS = 30_000
const TACTIC_WITH_ROLES_WAIT_MS = 120_000
/** 선수 5명의 역할 별점(선수마다 두 국면의 표)을 읽는 시간 한도 */
const ROLE_STARS_WAIT_MS = 60_000

function parseJson(text: string | null): unknown | null {
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/**
 * 켜져 있는 게임의 지금 전술(자리 11개의 포지션·역할, 점유 시와 비점유 시)을 읽는다(플러그인 0.14.0 이상, 읽기만).
 * uid는 내 팀 선수 한 명이다(전술은 선수를 거쳐 읽는다). withRoles가 참이면 자리마다 고를 수 있는 역할 목록도 읽는다(느리다).
 * 풀어 읽는 것은 shared/tacticImport.ts(parseTacticAnswer)가 한다. 게임이 꺼져 있거나, 플러그인이 낮거나, 게임이 바쁘거나, 시간이 넘으면 null.
 */
export async function gameTactic(teamId: number, uid: number, withRoles = false): Promise<unknown | null> {
  const roles = withRoles ? '&roles=1' : ''
  return parseJson(await ask(`/tactic?team=${Math.trunc(teamId)}&uid=${Math.trunc(uid)}${roles}`, withRoles ? TACTIC_WITH_ROLES_WAIT_MS : TACTIC_WAIT_MS))
}

/**
 * 선수들의 역할 별점 표(두 국면)를 켜져 있는 게임에 묻는다(플러그인 0.14.0 이상, 읽기만). 한 번에 STARS_PER_REQUEST명까지다.
 * 게임에서 찾지 못한 선수는 빠진다. 풀어 읽는 것은 shared/roleStars.ts(parseRoleStars)가 한다. 읽지 못하면 null.
 */
export async function gameRoleStars(teamId: number, uids: number[]): Promise<unknown | null> {
  if (uids.length === 0) return { players: [] }
  const list = uids.slice(0, STARS_PER_REQUEST).map((uid) => Math.trunc(uid))
  return parseJson(await ask(`/rolestars?team=${Math.trunc(teamId)}&uids=${list.join(',')}`, ROLE_STARS_WAIT_MS))
}
