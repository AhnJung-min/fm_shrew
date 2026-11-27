/**
 * 에디터 고친 값 저장소(A-15)의 시험: 화면이 사라져도 남고, 반영하거나 버릴 때만 비워진다.
 * 선수 이름은 모두 지어낸 것이다.
 */
import { describe, expect, it, vi } from 'vitest'
import type { EditorApplyReport } from '../src/shared/connect'
import type { EditorPlayer } from '../src/shared/world'
import { createEditorStore, draftOf, editsOf, EMPTY_EDITOR, isChanged, toEdit } from '../src/renderer/src/lib/editorStore'

const player = (uid: number, over: Partial<EditorPlayer> = {}): EditorPlayer => ({
  uid,
  name: `가상선수${uid}`,
  age: 24,
  position: 'DC',
  club: '가상구단',
  ca: 120,
  pa: 140,
  positions: Array.from({ length: 15 }, () => 5),
  attributes: Array.from({ length: 54 }, () => 50),
  source: 'game',
  ...over
})

describe('고친 값 판정', () => {
  it('고치지 않았으면 바뀐 것이 아니고, 보낼 값은 uid뿐이다', () => {
    const p = player(1)
    expect(isChanged(p, draftOf(p))).toBe(false)
    expect(toEdit(p, draftOf(p))).toEqual({ uid: 1 })
  })

  it('고친 항목만 보낸다', () => {
    const p = player(1)
    const d = draftOf(p)
    d.ca = 130
    d.attributes[3] = 80
    expect(isChanged(p, d)).toBe(true)
    const edit = toEdit(p, d)
    expect(edit.ca).toBe(130)
    expect(edit.pa).toBeUndefined()
    expect(edit.positions).toBeUndefined()
    expect(edit.attributes?.[3]).toBe(80)
  })
})

describe('저장소: 화면을 옮겨도 남는다', () => {
  it('고친 값은 저장소에 남아 있고, 구독자에게 알려진다', () => {
    const store = createEditorStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const p = player(1)
    const d = draftOf(p)
    d.ca = 130
    store.setDraft(p, d)
    expect(store.get().pending.size).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
    // 화면(Editor)이 사라졌다 다시 떠도 같은 저장소에서 그대로 읽는다
    expect(store.get().pending.get(1)?.draft.ca).toBe(130)
  })

  it('다시 열어 같은 선수를 더 고쳐도 처음의 원래 값을 기준으로 삼는다', () => {
    const store = createEditorStore()
    const original = player(1)
    const d = draftOf(original)
    d.ca = 130
    store.setDraft(original, d)
    // 그 사이 게임의 값이 바뀌어 다시 읽은 선수는 ca가 125다
    const reread = player(1, { ca: 125 })
    const next = { ...store.get().pending.get(1)!.draft, pa: 150 }
    store.setDraft(reread, next)
    expect(store.get().pending.get(1)?.player.ca).toBe(120)
    expect(editsOf(store.get())[0]).toMatchObject({ uid: 1, ca: 130, pa: 150 })
  })

  it('원래 값으로 되돌리면 그 선수는 고친 목록에서 빠진다', () => {
    const store = createEditorStore()
    const p = player(1)
    const d = draftOf(p)
    d.ca = 130
    store.setDraft(p, d)
    store.setDraft(p, draftOf(p))
    expect(store.get().pending.size).toBe(0)
  })

  it('선수 하나 되돌리기는 그 선수만 비운다', () => {
    const store = createEditorStore()
    for (const uid of [1, 2]) {
      const p = player(uid)
      store.setDraft(p, { ...draftOf(p), ca: 130 })
    }
    store.revert(1)
    expect([...store.get().pending.keys()]).toEqual([2])
  })

  it('모두 버리면 고친 값과 결과 안내가 모두 비워진다', () => {
    const store = createEditorStore()
    const p = player(1)
    store.setDraft(p, { ...draftOf(p), ca: 130 })
    store.applied({ ok: false, message: 'x', players: [{ uid: 1, name: 'a', status: 'failed', written: [], failed: ['ca'] }] })
    store.discardAll()
    expect(store.get().pending.size).toBe(0)
    expect(store.get().report).toBeNull()
  })
})

describe('저장소: 게임에 반영한 뒤', () => {
  const report = (players: EditorApplyReport['players'], ok: boolean): EditorApplyReport => ({ ok, message: '결과', players })

  it('모두 들어간 선수만 비우고, 실패하거나 일부만 들어가거나 보내지 못한 선수는 남긴다', () => {
    const store = createEditorStore()
    for (const uid of [1, 2, 3, 4]) {
      const p = player(uid)
      store.setDraft(p, { ...draftOf(p), ca: 130 })
    }
    store.applied(
      report(
        [
          { uid: 1, name: 'a', status: 'written', written: ['ca'], failed: [] },
          { uid: 2, name: 'b', status: 'partial', written: ['ca'], failed: ['attributes'] },
          { uid: 3, name: 'c', status: 'failed', written: [], failed: ['ca'], rolledBack: ['positions'], restored: true },
          { uid: 4, name: 'd', status: 'skipped', written: [], failed: [] }
        ],
        false
      )
    )
    expect([...store.get().pending.keys()].sort()).toEqual([2, 3, 4])
    expect(store.get().report?.ok).toBe(false)
  })

  it('모두 성공하면 모두 비워진다', () => {
    const store = createEditorStore()
    const p = player(1)
    store.setDraft(p, { ...draftOf(p), ca: 130 })
    store.applied(report([{ uid: 1, name: 'a', status: 'written', written: ['ca'], failed: [] }], true))
    expect(store.get().pending.size).toBe(0)
  })

  it('결과 안내만 닫아도 고친 값은 남는다', () => {
    const store = createEditorStore()
    const p = player(1)
    store.setDraft(p, { ...draftOf(p), ca: 130 })
    store.applied(report([{ uid: 1, name: 'a', status: 'failed', written: [], failed: ['ca'] }], false))
    store.dismissReport()
    expect(store.get().report).toBeNull()
    expect(store.get().pending.size).toBe(1)
  })
})

describe('저장소: 세이브가 바뀌면', () => {
  it('처음 세이브가 정해질 때는 비우지 않고, 같은 세이브면 그대로 둔다', () => {
    const store = createEditorStore()
    const p = player(1)
    store.setDraft(p, { ...draftOf(p), ca: 130 })
    store.scope('')
    store.scope('a.fm')
    store.scope('a.fm')
    expect(store.get().pending.size).toBe(1)
  })

  it('다른 세이브를 적용하면 비운다(선수 번호가 다른 사람을 가리킬 수 있다)', () => {
    const store = createEditorStore()
    store.scope('a.fm')
    const p = player(1)
    store.setDraft(p, { ...draftOf(p), ca: 130 })
    store.scope('b.fm')
    expect(store.get().pending.size).toBe(0)
    expect(store.get().scope).toBe('b.fm')
  })

  it('빈 상태 상수는 바뀌지 않는다', () => {
    createEditorStore().setDraft(player(1), { ...draftOf(player(1)), ca: 130 })
    expect(EMPTY_EDITOR.pending.size).toBe(0)
  })
})
