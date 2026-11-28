import { withJosa } from './korean'
import { K } from './ledger'
import { SHARE_SCALE } from './limits'
import { zOf, type RoleNorms } from './norms'
import { formatPounds } from './playerView'
import { parsePositions, posPenaltySigma, ratingAt, RATING_UNKNOWN_ASSUMED } from './positions'
import type { Realism, RecommendTierId } from './recommend'
import { effectiveRoleWeights, LEGACY_CATALOG, profileWeights, type RoleCatalog } from './roleCatalog'
import { attributesOf, scoreRole, type AttributeValue } from './roles'
import type { SeasonMatch, SeasonTableRow } from './season'
import { mixedPenaltySigma, type RatingInput, type SlotProfile } from './slotProfile'
import { dateFromNumber, daysBetween, isContractSoon, type SlotAnalysis, type TacticAnalysis, type Ymd } from './tactic'
import type { ColumnInfo, PlayerRow } from './types'
import {
  growthBetaOf,
  growthGain,
  hasGrowthRoom,
  prospectCheck,
  type CandidateBench,
  type ProspectCheck
} from './world'

/**
 * 대시보드의 자료 모양과 순수 계산.
 * 세이브·화면을 모르고, 내 1군 선수 표(스쿼드 표와 같은 줄)와 전술 분석 같은 이미 계산된 값만 받는다.
 *
 * 계산이 셋 있다: 정리 후보의 "잉여 점수", 주급 과다 의심의 "로그 선형 기대 주급(능력·나이)", 오늘의 브리핑 문장.
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
  /**
   * 임대로 온 선수의 임대 복귀(5회차). end는 계약 만료일이 아니라 임대가 끝나는 날(오늘 이후 첫 6월 30일로 어림한 추정)이고,
   * from은 돌아갈 원 소속 구단(모르면 빈 글자)이다. 임대가 아니면 없다
   */
  loan?: { from: string }
}

export interface SurplusRow extends DashPlayer {
  wage: number | null
  /** 정리 후보 점수(0~100). 높을수록 정리할 만한 선수 */
  score: number
  /** 항목별로 더한 점수 */
  parts: { fit: number; wage: number; age: number }
  /** 몰라서 보통(0.5)으로 본 항목 */
  unknown: Array<'fit' | 'wage' | 'age'>
  /** 적합도 위험을 어떻게 정했는가: 뛸 자리가 있음(slot), 전술에 뛸 자리가 없음(noSlot), 골키퍼 인원(keeper), 정하지 못함(unknown) */
  fit: 'slot' | 'noSlot' | 'keeper' | 'unknown'
  /** 가장 가까운 자리와 그 자리 첫 후보와의 적합도 차이(f_eff 기준 점, 그리고 그 자리 역할의 표준편차 단위). 뛸 자리가 전술에 없으면 null */
  slotLabel: string | null
  fitGap: number | null
  fitGapSigma: number | null
  /** 전술에 뛸 자리가 없을 때 가장 잘 맞는 역할 이름 */
  bestRole: string | null
  /** 주급이 기대 주급보다 몇 σ 높은가(z_w, 기대 이하이면 음수). 모르면 null */
  wageZ: number | null
  reason: string
}

export interface ProspectRow extends DashPlayer {
  room: number
  /** 다 컸을 때 적합도가 오르는 점수(β × growthShare × (PA - CA)) */
  gain: number
  reason: string
}

export interface WageModelInfo {
  /** ln(주급) = a + b·(CA - 145) + b2·((CA - 145)/10)² + c1·[나이 < 21] + c2·[나이 ≥ 30] */
  a: number
  b: number
  /** 현재 능력의 2차항(5회차). 음수이면 스타 주급이 지수보다 덜 오른다 */
  b2: number
  c1: number
  c2: number
  r2: number
  /** 잔차 표준편차(로그 주급) */
  s: number
  n: number
  /** 어느 선수들로 구했는지: 내 리그 팀들. 순위표를 읽지 못하면 모델을 만들지 않는다(5회차. 예전의 "모든 남자 선수" 대신하기는 쓸 수 없어 없앴다) */
  scope: 'league'
  teams: number
  /** 첫 적합에서 |z| > WAGE_OUTLIER_Z라 빼고 다시 맞춘 선수 수(4회차) */
  removed: number
}

export interface OverpaidRow extends DashPlayer {
  wage: number
  /** 같은 리그에서 이 현재 능력·나이의 선수가 보통 받는 주급 */
  expected: number
  ratio: number
  /** 기대 주급보다 잔차 표준편차의 몇 배 높은가(z_w) */
  z: number
  /** 강한 의심(z ≥ OVERPAID_Z_STRONG) */
  strong: boolean
  excess: number
}

export interface RecommendSlot {
  formation: string
  /** 이 자리가 든 전술의 번호(대시보드 카드에서 영입 후보로 넘어갈 때 `{ tacticId, index }`로 가리킨다) */
  tacticId: string
  index: number
  /** "중앙 수비 2자리"처럼 같은 프로파일의 자리 수까지 붙인 이름 */
  label: string
  roleLabel: string
  need: number
  levelLabel: string
  level: 'urgent' | 'recommended' | 'normal' | 'fine'
  reason: string
  /** 같은 포지션·역할의 자리 수 */
  groupSlots: number
  /** 영입 후보 화면과 같은 비교 기준(자리가 여럿이면 가장 약한 주전과, 그 자리들의 첫 후보 가운데 가장 높은 선수) */
  bench: CandidateBench
}

/**
 * 가장 급한 자리를 대시보드 영입 추천의 기준으로 바꾼다. 영입 후보 화면처럼 같은 포지션·역할의 자리를 한 그룹으로 보고
 * 그 그룹의 비교 기준을 쓴다(그래야 카드의 "주전과 적합도 +5.3"이 위에 적힌 주전과 맞는다).
 * tacticId는 분석한 전술의 번호(analysis.tactic.id). 주지 않으면 옛 포메이션 설정으로 만든 옛 전술의 번호(`legacy:${formation}`)다.
 */
export function recommendSlotOf(formation: string, need: SlotAnalysis, tacticId: string = `legacy:${formation}`): RecommendSlot {
  const { group } = need
  const count = group.slots.length
  return {
    formation,
    tacticId,
    index: need.slot.index,
    label: count > 1 ? `${need.positionLabel} ${count}자리` : need.label,
    roleLabel: need.roleLabel,
    need: group.need,
    levelLabel: group.levelLabel,
    level: group.level,
    reason: group.reason,
    groupSlots: count,
    bench: group.bench
  }
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
  /** 그 자리 역할 적합도(화면에 보이는 값) */
  score: number
  /** 화면에 보이는 적합도끼리의 차이(후보 - 주전). 마우스 설명으로만 보여 준다 */
  gap: number | null
  /** 주전과의 차이: 후보의 비교 적합도(숙련·나이를 뺀 값) - 주전 기준(나이 하락을 뺀 값). 설명 문장·유형 판정과 같은 기준이라 카드에는 이 값을 쓴다(5회차) */
  gapEff: number | null
  /** 임대 중이면 지금 뛰고 있는 구단(club은 원 소속). 아니면 null */
  loanedTo: string | null
  /** 영입 현실성(낮으면 등급을 고려까지로 제한했다) */
  realism: Realism
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
    /** 이미 계약이 끝난 선수(남은 일수 < 0). 12개월 안 목록에는 넣지 않는다 */
    expired: DashContract[]
    /** 오늘부터 12개월 안에 끝나는 선수(이미 끝난 선수 제외) */
    within1y: DashContract[]
    /** 1년 넘게, 2년 안에 끝나는 선수 */
    within2y: DashContract[]
    wageWithin1y: number
  }
  surplus: {
    ok: boolean
    message?: string
    formation: string
    rows: SurplusRow[]
    prospects: ProspectRow[]
  }
  overpaid: {
    ok: boolean
    message?: string
    model: WageModelInfo | null
    rows: OverpaidRow[]
    /** 기준(z ≥ OVERPAID_Z)을 넘는 선수 수(목록은 위쪽 몇 명만) */
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
  contracts: { known: 0, expired: [], within1y: [], within2y: [], wageWithin1y: 0 },
  surplus: { ok: false, formation: '', rows: [], prospects: [] },
  overpaid: { ok: false, model: null, rows: [], total: 0 },
  recommend: { ok: false, slot: null, rows: [], matched: 0 }
}

// ---------- 내 1군 선수 ----------

/** 스쿼드 표의 한 줄에서 뽑은 값 */
export interface FirstTeamPlayer extends DashPlayer {
  wage: number | null
  contractEnd: Ymd | null
  /** 임대로 온 선수면 임대가 끝나는 날과 원 소속 구단(PlayerRow.loan). 아니면 없다 */
  loan?: { end: Ymd; from: string }
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
      contractEnd: dateFromNumber(num(row, hEnd)),
      loan: row.loan
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

/**
 * 계약 만료 창: 오늘부터 K.CONTRACT_SOON_DAYS(365일, 화면의 "12개월") 이내와 그 뒤 K.CONTRACT_FAR_DAYS(730일)까지(1~2년).
 * 이미 끝난 계약(남은 일수 < 0)은 따로 센다. 스쿼드 진단 카드(insights.ts)도 같은 정의(isContractSoon)를 쓴다(F-08).
 */
export function contractWindows(
  players: FirstTeamPlayer[],
  today: Ymd | undefined
): { known: number; expired: DashContract[]; within1y: DashContract[]; within2y: DashContract[]; wageWithin1y: number } {
  const empty = { known: 0, expired: [], within1y: [], within2y: [], wageWithin1y: 0 }
  if (!today) return empty
  const rows: DashContract[] = []
  for (const player of players) {
    // 임대로 온 선수는 원 소속과 맺은 계약이 아니라 임대가 끝나는 날(추정)에 떠난다(5회차)
    if (player.loan) {
      rows.push({ ...asPlayer(player), end: player.loan.end, daysLeft: daysBetween(today, player.loan.end), wage: player.wage, loan: { from: player.loan.from } })
      continue
    }
    if (!player.contractEnd) continue
    rows.push({ ...asPlayer(player), end: player.contractEnd, daysLeft: daysBetween(today, player.contractEnd), wage: player.wage })
  }
  rows.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, 'ko'))
  // 이미 끝난 계약(남은 일수 < 0)은 "12개월 안에 끝난다"에 섞지 않고 따로 센다(4회차)
  const expired = rows.filter((row) => row.daysLeft < 0)
  const within1y = rows.filter((row) => isContractSoon(row.daysLeft))
  const within2y = rows.filter((row) => row.daysLeft > K.CONTRACT_SOON_DAYS && row.daysLeft <= K.CONTRACT_FAR_DAYS)
  // 임대 복귀 선수의 주급은 원 소속 계약 값이라 우리가 아끼는 돈이 아니다. 주급 합계에서 뺀다
  return { known: rows.length, expired, within1y, within2y, wageWithin1y: within1y.reduce((sum, row) => sum + (row.loan ? 0 : (row.wage ?? 0)), 0) }
}

// ---------- 주급 과다 의심: ln(주급) = a + b × 현재 능력 + c1 × [나이 < 21] + c2 × [나이 ≥ 30] ----------

/*
 * 과다 의심: 같은 리그 선수들의 주급을 현재 능력과 나이로 맞춘 식의 잔차가 표준편차(s)의 K.OVERPAID_Z배 이상 높은 선수.
 * z = 1.0은 기대 주급의 e^s배(s 0.52이면 약 1.67배)다. 2회차까지의 "기대의 1.3배"는 z 0.5 안팎이라 리그 선수의 3분의 1이 걸렸다(3회차).
 * 1.0, 1.5(강한 의심 K.OVERPAID_Z_STRONG)는 추정이다: 이 앱이 정한 어림이며 리그에서 z ≥ 1인 선수는 약 10~11%다.
 * 나이 더미는 K.WAGE_YOUNG_BELOW세 미만(어린 선수는 같은 능력이라도 덜 받는다)과 K.WAGE_OLD_FROM세 이상(경험이 많으면 더 받는다)이다.
 * 회귀는 K.WAGE_MODEL_MIN_SAMPLE명 이상일 때만 믿고, 잔차가 K.WAGE_OUTLIER_Z 표준편차를 넘는 선수는 빼고 한 번만 다시 맞춘다(4회차).
 * K.WAGE_SD_FLOOR는 잔차 표준편차가 0에 가까운 자료에서 z가 폭주하지 않게 하는 하한이다.
 */

/** 목록에 보여 주는 최대 인원(화면 줄 수라 조정 상수가 아니다) */
export const OVERPAID_SHOWN = 5

/** 로그 주급 모델에서 현재 능력의 기준점과 2차항의 눈금(식의 열 눈금이라 값을 바꿔도 적합 결과가 같다) */
export const WAGE_CA_CENTER = 145
export const WAGE_CA_QUAD_SCALE = 10

export interface WagePoint {
  ca: number
  wage: number
  /** 모르면 null/없음(나이 더미 0으로 본다) */
  age?: number | null
}

/**
 * 로그 주급 모델의 계수(5회차에 2차항을 더했다):
 *   ln(주급) = a + b·(CA - 145) + b2·((CA - 145)/10)² + c1·[나이 < 21] + c2·[나이 ≥ 30]
 * 스타 주급은 지수보다 덜 오르는 휘어짐이 있어, 직선 모델은 CA 170 이상을 30% 과대 예측했다(검토 5회차 P10).
 */
export interface WageCoefs {
  /** CA 145에서의 로그 주급(기준점) */
  a: number
  b: number
  /** 2차항. 없으면 0(옛 기록) */
  b2?: number
  /** 21세 미만 */
  c1: number
  /** 30세 이상 */
  c2: number
}

/** 계수와 잔차 표준편차(z를 매기는 데 필요한 전부) */
export interface WageScale extends WageCoefs {
  s: number
}

export interface WageFit extends WageScale {
  b2: number
  r2: number
  n: number
  /** 이상치로 뺀 선수 수 */
  removed: number
}

/** 선형 연립방정식 풀이(부분 피벗 가우스 소거). 풀 수 없으면 null */
function solveLinear(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length
  const m = matrix.map((row, i) => [...row, vector[i]])
  for (let col = 0; col < size; col++) {
    let pivot = col
    for (let row = col + 1; row < size; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    if (Math.abs(m[pivot][col]) < 1e-9) return null
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    for (let row = 0; row < size; row++) {
      if (row === col) continue
      const factor = m[row][col] / m[col][col]
      for (let k = col; k <= size; k++) m[row][k] -= factor * m[col][k]
    }
  }
  return m.map((row, i) => row[size] / row[i])
}

/**
 * 최소제곱: ln(주급) = a + b·(CA - 145) + b2·((CA - 145)/10)² + c1·[나이 < 21] + c2·[나이 ≥ 30]. 주급이 0이거나 능력을 모르는 선수는 뺀다.
 * 나이를 모르면 두 더미는 0이다. 한쪽 집단이 2명 미만이라 더미를 세울 수 없으면 그 계수는 0으로 둔다.
 * 능력이 서로 다른 값이 셋 미만이라 2차항을 세울 수 없으면 b2는 0이다.
 * 표본이 적거나 능력이 모두 같거나 주급이 모두 같으면 null. r2는 로그 주급에서의 결정계수, s는 잔차 표준편차(자유도 n - 계수 수).
 * 이상치(|z| > 3)를 한 번 빼고 다시 맞추는 절차와 표본·더미 조건은 4회차 그대로다.
 */
export function fitWageModel(points: WagePoint[], minSample = K.WAGE_MODEL_MIN_SAMPLE): WageFit | null {
  const used = points.filter((point) => point.ca > 0 && point.wage > 0)
  const first = fitOnce(used, minSample)
  if (!first) return null
  // |z| > 3인 선수를 빼고 한 번만 다시 맞춘다. 남은 표본이 너무 적거나 다시 맞출 수 없으면 첫 적합을 그대로 쓴다
  const kept = used.filter((point) => Math.abs(wageZ(first, point.wage, point.ca, point.age ?? null).z) <= K.WAGE_OUTLIER_Z)
  if (kept.length === used.length) return first
  const second = fitOnce(kept, minSample)
  return second ? { ...second, removed: used.length - kept.length } : first
}

function fitOnce(used: WagePoint[], minSample: number): WageFit | null {
  return fitColumns(used, minSample, true) ?? fitColumns(used, minSample, false)
}

function fitColumns(used: WagePoint[], minSample: number, quadratic: boolean): WageFit | null {
  const n = used.length
  if (n < minSample) return null
  const young = used.map((point) => (point.age !== null && point.age !== undefined && point.age < K.WAGE_YOUNG_BELOW ? 1 : 0))
  const old = used.map((point) => (point.age !== null && point.age !== undefined && point.age >= K.WAGE_OLD_FROM ? 1 : 0))
  const usable = (dummy: number[]): boolean => {
    const ones = dummy.reduce((sum, value) => sum + value, 0)
    return ones >= 2 && n - ones >= 2
  }
  const useYoung = usable(young)
  const useOld = usable(old)
  const y = used.map((point) => Math.log(point.wage))
  const meanY = y.reduce((sum, value) => sum + value, 0) / n
  const sst = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0)
  if (sst === 0) return null
  // 열: 절편, (현재 능력 - 145), ((현재 능력 - 145)/10)², 어린 더미, 나이 든 더미
  const centered = used.map((point) => point.ca - WAGE_CA_CENTER)
  const columns: number[][] = [used.map(() => 1), centered]
  if (quadratic) columns.push(centered.map((x) => (x / WAGE_CA_QUAD_SCALE) ** 2))
  if (useYoung) columns.push(young)
  if (useOld) columns.push(old)
  const k = columns.length
  const xtx = columns.map((left) => columns.map((right) => left.reduce((sum, value, i) => sum + value * right[i], 0)))
  const xty = columns.map((column) => column.reduce((sum, value, i) => sum + value * y[i], 0))
  const beta = solveLinear(xtx, xty)
  if (!beta) return null
  let sse = 0
  for (let i = 0; i < n; i++) {
    let predicted = 0
    for (let c = 0; c < k; c++) predicted += beta[c] * columns[c][i]
    sse += (y[i] - predicted) ** 2
  }
  let at = 2
  const b2 = quadratic ? beta[at++] : 0
  const c1 = useYoung ? beta[at++] : 0
  const c2 = useOld ? beta[at++] : 0
  return { a: beta[0], b: beta[1], b2, c1, c2, r2: 1 - sse / sst, s: Math.sqrt(sse / Math.max(1, n - k)), n, removed: 0 }
}

/** 기대 주급(파운드). 나이를 모르면(null) 나이 더미는 0이다. 자유 계약 선수의 기대 주급도 같은 식이다 */
export function expectedWage(model: WageCoefs, ca: number, age: number | null = null): number {
  const young = age !== null && age < K.WAGE_YOUNG_BELOW ? model.c1 : 0
  const old = age !== null && age >= K.WAGE_OLD_FROM ? model.c2 : 0
  const x = ca - WAGE_CA_CENTER
  return Math.exp(model.a + model.b * x + (model.b2 ?? 0) * (x / WAGE_CA_QUAD_SCALE) ** 2 + young + old)
}

/** 주급이 기대 주급보다 잔차 표준편차의 몇 배 높은가(z_w) */
export function wageZ(model: WageScale, wage: number, ca: number, age: number | null): { z: number; expected: number; ratio: number } {
  const expected = expectedWage(model, ca, age)
  return { z: Math.log(wage / expected) / Math.max(model.s, K.WAGE_SD_FLOOR), expected, ratio: wage / expected }
}

/**
 * 내 1군에서 z_w ≥ OVERPAID_Z인 선수를 z가 큰 순서로. 임대로 들어온 선수(exclude)는 주급이 원 소속 계약 값이라 판정하지 않는다.
 * 초과액은 표시만 하고 정렬에 쓰지 않는다(고주급 스타가 낮은 비율의 고액자보다 위에 오르는 것을 막는다).
 */
export function overpaidPlayers(players: FirstTeamPlayer[], model: WageScale, exclude: ReadonlySet<number> = new Set()): { rows: OverpaidRow[]; total: number } {
  const found: OverpaidRow[] = []
  for (const player of players) {
    if (exclude.has(player.uid) || player.wage === null || player.ca === null || player.ca <= 0) continue
    const { z, expected, ratio } = wageZ(model, player.wage, player.ca, player.age)
    if (z < K.OVERPAID_Z) continue
    found.push({
      ...asPlayer(player),
      wage: player.wage,
      expected: Math.round(expected),
      ratio: Math.round(ratio * 100) / 100,
      z: Math.round(z * 100) / 100,
      strong: z >= K.OVERPAID_Z_STRONG,
      excess: Math.round(player.wage - expected)
    })
  }
  found.sort((a, b) => b.z - a.z || a.name.localeCompare(b.name, 'ko'))
  return { rows: found.slice(0, OVERPAID_SHOWN), total: found.length }
}

// ---------- 정리 후보: 잉여 점수 ----------

/*
 * 잉여 점수(0~100) = 세 위험의 가중 평균 × 100. 각 위험은 0(정리할 이유 없음)~1(매우 큼).
 * 알 수 없는 위험은 빼지 않고 보통(SURPLUS_UNKNOWN_RISK 0.5)으로 계산한다(tactic.ts·recommend.ts와 같은 방침). 이유 문장에 그 사실을 적는다.
 *
 * - 적합도 50: 자리가 있으면 ②와 같은 f_eff(숙련 감점을 뺀 적합도)로 그 자리 첫 후보와의 차이를 그 자리 역할의 σ로 잰다. 가장 작은 자리가 "가장 가까운 자리".
 *     f_eff,i,s = f_i,s - σ_s · posPenaltySigma(r_i,s),  bench_s = 첫 후보의 f_eff(없으면 주전의 f_eff),  gapσ = min_s max(0, bench_s - f_eff,i,s)/σ_s
 *     (2단계: f_i,s는 그 자리 프로파일의 합성 가중치로 낸 적합도이고, 두 국면의 포지션이 다른 자리의 감점은 점유 시·비점유 시 숙련을 비중으로 섞은 mixedPenaltySigma다.
 *      뛸 수 있는 자리인지는 점유 시 포지션만 본다. 두 국면이 같으면 위 식 그대로다)
 *   현재 전술에 뛸 자리가 없으면(3회차): 선수가 숙련 10 이상인 모든 (역할, 포지션) 가운데 가장 좋은 쪽의 z(= (f - μ_R)/σ_R - posPenaltySigma(r))를
 *   지금 전술 필드 주전 가운데 가장 낮은 z_eff와 견주고, 거기에 "자리가 없다"는 가산 NO_SLOT_PREMIUM을 더한다.
 *     gapσ = max(0, z_min - z_best) + NO_SLOT_PREMIUM,  위험 = clamp01(gapσ / FIT_GAP_SIGMAS)
 *   (2회차까지는 자리가 없으면 위험 1이라 포메이션만 바꿔도 주전급 선수가 1위가 되었다.)
 *   골키퍼는 인원으로 정한다: 능력 상위 GOALKEEPERS_KEPT명은 대상이 아니고, 그 뒤 골키퍼는 위험 1.
 * - 주급 25: 기대 주급(주급 과다 의심과 같은 모델)보다 얼마나 높은가. z_w = (ln 주급 - 예측 ln 주급)/s, 위험 = clamp01(max(0, z_w)/WAGE_Z_FULL).
 * - 나이·정체 25: 나이 위험(24세 이하 0, 32세 이상 1)과 정체 위험(잠재가 현재보다 20 이상 높으면 0, 같으면 1)을 6 대 4로 섞는다.
 *   정체 위험은 나이와 함께 본다(4회차): w = clamp01((나이 - 26)/2), 정체_eff = (1 - w)·정체 + w. 28세 이상은 정체 위험 1이다.
 *   PA는 나이가 들어도 줄지 않아 33세 이상의 PA - CA가 12~16이 되므로 "클 여지가 있다"로 읽으면 하락 중인 선수의 위험이 거꾸로 낮아진다.
 *
 * 선발도 첫 후보도 아닌 선수만 대상이다. 골키퍼 상위 3명, 임대로 들어온 선수(이 구단이 정리할 수 없다)도 뺀다.
 * 클 여지가 있는 어린 선수(hasGrowthRoom, 영입 후보의 유망주 자격과 같은 판정)는 정리 후보가 아니라 "임대 보낼 선수"로 따로 본다.
 * 가중치(K.SURPLUS_WEIGHTS: 적합도 50, 주급 25, 나이·정체 25)와 아래 상수들(NO_SLOT_PREMIUM, FIT_GAP_SIGMAS, WAGE_Z_FULL, AGE_RISK_FROM, AGE_RISK_FULL,
 * STAGNATION_ROOM_FULL, AGE_SHARE, STAGNATION_AGE_FROM, STAGNATION_AGE_FULL, SURPLUS_MIN_SHOWN, GOALKEEPERS_KEPT)는 모두 대장(ledger.ts)에 있다.
 */

/** 화면에 보여 주는 최대 인원(조정 상수가 아니다) */
export const SURPLUS_SHOWN = 5

export interface SurplusInput {
  /** 적합도 위험(0~1). 정할 수 없으면 null(보통 SURPLUS_UNKNOWN_RISK) */
  fitRisk: number | null
  /** 주급이 기대 주급보다 몇 σ 높은가(z_w). 주급을 모르거나 모델이 없으면 null */
  wageZ: number | null
  age: number | null
  ca: number | null
  pa: number | null
}

export interface SurplusScore {
  score: number
  parts: { fit: number; wage: number; age: number }
  /** 몰라서 보통(UNKNOWN_RISK)으로 본 항목 */
  unknown: Array<'fit' | 'wage' | 'age'>
}

/** 적합도 차이(σ 단위)를 위험(0~1)으로 */
export const fitRiskOf = (gapSigma: number): number => clamp01(gapSigma / K.FIT_GAP_SIGMAS)

export function surplusScore(input: SurplusInput): SurplusScore {
  const unknown: SurplusScore['unknown'] = []
  let fit = K.SURPLUS_UNKNOWN_RISK
  if (input.fitRisk !== null) fit = clamp01(input.fitRisk)
  else unknown.push('fit')
  let wage = K.SURPLUS_UNKNOWN_RISK
  if (input.wageZ !== null) wage = clamp01(Math.max(0, input.wageZ) / K.WAGE_Z_FULL)
  else unknown.push('wage')
  let age = K.SURPLUS_UNKNOWN_RISK
  if (input.age !== null) {
    const ageRisk = clamp01((input.age - K.AGE_RISK_FROM) / (K.AGE_RISK_FULL - K.AGE_RISK_FROM))
    const w = clamp01((input.age - K.STAGNATION_AGE_FROM) / (K.STAGNATION_AGE_FULL - K.STAGNATION_AGE_FROM))
    const stagnation = input.ca !== null && input.pa !== null ? (1 - w) * clamp01(1 - (input.pa - input.ca) / K.STAGNATION_ROOM_FULL) + w : null
    age = stagnation === null ? ageRisk : K.AGE_SHARE * ageRisk + (1 - K.AGE_SHARE) * stagnation
  } else unknown.push('age')
  const parts = { fit: round1(fit * K.SURPLUS_WEIGHTS.fit), wage: round1(wage * K.SURPLUS_WEIGHTS.wage), age: round1(age * K.SURPLUS_WEIGHTS.age) }
  const score = round1(fit * K.SURPLUS_WEIGHTS.fit + wage * K.SURPLUS_WEIGHTS.wage + age * K.SURPLUS_WEIGHTS.age)
  return { score, parts, unknown }
}

/** 적합도 위험을 어떻게 정했는가(이유 문장이 쓴다) */
type FitBasis =
  | { kind: 'slot'; label: string; gap: number; sigma: number; benchmarkName: string; rating: number; oopRating: number | null; penaltyPoints: number }
  | { kind: 'noSlot'; formation: string; roleLabel: string; zMin: number; zBest: number }
  | { kind: 'keeper'; total: number }
  | { kind: 'unknown'; formation: string }

/** 선수 한 명의 정리 후보 이유를 한 문장으로. 조각마다 (잇는 꼴, 맺는 꼴)을 두고 마지막 조각만 맺는 꼴로 쓴다. */
function surplusReason(player: FirstTeamPlayer, scored: SurplusScore, basis: FitBasis, wage: { z: number; expected: number; ratio: number } | null): string {
  const clauses: Array<[string, string]> = []
  const stem = (text: string, connect: string, end: string): void => {
    clauses.push([`${text}${connect}`, `${text}${end}`])
  }
  if (basis.kind === 'slot') {
    if (basis.gap >= 0.5) {
      stem(`가장 가까운 ${basis.label} 자리에서도 첫 후보 ${basis.benchmarkName}보다 적합도가 ${basis.gap.toFixed(1)}점(이 역할의 보통 점수 차이의 약 ${(basis.gap / basis.sigma).toFixed(1)}배) 낮`, '고', '습니다')
    } else stem(`${basis.label} 자리 첫 후보 ${basis.benchmarkName}와 실력은 비슷하지만 그 자리가 이미 찼`, '고', '습니다')
    if (basis.penaltyPoints >= 0.05) {
      // 두 국면의 숙련이 달라 감점이 두 숙련을 섞은 값일 때만 두 숙련을 함께 적는다(같으면 지금 글 그대로)
      stem(
        basis.oopRating === null
          ? `그 자리 포지션 숙련이 ${basis.rating}이라 ${basis.penaltyPoints.toFixed(1)}점 뺐`
          : `그 자리 포지션 숙련(점유 시 ${basis.rating}, 비점유 시 ${basis.oopRating})에 따라 ${basis.penaltyPoints.toFixed(1)}점 뺐`,
        '고',
        '습니다'
      )
    }
  } else if (basis.kind === 'noSlot') {
    const diff = basis.zMin - basis.zBest
    const lead = `지금 ${basis.formation}에는 ${withJosa(player.name, '이/가')} 뛸 자리가 없습니다. 가장 잘 맞는 역할(${basis.roleLabel})로 보면 주전 가운데 가장 약한 선수보다 이 역할의 보통 점수 차이의 ${Math.abs(diff).toFixed(1)}배만큼`
    if (diff > 0) clauses.push([`${lead} 낮고`, `${lead} 낮습니다`])
    else clauses.push([`${lead} 높아 전술을 바꾸면 주전감이고`, `${lead} 높습니다. 전술을 바꾸면 주전감입니다`])
  } else if (basis.kind === 'keeper') {
    clauses.push([`골키퍼가 ${basis.total}명이라 ${K.GOALKEEPERS_KEPT + 1}번째 이후이고(현재 능력 순)`, `골키퍼가 ${basis.total}명이라 ${K.GOALKEEPERS_KEPT + 1}번째 이후입니다(현재 능력 순)`])
  } else {
    stem(`현재 전술(${basis.formation})에 ${withJosa(player.name, '이/가')} 뛸 자리가 없고 역할 기준을 몰라 적합도 위험을 보통(0.5)으로 보았`, '고', '습니다')
  }
  if (wage && wage.z >= 0.5 && player.wage) {
    stem(`${withJosa(`주급 ${formatPounds(player.wage)}`, '은/는')} 같은 능력 선수의 기대 주급(${formatPounds(Math.round(wage.expected))})의 ${wage.ratio.toFixed(1)}배`, '이고', '입니다')
  }
  if (player.age !== null) {
    const room = player.ca !== null && player.pa !== null ? player.pa - player.ca : null
    if (player.age >= K.STAGNATION_AGE_FULL && room !== null) {
      // 28세 이상은 PA가 남아 있어도 크기 어렵다(두 문장이 겹치면 하나만)
      stem(room <= 5 ? `${player.age}세로 앞으로 클 여지가 거의 없` : `${player.age}세로 잠재 능력이 남아 있어도 이 나이에는 크기 어렵`, '고', '습니다')
    } else if (room !== null && room <= 5) {
      stem(room <= 0 ? `${player.age}세이고 잠재 능력이 현재 능력과 같` : `${player.age}세이고 잠재 능력이 현재 능력보다 ${room}밖에 높지 않`, '고', '습니다')
    } else if (player.age >= 30) stem(`${player.age}세`, '이고', '입니다')
  }
  if (scored.unknown.includes('wage')) stem('주급이나 주급 기준을 몰라 보통(0.5)으로 보았', '고', '습니다')
  if (scored.unknown.includes('age')) stem('나이를 몰라 보통(0.5)으로 보았', '고', '습니다')
  return `${clauses.map(([joined, last], i) => (i === clauses.length - 1 ? last : joined)).join(' ')}.`
}

/**
 * 이 자리 프로파일에서 선수의 숙련 감점 입력. 두 국면의 포지션이 같으면 숫자 하나(옛 계산 그대로),
 * 다르면 점유 시·비점유 시 숙련과 비중(두 숙련을 섞은 감점)이다.
 */
function slotRatingInput(profile: SlotProfile, ratingOf: (position: string) => number, oopRatingOf: (position: string) => number): RatingInput {
  const ip = ratingOf(profile.ip.position)
  return profile.oop.position === profile.ip.position ? ip : { ip, oop: oopRatingOf(profile.oop.position), sharePct: profile.sharePct }
}

interface ProspectVerdict {
  /** ③의 유망주 자격 전체를 넘는가 */
  ok: boolean
  /** 다 컸을 때 적합도가 오르는 점수 */
  gain: number
  /** ok가 아닐 때 이유 앞에 붙이는 문장 */
  lead: string
}

/**
 * 내 선수가 "임대 보내 키울 선수"인가(5회차 수정 C). ③의 유망주 자격(클 여지 ∧ 다 컸을 때 f_eff ≥ 그 자리 기준 anchor' - 0.25σ)과 같은 판정(world.ts prospectCheck)을 쓴다.
 *   여유 = 뛸 수 있는 자리 s 가운데 최대 [f_eff + gain - (anchor'_s - 0.25σ_s)]     (여유 ≥ 0이면 임대 유망주)
 *   전술에 뛸 자리가 없으면: 숙련 10 이상인 (역할, 포지션) 가운데 최대 [(f + gain - μ)/σ - 숙련 감점] 을 (가장 약한 필드 주전의 z_eff - 0.25)와 견준다.
 * 클 여지가 없으면 null(정리 후보 계산). 역할 기준 분포를 모르면(미리보기) 클 여지만 보는 예전 판정으로 대신한다.
 */
function prospectVerdict(args: {
  player: FirstTeamPlayer
  attrs: Record<string, AttributeValue>
  playable: string[]
  /** 그 포지션의 숙련(숫자를 모르면 뛸 수 있다고 적힌 자리만 20, 아니면 0) */
  ratingOf: (position: string) => number
  /** 비점유 시 포지션의 숙련(숫자를 모르면 20). 두 국면의 포지션이 다른 자리의 감점에만 쓴다 */
  oopRatingOf: (position: string) => number
  catalog: RoleCatalog
  slots: Array<{ slot: SlotAnalysis; weights: Record<string, number> }>
  norms: RoleNorms | undefined
  roleWeights: Record<string, Record<string, number>>
  zMin: number | null
}): ProspectVerdict | null {
  const { player, attrs, playable, ratingOf, oopRatingOf, catalog, slots, norms, roleWeights, zMin } = args
  const { age, ca, pa } = player
  if (age === null || ca === null || pa === null) return null

  // (1) 전술에 뛸 자리가 있다(점유 시 포지션을 뛸 수 있는 자리. 감점은 두 국면의 숙련을 섞은 값)
  let bestSlot: { check: ProspectCheck; label: string } | null = null
  let canPlaySomewhere = false
  for (const { slot, weights } of slots) {
    if (!playable.includes(slot.slot.position)) continue
    const result = scoreRole(attrs, weights)
    if (!result) continue
    canPlaySomewhere = true
    const check = prospectCheck({ score: result.score, age, ca, pa, rating: slotRatingInput(slot.slot.profile, ratingOf, oopRatingOf) }, slot.group.bench, slot.norm, slot.slot.position === 'GK')
    if (!check.room) continue
    if (!bestSlot || check.margin > bestSlot.check.margin) bestSlot = { check, label: slot.label }
  }
  if (bestSlot) {
    const { check, label } = bestSlot
    if (check.margin >= 0) return { ok: true, gain: check.gain, lead: '' }
    return { ok: false, gain: check.gain, lead: `클 여지(+${check.gain.toFixed(1)}점)는 있지만 다 커도 ${label} 자리 기준(${check.line.toFixed(1)}점)에 못 미칩니다(예상 ${check.projected.toFixed(1)}점).` }
  }
  if (canPlaySomewhere) return null

  // (2) 전술에 뛸 자리가 없다
  if (!norms || zMin === null) {
    // 역할 기준 분포가 없으면 예전처럼 클 여지만 본다(대표 기울기와 σ)
    return hasGrowthRoom(age, ca, pa, K.REPRESENTATIVE_BETA, K.REPRESENTATIVE_SIGMA) ? { ok: true, gain: growthGain(age, ca, pa, K.REPRESENTATIVE_BETA), lead: '' } : null
  }
  // 자리가 없는 선수는 카탈로그의 참조 프로파일(역할 하나, 비중 100)을 돈다. 옛 14역할은 ROLES 순서 그대로다
  let best: { margin: number; gain: number } | null = null
  for (const reference of catalog.references('ip')) {
    const norm = norms[reference.key]
    if (!norm) continue
    const goalkeeper = reference.goalkeeper
    const beta = growthBetaOf(norm)
    if (!hasGrowthRoom(age, ca, pa, beta, norm.sigma, goalkeeper)) continue
    const result = scoreRole(attrs, effectiveRoleWeights(catalog, reference.roleId, roleWeights))
    if (!result) continue
    const gain = growthGain(age, ca, pa, beta, goalkeeper)
    for (const position of reference.positions) {
      const rating = ratingOf(position)
      if (rating < K.TEMPORARY_MIN_RATING) continue
      const margin = (result.score + gain - norm.mu) / norm.sigma - posPenaltySigma(rating) - (zMin - K.STARTER_TOLERANCE_SIGMAS)
      if (!best || margin > best.margin) best = { margin, gain }
    }
  }
  if (!best) return null
  if (best.margin >= 0) return { ok: true, gain: best.gain, lead: '' }
  return { ok: false, gain: best.gain, lead: `클 여지(+${best.gain.toFixed(1)}점)는 있지만 다 커도 지금 전술의 가장 약한 주전 수준에 못 미칩니다.` }
}

/**
 * 정리 후보 TOP 5와 임대 보낼 유망주.
 * 선발이거나 어느 자리의 첫 후보이면 대상이 아니다(analyseTactic의 depth 결과를 그대로 쓴다).
 * norms는 역할별 기준 분포(squad.roleNorms). 없으면 전술에 뛸 자리가 없는 선수의 적합도 위험은 보통(0.5)으로 본다.
 *
 * 자리 경로는 그 자리 프로파일의 합성 가중치로 점수를 내고 숙련 감점은 두 국면의 숙련을 섞은 값이며, 뛸 수 있는지는 점유 시 포지션만 본다.
 * 전술에 뛸 자리가 없는 선수는 카탈로그의 참조 프로파일(역할 하나)을 돈다. 옛 14역할은 두 길 모두 지금과 같다.
 */
export function surplusReport(args: {
  players: FirstTeamPlayer[]
  rows: PlayerRow[]
  columns: ColumnInfo[]
  analysis: TacticAnalysis
  roleWeights: Record<string, Record<string, number>>
  /** 분석에 쓴 역할 카탈로그(analysis를 만들 때 쓴 것과 같아야 한다). 없으면 옛 14역할 */
  catalog?: RoleCatalog
  norms?: RoleNorms
  /** 주급 기대치 모델. 없으면 주급 위험은 보통(0.5) */
  wageModel?: WageScale | null
  /** 임대로 들어온 선수의 번호. 정리 후보·임대 유망주에서 뺀다 */
  loanedIn?: ReadonlySet<number>
  /** 이 점수 미만은 보여 주지 않는다(기본 SURPLUS_MIN_SHOWN) */
  minScore?: number
}): { rows: SurplusRow[]; prospects: ProspectRow[] } {
  const { players, rows, columns, analysis, roleWeights, catalog = LEGACY_CATALOG, norms, wageModel, loanedIn = new Set<number>(), minScore = K.SURPLUS_MIN_SHOWN } = args
  const used = new Set<number>()
  for (const slot of analysis.slots) {
    if (slot.slot.starter) used.add(slot.slot.starter.idx)
    if (slot.slot.backups[0]) used.add(slot.slot.backups[0].idx)
  }

  const positionHeader = columns.find((col) => col.field === 'position')?.header
  const rowOf = new Map(rows.map((row) => [row.idx, row]))
  const slots = analysis.slots.map((slot) => ({
    slot,
    weights: profileWeights(catalog, slot.slot.profile, roleWeights),
    bench: slot.slot.backups[0]?.effScore ?? slot.slot.starter?.effScore ?? null,
    benchmarkName: slot.slot.backups[0]?.name ?? slot.slot.starter?.name ?? '',
    sigma: slot.norm.sigma
  }))
  // 지금 전술 필드 주전들의 z_eff 가운데 가장 낮은 값(골키퍼 제외)
  let zMin: number | null = null
  for (const each of analysis.slots) {
    if (each.slot.position === 'GK' || each.starterZ === null) continue
    if (zMin === null || each.starterZ < zMin) zMin = each.starterZ
  }

  // 골키퍼(포지션이 골키퍼뿐인 선수)는 능력이 높은 GOALKEEPERS_KEPT명을 두고 나머지는 인원 때문에 정리 후보가 된다
  const isKeeper = (player: FirstTeamPlayer): boolean => {
    const row = rowOf.get(player.uid)
    const list = row && positionHeader ? parsePositions(row.cells[positionHeader]?.raw ?? '') : []
    return list.length === 1 && list[0] === 'GK'
  }
  const keepers = players.filter(isKeeper).sort((a, b) => (b.ca ?? 0) - (a.ca ?? 0))
  const kept = new Set(keepers.slice(0, K.GOALKEEPERS_KEPT).map((player) => player.uid))
  const keeperIds = new Set(keepers.map((player) => player.uid))

  const surplus: SurplusRow[] = []
  const prospects: ProspectRow[] = []
  for (const player of players) {
    if (used.has(player.uid) || kept.has(player.uid) || loanedIn.has(player.uid)) continue
    const row = rowOf.get(player.uid)
    const playable = row && positionHeader ? parsePositions(row.cells[positionHeader]?.raw ?? '') : []
    const attrs = row ? attributesOf(row, columns) : {}
    /** 그 자리 포지션 숙련. 숫자가 없으면 뛸 수 있다고 적힌 자리는 20(감점 없음), 아니면 0 */
    const ratingOf = (position: string): number => ratingAt(row?.ratings, position) ?? (playable.includes(position) ? RATING_UNKNOWN_ASSUMED : 0)
    /** 비점유 시 포지션 숙련. 숫자가 없으면 20(모르는 값으로 깎지 않는다). 두 국면의 포지션이 다른 자리의 감점에만 쓴다 */
    const oopRatingOf = (position: string): number => ratingAt(row?.ratings, position) ?? RATING_UNKNOWN_ASSUMED

    let basis: FitBasis
    let fitRisk: number | null
    let best: { gap: number; sigma: number; label: string; benchmarkName: string; rating: number; oopRating: number | null; penaltyPoints: number } | null = null
    let bestRole: { roleLabel: string; z: number } | null = null
    if (keeperIds.has(player.uid)) {
      basis = { kind: 'keeper', total: keepers.length }
      fitRisk = 1
    } else {
      // 뛸 수 있는 자리마다 ②와 같은 f_eff(숙련 감점을 뺀 적합도)로 그 자리 첫 후보와 견준다. 역할의 눈금이 다르므로 σ 단위로 견주어 가장 가까운 자리를 고른다
      for (const { slot, weights, bench, benchmarkName, sigma } of slots) {
        if (bench === null || !playable.includes(slot.slot.position)) continue
        const result = scoreRole(attrs, weights)
        if (!result) continue
        const rating = ratingOf(slot.slot.position)
        // 숙련 감점은 두 국면의 숙련을 점유 시 비중으로 섞은 값이다. 두 국면의 포지션이 같으면 숙련 하나라 옛 감점 그대로다.
        // 풀이 글에 두 숙련을 적는 것은 두 숙련이 달라 감점이 정말 섞였을 때뿐이다
        const oopRating = slot.slot.oopPosition === slot.slot.position ? rating : oopRatingOf(slot.slot.oopPosition)
        const penaltyPoints = sigma * mixedPenaltySigma(rating, oopRating, slot.slot.profile.sharePct)
        const gap = Math.max(0, bench - (result.score - penaltyPoints))
        if (!best || gap / sigma < best.gap / best.sigma) {
          best = { gap, sigma, label: slot.label, benchmarkName, rating, oopRating: oopRating !== rating && slot.slot.profile.sharePct < SHARE_SCALE ? oopRating : null, penaltyPoints }
        }
      }
      if (best) {
        basis = { kind: 'slot', label: best.label, gap: best.gap, sigma: best.sigma, benchmarkName: best.benchmarkName, rating: best.rating, oopRating: best.oopRating, penaltyPoints: best.penaltyPoints }
        fitRisk = fitRiskOf(best.gap / best.sigma)
      } else {
        // 뛸 자리가 전술에 없다: 숙련 10 이상인 모든 (역할, 포지션) 가운데 가장 좋은 z(숙련 감점 반영)로 최약 주전과 견준다
        if (norms) {
          // 참조 프로파일(역할 하나, 비중 100)을 돈다. 옛 14역할은 ROLES 순서 그대로다
          for (const reference of catalog.references('ip')) {
            const norm = norms[reference.key]
            if (!norm) continue
            const result = scoreRole(attrs, effectiveRoleWeights(catalog, reference.roleId, roleWeights))
            if (!result) continue
            for (const position of reference.positions) {
              const rating = ratingOf(position)
              if (rating < K.TEMPORARY_MIN_RATING) continue
              const z = zOf(norm, result.score) - posPenaltySigma(rating)
              if (!bestRole || z > bestRole.z) {
                bestRole = { roleLabel: reference.label, z }
              }
            }
          }
        }
        if (bestRole && zMin !== null) {
          basis = { kind: 'noSlot', formation: analysis.formation.label, roleLabel: bestRole.roleLabel, zMin, zBest: bestRole.z }
          fitRisk = fitRiskOf(Math.max(0, zMin - bestRole.z) + K.NO_SLOT_PREMIUM)
        } else {
          basis = { kind: 'unknown', formation: analysis.formation.label }
          fitRisk = null
        }
      }
    }

    // 임대 보내 키울 선수 = ③의 유망주 자격 전체(클 여지 ∧ 다 컸을 때 우리 주전 수준). 클 여지만 있고 다 커도 못 미치면 정리 후보로 계산한다(5회차)
    const room = player.ca !== null && player.pa !== null ? player.pa - player.ca : null
    const verdict = room === null ? null : prospectVerdict({ player, attrs, playable, ratingOf, oopRatingOf, catalog, slots, norms, roleWeights, zMin })
    if (verdict && verdict.ok && room !== null) {
      prospects.push({
        ...asPlayer(player),
        room,
        gain: round1(verdict.gain),
        reason: `${player.age}세, 현재 능력 ${player.ca}에 잠재 능력 ${player.pa}으로 ${room}만큼 더 큽니다. 다 크면 적합도가 약 ${verdict.gain.toFixed(1)}점 오를 것으로 봅니다. 1군에서 뛸 자리는 없어 임대로 경기를 뛰게 하는 편이 낫습니다.`
      })
      continue
    }
    const wage = wageModel && player.wage !== null && player.ca !== null && player.ca > 0 ? wageZ(wageModel, player.wage, player.ca, player.age) : null
    const scored = surplusScore({ fitRisk, wageZ: wage ? wage.z : null, age: player.age, ca: player.ca, pa: player.pa })
    surplus.push({
      ...asPlayer(player),
      wage: player.wage,
      score: scored.score,
      parts: scored.parts,
      unknown: scored.unknown,
      fit: basis.kind,
      slotLabel: best ? best.label : null,
      fitGap: best ? round1(best.gap) : null,
      fitGapSigma: best ? round1(best.gap / best.sigma) : null,
      bestRole: bestRole ? bestRole.roleLabel : null,
      wageZ: wage ? round1(wage.z) : null,
      reason: `${verdict && !verdict.ok ? `${verdict.lead} ` : ''}${surplusReason(player, scored, basis, wage)}`
    })
  }
  surplus.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ko'))
  prospects.sort((a, b) => (b.pa ?? 0) - (a.pa ?? 0) || b.room - a.room)
  return { rows: surplus.filter((row) => row.score >= minScore).slice(0, SURPLUS_SHOWN), prospects: prospects.slice(0, SURPLUS_SHOWN) }
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
  /**
   * 계약 만료까지 12개월 이내 선수 이름과 수(만료일을 아는 선수가 있을 때만). expired는 이미 계약이 끝난 선수 수.
   * loans는 임대로 와서 시즌 끝에 원 소속 팀으로 돌아가는 1군 선수(5회차). count·names에는 넣지 않고 따로 적는다(어조는 합쳐서 본다)
   */
  expiring: { known: number; names: string[]; count: number; expired?: number; loans?: { count: number; names: string[] } } | null
}

/**
 * 최근 경기가 좋은 흐름인가: 무패이고 승이 절반 이상이거나, 5경기 기준으로 패 1 이하이고 승 4 이상(경기 수가 다르면 비례).
 * ("4승 1패"도 좋은 흐름이다. 3회차)
 */
function goodForm(wins: number, losses: number, games: number): boolean {
  return (losses === 0 && wins * 2 >= games) || (losses <= games / 5 && wins >= (games * 4) / 5)
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
    // 읽은 경기가 적으면(3경기 미만) 좋음·위험으로 단정하지 않는다: 1경기 1패를 "위험"으로 쓰지 않는다(4회차)
    const tone: Tone = played.length < K.FORM_MIN_GAMES ? 'info' : goodForm(w, l, played.length) ? 'good' : l * 2 >= played.length ? 'bad' : 'info'
    lines.push({ id: 'form', text: `최근 ${played.length}경기 ${record}${goals}입니다.`, tone })
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
            // "급한"은 보강 권장 이상일 때만 쓴다(보통인데 급하다고 읽히지 않게. 3회차)
            text: `${need.level === 'normal' ? '보강 필요도가 가장 높은 자리는' : '가장 보강이 급한 자리는'} ${need.label}(${need.roleLabel})입니다. 보강 필요도 ${need.need}점(${need.levelLabel}). ${need.reason}`,
            tone: need.level === 'urgent' ? 'bad' : need.level === 'recommended' ? 'warn' : 'info'
          }
    )
  }

  if (expiring && expiring.known > 0) {
    const expired = expiring.expired ?? 0
    const ended = expired > 0 ? ` 이미 계약이 끝난 선수가 ${expired}명 있습니다.` : ''
    // 임대로 온 선수는 시즌 끝에 원 소속 팀으로 돌아간다. 계약이 끝나는 선수처럼 센다(1명 이상이면 "좋음"이 아니다. 5회차)
    const loans = expiring.loans && expiring.loans.count > 0 ? expiring.loans : null
    const returning = loans ? ` 임대로 온 선수 ${loans.count}명(${loans.names.slice(0, 3).join(', ')}${loans.count > 3 ? ' 외' : ''})은 시즌 끝에 원 소속 팀으로 돌아갑니다.` : ''
    const total = expiring.count + (loans?.count ?? 0)
    lines.push(
      expiring.count === 0
        ? { id: 'contracts', text: `12개월 안에 계약이 끝나는 1군 선수는 없습니다.${returning}${ended}`, tone: expired > 0 || loans ? 'info' : 'good' }
        : {
            id: 'contracts',
            text: `12개월 안에 계약이 끝나는 1군 선수가 ${expiring.count}명입니다(${expiring.names.slice(0, 3).join(', ')}${expiring.count > 3 ? ' 외' : ''}).${returning}${ended}`,
            tone: total >= 3 ? 'warn' : 'info'
          }
    )
  }
  return lines.slice(0, 5)
}
