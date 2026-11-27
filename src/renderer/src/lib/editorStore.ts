import { useSyncExternalStore } from 'react'
import type { EditorApplyReport } from '@shared/connect'
import type { EditorEdit, EditorPlayer } from '@shared/world'

/**
 * 에디터에서 고치는 중인 값을 담아 두는 곳(A-15). 화면(Editor)이 사라져도 남아서, 다른 화면에 갔다 와도 고친 값이 그대로다.
 * "게임에 반영"으로 들어간 선수나 사용자가 버린 선수만 비워진다. 앱을 끄면 사라진다(화면 안에서만 산다).
 */

/** 고치는 중인 값. 능력치는 저장값(1~100) 그대로 들고 있다 */
export interface Draft {
  ca: number
  pa: number
  positions: number[]
  attributes: number[]
}

/** 한 선수의 원래 값(고치기 시작할 때의 값)과 고치는 중인 값 */
export interface PendingEntry {
  player: EditorPlayer
  draft: Draft
}

export interface EditorState {
  /** 선수 고유 번호 → 고치는 중인 것 */
  pending: ReadonlyMap<number, PendingEntry>
  /** 가장 최근 "게임에 반영"의 선수·항목별 결과. 없으면 null */
  report: EditorApplyReport | null
  /** 이 세이브(경로)의 선수들에 대한 수정이다. 다른 세이브를 적용하면 비운다 */
  scope: string
}

const sameList = (a: number[], b: number[]): boolean => a.length === b.length && a.every((value, i) => value === b[i])

export const draftOf = (player: EditorPlayer): Draft => ({
  ca: player.ca,
  pa: player.pa,
  positions: [...player.positions],
  attributes: [...player.attributes]
})

export function isChanged(player: EditorPlayer, draft: Draft): boolean {
  return draft.ca !== player.ca || draft.pa !== player.pa || !sameList(draft.positions, player.positions) || !sameList(draft.attributes, player.attributes)
}

/** 고친 항목만 담은 보낼 값 */
export function toEdit(player: EditorPlayer, draft: Draft): EditorEdit {
  const edit: EditorEdit = { uid: player.uid }
  if (draft.ca !== player.ca) edit.ca = draft.ca
  if (draft.pa !== player.pa) edit.pa = draft.pa
  if (!sameList(draft.positions, player.positions)) edit.positions = draft.positions
  if (!sameList(draft.attributes, player.attributes)) edit.attributes = draft.attributes
  return edit
}

/** 선수 하나의 고친 값을 넣는다. 원래 값과 같아졌으면 그 선수는 뺀다 */
export function withDraft(state: EditorState, player: EditorPlayer, draft: Draft): EditorState {
  const pending = new Map(state.pending)
  // 처음 고칠 때의 원래 값을 계속 쓴다(고치는 중에 게임에서 다시 읽은 값으로 바뀌지 않게)
  const original = state.pending.get(player.uid)?.player ?? player
  if (isChanged(original, draft)) pending.set(player.uid, { player: original, draft })
  else pending.delete(player.uid)
  return { ...state, pending }
}

/** 한 선수의 고친 값을 버린다 */
export function withoutPlayer(state: EditorState, uid: number): EditorState {
  if (!state.pending.has(uid)) return state
  const pending = new Map(state.pending)
  pending.delete(uid)
  return { ...state, pending }
}

/** 모든 고친 값을 버린다(결과 안내도 비운다) */
export const cleared = (state: EditorState): EditorState => ({ ...state, pending: new Map(), report: null })

/**
 * "게임에 반영"의 결과를 받아들인다. 모두 들어간 선수만 비우고, 일부만 들어갔거나 실패했거나 보내지 못한 선수는 그대로 둬서
 * 다시 반영하거나 버릴 수 있게 한다.
 */
export function afterApply(state: EditorState, report: EditorApplyReport): EditorState {
  const pending = new Map(state.pending)
  for (const result of report.players ?? []) if (result.status === 'written') pending.delete(result.uid)
  return { ...state, pending, report }
}

/** 보낼 값들 */
export function editsOf(state: EditorState): EditorEdit[] {
  return [...state.pending.values()].map((entry) => toEdit(entry.player, entry.draft))
}

/**
 * 적용한 세이브가 바뀌었을 때. 다른 세이브면(경로가 다르면) 선수 번호가 다른 사람을 가리킬 수 있어 비운다.
 * 경로가 비어 있으면(아직 읽는 중) 아무것도 하지 않는다.
 */
export function inScope(state: EditorState, path: string): EditorState {
  if (path === '' || path === state.scope) return state
  return state.scope === '' ? { ...state, scope: path } : { ...cleared(state), scope: path }
}

export const EMPTY_EDITOR: EditorState = { pending: new Map(), report: null, scope: '' }

/** 상태를 들고 있다가 바뀌면 구독자에게 알린다(React 밖에서도 쓸 수 있게 따로 만든다) */
export function createEditorStore(initial: EditorState = EMPTY_EDITOR) {
  let state = initial
  const listeners = new Set<() => void>()
  const set = (next: EditorState): void => {
    if (next === state) return
    state = next
    listeners.forEach((listener) => listener())
  }
  return {
    get: (): EditorState => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setDraft: (player: EditorPlayer, draft: Draft): void => set(withDraft(state, player, draft)),
    revert: (uid: number): void => set(withoutPlayer(state, uid)),
    discardAll: (): void => set(cleared(state)),
    applied: (report: EditorApplyReport): void => set(afterApply(state, report)),
    dismissReport: (): void => set({ ...state, report: null }),
    scope: (path: string): void => set(inScope(state, path))
  }
}

/** 앱 전체에서 하나. Editor 화면과 사이드바가 같이 쓴다 */
export const editorStore = createEditorStore()

export function useEditorState(): EditorState {
  return useSyncExternalStore(editorStore.subscribe, editorStore.get)
}
