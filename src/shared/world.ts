import { K } from './ledger'
import { FALLBACK_NORM, type RoleNorm } from './norms'
import { posPenaltySigma } from './positions'
import type { Recommendation, RecommendTierId, SquadMoney } from './recommend'

/** 세이브 전체(모든 구단의 선수)를 놓고 하는 일: 영입 후보 찾기와 능력치 수정 */

/** 세이브에 능력치 54개가 저장된 순서 */
export const SAVE_ATTRIBUTE_ORDER = [
  'crossing', 'dribbling', 'finishing', 'heading', 'longShots', 'marking', 'offTheBall', 'passing', 'penalty',
  'tackling', 'vision', 'handling', 'aerialReach', 'commandOfArea', 'communication', 'kicking', 'throwing',
  'anticipation', 'decisions', 'oneOnOnes', 'positioning', 'reflexes', 'firstTouch', 'technique', 'leftFoot',
  'rightFoot', 'flair', 'corners', 'teamwork', 'workRate', 'longThrows', 'eccentricity', 'rushingOut', 'punching',
  'acceleration', 'freeKick', 'strength', 'stamina', 'pace', 'jumping', 'leadership', 'dirtiness', 'balance',
  'bravery', 'consistency', 'aggression', 'agility', 'importantMatches', 'injuryProneness', 'versatility',
  'naturalFitness', 'determination', 'composure', 'concentration'
] as const

export type SaveAttributeId = (typeof SAVE_ATTRIBUTE_ORDER)[number]

/** 게임 화면에는 보이지 않는 능력치 */
export const HIDDEN_ATTRIBUTE_LABEL: Partial<Record<SaveAttributeId, string>> = {
  consistency: '일관성',
  importantMatches: '큰 경기',
  injuryProneness: '부상 빈도',
  versatility: '다재다능',
  dirtiness: '비매너 플레이'
}

/** 저장값(1~100)을 게임 표시값(1~20)으로 */
export function shownValue(stored: number): number {
  return Math.min(20, Math.max(1, Math.round(stored / 5)))
}

/** 영입 후보의 유형. all은 아래 세 유형(즉시 전력·로테이션·유망주) 가운데 하나 이상에 드는 선수 모두이고, free는 그 가운데 소속이 없는 선수다 */
export type CandidateCategory = 'all' | 'starter' | 'rotation' | 'prospect' | 'free'

export const CATEGORY_LABEL: Record<CandidateCategory, string> = {
  all: '전체',
  starter: '즉시 전력',
  rotation: '로테이션 자원',
  prospect: '유망주',
  free: '자유 계약'
}

export const CATEGORY_HELP: Record<CandidateCategory, string> = {
  all: '즉시 전력·로테이션·유망주에 드는 선수 모두',
  starter: '이 자리(역할)의 적합도가 내 주전 수준이거나 그 이상인 선수',
  rotation: '주전에는 못 미치지만 내 첫 후보 수준 이상인, 번갈아 쓸 만한 선수(후보가 한 명뿐인 자리는 한 명 더 필요하므로 조금 더 낮은 선수까지)',
  prospect: '23세 이하이고, 크고 나면 내 주전 수준이 될 것으로 보이며 다 컸을 때 적합도가 이 역할 점수 차이의 보통 크기의 절반 넘게 오르는 선수',
  free: '소속이 없는 선수 가운데 위 유형에 드는 선수'
}

// ---------- 유형 판정 ----------

/*
 * 유형 판정과 성장 예측의 상수는 대장(ledger.ts)에 있다.
 *
 * 유망주 자격(PROSPECT_MAX_AGE 23세 이하, PROSPECT_MIN_ROOM, PROSPECT_MIN_GAIN_SIGMA, 3회차): 성숙 시 적합도 이득이 이 값 × σ 이상이어야 "클 여지가 있다"고 본다.
 * 23세 CA152/PA164는 이득 0.27σ라 빠지고(로테이션 자원), 18세 CA165/PA183은 1.1σ라 든다.
 *
 * 성숙 시 적합도 proj_eff = f_eff + β × growthShare(나이) × max(0, PA - CA)  (f_eff는 숙련 감점·나이 하락을 뺀 지금 적합도, β는 역할 기준 분포의 "현재 능력 1점당 적합도").
 * growthShare(나이)는 지금 현재 능력(CA)과 잠재 능력(PA)의 차이 가운데 성숙까지 채워질 몫이다(3회차). 직선 보간표(GROWTH_SHARE_TABLE):
 * (17세 이하 0.78) (18 0.70) (20 0.57) (22 0.38) (24 0.15) (26세 이상 0).
 * 근거(단면 실측, 실험): 같은 PA 구간(120~140, 140~160, 160~180) 선수들이 나이별로 평균 현재 능력이 27~29세 평균에 대해
 * (PA - CA)를 얼마나 채웠는가를 셋 구간에서 평균했다(16~18세 0.77~0.80/0.68~0.71, 20세 0.54~0.59, 22세 0.36~0.42, 24세 0.00~0.16, 26세 이후 0에 수렴).
 * 한계: 한 시점의 단면이라 세대(코호트) 차이와 은퇴·방출 편향이 섞여 있다. 두 날짜의 세이브로 같은 선수들의 변화를 직접 재어 다시 확인해야 한다.
 * (1·2회차의 ρ(나이)·R(나이) 곱은 22~26세에서 이 실측의 약 2배였다.)
 * 골키퍼는 늦게 크는 별도 표(GROWTH_SHARE_TABLE_GOALKEEPER, 5회차): 22세 0.46 대 필드 0.35, 24세 0.28 대 0.09.
 *
 * 하락: AGING_START_AGE(필드 31세, 골키퍼 AGING_START_AGE_GOALKEEPER 34세)를 넘으면 한 해마다 AGING_DROP_PER_YEAR점씩 내려갈 것으로 보고
 * 적합도를 낮춘다(주전과 영입 후보에 똑같이 적용). 하락 속도는 단면 자료(세이브 하나)로 구할 수 없어 추정이다.
 *
 * 유형 경계: STARTER_TOLERANCE_SIGMAS(주전보다 이만큼 낮아도 주전 수준), ROTATION_REACH_SIGMAS(로테이션은 주전보다 이만큼 넘게 낮으면 아니다),
 * THIN_REACH_SIGMAS(후보가 2명 미만인 그룹은 로테이션 창을 이만큼까지 연다), CA_GATE(현재 능력은 내 주전의 이 비율 이상).
 * REPRESENTATIVE_BETA·REPRESENTATIVE_SIGMA는 역할을 정할 수 없을 때 쓰는 대표 기울기와 σ(실제 세이브에서 역할별 β 0.24~0.34, σ 2.8~5.9의 가운데쯤. 3회차 보고서).
 */

/** 비교 기준으로 쓰는 내 주전. score는 포지션 숙련을 반영한 적합도(f_eff)이고, 나이 하락은 benchmarkOf가 더 뺀다 */
export interface BenchStarter {
  name?: string
  /** 포지션 숙련을 반영한 적합도(주전의 나이 하락은 아직 반영 전) */
  score: number
  ca: number
  age?: number | null
  /** 화면에 보이는 적합도(숙련 반영 전). 없으면 score와 같다 */
  shownScore?: number
}

export interface CandidateBench {
  /** 비교 기준 주전. 같은 포지션·같은 역할 자리가 여럿이면 그 가운데 가장 약한 주전(나이 하락까지 반영해서) */
  starter: BenchStarter | null
  /**
   * 두 번째. 같은 포지션·같은 역할 자리가 여럿이면 그 자리들의 첫 후보 가운데 가장 높은 선수.
   * age는 첫 후보에게도 주전과 같은 나이 하락을 빼는 데 쓴다(5회차). 모르면 하락 없음.
   */
  backup: { name: string; score: number; shownScore?: number; age?: number | null } | null
  /** 그룹의 서로 다른 후보가 2명 미만이다(얇음. 5회차). 모르면 얇지 않은 것으로 본다 */
  thin?: boolean
}

/** "내 팀 가장 약한 주전 ○○ 76점, 두 번째 ○○ 73점". 영입 후보 화면과 대시보드 영입 추천이 같은 문장을 쓴다 */
export function benchLine(bench: CandidateBench, groupSlots: number): string {
  const { starter, backup } = bench
  if (!starter) return '내 팀에 이 자리를 뛸 선수가 없어 비교 기준이 없습니다'
  const second = backup ? `, 두 번째 ${backup.name} ${Math.round(backup.shownScore ?? backup.score)}점` : ''
  const weakest = groupSlots > 1 ? '가장 약한 주전' : '주전'
  return `내 팀 ${weakest} ${starter.name} ${Math.round(starter.shownScore ?? starter.score)}점${second}`
}

/** 성장 몫(GROWTH_SHARE_TABLE을 직선으로 이은 값). 17세 이하 0.78, 26세 이상 0. 골키퍼는 늦게 크는 별도 표를 쓴다 */
export function growthShare(age: number, goalkeeper = false): number {
  const table = goalkeeper ? K.GROWTH_SHARE_TABLE_GOALKEEPER : K.GROWTH_SHARE_TABLE
  if (age <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]
    if (age <= x1) {
      const [x0, y0] = table[i - 1]
      return y0 + ((y1 - y0) * (age - x0)) / (x1 - x0)
    }
  }
  return table[table.length - 1][1]
}

/**
 * 성장 예측에 쓰는 기울기(5회차): 성장이 실제로 지나가는 현재 능력 구간(110~180)에서 잰 β_grow. 없으면 β.
 * 성장을 쓰는 모든 곳(성숙 시 전력, 유망주 자격, 대시보드 임대 유망주)이 이 값을 같이 쓴다.
 */
export function growthBetaOf(norm: Pick<RoleNorm, 'beta' | 'betaGrow'>): number {
  return norm.betaGrow ?? norm.beta
}

/** 성숙 시 적합도가 지금보다 오르는 점수: β_grow × growthShare(나이) × max(0, PA - CA). 나이를 모르면 0 */
export function growthGain(age: number | null, ca: number, pa: number, beta: number, goalkeeper = false): number {
  if (age === null) return 0
  return beta * growthShare(age, goalkeeper) * Math.max(0, pa - ca)
}

/** 성숙 시 예상 적합도(proj). 26세 이상이거나 나이를 모르면 지금 적합도 그대로다 */
export function projectedScore(score: number, age: number | null, ca: number, pa: number, beta: number, goalkeeper = false): number {
  return score + growthGain(age, ca, pa, beta, goalkeeper)
}

/**
 * 클 여지가 있는가(유망주 자격의 앞 절반): 나이 ≤ 23 ∧ PA - CA ≥ 10 ∧ 성숙 시 이득 ≥ 0.5σ.
 * 영입 후보의 유망주 유형(categoriesOf)과 대시보드의 "임대 보내 키울 선수"가 이 함수 하나를 쓴다.
 */
export function hasGrowthRoom(age: number | null, ca: number, pa: number, beta: number, sigma: number, goalkeeper = false): boolean {
  return age !== null && age <= K.PROSPECT_MAX_AGE && pa - ca >= K.PROSPECT_MIN_ROOM && growthGain(age, ca, pa, beta, goalkeeper) >= K.PROSPECT_MIN_GAIN_SIGMA * sigma
}

/** 나이 하락으로 내년까지 깎아 보는 적합도(점). 시작 나이(필드 31, 골키퍼 34)를 넘은 해마다 AGING_DROP_PER_YEAR */
export function agingDrop(age: number | null | undefined, goalkeeper = false): number {
  if (age === null || age === undefined) return 0
  const start = goalkeeper ? K.AGING_START_AGE_GOALKEEPER : K.AGING_START_AGE
  return K.AGING_DROP_PER_YEAR * Math.max(0, age - start)
}

/** f_eff = f - σ·posPenaltySigma(r) - 나이 하락. 숙련을 모르면(null) 숙련 감점은 없다(많은 선수를 도는 곳에서 쓰는 숫자만 돌려주는 꼴) */
export function effectiveScore(score: number, rating: number | null | undefined, age: number | null | undefined, sigma: number, goalkeeper = false): number {
  const position = rating === null || rating === undefined ? 0 : sigma * posPenaltySigma(rating)
  return score - position - agingDrop(age, goalkeeper)
}

/** 적합도에서 무엇을 얼마나 뺐는가(포지션 숙련, 나이 하락). 화면에 보이는 적합도는 그대로이고, 비교에만 반영한 값이 effective다 */
export interface FitAdjust {
  /** 화면에 보이는 적합도 */
  shown: number
  /** 비교에 쓰는 적합도: shown - 숙련 감점 - 나이 하락 */
  effective: number
  /** 포지션 숙련 감점(점) */
  positionPoints: number
  /** 포지션 숙련 감점(표준편차의 배수) */
  positionSigma: number
  /** 나이 하락(점) */
  agePoints: number
}

/** f_eff = f - σ·posPenaltySigma(r) - 나이 하락. 숙련을 모르면(null) 숙련 감점은 없다 */
export function effectiveFit(
  score: number,
  rating: number | null | undefined,
  age: number | null | undefined,
  norm: RoleNorm = FALLBACK_NORM,
  goalkeeper = false
): FitAdjust {
  const positionSigma = rating === null || rating === undefined ? 0 : posPenaltySigma(rating)
  const positionPoints = norm.sigma * positionSigma
  const agePoints = agingDrop(age, goalkeeper)
  return { shown: score, effective: effectiveScore(score, rating, age, norm.sigma, goalkeeper), positionPoints, positionSigma, agePoints }
}

/** 비교 기준: 주전의 하락을 감안한 적합도(기준점), 그만큼 낮춘 점수, 현재 능력 문턱 */
export interface Benchmark {
  /** 후보가 넘어야 할 주전 점수(주전이 없으면 이 역할 상위권 평균) */
  anchor: number
  /** 주전의 나이 하락을 감안해 낮춘 점수(0이면 낮추지 않음) */
  drop: number
  /** 이 현재 능력 이상이어야 한다 */
  caGate: number
  hasStarter: boolean
}

export function benchmarkOf(starter: CandidateBench['starter'], norm: RoleNorm = FALLBACK_NORM, goalkeeper = false): Benchmark {
  if (!starter) return { anchor: norm.mu, drop: 0, caGate: K.CA_GATE * norm.caRef, hasStarter: false }
  const drop = agingDrop(starter.age, goalkeeper)
  return { anchor: starter.score - drop, drop, caGate: K.CA_GATE * starter.ca, hasStarter: true }
}

/**
 * 즉시 전력·로테이션의 경계(5회차). 로테이션 창은 [floor, line)이다.
 *
 *   f_b'    = f_b - 나이 하락(첫 후보에게도 주전과 같은 하락. 31세부터, 골키퍼 34세부터 해마다 1점)
 *   anchor' = max(anchor, f_b')       나이 든 주전보다 첫 후보가 나으면 그 후보가 내년의 기준이다(주전이 있을 때)
 *   line    = anchor' - 0.25σ         즉시 전력: f_eff ≥ line
 *   얇음    = 그룹의 서로 다른 후보가 2명 미만
 *   floor   = (얇음 ? min(max(f_b', anchor' - 1.5σ), anchor' - 1.0σ) : max(f_b', anchor' - 1.5σ)) - 0.25σ     (후보가 없으면 f_b' = -∞)
 *
 * 4회차까지는 나이 하락을 주전에게만 빼서 주전이 31세를 넘으면 창이 뒤집혔고, 후보가 1명이면 창이 거의 닫혔다(검토 5회차 P8).
 * 추천 점수의 즉시 전력 항과 표의 "주전 대비"는 anchor(첫 후보 항이 따로 있으므로)를 그대로 쓴다.
 */
export interface RotationWindow {
  /** 주전의 나이 하락을 뺀 비교선(benchmarkOf의 anchor) */
  anchor: number
  /** 내년의 기준 anchor' */
  next: number
  /** 첫 후보의 적합도에서 나이 하락을 뺀 값 f_b'. 후보가 없으면 null */
  backupEff: number | null
  /** 즉시 전력 선: anchor' - 0.25σ */
  line: number
  /** 로테이션 아래 경계 */
  floor: number
  thin: boolean
  caGate: number
  hasStarter: boolean
}

export function rotationWindowOf(bench: CandidateBench, norm: RoleNorm = FALLBACK_NORM, goalkeeper = false): RotationWindow {
  const { anchor, caGate, hasStarter } = benchmarkOf(bench.starter, norm, goalkeeper)
  const tolerance = K.STARTER_TOLERANCE_SIGMAS * norm.sigma
  const backupEff = bench.backup ? bench.backup.score - agingDrop(bench.backup.age, goalkeeper) : null
  const next = hasStarter && backupEff !== null ? Math.max(anchor, backupEff) : anchor
  const reach = next - K.ROTATION_REACH_SIGMAS * norm.sigma
  const thin = bench.thin === true
  const base = backupEff === null ? reach : Math.max(backupEff, reach)
  const floor = (thin ? Math.min(base, next - K.THIN_REACH_SIGMAS * norm.sigma) : base) - tolerance
  return { anchor, next, backupEff, line: next - tolerance, floor, thin, caGate, hasStarter }
}

/**
 * 로테이션 탭 위에 적는 한 줄(5회차): 로테이션으로 보는 범위를 숫자로. 비교 기준 주전이 없으면 null.
 * 이 탭은 경계 상수(0.25σ, CA 문턱 0.85)에 민감해서(검토 4회차 7.1절) 어디서 시작하고 끝나는지 보여 준다.
 */
export function rotationBoundaryLine(bench: CandidateBench, norm: RoleNorm = FALLBACK_NORM, goalkeeper = false): string | null {
  if (!bench.starter) return null
  const window = rotationWindowOf(bench, norm, goalkeeper)
  if (window.floor >= window.line) {
    return `지금은 로테이션으로 볼 범위가 비어 있습니다(첫 후보가 이미 주전 기준 ${window.next.toFixed(1)}점에 닿아 있어, 그보다 낮은 선수는 대안이 되지 않습니다).`
  }
  return `로테이션은 적합도 ${window.floor.toFixed(1)}점 이상 ${window.line.toFixed(1)}점 미만입니다(위쪽 경계는 주전 기준 ${window.next.toFixed(1)}점보다 ${(window.next - window.line).toFixed(1)}점 아래).`
}

/** 유망주 자격의 판정(5회차): 클 여지, 다 컸을 때의 f_eff, 기준선, 여유(예상 - 기준선) */
export interface ProspectCheck {
  /** hasGrowthRoom: 나이 ≤ 23 ∧ PA - CA ≥ 10 ∧ 이득 ≥ 0.5σ */
  room: boolean
  /** 다 컸을 때 적합도가 오르는 점수 */
  gain: number
  /** 예상 적합도 proj_eff = f_eff + gain */
  projected: number
  /** 기준선 anchor' - 0.25σ */
  line: number
  /** 예상 - 기준선. 0 이상이면 기준을 넘는다 */
  margin: number
}

/**
 * 유망주 자격 전체: room ∧ margin ≥ 0. 영입 후보(categoriesOf)와 대시보드 "임대 보내 키울 선수"가 이 함수 하나를 쓴다(5회차 수정 C).
 * player.score는 화면에 보이는 적합도, rating은 그 자리 포지션 숙련이다. 기준은 anchor'(주전의 나이 하락에 첫 후보까지 반영)를 쓴다.
 */
export function prospectCheck(
  player: { score: number; age: number | null; ca: number; pa: number; rating?: number | null },
  bench: CandidateBench,
  norm: RoleNorm = FALLBACK_NORM,
  goalkeeper = false,
  window: RotationWindow = rotationWindowOf(bench, norm, goalkeeper)
): ProspectCheck {
  const { line } = window
  const fit = effectiveScore(player.score, player.rating, player.age, norm.sigma, goalkeeper)
  const beta = growthBetaOf(norm)
  const gain = growthGain(player.age, player.ca, player.pa, beta, goalkeeper)
  const room = hasGrowthRoom(player.age, player.ca, player.pa, beta, norm.sigma, goalkeeper)
  return { room, gain, projected: fit + gain, line, margin: fit + gain - line }
}

/**
 * 한 선수가 어느 유형에 드는지. 여러 유형에 들 수 있고, 아무 유형에도 들지 않으면 빈 목록이다.
 * 소속이 없는 선수는 위 유형에 하나라도 들 때만 free가 붙는다(free는 별도 유형이 아니라 "소속 없음" 조건이다).
 *
 * f_eff 후보의 반영한 적합도(숙련 감점·나이 하락을 뺀 것), anchor 기준 주전의 적합도(같은 방식으로 반영, 나이 하락 포함),
 * f_b 첫 후보(5회차: 첫 후보에게도 나이 하락을 뺀 f_b'), anchor' = max(anchor, f_b')(rotationWindowOf), σ 이 역할의 표준편차.
 *   starter : f_eff ≥ anchor' - 0.25σ ∧ CA ≥ 0.85·기준 주전 CA
 *   rotation: f_eff < anchor' - 0.25σ ∧ f_eff ≥ floor ∧ CA 문턱     floor = max(f_b', anchor' - 1.5σ) - 0.25σ (후보가 1명 이하면 min(max(f_b', anchor' - 1.5σ), anchor' - 1.0σ) - 0.25σ)
 *   prospect: 나이 ≤ 23 ∧ PA - CA ≥ 10 ∧ β_grow·growthShare(나이)·(PA - CA) ≥ 0.5σ ∧ 성숙 시 적합도(proj_eff) ≥ anchor' - 0.25σ   (prospectCheck)
 * 주전이 없으면 anchor 대신 이 역할 상위권 평균(mu), CA 문턱은 0.85 × 기준 능력(caRef).
 * 같은 포지션·같은 역할 자리가 여럿이면 bench가 그 그룹의 값이다(shared/tactic.ts의 slotBench).
 */
export function categoriesOf(
  player: { score: number; age: number | null; ca: number; pa: number; hasClub: boolean; rating?: number | null },
  bench: CandidateBench,
  norm: RoleNorm = FALLBACK_NORM,
  goalkeeper = false,
  /** 같은 bench·norm으로 많은 선수를 돌 때 한 번 구해 둔 창(없으면 여기서 구한다) */
  window: RotationWindow = rotationWindowOf(bench, norm, goalkeeper)
): CandidateCategory[] {
  const found: CandidateCategory[] = []
  const fit = effectiveScore(player.score, player.rating, player.age, norm.sigma, goalkeeper)
  if (player.ca >= window.caGate) {
    if (fit >= window.line) found.push('starter')
    else if (fit >= window.floor) found.push('rotation')
  }
  // 23세를 넘으면 클 여지가 없다(많은 선수를 도는 곳이라 먼저 걸러 낸다)
  if (player.age !== null && player.age <= K.PROSPECT_MAX_AGE) {
    const prospect = prospectCheck(player, bench, norm, goalkeeper, window)
    if (prospect.room && prospect.margin >= 0) found.push('prospect')
  }
  if (found.length > 0 && !player.hasClub) found.push('free')
  return found
}

/** 표의 "주전 대비"(5회차): f_eff(후보) - anchor. 설명 문장·유형 판정과 같은 기준이다. 비교 기준 주전이 없으면 null */
export function gapVsAnchor(effective: number, bench: CandidateBench, norm: RoleNorm = FALLBACK_NORM, goalkeeper = false): number | null {
  if (!bench.starter) return null
  return Math.round((effective - benchmarkOf(bench.starter, norm, goalkeeper).anchor) * 10) / 10
}

export interface CandidateQuery {
  roleId: string
  category: CandidateCategory
  /** 이 나이 이하만. 제한이 없으면 null */
  maxAge: number | null
  /** 고른 역할의 자리에서 뛸 수 있는 선수만 */
  onlyEligible: boolean
  /** 소속 구단을 알아내지 못한 선수도 넣을지 */
  includeUnknownClub: boolean
  /** 이름에 들어 있는 글자. 있으면 유형 자격과 상관없이 이름이 맞는 선수를 모두 보여 준다(자격이 없으면 "유형 밖"으로 표시) */
  search: string
  /** 계약이 이 개월 수 안에 끝나는 선수만. 제한이 없으면 null */
  expiringWithinMonths: number | null
  /**
   * 전술의 한 자리를 기준으로 찾을 때: 그 자리의 포메이션·자리별 역할과 자리 순번.
   * 같은 포지션·같은 역할의 자리(예: 4-2-3-1의 중앙 수비 두 자리)는 한 그룹으로 보므로, 그룹의 어느 자리를 골라도 결과가 같다.
   * 가장 약한 주전·그룹의 첫 후보·그룹의 보강 필요도(자리들 가운데 최대)를 기준으로 하고, 역할(roleId)은 자리의 역할로 본다.
   * 없으면 고른 역할(roleId)만으로 찾는다.
   */
  slot?: { formation: string; slotRoles: Record<string, string>; index: number } | null
}

export interface CandidateRow {
  uid: number
  name: string
  age: number | null
  /** 게임 표기("D (RC), WB (R)") */
  position: string
  /** 소속 구단. 없으면 "자유 계약", 알아내지 못했으면 빈 글자 */
  club: string
  ca: number
  pa: number
  /** 세이브에 적힌 기준 몸값(파운드). 모르면 null */
  value: number | null
  /** 세이브에 적힌 주급(파운드). 모르면 null */
  wage: number | null
  /** 세이브에 적힌 계약 만료일. 모르면 null */
  contractEnd: { year: number; month: number; day: number } | null
  /** 계약상 입지("핵심 선수"). 모르면 빈 글자 */
  squadStatus: string
  /** 국적. 나라 이름을 아직 모르면 빈 글자 */
  nation: string
  /** 소속 구단의 고유 번호(엠블럼용). 구단을 알아내지 못했거나 자유 계약이면 null */
  clubUid: number | null
  /** 임대 중이면 지금 뛰고 있는 구단 이름. club은 원 소속 구단이다(이적료를 받는 쪽). 임대가 아니면 null */
  loanedTo: string | null
  /** 고른 역할의 적합도(0~100). 화면에 보이는 값이고 숙련·나이 감점은 반영 전이다 */
  score: number
  /** 내 주전(그룹에서 가장 약한 주전)과 화면의 적합도끼리의 차이(후보 - 주전). 주전이 없으면 null. 표에서는 칸의 마우스 설명으로만 보여 준다 */
  gap: number | null
  /**
   * 주전과의 차이 gapEff = f_eff(후보) - anchor(5회차). f_eff는 숙련·나이를 뺀 비교 적합도, anchor는 비교 주전의 f_eff에서 나이 하락을 뺀 값이다.
   * 설명 문장·유형 판정과 같은 기준이라 표의 "주전 대비" 칸과 대시보드 카드가 이 값을 쓴다. 주전이 없으면 null
   */
  gapEff: number | null
  /** 이 선수가 드는 유형(즉시 전력·로테이션·유망주, 소속이 없으면 자유 계약도). 어느 유형에도 들지 않으면 빈 목록 */
  categories: CandidateCategory[]
  /** 추천 점수(0~100)와 항목별 풀이 */
  recommend: Recommendation
  /** 같은 유형 탭의 자격 후보 전체 안에서 매긴 등급. 고른 유형에 들지 않는 선수(이름 검색으로 보인 경우)는 outside */
  tier: RecommendTierId
  /** 능력치 54개(게임 표시값 1~20), SAVE_ATTRIBUTE_ORDER 순서 */
  attributes: number[]
}

export interface CandidateResult {
  ok: boolean
  /** 읽지 못한 이유 */
  message?: string
  /** 읽은 세이브 파일 이름 */
  saveName?: string
  bench: CandidateBench
  /** 유형마다 조건(역할·나이·이름)에 맞고 그 유형의 자격을 갖춘 선수 수. all은 세 유형 가운데 하나 이상에 든 선수 수 */
  counts: Record<CandidateCategory, number>
  /** 보여 주는 줄(점수 순, 많으면 앞에서 자른다) */
  rows: CandidateRow[]
  /** 보여 줄 수 있는 선수 수(rows보다 많을 수 있다). 이름을 찾는 중이면 이름이 맞는 선수 전부 */
  matched: number
  /** 고른 유형의 자격 후보 전체 수. 등급(백분위)은 이 안에서 매긴다 */
  ranked?: number
  /** 이 역할의 기준 분포(후보 점수가 상위권에서 어디쯤인지 설명하는 데 쓴다) */
  norm?: RoleNorm
  /** 자리를 기준으로 찾았을 때 그 자리 그룹의 보강 필요도(0~100, 그룹 자리들 가운데 최대). 아니면 없다 */
  need?: number | null
  /** 자리를 기준으로 찾았을 때 그 자리가 속한 그룹(같은 포지션·같은 역할의 자리들). 아니면 없다 */
  group?: { label: string; slots: number } | null
  /** 비용 부담을 견준 내 팀의 주급·몸값 수준. 알 수 없으면 null */
  baseline?: SquadMoney | null
}

/**
 * 계약상 입지(세이브에 적힌 값 → 이름). 구단이 그 선수에게 약속한 역할이지 실제 출전 시간이 아니다.
 * 값의 뜻은 공개 해독기 fmsave가 게임 화면과 맞춰 확인해 둔 것을 따랐다.
 */
export const SQUAD_STATUS_LABEL: Record<number, string> = {
  1: '핵심 선수',
  2: '중요 선수',
  3: '주전',
  4: '로테이션',
  5: '교체 카드',
  7: '비주전',
  9: '비상 백업',
  10: '1군 진입 유망주',
  11: '미래 유망주',
  13: '유소년',
  14: 'B팀 주전',
  15: '주전 골키퍼',
  16: '컵 대회 골키퍼',
  17: '국내 컵 골키퍼',
  18: '대륙 컵 골키퍼',
  20: '백업 골키퍼',
  21: '비상 백업 골키퍼'
}

/**
 * 게임이 알려 주는 선수의 시장 정보(영입 후보에 붙인다). 세이브에서는 읽지 못하고, 켜져 있는 게임에 물어 받는다.
 * 게임이 감독에게 보여 주는 그대로라서, 스카우트하지 않은 선수의 몸값은 게임에서처럼 넓은 범위로 나온다.
 */
export interface PlayerMarket {
  uid: number
  /** 게임이 적어 주는 몸값("170억 원 - 185억 원") */
  value?: string
  /** 몸값을 견줄 때 쓰는 수(게임의 기준 통화) */
  valueSort?: number
  /** 게임이 적어 주는 주급("주급 6.5억 원") */
  wage?: string
  wageSort?: number
  /** 계약 만료일. 연·월·일 */
  contractEnd?: { year: number; month: number; day: number }
  nation?: string
  /** 게임이 알려 주는 소속 구단(세이브에서 구단을 알아내지 못한 선수에 쓴다) */
  club?: string
  /** 여자 선수인지 */
  female?: boolean
}

export interface MarketResult {
  /** 게임에 물어볼 수 있었는지 */
  ok: boolean
  /** 물어볼 수 없었던 이유 */
  message?: string
  /** 답을 받은 선수들(게임에서 찾지 못한 선수는 빠진다) */
  players: PlayerMarket[]
}

/** 게임이 적어 준 날짜("2027년/6월/30일", "30/6/2027" 등)에서 연·월·일을 뽑는다. 알아보지 못하면 null */
export function parseGameDate(text: string): { year: number; month: number; day: number } | null {
  const numbers = (text.match(/\d+/g) ?? []).map(Number)
  if (numbers.length !== 3) return null
  const yearAt = numbers.findIndex((value) => value >= 1900)
  if (yearAt !== 0 && yearAt !== 2) return null
  const [month, day] = yearAt === 0 ? [numbers[1], numbers[2]] : [numbers[1], numbers[0]]
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year: numbers[yearAt], month, day }
}

/** 에디터의 선수 목록 한 줄 */
export interface EditorListItem {
  uid: number
  name: string
  age: number | null
  position: string
  club: string
  /** 소속 구단의 고유 번호(엠블럼). 모르면 없다 */
  clubUid?: number | null
  ca: number
  pa: number
}

/** 에디터에서 고치는 한 선수의 값 */
export interface EditorPlayer extends EditorListItem {
  /** 포지션 숙련도 15개(1~20), POSITION_KEYS 순서 */
  positions: number[]
  /** 능력치 54개의 저장값(1~100) */
  attributes: number[]
  /** 값을 어디서 읽었는지: 켜져 있는 게임의 지금 값인지, 마지막으로 저장한 세이브의 값인지 */
  source: 'game' | 'save'
  /** 세이브의 값을 보여 줄 때 그 이유 */
  sourceNote?: string
}

/** 한 선수에 대한 수정. 적힌 것만 바꾼다 */
export interface EditorEdit {
  uid: number
  positions?: number[]
  attributes?: number[]
  ca?: number
  pa?: number
}

export interface EditorApplyResult {
  ok: boolean
  message: string
}

const whole = (values: number[], length: number, min: number, max: number): boolean =>
  values.length === length && values.every((value) => Number.isInteger(value) && value >= min && value <= max)

/** 고칠 값이 범위 안인지 본다. 문제가 있으면 그 이유를 돌려준다. */
export function checkEdit(edit: EditorEdit): string | null {
  if (!Number.isInteger(edit.uid) || edit.uid <= 0) return '선수를 알아볼 수 없습니다.'
  if (edit.positions && !whole(edit.positions, 15, 1, 20)) return '포지션 숙련도는 1~20이어야 합니다.'
  if (edit.attributes && !whole(edit.attributes, SAVE_ATTRIBUTE_ORDER.length, 1, 100)) return '능력치 값이 범위를 벗어났습니다.'
  for (const value of [edit.ca, edit.pa]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 200)) return '현재·잠재 능력은 1~200이어야 합니다.'
  }
  if (edit.ca !== undefined && edit.pa !== undefined && edit.ca > edit.pa) return '현재 능력이 잠재 능력보다 클 수 없습니다.'
  return null
}

/** 선수 정보 화면의 능력치 한 칸(게임 표시값 1~20) */
export interface ProfileAttribute {
  id: string
  label: string
  group: 'technical' | 'mental' | 'physical' | 'goalkeeping'
  value: number
}

/** 선수 한 명의 정보 화면에 필요한 모든 것 */
export interface PlayerProfile {
  uid: number
  name: string
  age: number | null
  /** 생년월일. 모르면 null */
  birth: { year: number; month: number; day: number } | null
  /** 게임 표기("D (RC), WB (R)") */
  position: string
  /** 포지션 숙련도 15개(1~20), POSITION_KEYS 순서 */
  positions: number[]
  goalkeeper: boolean
  ca: number
  pa: number
  /** 구단 이름. 소속이 없으면 "자유 계약", 모르면 빈 글자. 임대 중이면 원 소속 구단 */
  club: string
  /** 소속 구단의 고유 번호(엠블럼). 모르면 null */
  clubUid: number | null
  /** 임대 중이면 지금 뛰고 있는 구단 이름 */
  loanedTo?: string
  nation: string
  /** 몸값. 모르면 빈 글자 */
  value: string
  /** 주급. 모르면 빈 글자 */
  wage: string
  /** 몸값·주급의 출처: 켜져 있는 게임이 알려 준 금액(원)인지, 세이브에 적힌 기준 금액(파운드)인지 */
  moneyFrom: 'game' | 'save'
  contractEnd: { year: number; month: number; day: number } | null
  squadStatus: string
  /** 왼발·오른발 능력(1~20) */
  foot: { left: number; right: number }
  /** 보이는 능력치. 기술(골키퍼는 골키퍼) → 정신 → 신체 순 */
  attributes: ProfileAttribute[]
  /** 게임 화면에는 안 보이는 능력치 */
  hidden: Array<{ id: string; label: string; value: number }>
  /** 능력치와 능력을 어디서 읽었는지: 켜져 있는 게임의 지금 값인지, 세이브에 적힌 값인지 */
  source: 'game' | 'save'
  sourceNote?: string
}
