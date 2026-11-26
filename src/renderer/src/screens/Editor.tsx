import { CircleAlert, RotateCcw, Save, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FIELDS, GROUP_LABEL } from '@shared/fields'
import { POSITION_KEYS } from '@shared/positions'
import type { ColumnGroup } from '@shared/types'
import {
  HIDDEN_ATTRIBUTE_LABEL,
  SAVE_ATTRIBUTE_ORDER,
  shownValue,
  type EditorEdit,
  type EditorListItem,
  type EditorPlayer,
  type SaveAttributeId
} from '@shared/world'
import { api } from '@/api'

/** 고치는 중인 값. 능력치는 저장값(1~100) 그대로 들고 있다 */
interface Draft {
  ca: number
  pa: number
  positions: number[]
  attributes: number[]
}

const POSITION_LABEL: Record<(typeof POSITION_KEYS)[number], string> = {
  GK: 'GK', SW: '스위퍼', DL: 'D (L)', DC: 'D (C)', DR: 'D (R)', DM: 'DM', ML: 'M (L)', MC: 'M (C)', MR: 'M (R)',
  AML: 'AM (L)', AMC: 'AM (C)', AMR: 'AM (R)', ST: 'ST', WBL: 'WB (L)', WBR: 'WB (R)'
}

interface AttributeSlot {
  index: number
  label: string
}

const INDEX = new Map<string, number>(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))
const slot = (id: string, label: string): AttributeSlot => ({ index: INDEX.get(id)!, label })

/** 능력치 묶음: 게임에 보이는 것(기술·정신·신체·골키퍼), 발, 게임에 보이지 않는 것 */
const GROUPS: Array<{ title: string; note?: string; slots: AttributeSlot[] }> = [
  ...(['technical', 'mental', 'physical', 'goalkeeping'] as ColumnGroup[]).map((group) => ({
    title: GROUP_LABEL[group],
    slots: FIELDS.filter((field) => field.isAttr && field.group === group).map((field) => slot(field.id, field.label))
  })),
  { title: '발', slots: [slot('leftFoot', '왼발'), slot('rightFoot', '오른발')] },
  {
    title: '숨은 능력치',
    note: '게임 화면에는 보이지 않는 값입니다. 부상 빈도와 비매너 플레이는 낮을수록 좋습니다.',
    slots: (Object.keys(HIDDEN_ATTRIBUTE_LABEL) as SaveAttributeId[]).map((id) => slot(id, HIDDEN_ATTRIBUTE_LABEL[id]!))
  }
]

const draftOf = (player: EditorPlayer): Draft => ({
  ca: player.ca,
  pa: player.pa,
  positions: [...player.positions],
  attributes: [...player.attributes]
})

const sameList = (a: number[], b: number[]): boolean => a.length === b.length && a.every((value, i) => value === b[i])

function isChanged(player: EditorPlayer, draft: Draft): boolean {
  return draft.ca !== player.ca || draft.pa !== player.pa || !sameList(draft.positions, player.positions) || !sameList(draft.attributes, player.attributes)
}

function toEdit(player: EditorPlayer, draft: Draft): EditorEdit {
  const edit: EditorEdit = { uid: player.uid }
  if (draft.ca !== player.ca) edit.ca = draft.ca
  if (draft.pa !== player.pa) edit.pa = draft.pa
  if (!sameList(draft.positions, player.positions)) edit.positions = draft.positions
  if (!sameList(draft.attributes, player.attributes)) edit.attributes = draft.attributes
  return edit
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(value)))

/**
 * 고친 값을 내보낼 길이 있는지.
 * 수정본 세이브를 새로 쓰는 방식은 게임(26.3.2)이 "저장된 게임을 열 수 없습니다"라며 불러오지 않아 막아 두었다.
 * 켜져 있는 게임에 바로 반영하는 방식으로 바꾸는 중이다.
 */
const CAN_APPLY = false

/** 숫자 한 칸. 바뀐 값은 눈에 띄게 하고, 원래 값을 풍선 도움말로 알려 준다 */
function NumberCell(props: { label: string; value: number; original: number; min: number; max: number; onChange: (value: number) => void }) {
  const { label, value, original, min, max, onChange } = props
  const changed = value !== original
  return (
    <label className={changed ? 'edit-cell changed' : 'edit-cell'} title={changed ? `${label}: 원래 ${original}` : label}>
      <span>{label}</span>
      <input
        className="field num"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (event.target.value !== '' && Number.isFinite(next)) onChange(clamp(next, min, max))
        }}
      />
    </label>
  )
}

/**
 * 세이브에 든 선수의 능력치·포지션 숙련도·현재/잠재 능력을 고친다.
 * 고친 값은 모아 두었다가 한 번에 새 세이브 파일로 쓴다. 원본 세이브는 그대로 남는다.
 */
export function Editor(props: { openUid: number | null; onOpened: () => void }) {
  const { openUid, onOpened } = props
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<EditorListItem[] | null>(null)
  const [saveName, setSaveName] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [player, setPlayer] = useState<EditorPlayer | null>(null)
  /** 선수 고유 번호 → 원래 값과 고치는 중인 값 */
  const [pending, setPending] = useState<Map<number, { player: EditorPlayer; draft: Draft }>>(new Map())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)

  const loadList = useCallback(async (text: string): Promise<void> => {
    const result = await api.editorList(text)
    setItems(result.items)
    setSaveName(result.saveName ?? null)
    setProblem(result.ok ? null : (result.message ?? '세이브를 읽지 못했습니다.'))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadList(search), search ? 220 : 0)
    return () => window.clearTimeout(timer)
  }, [search, loadList])

  const open = useCallback(async (uid: number): Promise<void> => {
    const loaded = await api.editorPlayer(uid)
    setPlayer(loaded)
    if (!loaded) setNotice({ text: '이 선수는 세이브에서 따로 가려낼 수 없어 고칠 수 없습니다.', error: true })
  }, [])

  // 영입 후보에서 넘어온 선수는 목록(세이브)을 읽은 뒤에 연다
  useEffect(() => {
    if (openUid === null || items === null) return
    void open(openUid)
    onOpened()
  }, [openUid, items, open, onOpened])

  const draft = useMemo<Draft | null>(() => (player ? (pending.get(player.uid)?.draft ?? draftOf(player)) : null), [player, pending])

  const update = (change: (draft: Draft) => void): void => {
    if (!player || !draft) return
    const next: Draft = { ...draft, positions: [...draft.positions], attributes: [...draft.attributes] }
    change(next)
    setPending((current) => {
      const copy = new Map(current)
      if (isChanged(player, next)) copy.set(player.uid, { player, draft: next })
      else copy.delete(player.uid)
      return copy
    })
  }

  const revert = (): void => {
    if (!player) return
    setPending((current) => {
      const copy = new Map(current)
      copy.delete(player.uid)
      return copy
    })
  }

  const save = async (): Promise<void> => {
    const edits = [...pending.values()].map((each) => toEdit(each.player, each.draft))
    const names = [...pending.values()].map((each) => each.player.name).join(', ')
    const ok = window.confirm(
      `${names}의 값을 고친 새 세이브를 만들까요?\n\n` +
        '원본 세이브는 그대로 두고 “이름 (수정).fm”으로 따로 만듭니다. 원본의 사본도 백업에 남깁니다.\n' +
        '게임에서 그 세이브를 불러와야 반영됩니다. 처음이라면 불러온 뒤 값이 맞는지 확인해 주세요.'
    )
    if (!ok) return
    setBusy(true)
    const result = await api.editorSave(edits)
    setBusy(false)
    setNotice({ text: result.message, error: !result.ok })
    if (!result.ok) return
    setPending(new Map())
    setPlayer(null)
    await loadList(search)
  }

  const caProblem = draft && draft.ca > draft.pa ? '현재 능력이 잠재 능력보다 큽니다. 저장하려면 잠재 능력을 올리거나 현재 능력을 낮춰 주세요.' : null
  const anyProblem = [...pending.values()].some((each) => each.draft.ca > each.draft.pa)

  return (
    <>
      <header className="page-head">
        <h1>에디터</h1>
        <span className="page-sub">
          {saveName ? `세이브 “${saveName}”의 선수 값을 고칩니다.` : problem ? '' : '세이브를 읽는 중입니다. 몇 초 걸립니다.'}
        </span>
        <div className="spacer" />
        {pending.size > 0 && <span className="page-sub num">고친 선수 {pending.size}명</span>}
        <button className="btn primary" disabled={!CAN_APPLY || pending.size === 0 || busy || anyProblem} onClick={() => void save()}>
          <Save size={16} />
          {busy ? '세이브를 쓰는 중…' : '수정본 세이브 만들기'}
        </button>
      </header>

      <div className="editor">
        <aside className="editor-list" aria-label="선수 목록">
          <label className="search-box">
            <Search size={15} />
            <input
              className="field"
              placeholder="모든 구단에서 이름으로 찾기"
              aria-label="이름으로 찾기"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <p className="faint editor-list-note">{search.trim() ? '찾은 선수(현재 능력 순)' : '내 팀 선수'}</p>
          <div className="editor-players">
            {items === null ? (
              <p className="muted">세이브를 읽는 중입니다.</p>
            ) : items.length === 0 ? (
              <p className="muted">{problem ?? (search.trim() ? '그런 이름의 선수가 없습니다.' : '내 팀을 찾지 못했습니다. 이름으로 찾아 주세요.')}</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.uid}
                  className="editor-player"
                  aria-current={player?.uid === item.uid ? 'true' : undefined}
                  onClick={() => void open(item.uid)}
                >
                  <strong>
                    {item.name}
                    {pending.has(item.uid) && <span className="tag squad">고침</span>}
                  </strong>
                  <span className="muted">
                    {[item.position, item.age !== null && `${item.age}세`, item.club].filter(Boolean).join(' · ')}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="editor-form">
          {!CAN_APPLY && (
            <p className="chat-caution" role="status">
              <CircleAlert size={15} />
              지금은 고친 값을 게임에 넣을 수 없습니다. 수정본 세이브를 게임이 불러오지 못해 그 방식은 막아 두었고, 켜져 있는
              게임에 바로 반영하는 방식으로 바꾸는 중입니다. 값을 살펴보는 것은 그대로 됩니다.
            </p>
          )}
          {notice && (
            <p className={notice.error ? 'chat-caution' : 'backup-notice'} role={notice.error ? 'alert' : 'status'}>
              {notice.error && <CircleAlert size={15} />}
              {notice.text}
            </p>
          )}
          {!player || !draft ? (
            <div className="empty">
              <strong>고칠 선수를 왼쪽에서 고르세요</strong>
              <p style={{ marginTop: 8 }}>
                능력치, 포지션 숙련도, 현재·잠재 능력을 고칠 수 있습니다. 여러 선수를 고친 뒤 한 번에 새 세이브로 만듭니다.
              </p>
            </div>
          ) : (
            <>
              <div className="editor-who">
                <div>
                  <h2>{player.name}</h2>
                  <p className="muted">{[player.position, player.age !== null && `${player.age}세`, player.club].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="spacer" />
                <button className="btn ghost" disabled={!pending.has(player.uid)} onClick={revert}>
                  <RotateCcw size={15} />
                  이 선수 되돌리기
                </button>
              </div>

              <section className="editor-group">
                <h3>능력</h3>
                <p className="faint">
                  게임은 시간이 지나면 능력치를 현재 능력에 맞춰 다시 조정합니다. 능력치를 크게 올렸다면 현재 능력도 함께 올려야 오래
                  유지됩니다.
                </p>
                <div className="edit-grid">
                  <NumberCell label="현재 능력" value={draft.ca} original={player.ca} min={1} max={200} onChange={(value) => update((d) => (d.ca = value))} />
                  <NumberCell label="잠재 능력" value={draft.pa} original={player.pa} min={1} max={200} onChange={(value) => update((d) => (d.pa = value))} />
                </div>
                {caProblem && (
                  <p className="chat-caution" role="alert">
                    <CircleAlert size={15} />
                    {caProblem}
                  </p>
                )}
              </section>

              {GROUPS.map((group) => (
                <section className="editor-group" key={group.title}>
                  <h3>{group.title}</h3>
                  {group.note && <p className="faint">{group.note}</p>}
                  <div className="edit-grid">
                    {group.slots.map(({ index, label }) => (
                      <NumberCell
                        key={index}
                        label={label}
                        value={shownValue(draft.attributes[index])}
                        original={shownValue(player.attributes[index])}
                        min={1}
                        max={20}
                        // 게임 표시값(1~20)으로 고치고, 저장값(1~100)은 그 다섯 배로 적는다
                        onChange={(value) =>
                          update((d) => (d.attributes[index] = value === shownValue(player.attributes[index]) ? player.attributes[index] : value * 5))
                        }
                      />
                    ))}
                  </div>
                </section>
              ))}

              <section className="editor-group">
                <h3>포지션 숙련도</h3>
                <p className="faint">1~20. 15 이상이면 그 자리에서 능숙하게 뛰고, 20이면 주 포지션입니다.</p>
                <div className="edit-grid">
                  {POSITION_KEYS.map((key, index) => (
                    <NumberCell
                      key={key}
                      label={POSITION_LABEL[key]}
                      value={draft.positions[index]}
                      original={player.positions[index]}
                      min={1}
                      max={20}
                      onChange={(value) => update((d) => (d.positions[index] = value))}
                    />
                  ))}
                </div>
              </section>
            </>
          )}
        </section>
      </div>
    </>
  )
}
