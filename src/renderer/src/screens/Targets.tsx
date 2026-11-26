import { PencilRuler, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FIELDS } from '@shared/fields'
import { formatPounds as pounds } from '@shared/playerView'
import { RECOMMEND_TIER_LABEL, TERM_HELP } from '@shared/recommend'
import { ROLE_BY_ID, ROLES } from '@shared/roles'
import { analyseTactic } from '@shared/tactic'
import type { LinkStatus } from '@shared/game'
import type { CellValue, ColumnInfo, PlayerRow, Settings, SquadResult } from '@shared/types'
import {
  CATEGORY_HELP,
  CATEGORY_LABEL,
  SAVE_ATTRIBUTE_ORDER,
  type CandidateCategory,
  type CandidateQuery,
  type CandidateResult,
  type CandidateRow,
  type PlayerMarket
} from '@shared/world'
import { api } from '@/api'
import { ClubLogo } from '@/components/ClubLogo'
import { PlayerDrawer } from '@/components/PlayerDrawer'
import { PlayerTable, sortRows, type SortState } from '@/components/PlayerTable'
import { RecommendPanel } from '@/components/RecommendPanel'
import '@/styles/targets.css'

const CATEGORIES: CandidateCategory[] = ['all', 'starter', 'rotation', 'prospect', 'free']

const info = (header: string, field: string, label: string, numeric: boolean): ColumnInfo => ({
  header, field, group: 'info', short: header, label, isAttr: false, numeric
})

const NAME = info('이름', 'name', '이름', false)
const KIND = info('유형', 'candidateKind', '이 선수가 드는 유형', false)
const RECO: ColumnInfo = { ...info('추천 점수', 'recommend', TERM_HELP.recommend, true), width: 118 }
const SCORE = info('적합도', 'roleScore', TERM_HELP.fit, true)
const GAP = info('주전 대비', 'starterGap', '이 자리(역할) 내 주전과의 적합도 차이', true)
const AGE = info('나이', 'age', '나이', true)
const POSITION = info('포지션', 'position', '포지션', false)
const CLUB: ColumnInfo = { ...info('소속 구단', 'club', '소속 구단', false), width: 196 }
const VALUE = info(
  '몸값',
  'value',
  '게임이 보여 주는 몸값(스카우트하지 않은 선수는 범위가 넓다). 게임에 묻기 전이나 FM이 꺼져 있을 때는 세이브에 적힌 기준 몸값(파운드)',
  true
)
const WAGE = info('주급', 'wage', '지금 받는 주급. 게임에 묻기 전이나 FM이 꺼져 있을 때는 세이브에 적힌 값(파운드)', true)
const STATUS = info('입지', 'squadStatus', '계약에 적힌 팀 내 입지(구단이 약속한 역할)', false)
const CONTRACT = info('계약 만료', 'contractEnd', '계약이 끝나는 날', true)
const NATION = info('국적', 'nation', '국적', false)
const ABILITY = info('현재 능력', 'ability', '현재 능력 (1~200)', true)
const POTENTIAL = info('잠재 능력', 'potential', '잠재 능력 (1~200)', true)

/** 게임 화면에 보이는 능력치 열들: 기술 → 정신 → 신체 → 골키퍼 */
const ATTRIBUTE_COLUMNS: Array<{ column: ColumnInfo; index: number }> = FIELDS.filter((field) => field.isAttr).map((field) => ({
  column: { header: field.label, field: field.id, group: field.group, short: field.short, label: field.label, isAttr: true, numeric: true },
  index: SAVE_ATTRIBUTE_ORDER.indexOf(field.id as (typeof SAVE_ATTRIBUTE_ORDER)[number])
}))

const COLUMNS: ColumnInfo[] = [
  NAME, RECO, KIND, SCORE, GAP, AGE, POSITION, CLUB, VALUE, WAGE, CONTRACT, STATUS, NATION, ABILITY, POTENTIAL,
  ...ATTRIBUTE_COLUMNS.map((each) => each.column)
]

/** "계약 만료 임박"으로 보는 기간 */
const EXPIRING_MONTHS = 12
/** 게임에 한 번에 묻는 선수 수 */
const MARKET_BATCH = 30

const text = (raw: string): CellValue => ({ raw, num: null })
const number = (value: number | null, raw?: string): CellValue => (value === null ? { raw: '', num: null } : { raw: raw ?? String(value), num: value })

/** 정렬할 수가 있는 글자 칸. 수를 모르면 글자만 */
const sortable = (raw: string | undefined, num: number | undefined): CellValue => ({ raw: raw ?? '', num: raw && num !== undefined ? num : null })

function toRow(row: CandidateRow, idx: number, market: PlayerMarket | undefined): PlayerRow {
  const end = row.contractEnd ?? market?.contractEnd
  const cells: Record<string, CellValue> = {
    [NAME.header]: text(row.name),
    [RECO.header]: number(row.recommend.total, String(Math.round(row.recommend.total))),
    [KIND.header]: text(row.categories.length > 0 ? row.categories.map((category) => CATEGORY_LABEL[category]).join(' · ') : '어느 유형에도 들지 않음'),
    [SCORE.header]: number(row.score, String(Math.round(row.score))),
    [GAP.header]: number(row.gap, row.gap === null ? '' : `${row.gap > 0 ? '+' : ''}${row.gap.toFixed(1)}`),
    [AGE.header]: number(row.age),
    [POSITION.header]: text(row.position),
    [CLUB.header]: text(row.club || market?.club || '알 수 없음'),
    // 정렬은 어느 쪽이든 같은 기준 몸값(파운드)으로 한다
    [VALUE.header]: market?.value
      ? sortable(market.value, market.valueSort ?? row.value ?? undefined)
      : row.value !== null
        ? { raw: pounds(row.value), num: row.value }
        : text(''),
    [WAGE.header]: market?.wage
      ? sortable(market.wage.replace(/^주급\s*/, ''), market.wageSort ?? row.wage ?? undefined)
      : row.wage !== null
        ? { raw: pounds(row.wage), num: row.wage }
        : text(''),
    [CONTRACT.header]: end ? { raw: `${end.year}.${end.month}.${end.day}`, num: end.year * 10000 + end.month * 100 + end.day } : text(''),
    [STATUS.header]: text(row.squadStatus),
    [NATION.header]: text(row.nation || market?.nation || ''),
    [ABILITY.header]: number(row.ca),
    [POTENTIAL.header]: number(row.pa)
  }
  for (const { column, index } of ATTRIBUTE_COLUMNS) cells[column.header] = number(row.attributes[index] ?? null)
  return { idx, name: row.name, cells }
}

function benchLine(result: CandidateResult): string {
  const { starter, backup } = result.bench
  if (!starter) return '내 팀에 이 자리를 뛸 선수가 없어 비교 기준이 없습니다'
  const second = backup ? `, 두 번째 ${backup.name} ${Math.round(backup.score)}점` : ''
  return `내 팀 주전 ${starter.name} ${Math.round(starter.score)}점${second}`
}

/**
 * 세이브에 든 모든 구단의 선수를 고른 역할의 점수로 줄 세우고, 내 팀 주전과 견주어 유형별로 보여 준다.
 * 계산은 메인 프로세스가 한다(선수가 10만 명쯤이라 화면으로 다 가져오지 않는다).
 */
export function Targets(props: {
  /** 자료가 바뀌면 달라지는 글자(다시 읽을 때를 안다) */
  dataKey: string
  link: LinkStatus
  settings: Settings
  onEdit: (uid: number) => void
  onGoHome: () => void
  /** 스쿼드 전술판에서 고른 자리(있으면 그 자리로 연다) */
  slotRequest?: { formation: string; index: number; at: number } | null
}) {
  const { dataKey, link, settings, onEdit, onGoHome, slotRequest } = props
  const [roleId, setRoleId] = useState('cb')
  /** 보강할 자리: 번호, 직접 고르기(manual), 가장 급한 자리(auto) */
  const [slotChoice, setSlotChoice] = useState<number | 'manual' | 'auto'>('auto')
  /** 전술 분석에 쓰는 내 선수 표 */
  const [squadSnap, setSquadSnap] = useState<SquadResult | null>(null)
  const [squadLoaded, setSquadLoaded] = useState(false)
  const [category, setCategory] = useState<CandidateCategory>('starter')
  const [maxAge, setMaxAge] = useState('')
  const [onlyEligible, setOnlyEligible] = useState(true)
  const [includeUnknownClub, setIncludeUnknownClub] = useState(false)
  const [expiringSoon, setExpiringSoon] = useState(false)
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<CandidateResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortState | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  /** 게임에서 받은 몸값·주급·계약(선수 번호별). 받는 대로 채워진다 */
  const [market, setMarket] = useState<Map<number, PlayerMarket>>(new Map())
  const [marketNote, setMarketNote] = useState('')
  const asked = useRef(new Set<number>())

  // 내 선수 표를 받아 전술 분석을 만든다(스쿼드 전술판과 같은 계산)
  useEffect(() => {
    let alive = true
    void api.worldSquad().then((loaded) => {
      if (!alive) return
      setSquadSnap(loaded)
      setSquadLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [dataKey])

  const analysis = useMemo(
    () =>
      squadSnap?.ok
        ? analyseTactic({
            rows: squadSnap.rows,
            columns: squadSnap.columns,
            today: squadSnap.today,
            formation: settings.formation,
            slotRoles: settings.slotRoles,
            roleWeights: settings.roleWeights,
            norms: squadSnap.roleNorms
          })
        : null,
    [squadSnap, settings.formation, settings.slotRoles, settings.roleWeights]
  )

  // 전술판에서 "이 자리 영입 후보 보기"로 왔으면 그 자리를 연다
  useEffect(() => {
    if (slotRequest && slotRequest.formation === settings.formation) setSlotChoice(slotRequest.index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotRequest?.at])

  // 처음에는 보강이 가장 급한 자리로 연다
  const activeSlot = analysis
    ? slotChoice === 'manual'
      ? null
      : slotChoice === 'auto'
        ? analysis.byNeed[0]
        : (analysis.slots[slotChoice] ?? analysis.byNeed[0])
    : null
  const queryRole = activeSlot ? activeSlot.slot.roleId : roleId
  const slotIndex = activeSlot ? activeSlot.slot.index : -1

  const query: CandidateQuery = useMemo(
    () => ({
      roleId: queryRole,
      category,
      maxAge: Number(maxAge) || null,
      onlyEligible,
      includeUnknownClub,
      search,
      expiringWithinMonths: expiringSoon ? EXPIRING_MONTHS : null,
      slot: slotIndex >= 0 ? { formation: settings.formation, slotRoles: settings.slotRoles, index: slotIndex } : null
    }),
    [queryRole, category, maxAge, onlyEligible, includeUnknownClub, search, expiringSoon, slotIndex, settings.formation, settings.slotRoles]
  )

  useEffect(() => {
    // 전술 분석을 받기 전에는 묻지 않는다(자리가 정해지기 전의 결과가 잠깐 비치는 것을 막는다)
    if (!squadLoaded) return
    let alive = true
    setLoading(true)
    // 글자를 치는 동안에는 기다렸다가 한 번만 묻는다
    const timer = window.setTimeout(() => {
      void api.worldCandidates(query).then((next) => {
        if (!alive) return
        setResult(next)
        setLoading(false)
        setSelectedIdx(null)
      })
    }, 180)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // 역할 가중치를 고치면 점수가 달라지므로 다시 묻는다
  }, [query, settings.roleWeights, dataKey, squadLoaded])

  // 게임이 바뀌면(다시 켬, 다른 세이브) 받아 둔 것을 버린다
  const marketKey = `${link.game.connected}|${link.game.pluginVersion}|${link.game.loaded}|${link.game.team}|${link.data.save?.path ?? ''}`
  useEffect(() => {
    asked.current = new Set()
    setMarket(new Map())
    setMarketNote('')
  }, [marketKey])

  // 보이는 선수들의 몸값·주급·계약을 게임에 조금씩 물어 채운다
  useEffect(() => {
    let alive = true
    const wanted = (result?.rows ?? []).map((row) => row.uid).filter((uid) => !asked.current.has(uid))
    if (wanted.length === 0) return
    void (async () => {
      for (let from = 0; from < wanted.length && alive; from += MARKET_BATCH) {
        const batch = wanted.slice(from, from + MARKET_BATCH)
        const answer = await api.worldMarket(batch)
        if (!alive) return
        setMarketNote(answer.ok ? '' : (answer.message ?? ''))
        if (answer.players.length > 0) {
          setMarket((before) => {
            const next = new Map(before)
            for (const player of answer.players) next.set(player.uid, player)
            return next
          })
        }
        if (!answer.ok) return
        for (const uid of batch) asked.current.add(uid)
      }
    })()
    return () => {
      alive = false
    }
  }, [result, marketKey])

  // 게임이 여자 선수라고 알려 준 줄은 뺀다(세이브에서는 성별을 가려내지 못한다)
  const rows = useMemo(
    () =>
      (result?.rows ?? [])
        .map((row, idx) => (market.get(row.uid)?.female ? null : toRow(row, idx, market.get(row.uid))))
        .filter((row): row is PlayerRow => row !== null),
    [result, market]
  )
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])
  const selected = selectedIdx === null ? null : (rows.find((row) => row.idx === selectedIdx) ?? null)
  const selectedUid = selectedIdx === null ? null : (result?.rows[selectedIdx]?.uid ?? null)
  const selectedCandidate = selectedIdx === null ? null : (result?.rows[selectedIdx] ?? null)

  /** 추천 점수 칸(숫자와 막대)과 구단 엠블럼 칸을 직접 그린다 */
  const renderCell = (col: ColumnInfo, row: PlayerRow): ReactNode | null => {
    const candidate = result?.rows[row.idx]
    if (!candidate) return null
    if (col.field === 'recommend') {
      const tier = { id: candidate.tier, label: RECOMMEND_TIER_LABEL[candidate.tier] }
      return (
        <span className="reco-cell" title={`${tier.label}(${candidate.recommend.total}점). ${TERM_HELP.recommend}`}>
          <span className="reco-num num">{Math.round(candidate.recommend.total)}</span>
          <span className={`reco-bar ${tier.id}`} aria-hidden="true">
            <i style={{ width: `${candidate.recommend.total}%` }} />
          </span>
        </span>
      )
    }
    if (col.field === 'club' && candidate.clubUid) {
      const name = row.cells[col.header]?.raw ?? candidate.club
      return (
        <span className="club-cell" title={name}>
          <ClubLogo uid={candidate.clubUid} size={18} />
          <span>{name}</span>
        </span>
      )
    }
    return null
  }

  if (result && !result.ok) {
    return (
      <>
        <header className="page-head">
          <h1>영입 후보</h1>
        </header>
        <div className="page-body">
          <div className="empty" style={{ maxWidth: 560, margin: '0 auto' }}>
            <strong>아직 보여 줄 선수가 없습니다</strong>
            <p style={{ marginTop: 8 }}>{result.message}</p>
            <div style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={onGoHome}>
                홈으로 가기
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <header className="page-head">
        <h1>영입 후보</h1>
        <span className="page-sub">
          {result?.saveName
            ? `“${result.saveName}”의 모든 구단 선수 · ${link.data.source === 'game' ? '게임의 지금 값' : '세이브에 저장된 값'}`
            : ''}
        </span>
        <div className="spacer" />
        {result?.ok && <span className="page-sub num">{benchLine(result)}</span>}
      </header>

      {analysis && (
        <div className="slot-bar">
          <div className="slot-bar-head">
            <strong>보강할 자리</strong>
            <span className="muted">
              {analysis.formation.label} 전술에서 보강 필요도가 높은 자리부터 늘어놓았습니다. 자리를 고르면 그 자리의 주전과 두 번째 선수를 기준으로 후보를 찾습니다.
            </span>
          </div>
          <div className="slot-picker" role="group" aria-label="보강할 자리">
            {analysis.byNeed.map((each) => (
              <button
                key={each.slot.index}
                className={`slot-chip ${each.level}`}
                aria-pressed={activeSlot?.slot.index === each.slot.index}
                title={`${each.label}(${each.roleLabel}). ${TERM_HELP.need} ${each.reason}`}
                onClick={() => setSlotChoice(each.slot.index)}
              >
                <span className="slot-chip-name">{each.label}</span>
                <span className="slot-chip-need">
                  보강 필요도 <b className="num">{Math.round(each.need)}</b> <em>{each.levelLabel}</em>
                </span>
              </button>
            ))}
            <button
              className="slot-chip manual"
              aria-pressed={activeSlot === null}
              title="전술과 상관없이 아무 역할이나 골라 찾습니다."
              onClick={() => setSlotChoice('manual')}
            >
              직접 고르기
            </button>
          </div>
          {activeSlot && (
            <p className="slot-line">
              {activeSlot.label}({activeSlot.roleLabel}): {activeSlot.reason} 역할은 스쿼드 전술판에서 바꿀 수 있습니다.
            </p>
          )}
        </div>
      )}
      <div className="toolbar">
        {activeSlot === null && (
          <label className="inline-field">
            <span className="muted">역할</span>
            <select className="field" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
              {ROLES.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {activeSlot && <span className="page-sub">역할: {ROLE_BY_ID[activeSlot.slot.roleId]?.label}</span>}
        <div className="chips" role="group" aria-label="유형">
          {CATEGORIES.map((each) => (
            <button
              key={each}
              className="chip"
              aria-pressed={category === each}
              title={CATEGORY_HELP[each]}
              onClick={() => setCategory(each)}
            >
              {CATEGORY_LABEL[each]}
              {result?.ok && <span className="num faint"> {result.counts[each].toLocaleString()}</span>}
            </button>
          ))}
        </div>
        <label className="inline-field">
          <input
            className="field num"
            type="number"
            min={15}
            max={45}
            placeholder="나이"
            aria-label="나이 상한"
            value={maxAge}
            onChange={(event) => setMaxAge(event.target.value)}
            style={{ width: 76 }}
          />
          <span className="muted">세 이하</span>
        </label>
        <label className="search-box">
          <Search size={15} />
          <input
            className="field"
            placeholder="이름으로 찾기"
            aria-label="이름으로 찾기"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <div className="toolbar">
        <label className="inline-field">
          <input type="checkbox" checked={onlyEligible} onChange={(event) => setOnlyEligible(event.target.checked)} />
          <span>{activeSlot ? '이 자리(포지션)를 뛸 수 있는 선수만' : '이 역할의 자리에서 뛸 수 있는 선수만'}</span>
        </label>
        <label className="inline-field" title="세이브에서 소속 구단을 알아내지 못한 선수들입니다.">
          <input type="checkbox" checked={includeUnknownClub} onChange={(event) => setIncludeUnknownClub(event.target.checked)} />
          <span>구단을 알아내지 못한 선수도</span>
        </label>
        <label className="inline-field" title="계약이 1년 안에 끝나는 선수만 봅니다. 이적료 없이, 또는 싸게 데려올 수 있는 선수들입니다.">
          <input type="checkbox" checked={expiringSoon} onChange={(event) => setExpiringSoon(event.target.checked)} />
          <span>계약이 1년 안에 끝나는 선수만</span>
        </label>
        {marketNote && <span className="muted">{marketNote}</span>}
        <div className="spacer" />
        <span className="page-sub num">
          {result?.ok &&
            (search.trim()
              ? `이름이 맞는 선수 ${result.matched.toLocaleString()}명(유형 자격과 상관없이 보여 줍니다)`
              : result.matched > result.rows.length
                ? `${CATEGORY_HELP[category]}: ${result.matched.toLocaleString()}명 중 위에서 ${result.rows.length}명`
                : `${CATEGORY_HELP[category]}: ${result.matched.toLocaleString()}명`)}
        </span>
      </div>

      {result?.ok && (
        <RecommendPanel
          row={selectedCandidate}
          category={category}
          baseline={result.baseline ?? null}
          need={result.need ?? null}
          ranked={result.ranked ?? null}
          norm={result.norm ?? null}
        />
      )}

      <div className="table-wrap">
        {result === null || (loading && rows.length === 0) ? (
          <div className="empty" style={{ flex: 1 }}>
            <strong>선수를 고르는 중입니다</strong>
          </div>
        ) : sorted.length === 0 ? (
          <div className="empty" style={{ flex: 1 }}>
            <strong>조건에 맞는 선수가 없습니다</strong>
            {category === 'free'
              ? '소속이 없는 선수 가운데 이 자리의 주전 수준에 가까운 선수가 없습니다. 유형을 “전체”로 바꾸거나 역할·나이 조건을 풀어 보세요.'
              : '유형을 “전체”로 바꾸거나 역할·나이 조건을 풀어 보세요. 이름으로 찾으면 유형 자격과 상관없이 보여 줍니다.'}
          </div>
        ) : (
          <PlayerTable
            columns={COLUMNS}
            rows={sorted}
            density={settings.density}
            sort={sort}
            onSort={setSort}
            selectedIdx={selectedIdx}
            onSelect={(row) => setSelectedIdx(selectedIdx === row.idx ? null : row.idx)}
            renderCell={renderCell}
          />
        )}
        {selected && (
          <PlayerDrawer
            columns={COLUMNS}
            row={selected}
            uid={selectedUid}
            onClose={() => setSelectedIdx(null)}
            action={
              selectedUid !== null && (
                <button className="btn" onClick={() => onEdit(selectedUid)}>
                  <PencilRuler size={15} />
                  에디터에서 열기
                </button>
              )
            }
          />
        )}
      </div>
    </>
  )
}
