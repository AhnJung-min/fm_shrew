import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseTree, readGameScene, type GameScene } from '@shared/gameUi'

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

/**
 * 선택지를 게임에서 누른다. 누르기 직전에 화면을 다시 읽어, 그 자리에 같은 문장이 그대로 있는지 확인한다
 * (그 사이에 화면이 넘어갔으면 누르지 않는다).
 */
export async function pressInGame(ref: number, expectedText: string): Promise<{ ok: boolean; message?: string }> {
  const now = await readFromGame()
  if (!now) return { ok: false, message: '게임 화면이 바뀌었습니다. 다시 읽어 주세요.' }
  const option = now.options.find((o) => o.ref === ref)
  if (!option || option.text !== expectedText) {
    return { ok: false, message: '게임 화면의 선택지가 바뀌었습니다. 다시 읽어 주세요.' }
  }
  const result = await ask(`/click?id=${ref}&mode=clickable`)
  if (result === null) return { ok: false, message: '게임에 연결하지 못했습니다.' }
  if (!result.startsWith('ok')) return { ok: false, message: `게임이 누르기를 받지 않았습니다: ${result}` }
  return { ok: true }
}

/** 게임 안 "직접 답변" 칸에 적힌 말 */
export interface GameWords {
  seq: number
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
  return Number.isFinite(seq) ? { seq, words: text.slice(cut + 1) } : null
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
