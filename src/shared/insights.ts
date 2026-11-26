import { dateFromNumber, POSITION_LABEL, type TacticAnalysis, type Ymd } from './tactic'
import type { ColumnInfo, PlayerRow, SquadResult } from './types'

/**
 * 스쿼드 진단: 선수 표에서 곧바로 셀 수 있는 사실만 짧은 글로 만든다.
 * 값이 없으면 짐작하지 않고 무엇이 없는지 적는다.
 */

export { dateFromNumber, POSITION_LABEL }
export type { Ymd }

/** 성장 기대주로 보는 나이 */
export const PROSPECT_AGE = 23
/** 핵심 전력으로 보여 주는 인원 */
export const CORE_COUNT = 5
/** 계약 만료 임박으로 보는 기간(개월) */
export const EXPIRY_MONTHS = 12
/** 카드마다 이름을 보여 주는 최대 줄 수 */
const MAX_LINES = 5

export interface InsightPlayer {
  idx: number
  name: string
  position: string
  age: number | null
  ca: number | null
  pa: number | null
  contractEnd: Ymd | null
  /** 표에 적힌 주급 글자("£120K"). 없으면 빈 글자 */
  wage: string
}

export interface InsightLine {
  /** 눌러서 선수 화면을 열 선수. 없으면 null */
  idx: number | null
  name: string
  detail: string
}

export interface InsightBar {
  label: string
  count: number
}

export interface InsightCard {
  id: 'depth' | 'age' | 'prospects' | 'core' | 'expiring'
  title: string
  /** 한 문장으로 사실만 */
  finding: string
  /** attention: 살펴볼 것이 있다, missing: 자료가 없어 못 셌다 */
  tone: 'normal' | 'attention' | 'missing'
  linesTitle?: string
  lines: InsightLine[]
  /** lines에 다 담지 못한 나머지 수 */
  more: number
  bars?: InsightBar[]
  /** 덧붙이는 말(읽지 못한 선수 수 등) */
  note?: string
}

const header = (columns: ColumnInfo[], field: string): string | undefined => columns.find((col) => col.field === field)?.header

/** 표의 줄들에서 진단에 쓸 값을 뽑는다. 어떤 열이 있었는지도 함께 알려 준다. */
export function insightPlayers(
  rows: PlayerRow[],
  columns: ColumnInfo[]
): { players: InsightPlayer[]; has: { age: boolean; ability: boolean; potential: boolean; contract: boolean } } {
  const at = {
    position: header(columns, 'position'),
    age: header(columns, 'age'),
    ca: header(columns, 'ability'),
    pa: header(columns, 'potential'),
    end: header(columns, 'contractEnd'),
    wage: header(columns, 'wage')
  }
  const num = (row: PlayerRow, key: string | undefined): number | null => {
    const value = key ? row.cells[key]?.num : null
    return value === undefined ? null : value
  }
  const players = rows.map(
    (row): InsightPlayer => ({
      idx: row.idx,
      name: row.name,
      position: (at.position && row.cells[at.position]?.raw) || '',
      age: num(row, at.age),
      ca: num(row, at.ca),
      pa: num(row, at.pa),
      contractEnd: dateFromNumber(num(row, at.end)),
      wage: (at.wage && row.cells[at.wage]?.raw) || ''
    })
  )
  return { players, has: { age: !!at.age, ability: !!at.ca, potential: !!(at.ca && at.pa), contract: !!at.end } }
}

const missing = (id: InsightCard['id'], title: string, finding: string): InsightCard => ({
  id, title, finding, tone: 'missing', lines: [], more: 0
})

// ---------- 포지션 뎁스 ----------

/** 보강 필요도가 이 값 이상인 자리를 카드에 올린다(전술 분석의 "보강 권장" 이상) */
export const DEPTH_CARD_MIN_NEED = 30

/** 전술 분석(shared/tactic.ts)의 결과를 카드로. 전술판의 분석과 같은 자리·같은 이유를 쓴다. */
export function depthCard(analysis: TacticAnalysis | null, formationLabel: string): InsightCard {
  const title = '포지션 뎁스'
  if (!analysis) return missing('depth', title, '포지션과 능력치 열이 있어야 자리별 선수를 계산할 수 있습니다.')
  const flagged = analysis.byNeed.filter((each) => each.need >= DEPTH_CARD_MIN_NEED)
  const urgent = flagged.filter((each) => each.level === 'urgent').length
  const lines = flagged.slice(0, MAX_LINES).map(
    (each): InsightLine => ({
      idx: each.slot.starter?.idx ?? null,
      name: each.slot.starter?.name ?? each.label,
      detail: `${each.label} · 보강 필요도 ${Math.round(each.need)}(${each.levelLabel}) · ${each.reason}`
    })
  )
  return {
    id: 'depth',
    title,
    finding:
      flagged.length === 0
        ? `${formationLabel} 기준으로 보강이 필요한 자리가 없습니다.`
        : `${formationLabel} 기준 보강 필요도가 ${DEPTH_CARD_MIN_NEED} 이상인 자리가 ${flagged.length}곳${urgent > 0 ? `(시급 ${urgent}곳)` : ''}입니다.`,
    tone: flagged.length === 0 ? 'normal' : 'attention',
    lines,
    more: Math.max(0, flagged.length - lines.length)
  }
}

// ---------- 나이 구성 ----------

export const AGE_GROUPS: Array<{ label: string; min: number; max: number }> = [
  { label: '21세 이하', min: 0, max: 21 },
  { label: '22~25세', min: 22, max: 25 },
  { label: '26~29세', min: 26, max: 29 },
  { label: '30세 이상', min: 30, max: 200 }
]

export function ageCard(players: InsightPlayer[], hasAge: boolean): InsightCard {
  const title = '나이 구성'
  if (!hasAge) return missing('age', title, '이 기록에는 나이 열이 없어 셀 수 없습니다.')
  const known = players.filter((player) => player.age !== null)
  if (known.length === 0) return missing('age', title, '선수들의 나이를 읽지 못했습니다.')
  const bars = AGE_GROUPS.map((group) => ({
    label: group.label,
    count: known.filter((player) => player.age! >= group.min && player.age! <= group.max).length
  }))
  const average = known.reduce((sum, player) => sum + player.age!, 0) / known.length
  const veterans = known.filter((player) => player.age! >= 30).sort((a, b) => b.age! - a.age! || a.name.localeCompare(b.name, 'ko'))
  const lines = veterans.slice(0, 3).map((player): InsightLine => ({ idx: player.idx, name: player.name, detail: `${player.age}세` }))
  const unknown = players.length - known.length
  return {
    id: 'age',
    title,
    finding: `평균 나이는 ${average.toFixed(1)}세입니다. 21세 이하 ${bars[0].count}명, 30세 이상 ${bars[3].count}명입니다.`,
    tone: 'normal',
    linesTitle: lines.length > 0 ? '나이가 많은 선수' : undefined,
    lines,
    more: Math.max(0, veterans.length - lines.length),
    bars,
    note: unknown > 0 ? `나이를 읽지 못한 선수 ${unknown}명은 세지 않았습니다.` : undefined
  }
}

// ---------- 성장 기대주 ----------

export function prospectsCard(players: InsightPlayer[], hasPotential: boolean): InsightCard {
  const title = '성장 기대주'
  if (!hasPotential) return missing('prospects', title, '이 기록에는 현재 능력이나 잠재 능력 열이 없어 셀 수 없습니다.')
  const young = players.filter((player) => player.age !== null && player.age <= PROSPECT_AGE)
  if (young.length === 0) return { ...missing('prospects', title, `${PROSPECT_AGE}세 이하 선수가 없습니다.`), tone: 'normal' }
  const room = young
    .filter((player) => player.ca !== null && player.pa !== null && player.pa > player.ca)
    .sort((a, b) => b.pa! - b.ca! - (a.pa! - a.ca!) || b.pa! - a.pa! || a.name.localeCompare(b.name, 'ko'))
  if (room.length === 0) {
    return {
      id: 'prospects',
      title,
      finding: `${PROSPECT_AGE}세 이하 ${young.length}명 가운데 잠재 능력이 현재 능력보다 높은 선수가 없습니다.`,
      tone: 'normal',
      lines: [],
      more: 0
    }
  }
  const lines = room.slice(0, 3).map(
    (player): InsightLine => ({
      idx: player.idx,
      name: player.name,
      detail: `${player.age}세 · 현재 ${player.ca} → 잠재 ${player.pa} (+${player.pa! - player.ca!})`
    })
  )
  return {
    id: 'prospects',
    title,
    finding: `${PROSPECT_AGE}세 이하 ${young.length}명 가운데 잠재 능력이 현재 능력보다 가장 많이 높은 선수들입니다.`,
    tone: 'normal',
    lines,
    more: Math.max(0, room.length - lines.length)
  }
}

// ---------- 핵심 전력 ----------

export function coreCard(players: InsightPlayer[], hasAbility: boolean): InsightCard {
  const title = '핵심 전력'
  if (!hasAbility) return missing('core', title, '이 기록에는 현재 능력 열이 없어 셀 수 없습니다.')
  const ranked = players
    .filter((player) => player.ca !== null)
    .sort((a, b) => b.ca! - a.ca! || a.name.localeCompare(b.name, 'ko'))
  if (ranked.length === 0) return missing('core', title, '선수들의 현재 능력을 읽지 못했습니다.')
  const top = ranked.slice(0, CORE_COUNT)
  const lines = top.map(
    (player): InsightLine => ({
      idx: player.idx,
      name: player.name,
      detail: `현재 능력 ${player.ca}${player.age !== null ? ` · ${player.age}세` : ''}`
    })
  )
  const last = top[top.length - 1]
  return {
    id: 'core',
    title,
    finding: `현재 능력이 가장 높은 ${top.length}명입니다. 1위 ${top[0].ca}, ${top.length}위 ${last.ca}.`,
    tone: 'normal',
    lines,
    more: 0
  }
}

// ---------- 계약 만료 임박 ----------

const DAY_MS = 86_400_000
const dayNumber = (date: Ymd): number => Math.round(Date.UTC(date.year, date.month - 1, date.day) / DAY_MS)

/** date에서 months개월 뒤(달력 기준)의 날짜 번호 */
function monthsLater(date: Ymd, months: number): number {
  return Math.round(Date.UTC(date.year, date.month - 1 + months, date.day) / DAY_MS)
}

const dateText = (date: Ymd): string => `${date.year}.${date.month}.${date.day}`

export function expiringCard(players: InsightPlayer[], today: Ymd | undefined, hasContract: boolean): InsightCard {
  const title = '계약 만료 임박'
  if (!hasContract) return missing('expiring', title, '이 기록에는 계약 만료일 열이 없어 셀 수 없습니다.')
  if (!today) return missing('expiring', title, '게임 속 오늘 날짜를 알 수 없어 남은 기간을 셀 수 없습니다.')
  const known = players.filter((player) => player.contractEnd !== null)
  if (known.length === 0) return missing('expiring', title, '세이브에서 계약 만료일을 읽지 못했습니다.')
  const from = dayNumber(today)
  const until = monthsLater(today, EXPIRY_MONTHS)
  const soon = known
    .filter((player) => {
      const end = dayNumber(player.contractEnd!)
      return end >= from && end <= until
    })
    .sort((a, b) => dayNumber(a.contractEnd!) - dayNumber(b.contractEnd!) || a.name.localeCompare(b.name, 'ko'))
  const unknown = players.length - known.length
  const note = [`기준일은 게임 속 오늘(${dateText(today)})입니다.`, unknown > 0 ? `계약 만료일을 읽지 못한 선수 ${unknown}명은 세지 않았습니다.` : '']
    .filter(Boolean)
    .join(' ')
  const lines = soon.slice(0, MAX_LINES).map((player): InsightLine => {
    const days = dayNumber(player.contractEnd!) - from
    const left = days <= 31 ? `${days}일 남음` : `${Math.round(days / 30.44)}개월 남음`
    return {
      idx: player.idx,
      name: player.name,
      detail: [dateText(player.contractEnd!), left, player.wage ? `주급 ${player.wage}` : ''].filter(Boolean).join(' · ')
    }
  })
  return {
    id: 'expiring',
    title,
    finding: soon.length === 0 ? `${EXPIRY_MONTHS}개월 안에 계약이 끝나는 선수가 없습니다.` : `${soon.length}명의 계약이 ${EXPIRY_MONTHS}개월 안에 끝납니다.`,
    tone: soon.length === 0 ? 'normal' : 'attention',
    lines,
    more: Math.max(0, soon.length - lines.length),
    note
  }
}

/** 진단 카드들. slots는 지금 고른 포메이션으로 만든 자리별 선수(만들 수 없으면 null) */
export function buildInsights(
  snapshot: Pick<SquadResult, 'rows' | 'columns' | 'today'>,
  analysis: TacticAnalysis | null,
  formationLabel: string
): InsightCard[] {
  const { players, has } = insightPlayers(snapshot.rows, snapshot.columns)
  return [
    depthCard(analysis, formationLabel),
    expiringCard(players, snapshot.today, has.contract),
    prospectsCard(players, has.potential),
    coreCard(players, has.ability),
    ageCard(players, has.age)
  ]
}
