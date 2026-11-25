import { useSyncExternalStore } from 'react'
import type { TalkCapture, TalkLine, TalkScene, TalkTurn, TalkUsage } from '@shared/talk'
import { api } from '@/api'

/** 대화 기록의 한 칸 */
export type TalkEntry =
  | { key: number; kind: 'scene'; capture: TalkCapture; scene: TalkScene | null; reading: boolean; usage?: TalkUsage }
  | { key: number; kind: 'me'; text: string }
  | { key: number; kind: 'them'; speaker: string; text: string; staged: boolean }
  | { key: number; kind: 'pick'; scene: TalkScene; turn: TalkTurn; usage?: TalkUsage }
  | { key: number; kind: 'error'; text: string }

interface TalkState {
  entries: TalkEntry[]
  /** 지금 대화가 놓인 장면 */
  scene: TalkScene | null
  /** 화면을 읽는 중이거나 상대의 대답을 기다리는 중 */
  busy: 'reading' | 'replying' | null
}

/**
 * 토크 도우미의 대화 상태. 다른 화면에 다녀와도 대화가 남아 있도록 화면 컴포넌트 밖에 둔다.
 * 앱을 끄면 사라진다(대화를 파일로 남기지 않는다).
 */
let state: TalkState = { entries: [], scene: null, busy: null }
let nextKey = 1
const listeners = new Set<() => void>()

function update(patch: Partial<TalkState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

/** 종류별로 key만 뺀 모양(합집합 타입에 Omit을 그냥 쓰면 종류별 필드가 사라진다) */
type NewEntry = TalkEntry extends infer E ? (E extends TalkEntry ? Omit<E, 'key'> : never) : never

function push(...entries: NewEntry[]): void {
  update({ entries: [...state.entries, ...entries.map((entry) => ({ ...entry, key: nextKey++ }) as TalkEntry)] })
}

function replace(key: number, patch: Partial<TalkEntry>): void {
  update({ entries: state.entries.map((entry) => (entry.key === key ? ({ ...entry, ...patch } as TalkEntry) : entry)) })
}

/** 지금까지 오간 말(감독과 상대). AI가 앞뒤 맥락을 알도록 함께 보낸다 */
function history(): TalkLine[] {
  const lines: TalkLine[] = []
  for (const entry of state.entries) {
    if (entry.kind === 'me') lines.push({ from: 'me', speaker: '감독', text: entry.text })
    if (entry.kind === 'them') lines.push({ from: 'them', speaker: entry.speaker, text: entry.text })
  }
  return lines
}

export const talkStore = {
  /** 새로 찍힌 화면을 대화에 넣고 곧바로 읽는다 */
  async addCapture(capture: TalkCapture): Promise<void> {
    const key = nextKey
    push({ kind: 'scene', capture, scene: null, reading: true })
    update({ busy: 'reading' })
    const result = await api.talkRead(capture.id)
    if (!result.ok || !result.scene) {
      replace(key, { reading: false })
      push({ kind: 'error', text: result.message ?? '화면을 읽지 못했습니다.' })
      update({ busy: null })
      return
    }
    const scene = result.scene
    replace(key, { reading: false, scene, usage: result.usage })
    if (scene.question) push({ kind: 'them', speaker: scene.speaker, text: scene.question, staged: false })
    update({ scene, busy: null })
  },

  addError(text: string): void {
    push({ kind: 'error', text })
  },

  async capture(): Promise<void> {
    const shot = await api.talkCapture()
    if (shot.ok && shot.capture) await talkStore.addCapture(shot.capture)
    else push({ kind: 'error', text: shot.message ?? '화면을 캡처하지 못했습니다.' })
  },

  async say(words: string): Promise<void> {
    const text = words.trim()
    const scene = state.scene
    if (!text || !scene || state.busy) return
    const before = history()
    push({ kind: 'me', text })
    update({ busy: 'replying' })
    const result = await api.talkSay(scene.id, before, text)
    if (!result.ok || !result.turn) {
      push({ kind: 'error', text: result.message ?? '답을 받지 못했습니다.' })
    } else {
      push(
        { kind: 'pick', scene, turn: result.turn, usage: result.usage },
        ...result.turn.replies.map((reply) => ({ kind: 'them' as const, speaker: reply.speaker, text: reply.text, staged: true }))
      )
    }
    update({ busy: null })
  },

  clear(): void {
    update({ entries: [], scene: null })
  }
}

export function useTalk(): TalkState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state
  )
}
