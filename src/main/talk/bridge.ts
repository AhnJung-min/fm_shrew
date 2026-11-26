import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseTree, readGameScene, readMatchInfo, type GameScene } from '@shared/gameUi'

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

/** 켜져 있는 게임이 알려 주는 상태 */
export interface GameState {
  version: string
  /** 세이브를 불러와 감독으로 들어가 있는지 */
  loaded: boolean
  manager: string
  team: string
  teamShort: string
  /** 내 팀 선수 이름 */
  players: string[]
}

/** 게임의 상태. 게임이 꺼져 있으면 null. 옛 플러그인(상태를 모르는 것)이면 연결됐다는 것만 알려 준다 */
export async function gameState(): Promise<GameState | null> {
  const text = await ask('/state', 2500)
  if (text !== null) {
    try {
      const raw = JSON.parse(text) as Partial<GameState>
      return {
        version: String(raw.version ?? ''),
        loaded: raw.loaded === true,
        manager: String(raw.manager ?? ''),
        team: String(raw.team ?? ''),
        teamShort: String(raw.teamShort ?? ''),
        players: Array.isArray(raw.players) ? raw.players.map(String) : []
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
