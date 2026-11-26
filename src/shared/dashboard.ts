import { withJosa } from './korean'
import { formatPounds } from './playerView'
import { parsePositions } from './positions'
import type { RecommendTierId } from './recommend'
import { attributesOf, effectiveWeights, scoreRole } from './roles'
import type { SeasonMatch, SeasonTableRow } from './season'
import { dateFromNumber, daysBetween, type TacticAnalysis, type Ymd } from './tactic'
import type { ColumnInfo, PlayerRow } from './types'

/**
 * 대시보드의 자료 모양과 순수 계산.
 * 세이브·화면을 모르고, 내 1군 선수 표(스쿼드 표와 같은 줄)와 전술 분석 같은 이미 계산된 값만 받는다.
 *
 * 계산이 셋 있다: 정리 후보의 "잉여 점수", 주급 과다 의심의 "로그 선형 기대 주급", 오늘의 브리핑 문장.
 * 점수의 기준값은 모두 아래 상수로 모아 두었고, 화면 설명이 이 상수를 그대로 읽는다.
 */

// ---------- 자료 모양 ----------

export interface DashDate {
  year: number
  month: number
  day: number
}

export type Tone = 'good' | 'warn' | 'bad' | 'info'

export interface BriefLine {
  id: 'standing' | 'form' | 'next' | 'need' | 'contracts'
  text: string
  tone: Tone
}

/** 대시보드 어디서나 같은 모양으로 쓰는 선수 한 명(고유 번호로 스쿼드 표와 이어진다) */
export interface DashPlayer {
  uid: number
  name: string
  age: number | null
  /** 게임 표기("D (RC), WB (R)") */
  position: string
  ca: number | null
  pa: number | null
}

export interface AgeBand {
  id: 'u21' | 'y22' | 'y26' | 'o30'
  label: string
  count: number
  /** 나이를 아는 선수 가운데 이 구간의 비율(0~1) */
  share: number
  players: DashPlayer[]
}

export interface ClubTeam {
  teamId: number
  /** 게임이 알려 준 이름. 아직 모르면 빈 글자 */
  name: string
  /** 1군인지 */
  first: boolean
  players: number
  averageAge: number | null
}

export interface LoanEntry extends DashPlayer {
  /** 내 구단에서 뛰는 팀 이름(임대 영입일 때) 또는 지금 뛰는 팀 이름(임대 방출일 때). 모르면 빈 글자 */
  team: string
  /** 임대를 보낸 구단(임대 영입) 또는 받은 구단(임대 방출). 모르면 빈 글자 */
  otherClub: string
  otherClubUid: number | null
}

export interface DashContract extends DashPlayer {
  end: DashDate
  /** 오늘부터 만료일까지 남은 일수. 이미 지났으면 음수 */
  daysLeft: number
  wage: number | null
}

export interface SurplusRow extends DashPlayer {
  wage: number | null
  /** 정리 후보 점수(0~100). 높을수록 정리할 만한 선수 */
  score: number
  /** 항목별로 더한 점수. 모르는 항목은 null */
  parts: { fit: number; wage: number; age: number }
  /** 몰라서 보통(0.5)으로 본 항목 */
  unknown: Array<'wage' | 'age'>
  /** 가장 가까운 자리와 그 자리 첫 후보와의 적합도 차이(점, 그리고 그 자리 역할의 표준편차 단위). 현재 전술에 뛸 자리가 없으면 null */
  slotLabel: string | null
  fitGap: number | null
  fitGapSigma: number | null
  /** 주급 ÷ 내 1군 주급 중간값. 모르면 null */
  wageRatio: number | null
  reason: string
}

export interface ProspectRow extends DashPlayer {
  room: number
  reason: string
}

export interface WageModelInfo {
  a: number
  b: number
  r2: number
  n: number
  /** 어느 선수들로 구했는지: 내 리그 팀들, 아니면 구단이 있는 모든 남자 선수 */
  scope: 'league' | 'all'
  teams: number
}

export interface OverpaidRow extends DashPlayer {
  wage: number
  /** 같은 리그에서 이 현재 능력의 선수가 보통 받는 주급 */
  expected: number
  ratio: number
  excess: number
}

export interface RecommendSlot {
  formation: string
  index: number
  label: string
  roleLabel: string
  need: number
  levelLabel: string
  level: 'urgent' | 'recommended' | 'normal' | 'fine'
  reason: string
  starter: { name: string; score: number } | null
  backup: { name: string; score: number } | null
}

export interface RecommendRow {
  uid: number
  name: string
  age: number | null
  position: string
  club: string
  clubUid: number | null
  ca: number
  pa: number
  /** 추천 점수(0~100) */
  total: number
  /** 같은 유형 탭의 자격 후보 안에서의 순위(백분위) 등급 — CandidateRow.tier 그대로 */
  tier: RecommendTierId
  /** 그 자리 역할 적합도와 내 주전과의 차이 */
  score: number
  gap: number | null
}

export interface DashboardData {
  ok: boolean
  /** ok가 아닐 때 화면에 그대로 보여 줄 설명 */
  message?: string
  meta?: {
    saveName: string
    /** 세이브를 저장한 시각(ISO) */
    savedAt: string
    /** 게임 속 오늘. 모르면 null */
    gameDate: DashDate | null
    /** 현재·잠재 능력과 포지션 숙련도를 어디서 읽었는지 */
    abilitySource: 'save' | 'game'
    liveAt: string | null
    club: string
    clubUid: number | null
  }
  brief: BriefLine[]
  squad: {
    firstTeam: number
    teams: ClubTeam[]
    /** 임대 선수. 믿을 수 없어 보이지 않을 때는 null */
    loans: { in: LoanEntry[]; out: LoanEntry[] } | null
    loanNote?: string
    ages: { bands: AgeBand[]; known: number; average: number | null }
  }
  contracts: {
    /** 만료일을 아는 선수 수 */
    known: number
    within1y: DashContract[]
    /** 1년 넘게, 2년 안에 끝나는 선수 */
    within2y: DashContract[]
    wageWithin1y: number
  }
  surplus: {
    ok: boolean
    message?: string
    formation: string
    medianWage: number | null
    rows: SurplusRow[]
    prospects: ProspectRow[]
  }
  overpaid: {
    ok: boolean
    message?: string
    model: WageModelInfo | null
    rows: OverpaidRow[]
    /** 기준 비율을 넘는 선수 수(목록은 위쪽 몇 명만) */
    total: number
  }
  recommend: {
    ok: boolean
    message?: string
    slot: RecommendSlot | null
    rows: RecommendRow[]
    matched: number
  }
}

export const NO_DASHBOARD: DashboardData = {
  ok: false,
  brief: [],
  squad: { firstTeam: 0, teams: [], loans: null, ages: { bands: [], known: 0, average: null } },
  contracts: { known: 0, within1y: [], within2y: [], wageWithin1y: 0 },
  surplus: { ok: false, formation: '', medianWage: null, rows: [], prospects: [] },
  overpaid: { ok: false, model: null, rows: [], total: 0 },
  recommend: { ok: false, slot: null, rows: [], matched: 0 }
}

// ---------- 내 1군 선수 ----------

/** 스쿼드 표의 한 줄에서 뽑은 값 */
export interface FirstTeamPlayer extends DashPlayer {
  wage: number | null
  contractEnd: Ymd | null
}

/** 스쿼드 표(내 1군)에서 대시보드가 쓰는 값만 뽑는다 */
export function firstTeamPlayers(rows: PlayerRow[], columns: ColumnInfo[]): FirstTeamPlayer[] {
  const header = (field: string): string | undefined => columns.find((col) => col.field === field)?.header
  const hAge = header('age')
  const hCa = header('ability')
  const hPa = header('potential')
  const hPos = header('position')
  const hWage = header('wage')
  const hEnd = header('contractEnd')
  const num = (row: PlayerRow, h: string | undefined): number | null => (h ? (row.cells[h]?.num ?? null) : null)
  return rows.map((row) => {
    const wage = num(row, hWage)
    return {
      uid: row.idx,
      name: row.name,
      age: num(row, hAge),
      position: hPos ? (row.cells[hPos]?.raw ?? '') : '',
      ca: num(row, hCa),
      pa: num(row, hPa),
      wage: wage !== null && wage > 0 ? wage : null,
      contractEnd: dateFromNumber(num(row, hEnd))
    }
  })
}

const asPlayer = ({ uid, name, age, position, ca, pa }: DashPlayer): DashPlayer => ({ uid, name, age, position, ca, pa })

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const round1 = (x: number): number => Math.round(x * 10) / 10
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

// ---------- 연령 구조 ----------

export const AGE_BAND_DEFS: Array<{ id: AgeBand['id']; label: string; min: number; max: number }> = [
  { id: 'u21', label: '21세 이하', min: 0, max: 21 },
  { id: 'y22', label: '22–25세', min: 22, max: 25 },
  { id: 'y26', label: '26–29세', min: 26, max: 29 },
  { id: 'o30', label: '30세 이상', min: 30, max: 200 }
]

export function ageStructure(players: DashPlayer[]): { bands: AgeBand[]; known: number; average: number | null } {
  const withAge = players.filter((player) => player.age !== null)
  const bands = AGE_BAND_DEFS.map((def): AgeBand => {
    const inBand = withAge
      .filter((player) => player.age! >= def.min && player.age! <= def.max)
      .sort((a, b) => b.age! - a.age! || a.name.localeCompare(b.name, 'ko'))
    return {
      id: def.id,
      label: def.label,
      count: inBand.length,
      share: withAge.length > 0 ? inBand.length / withAge.length : 0,
      players: inBand.map(asPlayer)
    }
  })
  const average = withAge.length > 0 ? round1(withAge.reduce((sum, player) => sum + player.age!, 0) / withAge.length) : null
  return { bands, known: withAge.length, average }
}

// ---------- 계약 만료 ----------

/** 계약 만료 창: 1년 이내와 그 뒤 1년(1~2년) */
export const CONTRACT_WINDOW_DAYS = [365, 730] as const

export function contractWindows(
  players: FirstTeamPlayer[],
  today: Ymd | undefined
): { known: number; within1y: DashContract[]; within2y: DashContract[]; wageWithin1y: number } {
  const empty = { known: 0, within1y: [], within2y: [], wageWithin1y: 0 }
  if (!today) return empty
  const rows: DashContract[] = []
  for (const player of players) {
    if (!player.contractEnd) continue
    rows.push({ ...asPlayer(player), end: player.contractEnd, daysLeft: daysBetween(today, player.contractEnd), wage: player.wage })
  }
  rows.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, 'ko'))
  const within1y = rows.filter((row) => row.daysLeft <= CONTRACT_WINDOW_DAYS[0])
  const within2y = rows.filter((row) => row.daysLeft > CONTRACT_WINDOW_DAYS[0] && row.daysLeft <= CONTRACT_WINDOW_DAYS[1])
  return { known: rows.length, within1y, within2y, wageWithin1y: within1y.reduce((sum, row) => sum + (row.wage ?? 0), 0) }
}

// ---------- 주급 과다 의심: ln(주급) = a + b × 현재 능력 ----------

/** 이 비율 이상 받으면 "과다 의심" */
export const OVERPAID_RATIO = 1.3
/** 목록에 보여 주는 최대 인원 */
export const OVERPAID_SHOWN = 5
/** 회귀를 믿으려면 필요한 최소 표본 */
export const WAGE_MODEL_MIN_SAMPLE = 30

/**
 * 최소제곱 직선: ln(주급) = a + b × 현재 능력. 주급이 0이거나 능력을 모르는 선수는 뺀다.
 * 표본이 적거나 능력이 모두 같으면 null. r2는 로그 주급에서의 결정계수.
 */
export function fitWageModel(points: Array<{ ca: number; wage: number }>, minSample = WAGE_MODEL_MIN_SAMPLE): { a: number; b: number; r2: number; n: number } | null {
  const used = points.filter((point) => point.ca > 0 && point.wage > 0)
  const n = used.length
  if (n < minSample) return null
  let sx = 0
  let sy = 0
  for (const { ca, wage } of used) {
    sx += ca
    sy += Math.log(wage)
  }
  const mx = sx / n
  const my = sy / n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const { ca, wage } of used) {
    const dx = ca - mx
    const dy = Math.log(wage) - my
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return null
  const b = sxy / sxx
  const a = my - b * mx
  return { a, b, r2: (sxy * sxy) / (sxx * syy), n }
}

export const expectedWage = (model: { a: number; b: number }, ca: number): number => Math.exp(model.a + model.b * ca)

/** 내 1군에서 기대 주급의 OVERPAID_RATIO배 이상 받는 선수를 초과액이 큰 순서로 */
export function overpaidPlayers(players: FirstTeamPlayer[], model: { a: number; b: number }): { rows: OverpaidRow[]; total: number } {
  const found: OverpaidRow[] = []
  for (const player of players) {
    if (player.wage === null || player.ca === null || player.ca <= 0) continue
    const expected = expectedWage(model, player.ca)
    const ratio = player.wage / expected
    if (ratio < OVERPAID_RATIO) continue
    found.push({ ...asPlayer(player), wage: player.wage, expected: Math.round(expected), ratio: Math.round(ratio * 100) / 100, excess: Math.round(player.wage - expected) })
  }
  found.sort((a, b) => b.excess - a.excess)
  return { rows: found.slice(0, OVERPAID_SHOWN), total: found.length }
}

// ---------- 정리 후보: 잉여 점수 ----------

/**
 * 잉여 점수(0~100) = 세 위험의 가중 평균 × 100. 각 위험은 0(정리할 이유 없음)~1(매우 큼).
 * 알 수 없는 위험은 빼지 않고 보통(UNKNOWN_RISK 0.5)으로 계산한다(tactic.ts·recommend.ts와 같은 방침). 이유 문장에 그 사실을 적는다.
 *
 * - 적합도 차이 50: 현재 전술에서 이 선수가 뛸 수 있는 자리 가운데 첫 후보와의 적합도 차이가 가장 작은 자리를 기준으로,
 *   첫 후보보다 낮은 점수를 그 자리 역할의 표준편차 σ로 잰 뒤 FIT_GAP_SIGMAS(3σ)로 나눈다. 뛸 수 있는 자리가 전술에 없으면 1.
 * - 주급 부담 25: 주급 ÷ 내 1군 주급 중간값이 0.5배 이하면 0, 2배 이상이면 1.
 * - 나이·정체 25: 나이 위험(24세 이하 0, 32세 이상 1)과 정체 위험(잠재가 현재보다 20 이상 높으면 0, 같으면 1)을 6 대 4로 섞는다.
 *
 * 선발도 첫 후보도 아닌 선수만 대상이다. 골키퍼는 셋은 두어야 하므로 능력이 높은 세 명(GOALKEEPERS_KEPT)은 뺀다.
 * 21세 이하이면서 잠재가 현재보다 10 이상 높은 선수는 정리 후보가 아니라 "임대 보낼 선수"로 따로 본다.
 */
export const SURPLUS_WEIGHTS = { fit: 50, wage: 25, age: 25 } as const
/** 첫 후보보다 이만큼(σ 단위) 낮으면 적합도 위험이 최대 */
export const FIT_GAP_SIGMAS = 3
/** 주급이나 나이를 몰라 위험을 정할 수 없을 때 쓰는 보통 값(추정) */
export const UNKNOWN_RISK = 0.5
export const WAGE_RATIO_ZERO = 0.5
export const WAGE_RATIO_FULL = 2
export const AGE_RISK_FROM = 24
export const AGE_RISK_FULL = 32
export const STAGNATION_ROOM_FULL = 20
export const AGE_SHARE = 0.6
export const PROSPECT_MAX_AGE = 21
export const PROSPECT_MIN_ROOM = 10
/** 중간값을 믿으려면 필요한 주급을 아는 1군 선수 수 */
export const MIN_WAGE_SAMPLE = 8
export const SURPLUS_SHOWN = 5
/** 골키퍼는 이만큼은 두어야 하므로 정리 후보로 보지 않는다 */
export const GOALKEEPERS_KEPT = 3

export interface SurplusInput {
  /** 가장 가까운 자리에서 첫 후보보다 얼마나 낮은가(그 자리 역할의 σ 단위, 0 이상). 뛸 자리가 없으면 null */
  fitGapSigma: number | null
  wage: number | null
  medianWage: number | null
  age: number | null
  ca: number | null
  pa: number | null
}

export interface SurplusScore {
  score: number
  parts: { fit: number; wage: number; age: number }
  wageRatio: number | null
  /** 몰라서 보통(UNKNOWN_RISK)으로 본 항목 */
  unknown: Array<'wage' | 'age'>
}

export function surplusScore(input: SurplusInput): SurplusScore {
  const unknown: SurplusScore['unknown'] = []
  const fit = input.fitGapSigma === null ? 1 : clamp01(input.fitGapSigma / FIT_GAP_SIGMAS)
  const wageRatio = input.wage && input.medianWage ? input.wage / input.medianWage : null
  let wage = UNKNOWN_RISK
  if (wageRatio !== null) wage = clamp01((wageRatio - WAGE_RATIO_ZERO) / (WAGE_RATIO_FULL - WAGE_RATIO_ZERO))
  else unknown.push('wage')
  let age = UNKNOWN_RISK
  if (input.age !== null) {
    const ageRisk = clamp01((input.age - AGE_RISK_FROM) / (AGE_RISK_FULL - AGE_RISK_FROM))
    const stagnation = input.ca !== null && input.pa !== null ? clamp01(1 - (input.pa - input.ca) / STAGNATION_ROOM_FULL) : null
    age = stagnation === null ? ageRisk : AGE_SHARE * ageRisk + (1 - AGE_SHARE) * stagnation
  } else unknown.push('age')
  const parts = { fit: round1(fit * SURPLUS_WEIGHTS.fit), wage: round1(wage * SURPLUS_WEIGHTS.wage), age: round1(age * SURPLUS_WEIGHTS.age) }
  const score = round1(fit * SURPLUS_WEIGHTS.fit + wage * SURPLUS_WEIGHTS.wage + age * SURPLUS_WEIGHTS.age)
  return { score, parts, wageRatio, unknown }
}

/** 선수 한 명의 정리 후보 이유를 한 문장으로. 조각마다 (잇는 꼴, 맺는 꼴)을 두고 마지막 조각만 맺는 꼴로 쓴다. */
function surplusReason(
  player: FirstTeamPlayer,
  scored: SurplusScore,
  best: { label: string; gap: number; sigma: number; benchmarkName: string } | null,
  median: number | null
): string {
  const clauses: Array<[string, string]> = []
  const stem = (text: string, connect: string, end: string): void => {
    clauses.push([`${text}${connect}`, `${text}${end}`])
  }
  if (!best) stem(`현재 전술에 ${withJosa(player.name, '이/가')} 뛸 수 있는 자리가 없`, '고', '습니다')
  else if (best.gap >= 0.5) {
    stem(`가장 가까운 ${best.label} 자리에서도 첫 후보 ${best.benchmarkName}보다 적합도가 ${best.gap.toFixed(1)}점(약 ${(best.gap / best.sigma).toFixed(1)} 표준편차) 낮`, '고', '습니다')
  } else stem(`${best.label} 자리 첫 후보 ${best.benchmarkName}와 실력은 비슷하지만 그 자리가 이미 찼`, '고', '습니다')
  if (scored.wageRatio !== null && scored.wageRatio >= 1 && player.wage && median) {
    stem(`주급 ${formatPounds(player.wage)}는 1군 중간값(${formatPounds(median)})의 ${scored.wageRatio.toFixed(1)}배`, '이고', '입니다')
  }
  if (player.age !== null) {
    const room = player.ca !== null && player.pa !== null ? player.pa - player.ca : null
    if (player.age >= 28 && room !== null && room <= 5) stem(`${player.age}세로 앞으로 클 여지가 거의 없`, '고', '습니다')
    else if (room !== null && room <= 5) {
      stem(room <= 0 ? `${player.age}세이고 잠재 능력이 현재 능력과 같` : `${player.age}세이고 잠재 능력이 현재 능력보다 ${room}밖에 높지 않`, '고', '습니다')
    } else if (player.age >= 30) stem(`${player.age}세`, '이고', '입니다')
  }
  if (scored.unknown.includes('wage')) stem('주급을 몰라 보통(0.5)으로 보았', '고', '습니다')
  if (scored.unknown.includes('age')) stem('나이를 몰라 보통(0.5)으로 보았', '고', '습니다')
  return `${clauses.map(([joined, last], i) => (i === clauses.length - 1 ? last : joined)).join(' ')}.`
}

/**
 * 정리 후보 TOP 5와 임대 보낼 유망주.
 * 선발이거나 어느 자리의 첫 후보이면 대상이 아니다(analyseTactic의 depth 결과를 그대로 쓴다).
 */
export function surplusReport(args: {
  players: FirstTeamPlayer[]
  rows: PlayerRow[]
  columns: ColumnInfo[]
  analysis: TacticAnalysis
  roleWeights: Record<string, Record<string, number>>
}): { medianWage: number | null; rows: SurplusRow[]; prospects: ProspectRow[] } {
  const { players, rows, columns, analysis, roleWeights } = args
  const used = new Set<number>()
  for (const slot of analysis.slots) {
    if (slot.slot.starter) used.add(slot.slot.starter.idx)
    if (slot.slot.backups[0]) used.add(slot.slot.backups[0].idx)
  }
  const wages = players.map((player) => player.wage).filter((wage): wage is number => wage !== null)
  const medianWage = wages.length >= MIN_WAGE_SAMPLE ? median(wages) : null

  const positionHeader = columns.find((col) => col.field === 'position')?.header
  const rowOf = new Map(rows.map((row) => [row.idx, row]))
  const slots = analysis.slots.map((slot) => ({
    slot,
    weights: effectiveWeights(slot.slot.roleId, roleWeights),
    benchmark: slot.slot.backups[0]?.score ?? slot.slot.starter?.score ?? null,
    benchmarkName: slot.slot.backups[0]?.name ?? slot.slot.starter?.name ?? '',
    sigma: slot.norm.sigma
  }))

  // 골키퍼(포지션이 골키퍼뿐인 선수) 가운데 능력이 높은 GOALKEEPERS_KEPT명은 정리 대상이 아니다
  const isKeeper = (player: FirstTeamPlayer): boolean => {
    const row = rowOf.get(player.uid)
    const list = row && positionHeader ? parsePositions(row.cells[positionHeader]?.raw ?? '') : []
    return list.length === 1 && list[0] === 'GK'
  }
  const kept = new Set(
    players
      .filter(isKeeper)
      .sort((a, b) => (b.ca ?? 0) - (a.ca ?? 0))
      .slice(0, GOALKEEPERS_KEPT)
      .map((player) => player.uid)
  )

  const surplus: SurplusRow[] = []
  const prospects: ProspectRow[] = []
  for (const player of players) {
    if (used.has(player.uid) || kept.has(player.uid)) continue
    const room = player.ca !== null && player.pa !== null ? player.pa - player.ca : null
    if (player.age !== null && player.age <= PROSPECT_MAX_AGE && room !== null && room >= PROSPECT_MIN_ROOM) {
      prospects.push({
        ...asPlayer(player),
        room,
        reason: `${player.age}세, 현재 능력 ${player.ca}에 잠재 능력 ${player.pa}으로 ${room}만큼 더 큽니다. 1군에서 뛸 자리는 없어 임대로 경기를 뛰게 하는 편이 낫습니다.`
      })
      continue
    }
    const row = rowOf.get(player.uid)
    let best: { gap: number; label: string; sigma: number; benchmarkName: string } | null = null
    if (row && positionHeader) {
      const playable = parsePositions(row.cells[positionHeader]?.raw ?? '')
      const attrs = attributesOf(row, columns)
      for (const { slot, weights, benchmark, benchmarkName, sigma } of slots) {
        if (benchmark === null || !playable.includes(slot.slot.position)) continue
        const result = scoreRole(attrs, weights)
        if (!result) continue
        const gap = Math.max(0, benchmark - result.score)
        // 자리마다 역할의 눈금이 다르므로 σ 단위로 견주어 가장 가까운 자리를 고른다
        if (!best || gap / sigma < best.gap / best.sigma) best = { gap, label: slot.label, sigma, benchmarkName }
      }
    }
    const scored = surplusScore({ fitGapSigma: best ? best.gap / best.sigma : null, wage: player.wage, medianWage, age: player.age, ca: player.ca, pa: player.pa })
    surplus.push({
      ...asPlayer(player),
      wage: player.wage,
      score: scored.score,
      parts: scored.parts,
      unknown: scored.unknown,
      slotLabel: best ? best.label : null,
      fitGap: best ? round1(best.gap) : null,
      fitGapSigma: best ? round1(best.gap / best.sigma) : null,
      wageRatio: scored.wageRatio === null ? null : round1(scored.wageRatio),
      reason: surplusReason(player, scored, best, medianWage)
    })
  }
  surplus.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ko'))
  prospects.sort((a, b) => (b.pa ?? 0) - (a.pa ?? 0) || b.room - a.room)
  return { medianWage, rows: surplus.slice(0, SURPLUS_SHOWN), prospects: prospects.slice(0, SURPLUS_SHOWN) }
}

// ---------- 오늘의 브리핑 ----------

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

function weekday(date: DashDate): string {
  return WEEKDAY[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()]
}

export interface BriefInput {
  /** 리그 순위표. 없으면 null */
  table: SeasonTableRow[] | null
  /** 최근 경기(가장 최근 것이 먼저) */
  recent: SeasonMatch[]
  next: SeasonMatch | null
  /** 가장 보강이 급한 자리 */
  need: { label: string; roleLabel: string; need: number; level: RecommendSlot['level']; levelLabel: string; reason: string; formation: string } | null
  /** 계약 만료까지 12개월 이내 선수 이름과 수(만료일을 아는 선수가 있을 때만) */
  expiring: { known: number; names: string[]; count: number } | null
}

/** 규칙으로 쓰는 짧은 브리핑. 자료가 없는 문장은 건너뛴다(없는 사실을 만들지 않는다). */
export function buildBrief(input: BriefInput): BriefLine[] {
  const lines: BriefLine[] = []
  const { table, recent, next, need, expiring } = input

  const mine = table?.find((row) => row.mine)
  if (table && mine && mine.played > 0) {
    const first = table[0]
    const second = table[1]
    let text: string
    let tone: Tone
    if (mine.position === 1) {
      text = `리그 1위입니다(${mine.played}경기, 승점 ${mine.points}점).`
      if (second) {
        const lead = mine.points - second.points
        text += lead > 0 ? ` 2위 ${second.name}보다 승점 ${lead}점 앞서 있습니다.` : ` 2위 ${second.name}도 승점이 같습니다.`
      }
      tone = 'good'
    } else {
      text = `리그 ${mine.position}위입니다(${mine.played}경기, 승점 ${mine.points}점).`
      const behind = first.points - mine.points
      text += behind > 0 ? ` 1위 ${first.name}보다 승점 ${behind}점 뒤져 있습니다.` : ` 1위 ${first.name}도 승점이 같습니다.`
      if (mine.position > 2 && second) {
        const gap = second.points - mine.points
        text += gap > 0 ? ` 2위와는 ${gap}점 차이입니다.` : ''
      }
      tone = mine.position <= 3 ? 'good' : mine.position > table.length - 3 ? 'warn' : 'info'
    }
    lines.push({ id: 'standing', text, tone })
  }

  const played = recent.filter((match) => match.result !== null)
  if (played.length > 0) {
    const count = (result: 'win' | 'draw' | 'loss'): number => played.filter((match) => match.result === result).length
    const w = count('win')
    const d = count('draw')
    const l = count('loss')
    const scored = played.filter((match) => match.goalsFor !== null && match.goalsAgainst !== null)
    const goals = scored.length === played.length ? ` (${scored.reduce((s, m) => s + m.goalsFor!, 0)}득점 ${scored.reduce((s, m) => s + m.goalsAgainst!, 0)}실점)` : ''
    const record = [w > 0 ? `${w}승` : '', d > 0 ? `${d}무` : '', l > 0 ? `${l}패` : ''].filter(Boolean).join(' ')
    lines.push({
      id: 'form',
      text: `최근 ${played.length}경기 ${record}${goals}입니다.`,
      tone: l === 0 && w * 2 >= played.length ? 'good' : l * 2 >= played.length ? 'bad' : 'info'
    })
  }

  if (next) {
    const rival = next.league ? table?.find((row) => row.teamId === next.opponentId) : undefined
    const opponent = next.opponent || '이름을 모르는 팀'
    const where = next.home ? '홈' : '원정'
    const detail = rival ? `리그 ${rival.position}위, 승점 ${rival.points}점` : next.league ? '' : '다른 대회'
    lines.push({
      id: 'next',
      text: `다음 경기는 ${next.date.month}월 ${next.date.day}일(${weekday(next.date)}) ${where}, ${opponent}${detail ? `(${detail})` : ''}입니다.`,
      tone: 'info'
    })
  }

  if (need) {
    lines.push(
      need.level === 'fine'
        ? { id: 'need', text: `현재 전술(${need.formation})에서 급히 보강할 자리는 없습니다. 가장 높은 보강 필요도는 ${need.label}의 ${need.need}점입니다.`, tone: 'good' }
        : {
            id: 'need',
            text: `가장 보강이 급한 자리는 ${need.label}(${need.roleLabel})입니다. 보강 필요도 ${need.need}점(${need.levelLabel}). ${need.reason}`,
            tone: need.level === 'urgent' ? 'bad' : need.level === 'recommended' ? 'warn' : 'info'
          }
    )
  }

  if (expiring && expiring.known > 0) {
    lines.push(
      expiring.count === 0
        ? { id: 'contracts', text: '12개월 안에 계약이 끝나는 1군 선수는 없습니다.', tone: 'good' }
        : {
            id: 'contracts',
            text: `12개월 안에 계약이 끝나는 1군 선수가 ${expiring.count}명입니다(${expiring.names.slice(0, 3).join(', ')}${expiring.count > 3 ? ' 외' : ''}).`,
            tone: expiring.count >= 3 ? 'warn' : 'info'
          }
    )
  }
  return lines.slice(0, 5)
}
