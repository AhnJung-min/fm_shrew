import { CircleAlert, RotateCcw, Search, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LinkStatus } from '@shared/game'
import {
  abilityWord,
  footSummary,
  footValues,
  formatDate,
  growthRoom,
  HIDDEN_HELP,
  hiddenAttributes,
  hiddenBand,
  isGoalkeeper,
  visibleAttributes
} from '@shared/playerView'
import { GOALKEEPER_AXES, OUTFIELD_AXES, profileOf } from '@shared/profile'
import type { AttributeValue } from '@shared/roles'
import {
  SAVE_ATTRIBUTE_ORDER,
  shownValue,
  type EditorEdit,
  type EditorListItem,
  type EditorPlayer,
  type PlayerProfile
} from '@shared/world'
import { api } from '@/api'
import { AttributeColumns } from '@/components/AttributeColumns'
import { EditNumber } from '@/components/EditNumber'
import { ClubLogo } from '@/components/ClubLogo'
import { PlayerFace } from '@/components/PlayerFace'
import { PositionMap } from '@/components/PositionMap'
import { RadarChart } from '@/components/RadarChart'
import { attrBand } from '@/lib/format'
import '@/styles/player.css'

/** 고치는 중인 값. 능력치는 저장값(1~100) 그대로 들고 있다 */
interface Draft {
  ca: number
  pa: number
  positions: number[]
  attributes: number[]
}

const INDEX = new Map<string, number>(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))

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

/** 에디터의 선수 카드: 머리말, 기본 정보, 능력, 능력치 세 줄, 숨은 능력치, 포지션 그림과 성향 그림을 한 장에 */
function PlayerCard(props: {
  player: EditorPlayer
  draft: Draft
  info: PlayerProfile | null
  changed: boolean
  caProblem: string | null
  onRevert: () => void
  update: (change: (draft: Draft) => void) => void
}) {
  const { player, draft, info, changed, caProblem, onRevert, update } = props
  const editable = player.source === 'game'
  const goalkeeper = isGoalkeeper(player.positions)
  const shown = useMemo(() => draft.attributes.map(shownValue), [draft.attributes])
  const originalShown = useMemo(() => player.attributes.map(shownValue), [player.attributes])
  const originalById = useMemo(() => Object.fromEntries(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, originalShown[i]])), [originalShown])

  const attributes = useMemo(() => visibleAttributes(shown, goalkeeper), [shown, goalkeeper])
  const others = useMemo(
    () => visibleAttributes(shown, !goalkeeper).filter((attribute) => attribute.group === (goalkeeper ? 'technical' : 'goalkeeping')),
    [shown, goalkeeper]
  )
  const hidden = useMemo(() => hiddenAttributes(shown), [shown])
  const feet = footValues(shown)
  const originalFeet = footValues(originalShown)
  const foot = footSummary(feet.left, feet.right)
  const room = growthRoom(draft.ca, draft.pa)

  /** 게임 표시값(1~20)으로 고치고, 저장값(1~100)은 그 다섯 배로 적는다. 원래 값으로 돌아오면 저장값도 원래대로 둔다 */
  const setAttribute = (id: string, value: number): void => {
    const index = INDEX.get(id)
    if (index === undefined) return
    update((d) => (d.attributes[index] = value === shownValue(player.attributes[index]) ? player.attributes[index] : value * 5))
  }

  const radar = useMemo(() => {
    const axes = goalkeeper ? GOALKEEPER_AXES : OUTFIELD_AXES
    const toRecord = (values: number[]): Record<string, AttributeValue> =>
      Object.fromEntries(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, { value: values[i], ranged: false }]))
    const now = profileOf(toRecord(shown), axes)
    const before = profileOf(toRecord(originalShown), axes)
    const differs = now.some((value, i) => value !== before[i])
    return {
      axes: axes.map((axis) => axis.label),
      series: differs
        ? [
            { name: '고친 값', color: '--series-1', values: now },
            { name: '원래 값', color: '--series-3', values: before }
          ]
        : [{ name: '지금 값', color: '--series-1', values: now }]
    }
  }, [shown, originalShown, goalkeeper])

  const unknown = <span className="faint">정보 없음</span>
  const facts: Array<[string, ReactNode]> = [
    ['나이', player.age !== null ? `${player.age}세` : unknown],
    ['생년월일', info?.birth ? formatDate(info.birth) : unknown],
    [
      '소속',
      player.club ? (
        <span className="with-logo">
          <ClubLogo uid={player.clubUid} size={18} />
          {player.club}
        </span>
      ) : (
        unknown
      )
    ],
    ['국적', info?.nation || unknown],
    ['몸값', info?.value || unknown],
    ['주급', info?.wage || unknown],
    ['계약 만료', info?.contractEnd ? formatDate(info.contractEnd) : unknown],
    ['계약상 입지', info?.squadStatus || unknown],
    ['주발', `${foot.main} (${foot.mainNote})`],
    ['약발', foot.weak ? `${foot.weak} (${foot.weakNote})` : '없음']
  ]

  return (
    <article className="ed-card" aria-label={`${player.name} 카드`}>
      <header className="ed-hero">
        <PlayerFace uid={player.uid} name={player.name} size={112} className="ed-portrait" />
        <div className="ed-name">
          <h2>{player.name}</h2>
          <p className="muted with-logo">
            <ClubLogo uid={player.clubUid} size={20} />
            {[player.position, player.age !== null && `${player.age}세`, player.club].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button className="btn ghost" disabled={!changed} onClick={onRevert}>
          <RotateCcw size={15} />
          이 선수 되돌리기
        </button>
      </header>

      {player.source === 'game' ? (
        <p className="backup-notice" role="status">
          켜져 있는 게임에서 읽은 지금 값입니다. 숫자 칸에서 위·아래 화살표 키를 누르면 1씩 바뀝니다.
        </p>
      ) : (
        <p className="chat-caution" role="status">
          <CircleAlert size={15} />
          {player.sourceNote} 이 상태에서는 고친 값을 게임에 넣을 수 없습니다.
        </p>
      )}

      <div className="ed-top">
        <section className="ed-panel" aria-label="기본 정보">
          <h3 className="pl-h">기본 정보</h3>
          <dl className="pl-info">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="pl-note">키는 세이브에 없어 보여 주지 않습니다. 발은 아래 “발” 칸을 고치면 바로 바뀝니다.</p>
        </section>

        <section className="ed-panel" aria-label="능력">
          <h3 className="pl-h">능력</h3>
          <div className="ed-ability">
            <label className={`pl-score ${draft.ca !== player.ca ? 'changed' : ''}`}>
              <span className="pl-score-label">현재 능력</span>
              <EditNumber label="현재 능력" value={draft.ca} original={player.ca} min={1} max={200} big disabled={!editable} onChange={(value) => update((d) => (d.ca = value))} />
              <span className="pl-bar" aria-hidden="true">
                <i style={{ width: `${(draft.ca / 200) * 100}%` }} />
              </span>
              {draft.ca !== player.ca && <small className="pl-orig">원래 값 {player.ca}</small>}
            </label>
            <label className={`pl-score pot ${draft.pa !== player.pa ? 'changed' : ''}`}>
              <span className="pl-score-label">잠재 능력</span>
              <EditNumber label="잠재 능력" value={draft.pa} original={player.pa} min={1} max={200} big disabled={!editable} onChange={(value) => update((d) => (d.pa = value))} />
              <span className="pl-bar" aria-hidden="true">
                <i style={{ width: `${(draft.pa / 200) * 100}%` }} />
              </span>
              {draft.pa !== player.pa && <small className="pl-orig">원래 값 {player.pa}</small>}
            </label>
          </div>
          {room !== null && <p className="pl-room">성장 여지 +{room}</p>}
          <p className="pl-note">
            두 값 모두 1~200입니다. 게임은 시간이 지나면 능력치를 현재 능력에 맞춰 다시 조정하므로, 능력치를 크게 올렸다면 현재
            능력도 함께 올려야 오래 유지됩니다.
          </p>
          {caProblem && (
            <p className="chat-caution" role="alert">
              <CircleAlert size={15} />
              {caProblem}
            </p>
          )}
        </section>
      </div>

      <section className="ed-panel" aria-label="능력치">
        <h3 className="pl-h">능력치</h3>
        <AttributeColumns mode="edit" attributes={attributes} original={originalById} onChange={setAttribute} disabled={!editable} />
        <details className="ed-more">
          <summary>{goalkeeper ? '필드 플레이어용 기술 능력치도 고치기' : '골키퍼 능력치도 고치기'}</summary>
          <AttributeColumns mode="edit" attributes={others} original={originalById} onChange={setAttribute} disabled={!editable} />
        </details>
        <div className="ed-feet">
          <h4>발</h4>
          {(
            [
              ['leftFoot', '왼발', feet.left, originalFeet.left],
              ['rightFoot', '오른발', feet.right, originalFeet.right]
            ] as const
          ).map(([id, label, value, original]) => (
            <label key={id} className={value !== original ? 'changed' : ''}>
              <span>
                {label}
                <small className="faint"> {abilityWord(value)}</small>
                {value !== original && <small className="pl-orig">원래 값 {original}</small>}
              </span>
              <EditNumber label={label} value={value} original={original} min={1} max={20} band={attrBand(value)} disabled={!editable} onChange={(next) => setAttribute(id, next)} />
            </label>
          ))}
        </div>
        <p className="pl-legend">
          {(['a1', 'a2', 'a3', 'a4'] as const).map((band, i) => (
            <span key={band}>
              <span className={`attr-chip ${band}`}>{['1~5', '6~10', '11~15', '16~20'][i]}</span> {['약함', '보통', '좋음', '뛰어남'][i]}
            </span>
          ))}
        </p>
      </section>

      <section className="ed-panel" aria-label="숨은 능력치">
        <h3 className="pl-h">숨은 능력치</h3>
        <p className="pl-note first">게임 화면에는 나오지 않지만 선수의 활약과 부상에 영향을 주는 값입니다. 부상 빈도와 비매너 플레이는 낮을수록 좋습니다.</p>
        <ul className="pl-hidden">
          {hidden.map((each) => {
            const help = HIDDEN_HELP[each.id as keyof typeof HIDDEN_HELP]
            const original = originalById[each.id]
            return (
              <li key={each.id} className={each.value !== original ? 'changed' : ''}>
                <label>
                  <div>
                    <b>{each.label}</b>
                    {help && <span className="faint">{help.help}</span>}
                    {each.value !== original && <small className="pl-orig">원래 값 {original}</small>}
                  </div>
                  <EditNumber
                    label={each.label}
                    value={each.value}
                    original={original}
                    min={1}
                    max={20}
                    band={hiddenBand(each.value, help?.higherIsBetter ?? true)}
                    disabled={!editable}
                    onChange={(value) => setAttribute(each.id, value)}
                  />
                </label>
              </li>
            )
          })}
        </ul>
      </section>

      <div className="ed-bottom">
        <section className="ed-panel" aria-label="포지션">
          <h3 className="pl-h">포지션 숙련도</h3>
          <p className="pl-note first">1~20. 15 이상이면 그 자리에서 능숙하게 뛰고, 20이면 주 포지션입니다. 그림의 자리를 누르면 그 칸으로 이동합니다.</p>
          <PositionMap
            ratings={draft.positions}
            edit={{ original: player.positions, disabled: !editable, onChange: (index, value) => update((d) => (d.positions[index] = value)) }}
          />
        </section>
        <section className="ed-panel" aria-label="성향 그림">
          <h3 className="pl-h">성향</h3>
          <RadarChart axes={radar.axes} series={radar.series} />
          <p className="pl-note">각 축은 관련 능력치의 평균입니다. 능력치를 고치면 바로 따라 움직입니다.</p>
        </section>
      </div>
    </article>
  )
}

/**
 * 선수의 능력치·포지션 숙련도·현재/잠재 능력을 고쳐 켜져 있는 게임에 바로 반영한다.
 * 선수 목록은 세이브에서, 고칠 값은 게임의 지금 값에서 읽는다. 세이브 파일은 건드리지 않는다.
 */
export function Editor(props: {
  /** 자료가 바뀌면 달라지는 글자(다시 읽을 때를 안다) */
  dataKey: string
  link: LinkStatus
  openUid: number | null
  onOpened: () => void
  onGoHome: () => void
}) {
  const { dataKey, link, openUid, onOpened, onGoHome } = props
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<EditorListItem[] | null>(null)
  const [saveName, setSaveName] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [player, setPlayer] = useState<EditorPlayer | null>(null)
  /** 고르는 선수의 나이·국적·몸값 같은 고치지 않는 정보(못 읽으면 없다) */
  const [info, setInfo] = useState<{ uid: number; profile: PlayerProfile | null } | null>(null)
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
  }, [search, loadList, dataKey])

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

  const openedUid = player?.uid ?? null
  useEffect(() => {
    if (openedUid === null) return
    let cancelled = false
    api
      .worldProfile(openedUid)
      .then((profile) => !cancelled && setInfo({ uid: openedUid, profile }))
      .catch(() => !cancelled && setInfo({ uid: openedUid, profile: null }))
    return () => {
      cancelled = true
    }
  }, [openedUid])

  const draft = useMemo<Draft | null>(() => (player ? (pending.get(player.uid)?.draft ?? draftOf(player)) : null), [player, pending])

  const update = (change: (draft: Draft) => void): void => {
    if (!player || !draft || player.source !== 'game') return
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

  const apply = async (): Promise<void> => {
    const edits = [...pending.values()].map((each) => toEdit(each.player, each.draft))
    const names = [...pending.values()].map((each) => each.player.name).join(', ')
    const ok = window.confirm(
      `${names}의 값을 지금 켜져 있는 게임에 바로 넣을까요?\n\n` +
        '세이브 파일은 건드리지 않습니다. 게임에서 저장해야 남고, 저장하지 않고 끄면 사라집니다.\n' +
        '처음이라면 게임에서 그 선수 화면을 다시 열어 값이 맞는지 확인해 주세요.'
    )
    if (!ok) return
    setBusy(true)
    const result = await api.editorApply(edits)
    setBusy(false)
    setNotice({ text: result.message, error: !result.ok })
    // 일부만 들어갔을 수도 있으니, 성공이든 실패든 게임의 지금 값을 다시 읽는다
    setPending(new Map())
    if (player) await open(player.uid)
  }

  const caProblem = draft && draft.ca > draft.pa ? '현재 능력이 잠재 능력보다 큽니다. 저장하려면 잠재 능력을 올리거나 현재 능력을 낮춰 주세요.' : null
  const anyProblem = [...pending.values()].some((each) => each.draft.ca > each.draft.pa)

  return (
    <>
      <header className="page-head">
        <h1>에디터</h1>
        <span className="page-sub">
          {!saveName
            ? ''
            : link.game.loaded
              ? '고친 값을 켜져 있는 게임에 바로 반영합니다.'
              : 'FM을 켜고 세이브를 불러와야 값을 고칠 수 있습니다. 지금은 보기만 됩니다.'}
        </span>
        <div className="spacer" />
        {pending.size > 0 && <span className="page-sub num">고친 선수 {pending.size}명</span>}
        <button className="btn primary" disabled={pending.size === 0 || busy || anyProblem} onClick={() => void apply()}>
          <Zap size={16} />
          {busy ? '게임에 넣는 중…' : '게임에 반영'}
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
              <div className="list-empty">
                <p className="muted">{problem ?? (search.trim() ? '그런 이름의 선수가 없습니다.' : '내 팀을 찾지 못했습니다. 이름으로 찾아 주세요.')}</p>
                {problem && !saveName && (
                  <button className="btn primary" onClick={onGoHome}>
                    홈에서 세이브 고르기
                  </button>
                )}
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={item.uid}
                  className="editor-player"
                  aria-current={player?.uid === item.uid ? 'true' : undefined}
                  onClick={() => void open(item.uid)}
                >
                  <strong>
                    <PlayerFace uid={item.uid} name={item.name} size={26} className="small" />
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
          {notice && (
            <p className={notice.error ? 'chat-caution' : 'backup-notice'} role={notice.error ? 'alert' : 'status'}>
              {notice.error && <CircleAlert size={15} />}
              {notice.text}
            </p>
          )}
          {!player || !draft ? (
            <div className="empty guide">
              <strong>고칠 선수를 왼쪽에서 고르세요</strong>
              <ol className="guide-steps">
                <li>왼쪽 목록에서 선수를 고릅니다. 다른 구단 선수는 위 칸에 이름을 쳐서 찾습니다.</li>
                <li>능력치, 포지션 숙련도, 현재·잠재 능력을 고칩니다. 고친 칸은 노랗게 표시됩니다.</li>
                <li>오른쪽 위 “게임에 반영”을 누르면 켜져 있는 게임에 바로 들어갑니다. 게임에서 저장해야 세이브에 남습니다.</li>
              </ol>
            </div>
          ) : (
            <PlayerCard
              player={player}
              draft={draft}
              info={info && info.uid === player.uid ? info.profile : null}
              changed={pending.has(player.uid)}
              caProblem={caProblem}
              onRevert={revert}
              update={update}
            />
          )}
        </section>
      </div>
    </>
  )
}
