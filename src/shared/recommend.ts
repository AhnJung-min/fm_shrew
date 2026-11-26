import { formatPounds } from './playerView'
import { PLAYABLE_RATING } from './positions'
import { SQUAD_STATUS_LABEL, type CandidateCategory } from './world'

/**
 * 영입 추천 점수 (0~100).
 *
 * 역할 점수 하나로 줄을 세우면 "능력은 좋지만 내 팀 최고 주급을 요구하는 34세"가 맨 위에 오른다.
 * 그래서 영입을 정할 때 실제로 따지는 일곱 가지를 따로 점수로 매겨 더한다. 항목마다 0~1의 "충족도"를 구하고,
 * 선택한 유형에 따라 정해진 가중치(합 100)를 곱한다. 가중치는 RECOMMEND_WEIGHTS 표에 모여 있다.
 *
 * 원칙
 * - 모르는 값으로 점수를 만들지 않는다. 값이 없어 못 구한 항목은 빼고, 남은 항목의 가중치를 합이 100이 되도록
 *   다시 나눈다(항목의 counted가 false이고 설명에 "반영하지 않았습니다"가 적힌다).
 * - 이 점수는 게임의 계산식이 아니라 이 앱이 정한 어림 기준이다. 숫자 하나하나의 이유는 각 항목의 설명에 적는다.
 * - 이적 예산, 선수의 성격(야망·충성심 등), 이적 가능 표시는 세이브에서 읽지 못해 쓰지 않는다.
 *
 * 이 모듈은 순수 계산만 한다(세이브·화면을 모른다).
 */

export type ComponentId = 'immediate' | 'position' | 'growth' | 'age' | 'cost' | 'ease' | 'reliability'

export const COMPONENT_ORDER: ComponentId[] = ['immediate', 'position', 'growth', 'age', 'cost', 'ease', 'reliability']

export const COMPONENT_LABEL: Record<ComponentId, string> = {
  immediate: '즉시 전력',
  position: '포지션 숙련',
  growth: '성장 가능성',
  age: '나이 가치',
  cost: '비용 부담',
  ease: '영입 난이도',
  reliability: '신뢰성'
}

/** 점수 설명에 쓰는 항목별 한 줄 풀이 */
export const COMPONENT_HELP: Record<ComponentId, string> = {
  immediate: '이 자리 역할의 적합도가 내 주전과 두 번째 선수보다 얼마나 높은가. 차이가 클수록 좋지만 어느 정도부터는 더 얹히는 점수가 줄어듭니다. 보강 필요도가 높은 자리일수록 이 항목의 비중이 커집니다.',
  position: '그 역할의 자리가 자연스러운 자리인가, 능숙하게 뛸 수 있는 자리인가, 겨우 뛸 수 있는 자리인가.',
  growth: '잠재 능력이 현재 능력보다 얼마나 높은가. 어릴수록 크게 쳐주고 28세부터는 0점입니다. 내 주전의 현재 능력을 넘어설 만큼 클 때만 인정합니다.',
  age: '지금 나이가 전성기에 가까운가. 필드 선수는 24~29세, 골키퍼는 27~33세를 전성기로 봅니다. 너무 어리면 당장은 약하고, 전성기가 지나면 가치가 떨어집니다.',
  cost: '이 선수의 주급과 몸값이 내 팀의 주급·몸값 수준에 비해 부담스럽지 않은가. 팀에서 가장 많이 받게 되는 선수는 크게 깎습니다.',
  ease: '데려오기 쉬운가. 계약이 얼마 안 남았거나 자유 계약이면 쉽고, 구단이 핵심 선수로 약속한 선수는 어렵습니다.',
  reliability: '꾸준히 제 몫을 하고 다치지 않는가. 일관성, 큰 경기, 부상 빈도, 타고난 체력, 결단력, 비매너 플레이로 봅니다.'
}

/** 화면 어디서나 같은 말로 쓰는 세 가지 점수의 풀이(풍선 도움말과 설명에 그대로 쓴다) */
export const TERM_HELP = {
  fit: '적합도: 그 자리 역할에 중요한 능력치를 가중 평균해 0~100점으로 만든 값입니다. 스쿼드, 전술판, 영입 후보가 모두 같은 식으로 계산합니다.',
  need: '보강 필요도: 이 자리에 선수를 더 영입해야 하는 정도(0~100)입니다. 주전의 적합도, 후보 수, 주전의 나이와 계약 기간으로 계산합니다.',
  recommend: '추천 점수: 영입 후보를 즉시 전력, 포지션 숙련, 성장 가능성, 나이 가치, 비용 부담, 영입 난이도, 신뢰성으로 나눠 매긴 0~100점입니다.'
} as const

/**
 * 유형별 가중치(합 100). 같은 선수라도 무엇을 찾느냐에 따라 중요한 것이 다르다.
 *
 * - 전체: 골고루. 즉시 전력을 가장 크게 본다.
 * - 즉시 전력: 지금 주전을 바꿀 선수를 찾는 것이므로 즉시 전력이 압도적이고 성장은 거의 보지 않는다.
 * - 로테이션 자원: 주전이 아닌 뒤를 받칠 선수라 능력 격차보다 몸값·주급 부담과 데려오기 쉬운지가 더 중요하다.
 * - 유망주: 지금 능력은 거의 보지 않고 성장 가능성이 40이다. 나이 가치(어릴수록 되팔 때 값이 오른다)도 본다.
 * - 자유 계약: 이적료가 없고 데려오기 쉬운 것은 모두에게 같으므로 비용·난이도는 0으로 두고(세이브에는 소속 없는
 *   선수의 주급도 적혀 있지 않다), 실력과 믿음직함(영입 뒤 문제를 덜 일으키는가)을 더 본다.
 */
export const RECOMMEND_WEIGHTS: Record<CandidateCategory, Record<ComponentId, number>> = {
  all: { immediate: 30, position: 10, growth: 12, age: 10, cost: 14, ease: 12, reliability: 12 },
  starter: { immediate: 40, position: 10, growth: 4, age: 10, cost: 14, ease: 10, reliability: 12 },
  rotation: { immediate: 30, position: 12, growth: 6, age: 8, cost: 18, ease: 14, reliability: 12 },
  prospect: { immediate: 8, position: 6, growth: 40, age: 8, cost: 14, ease: 12, reliability: 12 },
  free: { immediate: 38, position: 10, growth: 14, age: 14, cost: 0, ease: 0, reliability: 24 }
}

// ---------- 즉시 전력 ----------

/**
 * 고른 자리의 보강 필요도(0~100, shared/tactic.ts)가 즉시 전력의 비중을 키우거나 줄인다.
 * 필요도 50이면 표의 가중치 그대로, 0이면 0.6배, 100이면 1.4배. 곱한 뒤 구한 항목의 가중치 합을 100으로 다시 나누므로
 * 필요한 자리의 업그레이드는 점수에서 더 크게, 이미 탄탄한 자리의 업그레이드는 더 작게 반영된다.
 * 직접 고른 역할(자리를 고르지 않음)이면 필요도를 몰라 곱하지 않는다.
 */
export const NEED_WEIGHT_LOW = 0.6
export const NEED_WEIGHT_HIGH = 1.4

/**
 * 역할 점수 차이를 충족도로 바꾸는 폭. 충족도 = 0.5 + 0.5 × tanh(차이 / 8).
 * 같으면 0.5, 8점 높으면 0.88, 15점 높으면 0.98(더 높아도 거의 안 오른다: 수확 체감), 8점 낮으면 0.12.
 * 8점은 같은 포지션 후보들의 역할 점수 편차가 보통 한 자리 수라서 "확실한 차이"의 기준으로 잡았다.
 */
export const UPGRADE_SCALE = 8
/** 내 팀에 그 역할을 뛸 선수가 없을 때 역할 점수 자체를 보는 구간: 40점 이하 0, 80점 이상 1 */
export const ABSOLUTE_FLOOR = 40
export const ABSOLUTE_TOP = 80
/**
 * 즉시 전력에서 주전과 견주는 몫(나머지는 두 번째 선수와 견준다).
 * 로테이션 자원을 찾을 때는 두 번째 선수를 넘는지가 핵심이라 주전 몫을 줄인다.
 */
export const STARTER_SHARE: Record<CandidateCategory, number> = { all: 0.7, starter: 0.85, rotation: 0.3, prospect: 0.7, free: 0.7 }

// ---------- 포지션 숙련 ----------

/** 숙련도 20이 자연스러운 자리다 */
export const POSITION_NATURAL = 20
/** 능숙한 자리(15~19)는 0.6에서 시작해 1점마다 0.075씩 올라 19에서 0.9가 된다 */
export const POSITION_ACCOMPLISHED_BASE = 0.6
export const POSITION_ACCOMPLISHED_STEP = 0.075
/** 15 미만은 겨우 뛰는 자리라 숙련도 / 15 × 0.35 (최대 0.35) */
export const POSITION_POOR_MAX = 0.35

// ---------- 성장 가능성 ----------

/** 이 나이 이하는 성장 시간을 전부 인정한다 */
export const GROWTH_AGE_FULL = 19
/** 이 나이부터는 성장을 기대하지 않는다(0). 그 사이는 직선으로 줄어든다: 23세 0.56, 26세 0.22 */
export const GROWTH_AGE_END = 28
/** 잠재 능력이 현재 능력보다 이만큼 높으면 만점. 유망주 대부분이 40 안쪽이다 */
export const HEADROOM_FULL = 40
/**
 * 성장해도 내 주전의 현재 능력을 못 넘으면 쓸모가 적다. 잠재 능력 / 내 주전 현재 능력이
 * 0.9 이하면 0, 1.1 이상이면 1로 보고 그 사이는 직선으로 잇는다.
 */
export const CEILING_LOW = 0.9
export const CEILING_HIGH = 1.1

// ---------- 나이 가치 ----------

/** 전성기(이 범위에서 1점). 필드 선수와 골키퍼가 다르다. 골키퍼는 늦게 피고 오래 간다 */
export const PEAK_OUTFIELD: [number, number] = [24, 29]
export const PEAK_GOALKEEPER: [number, number] = [27, 33]
/** 18세 이하의 점수. 되팔 가치는 높지만 당장의 힘은 약하다. 전성기 시작 나이에 가까워질수록 1로 오른다 */
export const AGE_YOUNG_FLOOR = 0.7
export const AGE_YOUNG_FROM = 18
/** 전성기가 지난 뒤 한 해마다 깎는 충족도 */
export const AGE_DECLINE_PER_YEAR = 0.12

// ---------- 비용 부담 ----------

/** 내 팀 주급·몸값 수준을 알려면 필요한 최소 선수 수(너무 적으면 중간값이 믿을 수 없다) */
export const MIN_SQUAD_SAMPLE = 8
/** 주급 충족도의 비중. 주급은 계약 기간 내내 나가는 돈이고 몸값은 한 번이다 */
export const WAGE_SHARE = 0.6
/**
 * 충족도 곡선(내 팀 수준 기준): 중간값의 절반 이하 1, 중간값 0.8, 팀 최고 0.2, 최고의 1.3배 이상 0.
 * 팀에서 제일 많이 받는 선수가 되는 영입은 라커룸과 재정에 부담이라 크게 깎는다.
 */
export const COST_LOW_RATIO = 0.5
export const COST_AT_MEDIAN = 0.8
export const COST_AT_TOP = 0.2
export const COST_OVER_TOP_RATIO = 1.3
/** 최고가 중간값의 이 배수보다 작으면(팀이 거의 평평하면) 곡선이 무너지지 않게 이 배수로 본다 */
export const COST_MIN_TOP_RATIO = 1.2
/**
 * 계약이 짧게 남은 선수는 이적료가 내려간다. 남은 일수 / 730(2년)만큼 몸값에 곱하되 20% 밑으로는 내리지 않는다.
 * (게임이 정확히 이렇게 계산하는 것은 아니다. 방향만 반영한 어림이다.)
 */
export const FEE_FULL_DAYS = 730
export const FEE_FLOOR = 0.2

// ---------- 영입 난이도 ----------

/** 남은 계약 일수 → 쉬움(0~1). 자유 계약 1, 6개월 0.9, 1년 0.75, 2년 0.5, 4년 이상 0.25 */
export const CONTRACT_EASE: Array<[number, number]> = [
  [0, 1],
  [183, 0.9],
  [365, 0.75],
  [730, 0.5],
  [1460, 0.25]
]
/** 계약 기간과 입지가 다 있을 때 계약 기간의 비중 */
export const CONTRACT_SHARE = 0.5
/**
 * 계약상 입지 → 쉬움(0~1). 코드의 뜻은 shared/world.ts의 SQUAD_STATUS_LABEL을 따른다.
 * 핵심 선수는 구단이 놓아주지 않으려 하고(0.1), 비주전·비상 백업은 구단이 필요로 하지 않아 내놓기 쉽다(0.9 이상).
 * 게임에는 "이적 가능" "필요 없음" 표시가 따로 있지만 세이브에서 읽지 못해 쓰지 않는다.
 */
export const STATUS_EASE: Record<number, number> = {
  1: 0.1, 2: 0.3, 3: 0.5, 4: 0.7, 5: 0.75, 7: 0.95, 9: 0.9,
  10: 0.4, 11: 0.4, 13: 0.5, 14: 0.6,
  15: 0.5, 16: 0.7, 17: 0.7, 18: 0.7, 20: 0.8, 21: 0.9
}

// ---------- 신뢰성 ----------

/**
 * 숨은 능력치와 결단력의 비중(합이 아니라 상대 비중). 값은 게임 표시값 1~20이다.
 * 부상 빈도와 비매너 플레이는 낮을수록 좋아 뒤집어 쓴다.
 * 일관성·부상 빈도를 크게 보는 이유: 사 오고 나서 뛰는 경기 수와 기복을 가장 직접 좌우한다.
 */
export const TRAIT_WEIGHTS = {
  consistency: 3,
  injuryProneness: 3,
  importantMatches: 2,
  naturalFitness: 1.5,
  determination: 1.5,
  dirtiness: 1
} as const

export type TraitId = keyof typeof TRAIT_WEIGHTS
const TRAIT_LABEL: Record<TraitId, string> = {
  consistency: '일관성',
  injuryProneness: '부상 빈도',
  importantMatches: '큰 경기',
  naturalFitness: '타고난 체력',
  determination: '결단력',
  dirtiness: '비매너 플레이'
}
const LOWER_IS_BETTER: ReadonlySet<TraitId> = new Set<TraitId>(['injuryProneness', 'dirtiness'])

// ---------- 입력과 출력 ----------

export type Traits = Record<TraitId, number | null>

export interface RecommendInput {
  category: CandidateCategory
  /** 고른 역할이 골키퍼 역할인가(전성기 나이가 다르다) */
  goalkeeper: boolean
  /** 고른 역할의 점수(0~100) */
  roleScore: number
  /** 그 역할의 자리들 가운데 가장 높은 포지션 숙련도(1~20). 모르면 null */
  roleRating: number | null
  age: number | null
  ca: number
  pa: number
  /** 세이브에 적힌 기준 몸값(파운드). 모르면 null */
  value: number | null
  /** 주급(파운드). 모르면 null */
  wage: number | null
  /** 계약 만료일(연도 × 1000 + 연중 일수). 모르면 0 또는 null */
  contractEnd: number | null
  /** 계약상 입지 코드. 모르면 0 */
  squadStatus: number
  /** 소속 구단이 있는가(없으면 자유 계약) */
  hasClub: boolean
  /** 숨은 능력치와 결단력(게임 표시값 1~20). 모르면 null */
  traits: Traits
}

export interface SquadMoney {
  medianWage: number
  topWage: number
  /** 몸값을 아는 선수가 너무 적으면 null */
  medianValue: number | null
  topValue: number | null
}

export interface RecommendContext {
  /** 내 팀에서 이 역할 점수가 가장 높은 선수. 없으면 null */
  starter: { score: number; ca: number } | null
  backup: { score: number } | null
  /** 게임의 오늘(연도, 연중 일수). 모르면 null */
  today: { year: number; day: number } | null
  /** 내 팀의 주급·몸값 수준. 알 수 없으면 null */
  money: SquadMoney | null
  /** 고른 자리의 보강 필요도(0~100). 자리를 고르지 않았으면 없다 */
  need?: number | null
}

export interface RecommendComponent {
  id: ComponentId
  label: string
  /** 이 항목이 더해 준 점수(소수 첫째 자리) */
  points: number
  /** 이 항목이 줄 수 있는 최고 점수. 못 구한 항목은 0이고, 구한 항목의 합이 100이다 */
  max: number
  /** 점수에 반영했는지 */
  counted: boolean
  /** 왜 이 점수인지 쉬운 말로 */
  note: string
}

export interface Recommendation {
  /** 0~100 */
  total: number
  components: RecommendComponent[]
}

// ---------- 도구 ----------

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
const round1 = (x: number): number => Math.round(x * 10) / 10
const fixed1 = (x: number): string => x.toFixed(1)

/** 점들을 직선으로 잇는다. 범위 밖은 양 끝 값. points의 x는 커져야 한다 */
export function interpolate(points: Array<[number, number]>, x: number): number {
  if (x <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]
    if (x <= x1) {
      const [x0, y0] = points[i - 1]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return points[points.length - 1][1]
}

/** 게임 안 날짜 두 개 사이의 일수(윤년은 무시한 어림). 만료일이 오늘보다 앞이면 음수 */
export function daysUntil(end: number, today: { year: number; day: number }): number {
  return (Math.floor(end / 1000) - today.year) * 365 + ((end % 1000) - today.day)
}

/** 내 팀 선수들의 주급·몸값 목록에서 수준을 뽑는다. 0은 모르는 값이다 */
export function squadMoney(wages: number[], values: number[]): SquadMoney | null {
  const known = (list: number[]): number[] => list.filter((x) => x > 0).sort((a, b) => a - b)
  const median = (sorted: number[]): number => {
    const mid = sorted.length >> 1
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  const w = known(wages)
  if (w.length < MIN_SQUAD_SAMPLE) return null
  const v = known(values)
  const haveValues = v.length >= MIN_SQUAD_SAMPLE
  return {
    medianWage: median(w),
    topWage: w[w.length - 1],
    medianValue: haveValues ? median(v) : null,
    topValue: haveValues ? v[v.length - 1] : null
  }
}

/** 내 팀 수준에 견준 부담의 충족도(1 가벼움 ~ 0 매우 무거움) */
export function affordability(amount: number, median: number, top: number): number {
  const topAt = Math.max(top, median * COST_MIN_TOP_RATIO)
  return interpolate(
    [
      [median * COST_LOW_RATIO, 1],
      [median, COST_AT_MEDIAN],
      [topAt, COST_AT_TOP],
      [topAt * COST_OVER_TOP_RATIO, 0]
    ],
    amount
  )
}

/** 나이 가치의 충족도 */
export function ageFit(age: number, goalkeeper: boolean): number {
  const [from, to] = goalkeeper ? PEAK_GOALKEEPER : PEAK_OUTFIELD
  if (age < from) {
    if (age <= AGE_YOUNG_FROM) return AGE_YOUNG_FLOOR
    return AGE_YOUNG_FLOOR + ((1 - AGE_YOUNG_FLOOR) * (age - AGE_YOUNG_FROM)) / (from - AGE_YOUNG_FROM)
  }
  if (age <= to) return 1
  return Math.max(0, 1 - AGE_DECLINE_PER_YEAR * (age - to))
}

/** 성장 가능성의 충족도(나이 × 잠재 여유 × 내 주전을 넘는가) */
export function growthFit(age: number, ca: number, pa: number, starterCa: number | null): number {
  const time = clamp01((GROWTH_AGE_END - age) / (GROWTH_AGE_END - GROWTH_AGE_FULL))
  const room = clamp01((pa - ca) / HEADROOM_FULL)
  const ceiling = starterCa === null ? 1 : clamp01((pa / starterCa - CEILING_LOW) / (CEILING_HIGH - CEILING_LOW))
  return time * room * ceiling
}

/** 포지션 숙련도의 충족도 */
export function positionFit(rating: number): number {
  if (rating >= POSITION_NATURAL) return 1
  if (rating >= PLAYABLE_RATING) return POSITION_ACCOMPLISHED_BASE + POSITION_ACCOMPLISHED_STEP * (rating - PLAYABLE_RATING)
  return (POSITION_POOR_MAX * Math.max(0, rating)) / PLAYABLE_RATING
}

/** 즉시 전력의 충족도. 주전·두 번째와의 점수 차이로 */
export function immediateFit(roleScore: number, ctx: Pick<RecommendContext, 'starter' | 'backup'>, category: CandidateCategory): number {
  const gain = (delta: number): number => 0.5 + 0.5 * Math.tanh(delta / UPGRADE_SCALE)
  if (!ctx.starter) return clamp01((roleScore - ABSOLUTE_FLOOR) / (ABSOLUTE_TOP - ABSOLUTE_FLOOR))
  const vsStarter = gain(roleScore - ctx.starter.score)
  if (!ctx.backup) return vsStarter
  const share = STARTER_SHARE[category]
  return share * vsStarter + (1 - share) * gain(roleScore - ctx.backup.score)
}

/** 신뢰성의 충족도와, 아는 값이 하나도 없으면 null */
export function reliabilityFit(traits: Traits): number | null {
  let sum = 0
  let weight = 0
  for (const id of Object.keys(TRAIT_WEIGHTS) as TraitId[]) {
    const value = traits[id]
    if (value === null) continue
    const good = clamp01((value - 1) / 19)
    sum += (LOWER_IS_BETTER.has(id) ? 1 - good : good) * TRAIT_WEIGHTS[id]
    weight += TRAIT_WEIGHTS[id]
  }
  return weight === 0 ? null : sum / weight
}

// ---------- 항목별 계산 ----------

interface Part {
  /** 0~1. 못 구했으면 null */
  fit: number | null
  note: string
}

const skipped = (reason: string): Part => ({ fit: null, note: `${reason} 이 항목은 점수에 반영하지 않았습니다.` })

function immediatePart(input: RecommendInput, ctx: RecommendContext, notes: boolean): Part {
  const fit = immediateFit(input.roleScore, ctx, input.category)
  if (!notes) return { fit, note: '' }
  const own = `적합도 ${fixed1(input.roleScore)}점`
  const need = ctx.need ?? null
  const weighting =
    need === null ? '' : need >= 60 ? ` 이 자리는 보강 필요도가 ${Math.round(need)}로 높아 이 항목의 비중을 키웠습니다.` : need <= 35 ? ` 이 자리는 보강 필요도가 ${Math.round(need)}로 낮아 이 항목의 비중을 줄였습니다.` : ''
  if (!ctx.starter) return { fit, note: `내 팀에 이 자리를 뛸 선수가 없어, ${own} 자체를 40~80점 구간에서 보았습니다.${weighting}` }
  const delta = input.roleScore - ctx.starter.score
  const versus = `내 주전(${fixed1(ctx.starter.score)}점)보다 ${fixed1(Math.abs(delta))}점 ${delta >= 0 ? '높습니다' : '낮습니다'}`
  if (!ctx.backup) return { fit, note: `${versus}. 두 번째 선수가 없어 주전과만 견주었습니다.${weighting}` }
  const second = input.roleScore - ctx.backup.score
  return {
    fit,
    note: `${versus}. 두 번째 선수(${fixed1(ctx.backup.score)}점)보다는 ${fixed1(Math.abs(second))}점 ${second >= 0 ? '높습니다' : '낮습니다'}.${weighting}`
  }
}

function positionPart(input: RecommendInput, notes: boolean): Part {
  const rating = input.roleRating
  if (rating === null) return skipped('이 역할의 자리 숙련도를 알 수 없어서,')
  const fit = positionFit(rating)
  if (!notes) return { fit, note: '' }
  if (rating >= POSITION_NATURAL) return { fit, note: `이 역할의 자리가 자연스러운 자리(숙련도 ${rating})입니다.` }
  if (rating >= PLAYABLE_RATING) return { fit, note: `이 역할의 자리를 능숙하게 뛸 수 있습니다(숙련도 ${rating}, 자연스러운 자리는 20).` }
  return { fit, note: `이 역할의 자리는 숙련도 ${rating}로 아직 어색합니다(능숙은 ${PLAYABLE_RATING} 이상).` }
}

function growthPart(input: RecommendInput, ctx: RecommendContext, notes: boolean): Part {
  if (input.age === null) return skipped('나이를 알 수 없어서,')
  const fit = growthFit(input.age, input.ca, input.pa, ctx.starter?.ca ?? null)
  if (!notes) return { fit, note: '' }
  if (input.age >= GROWTH_AGE_END) return { fit, note: `${input.age}세는 더 크기를 기대하지 않아 0점입니다(${GROWTH_AGE_END}세부터).` }
  const room = input.pa - input.ca
  const base = `${input.age}세이고 잠재 능력이 현재 능력보다 ${room} 높습니다(${input.ca} → ${input.pa}).`
  if (room <= 0) return { fit, note: `${input.age}세이지만 잠재 능력이 현재 능력과 같아 더 크지 않습니다.` }
  if (ctx.starter && input.pa / ctx.starter.ca < CEILING_HIGH) {
    return { fit, note: `${base} 다만 잠재 능력 ${input.pa}이 내 주전의 현재 능력 ${ctx.starter.ca}을 크게 넘지는 못해 깎았습니다.` }
  }
  return { fit, note: base }
}

function agePart(input: RecommendInput, notes: boolean): Part {
  if (input.age === null) return skipped('나이를 알 수 없어서,')
  const fit = ageFit(input.age, input.goalkeeper)
  if (!notes) return { fit, note: '' }
  const [from, to] = input.goalkeeper ? PEAK_GOALKEEPER : PEAK_OUTFIELD
  const kind = input.goalkeeper ? '골키퍼' : '필드 선수'
  const where = input.age < from ? '아직 전성기 전입니다' : input.age <= to ? '전성기입니다' : '전성기가 지났습니다'
  return { fit, note: `${input.age}세로 ${where}(${kind}의 전성기는 ${from}~${to}세).` }
}

function costPart(input: RecommendInput, ctx: RecommendContext, notes: boolean): Part {
  if (!ctx.money) return skipped('내 팀의 주급·몸값 수준을 알 수 없어서,')
  if (input.wage === null) return skipped(input.hasClub ? '이 선수의 주급을 알 수 없어서,' : '자유 계약 선수는 세이브에 주급이 적혀 있지 않아서,')
  const { medianWage, topWage, medianValue, topValue } = ctx.money
  const wageFit = affordability(input.wage, medianWage, topWage)

  let valueFit: number | null = null
  let feeNote = ''
  if (!input.hasClub) {
    valueFit = 1
    feeNote = '소속 구단이 없어 이적료가 들지 않습니다.'
  } else if (input.value !== null && medianValue !== null && topValue !== null) {
    let fee = input.value
    if (input.contractEnd && ctx.today) {
      fee *= Math.min(1, Math.max(FEE_FLOOR, daysUntil(input.contractEnd, ctx.today) / FEE_FULL_DAYS))
    }
    valueFit = affordability(fee, medianValue, topValue)
    feeNote = `몸값 ${formatPounds(input.value)}${fee < input.value ? `(계약이 짧아 ${formatPounds(Math.round(fee))}쯤으로 봄)` : ''}는 내 팀 선수 몸값 중간(${formatPounds(medianValue)}) 기준 ${valueFit >= 0.7 ? '부담이 크지 않습니다' : valueFit >= 0.4 ? '다소 큽니다' : '매우 큽니다'}.`
  } else {
    feeNote = '몸값을 알 수 없어 주급만 보았습니다.'
  }
  const fit = valueFit === null ? wageFit : WAGE_SHARE * wageFit + (1 - WAGE_SHARE) * valueFit
  if (!notes) return { fit, note: '' }
  const ratio = input.wage / medianWage
  const wageNote =
    input.wage > topWage
      ? `주급 ${formatPounds(input.wage)}는 내 팀 최고 주급(${formatPounds(topWage)})보다 많아 팀에서 가장 많이 받는 선수가 됩니다.`
      : ratio < COST_LOW_RATIO
        ? `주급 ${formatPounds(input.wage)}는 내 팀 중간(${formatPounds(medianWage)})의 절반에도 못 미쳐 부담이 거의 없습니다.`
        : `주급 ${formatPounds(input.wage)}는 내 팀 중간(${formatPounds(medianWage)})의 ${fixed1(ratio)}배입니다.`
  return { fit, note: `${wageNote} ${feeNote}` }
}

function easePart(input: RecommendInput, ctx: RecommendContext, notes: boolean): Part {
  if (!input.hasClub) return { fit: 1, note: notes ? '소속 구단이 없어 협상할 상대가 선수 본인뿐이라 가장 쉽습니다.' : '' }
  const days = input.contractEnd && ctx.today ? daysUntil(input.contractEnd, ctx.today) : null
  const contractFit = days === null ? null : interpolate(CONTRACT_EASE, Math.max(0, days))
  const statusFit = STATUS_EASE[input.squadStatus] ?? null
  let fit: number | null = null
  if (contractFit !== null && statusFit !== null) fit = CONTRACT_SHARE * contractFit + (1 - CONTRACT_SHARE) * statusFit
  else fit = contractFit ?? statusFit
  if (fit === null) return skipped('계약 만료일과 계약상 입지를 모두 알 수 없어서,')
  if (!notes) return { fit, note: '' }
  const parts: string[] = []
  if (days !== null) parts.push(days <= 0 ? '계약이 곧 끝납니다' : days < 60 ? `계약이 ${days}일 남았습니다` : `계약이 ${Math.round(days / 30.44)}개월 남았습니다`)
  else parts.push('계약 만료일은 알 수 없어 반영하지 않았습니다')
  const label = SQUAD_STATUS_LABEL[input.squadStatus]
  if (statusFit !== null && label) parts.push(`구단이 약속한 입지는 "${label}"입니다`)
  else parts.push('계약상 입지는 알 수 없어 반영하지 않았습니다')
  return { fit, note: `${parts.join(', ')}.` }
}

function reliabilityPart(input: RecommendInput, notes: boolean): Part {
  const fit = reliabilityFit(input.traits)
  if (fit === null) return skipped('숨은 능력치를 읽지 못해서,')
  if (!notes) return { fit, note: '' }
  const shown = (['consistency', 'injuryProneness', 'importantMatches', 'naturalFitness'] as TraitId[])
    .filter((id) => input.traits[id] !== null)
    .map((id) => `${TRAIT_LABEL[id]} ${input.traits[id]}${LOWER_IS_BETTER.has(id) ? '(낮을수록 좋음)' : ''}`)
  return { fit, note: `${shown.join(', ')} 등으로 꾸준함과 건강을 보았습니다.` }
}

/**
 * 추천 점수를 계산한다. withNotes가 false이면 설명 글을 만들지 않아 빠르다(줄 세우기용).
 * 점수는 withNotes와 상관없이 같다.
 */
export function recommend(input: RecommendInput, ctx: RecommendContext, withNotes = true): Recommendation {
  const weights = { ...RECOMMEND_WEIGHTS[input.category] }
  const need = ctx.need ?? null
  const needFactor = need === null ? 1 : NEED_WEIGHT_LOW + (NEED_WEIGHT_HIGH - NEED_WEIGHT_LOW) * clamp01(need / 100)
  weights.immediate *= needFactor
  const parts: Record<ComponentId, Part> = {
    immediate: immediatePart(input, ctx, withNotes),
    position: positionPart(input, withNotes),
    growth: growthPart(input, ctx, withNotes),
    age: agePart(input, withNotes),
    cost: costPart(input, ctx, withNotes),
    ease: easePart(input, ctx, withNotes),
    reliability: reliabilityPart(input, withNotes)
  }

  // 구한 항목의 가중치 합이 100이 되도록 다시 나눈다
  let counted = 0
  for (const id of COMPONENT_ORDER) if (parts[id].fit !== null && weights[id] > 0) counted += weights[id]
  const scale = counted > 0 ? 100 / counted : 0

  let total = 0
  const components = COMPONENT_ORDER.map((id): RecommendComponent => {
    const { fit, note } = parts[id]
    const used = fit !== null && weights[id] > 0
    const max = used ? weights[id] * scale : 0
    const points = used ? fit! * max : 0
    total += points
    return {
      id,
      label: COMPONENT_LABEL[id],
      points: round1(points),
      max: round1(max),
      counted: used,
      note: !withNotes ? '' : weights[id] > 0 ? note : '이 유형에서는 점수에 반영하지 않습니다.'
    }
  })
  return { total: round1(Math.min(100, Math.max(0, total))), components }
}

/**
 * 추천 점수를 한마디로: 색에만 기대지 않도록 화면에 이 말을 같이 적는다.
 * 경계는 이 앱이 정한 어림이다(75 이상이면 대부분의 항목이 좋은 선수).
 */
export const RECOMMEND_TIERS: Array<{ min: number; id: 'top' | 'good' | 'maybe' | 'low'; label: string }> = [
  { min: 75, id: 'top', label: '강력 추천' },
  { min: 60, id: 'good', label: '추천' },
  { min: 45, id: 'maybe', label: '고려' },
  { min: 0, id: 'low', label: '보류' }
]

export function recommendTier(total: number): { id: 'top' | 'good' | 'maybe' | 'low'; label: string } {
  const tier = RECOMMEND_TIERS.find((each) => total >= each.min) ?? RECOMMEND_TIERS[RECOMMEND_TIERS.length - 1]
  return { id: tier.id, label: tier.label }
}
