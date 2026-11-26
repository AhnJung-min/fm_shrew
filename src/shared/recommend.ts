import { withJosa } from './korean'
import { FALLBACK_NORM, gainOf, type RoleNorm } from './norms'
import { formatPounds } from './playerView'
import { PLAYABLE_RATING } from './positions'
import { benchmarkOf, growthRatio, projectedScore, SQUAD_STATUS_LABEL, type CandidateCategory } from './world'

/**
 * 영입 추천 점수 (0~100).
 *
 * 역할 점수 하나로 줄을 세우면 "능력은 좋지만 내 팀 최고 주급을 요구하는 34세"가 맨 위에 오른다.
 * 그래서 영입을 정할 때 실제로 따지는 여섯 가지를 따로 점수로 매겨 더한다. 항목마다 0~1의 "충족도"를 구하고,
 * 선택한 유형에 따라 정해진 가중치(합 100)를 곱한다. 가중치는 RECOMMEND_WEIGHTS 표에 모여 있다.
 * 그 합에 포지션 보정(posGate, 0~1)을 곱한 것이 총점이다.
 *
 * 순서: 자격(유형 판정, shared/world.ts의 categoriesOf) → 곱셈 보정(포지션 숙련) → 더하는 점수(항목 여섯 개).
 * 실력이 모자란 선수가 다른 항목 점수만으로 위에 오르지 않도록, 점수를 매기기 전에 자격을 먼저 따진다.
 *
 * 원칙
 * - 모르는 값 때문에 항목을 빼거나 가중치를 다시 나누지 않는다. 항목은 늘 들어가고, 모르는 값은 보통(0.5)으로 보며
 *   설명에 "정보가 없어 보통(0.5)으로 보았습니다"를 적는다. (값이 없는 선수가 값이 있는 선수보다 유리해지지 않게 한다.)
 * - 점수 차이는 그 역할의 표준편차(σ)로 잰다(shared/norms.ts). 역할이 달라도 같은 σ 단위 차이는 같은 점수를 받는다.
 * - 이 점수는 게임의 계산식이 아니라 이 앱이 정한 어림 기준이다. 숫자 하나하나의 이유는 각 항목의 설명에 적는다.
 * - 이적 예산, 선수의 성격(야망·충성심 등), 이적 가능 표시는 세이브에서 읽지 못해 쓰지 않는다. 대신 어려울 수 있는 경우는
 *   경고 문구(warnings)로만 알리고 점수에는 넣지 않는다.
 *
 * 이 모듈은 순수 계산만 한다(세이브·화면을 모른다).
 */

export type ComponentId = 'immediate' | 'growth' | 'age' | 'cost' | 'ease' | 'reliability'

export const COMPONENT_ORDER: ComponentId[] = ['immediate', 'growth', 'age', 'cost', 'ease', 'reliability']

export const COMPONENT_LABEL: Record<ComponentId, string> = {
  immediate: '즉시 전력',
  growth: '성장 가능성',
  age: '나이 가치',
  cost: '비용 부담',
  ease: '영입 난이도',
  reliability: '신뢰성'
}

/** 점수 설명에 쓰는 항목별 한 줄 풀이 */
export const COMPONENT_HELP: Record<ComponentId, string> = {
  immediate: '이 자리 역할의 적합도가 내 주전과 두 번째 선수보다 얼마나 높은가. 차이는 그 역할 선수들의 보통 점수 차이로 재고, 차이가 클수록 좋지만 어느 정도부터는 더 얹히는 점수가 줄어듭니다. 주전이 31세를 넘으면(골키퍼는 34세) 내년 하락을 감안해 기준을 낮춥니다. 보강 필요도가 높은 자리일수록 이 항목의 비중이 커집니다.',
  growth: '지금 점수가 아니라 크고 난 뒤 점수가 내 주전 기준을 얼마나 더 넘어서는가. 어릴수록, 잠재 능력이 현재 능력보다 높을수록 크고 27세부터는 0점입니다.',
  age: '지금 나이가 전성기에 가까운가. 필드 선수는 24~29세, 골키퍼는 27~33세를 전성기로 봅니다. 너무 어리면 당장은 약하고, 전성기가 지나면 가치가 떨어집니다.',
  cost: '이 선수의 주급과 몸값이 내 팀의 주급·몸값 수준에 비해 부담스럽지 않은가. 팀에서 가장 많이 받게 되는 선수는 크게 깎습니다.',
  ease: '데려오기 쉬운가. 계약이 얼마 안 남았거나 자유 계약이면 쉽고, 구단이 핵심 선수로 약속한 선수는 어렵습니다.',
  reliability: '꾸준히 제 몫을 하고 다치지 않는가. 일관성, 큰 경기, 부상 빈도, 타고난 체력, 결단력, 비매너 플레이로 봅니다.'
}

/** 화면 어디서나 같은 말로 쓰는 세 가지 점수의 풀이(풍선 도움말과 설명에 그대로 쓴다) */
export const TERM_HELP = {
  fit: '적합도: 그 자리 역할에 중요한 능력치를 가중 평균해 0~100점으로 만든 값입니다. 스쿼드, 전술판, 영입 후보가 모두 같은 식으로 계산합니다.',
  need: '보강 필요도: 이 자리에 선수를 더 영입해야 하는 정도(0~100)입니다. 주전이 같은 역할의 상위권 선수들에 견줘 얼마나 약한지, 후보 수와 격차, 주전의 나이와 계약 기간으로 계산합니다.',
  recommend: '추천 점수: 영입 후보를 즉시 전력, 성장 가능성, 나이 가치, 비용 부담, 영입 난이도, 신뢰성으로 나눠 매긴 0~100점이고, 그 자리 포지션 숙련도에 따라 보정합니다. 즉시 전력·로테이션·유망주 가운데 하나 이상의 자격을 갖춘 선수만 점수를 매깁니다.'
} as const

/**
 * 유형별 가중치(합 100). 같은 선수라도 무엇을 찾느냐에 따라 중요한 것이 다르다.
 * ('포지션 숙련'은 더하는 항목이 아니라 곱하는 보정 posGate로 옮겼다.)
 *
 * - 전체: 골고루. 즉시 전력을 가장 크게 본다.
 * - 즉시 전력: 지금 주전을 바꿀 선수를 찾는 것이므로 즉시 전력이 절반이고 성장은 거의 보지 않는다.
 * - 로테이션 자원: 주전이 아닌 뒤를 받칠 선수라 능력 격차보다 몸값·주급 부담과 데려오기 쉬운지가 더 중요하다.
 * - 유망주: 지금 능력은 거의 보지 않고 성장 가능성이 40이다. 나이 가치(어릴수록 되팔 때 값이 오른다)도 본다.
 * - 자유 계약: 이적료가 없고 데려오기 쉬운 것은 모두에게 같으므로 비용·난이도는 0으로 두고(세이브에는 소속 없는
 *   선수의 주급도 적혀 있지 않다), 실력과 믿음직함(영입 뒤 문제를 덜 일으키는가)을 더 본다.
 */
export const RECOMMEND_WEIGHTS: Record<CandidateCategory, Record<ComponentId, number>> = {
  all: { immediate: 40, growth: 12, age: 10, cost: 14, ease: 12, reliability: 12 },
  starter: { immediate: 50, growth: 4, age: 10, cost: 14, ease: 10, reliability: 12 },
  rotation: { immediate: 36, growth: 6, age: 8, cost: 20, ease: 16, reliability: 14 },
  prospect: { immediate: 12, growth: 40, age: 10, cost: 14, ease: 12, reliability: 12 },
  free: { immediate: 50, growth: 12, age: 14, cost: 0, ease: 0, reliability: 24 }
}

// ---------- 등급 ----------

export type RecommendTierId = 'top' | 'good' | 'maybe' | 'low' | 'outside'

export const RECOMMEND_TIER_LABEL: Record<RecommendTierId, string> = {
  top: '강력 추천',
  good: '추천',
  maybe: '고려',
  low: '보류',
  outside: '유형 밖'
}

/**
 * 등급은 점수의 절대값이 아니라 "같은 유형 탭의 자격 후보 전체" 안에서의 순위(백분위)로 매긴다.
 * 유형마다 점수 눈금이 달라서 75점 같은 고정 경계는 유형에 따라 다른 뜻이 되기 때문이다.
 * 누적 비율: 상위 5% 강력 추천, 다음 15%(상위 20%까지) 추천, 다음 30%(상위 50%까지) 고려, 나머지 보류. (비율은 이 앱이 정한 어림)
 */
export const TIER_CUMULATIVE_SHARE = [0.05, 0.2, 0.5] as const
/** 점수가 이보다 낮으면 순위가 높아도 보류(절대 하한. 추정: 모든 항목이 중간쯤인 선수가 50점 안팎) */
export const TIER_MIN_TOTAL = 50

/** 자격 후보들의 총점 목록으로 등급을 매기는 함수를 만든다. 같은 점수는 같은 등급이고, 후보가 한 명이면 50점 이상일 때 강력 추천이다 */
export function tierRanker(totals: number[]): (total: number) => Exclude<RecommendTierId, 'outside'> {
  const sorted = [...totals].sort((a, b) => b - a)
  const count = sorted.length
  return (total) => {
    if (total < TIER_MIN_TOTAL || count === 0) return 'low'
    // 나보다 점수가 높은 후보 수(이분 탐색)
    let low = 0
    let high = count
    while (low < high) {
      const mid = (low + high) >> 1
      if (sorted[mid] > total) low = mid + 1
      else high = mid
    }
    const share = low / count
    if (share < TIER_CUMULATIVE_SHARE[0]) return 'top'
    if (share < TIER_CUMULATIVE_SHARE[1]) return 'good'
    if (share < TIER_CUMULATIVE_SHARE[2]) return 'maybe'
    return 'low'
  }
}

/** 유형마다 등급의 뜻(한 줄) */
export const TIER_MEANING: Record<CandidateCategory, string> = {
  all: '즉시 전력·로테이션·유망주 자격을 갖춘 선수들 안에서의 순위입니다.',
  starter: '주전 경쟁: 지금 주전과 자리를 다툴 만한 선수들 안에서의 순위입니다.',
  rotation: '쓸 만한 대안: 주전은 아니어도 번갈아 쓸 만한 선수들 안에서의 순위입니다.',
  prospect: '미래 자산: 크고 나면 주전 수준이 될 것으로 보이는 어린 선수들 안에서의 순위입니다.',
  free: '소속이 없는 선수 가운데 위 자격을 갖춘 선수들 안에서의 순위입니다.'
}

/**
 * 점수만 알고 순위를 모르는 곳(짧은 목록)에서 쓰는 임시 등급. 화면은 CandidateRow.tier(백분위 등급)를 써야 한다.
 * 추정: 경계는 어림이다.
 */
export const RECOMMEND_TIERS: Array<{ min: number; id: Exclude<RecommendTierId, 'outside'>; label: string }> = [
  { min: 70, id: 'top', label: '강력 추천' },
  { min: 60, id: 'good', label: '추천' },
  { min: TIER_MIN_TOTAL, id: 'maybe', label: '고려' },
  { min: 0, id: 'low', label: '보류' }
]

export function recommendTier(total: number): { id: Exclude<RecommendTierId, 'outside'>; label: string } {
  const tier = RECOMMEND_TIERS.find((each) => total >= each.min) ?? RECOMMEND_TIERS[RECOMMEND_TIERS.length - 1]
  return { id: tier.id, label: tier.label }
}

// ---------- 즉시 전력 ----------

/**
 * 고른 자리의 보강 필요도(0~100, shared/tactic.ts)가 즉시 전력의 비중을 키우거나 줄인다.
 * 필요도 50이면 표의 가중치 그대로, 0이면 0.8배, 100이면 1.2배. 곱한 뒤 가중치 합을 100으로 다시 나누므로
 * 필요한 자리의 업그레이드는 점수에서 더 크게, 이미 탄탄한 자리의 업그레이드는 더 작게 반영된다.
 * (1회차 검토에서 0.6~1.4배가 지나치다고 보아 줄였다: 같은 자리 목록에서는 모든 후보에 똑같이 곱해지므로
 * 즉시 전력과 나머지 항목의 균형만 바꾼다.) 자리를 고르지 않았으면 필요도를 50으로 본다.
 */
export const NEED_WEIGHT_LOW = 0.8
export const NEED_WEIGHT_HIGH = 1.2
export const NEED_DEFAULT = 50

/**
 * 즉시 전력에서 주전과 견주는 몫(나머지는 두 번째 선수와 견준다).
 * 로테이션 자원을 찾을 때는 두 번째 선수를 넘는지가 핵심이라 주전 몫을 줄인다.
 */
export const STARTER_SHARE: Record<CandidateCategory, number> = { all: 0.7, starter: 0.85, rotation: 0.3, prospect: 0.7, free: 0.7 }

// ---------- 포지션 숙련(보정) ----------

/**
 * 포지션 보정 posGate(r), r = 그 자리의 숙련도(1~20):
 *   20 이상 1 / 15~19 0.85 + 0.03(r-15) / 10~14 0.55 + 0.06(r-10) / 10 미만 0.055·r
 * 15(능숙)에서 0.85, 10에서 0.55로 끊기지 않게 이어진다. 못 뛰는 자리의 선수는 총점이 5.5% 이하가 된다.
 * 근거: 더하는 항목(최대 4점 차)으로는 숙련 1~3인 선수가 필터를 풀었을 때 위로 올라오는 것을 막지 못했다(검토 1회차).
 */
export const POSITION_NATURAL = 20
export const GATE_ACCOMPLISHED_BASE = 0.85
export const GATE_ACCOMPLISHED_STEP = 0.03
/** 숙련 10 이상 15 미만(어색하지만 뛸 수는 있음) */
export const GATE_AWKWARD_FROM = 10
export const GATE_AWKWARD_BASE = 0.55
export const GATE_AWKWARD_STEP = 0.06
/** 숙련 10 미만: 1점마다 0.055 */
export const GATE_POOR_PER_POINT = 0.055

export function positionGate(rating: number): number {
  const r = Math.max(0, rating)
  if (r >= POSITION_NATURAL) return 1
  if (r >= PLAYABLE_RATING) return GATE_ACCOMPLISHED_BASE + GATE_ACCOMPLISHED_STEP * (r - PLAYABLE_RATING)
  if (r >= GATE_AWKWARD_FROM) return GATE_AWKWARD_BASE + GATE_AWKWARD_STEP * (r - GATE_AWKWARD_FROM)
  return GATE_POOR_PER_POINT * r
}

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

// ---------- 모르는 값 ----------

/** 값을 모를 때의 충족도. 좋지도 나쁘지도 않다고 본다 */
export const UNKNOWN_FIT = 0.5
const UNKNOWN_NOTE = '정보가 없어 보통(0.5)으로 보았습니다.'

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

// ---------- 경고(점수에는 넣지 않는다) ----------

/** 소속팀에서 중요한 선수로 약속된 입지 코드: 핵심 선수 1, 중요 선수 2, 주전 3, 주전 골키퍼 15 */
export const IMPORTANT_STATUS: ReadonlySet<number> = new Set([1, 2, 3, 15])
/** 현재 능력이 내 주전보다 이만큼 이상 높으면 큰 구단의 핵심일 수 있다고 알린다 */
export const WARN_CA_MARGIN = 10
/** 계약이 이 일수(4년) 이상 남았으면 이적료가 비쌀 수 있다고 알린다 */
export const WARN_LONG_CONTRACT_DAYS = 4 * 365

// ---------- 입력과 출력 ----------

export type Traits = Record<TraitId, number | null>

export interface RecommendInput {
  category: CandidateCategory
  /** 고른 역할이 골키퍼 역할인가(전성기 나이가 다르다) */
  goalkeeper: boolean
  /** 고른 역할의 점수(0~100) */
  roleScore: number
  /** 그 역할의 자리(들) 가운데 가장 높은 포지션 숙련도(1~20). 모르면 null(보정하지 않는다) */
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
  starter: { name?: string; score: number; ca: number; age?: number | null } | null
  backup: { score: number } | null
  /** 게임의 오늘(연도, 연중 일수). 모르면 null */
  today: { year: number; day: number } | null
  /** 내 팀의 주급·몸값 수준. 알 수 없으면 null */
  money: SquadMoney | null
  /** 고른 자리의 보강 필요도(0~100). 자리를 고르지 않았으면 없다(50으로 본다) */
  need?: number | null
  /** 이 역할의 기준 분포. 없으면 FALLBACK_NORM */
  norm?: RoleNorm
}

export interface RecommendComponent {
  id: ComponentId
  label: string
  /** 이 항목이 더해 준 점수(소수 첫째 자리). 포지션 보정을 곱하기 전의 점수다 */
  points: number
  /** 이 항목이 줄 수 있는 최고 점수. 이 유형에서 쓰지 않는 항목은 0이고, 쓰는 항목의 합이 100이다 */
  max: number
  /** 점수에 반영했는지(이 유형에서 가중치가 0이면 false) */
  counted: boolean
  /** 값을 몰라 보통(0.5)으로 본 항목인지 */
  assumed: boolean
  /** 왜 이 점수인지 쉬운 말로 */
  note: string
}

export interface Recommendation {
  /** 0~100. base × gate */
  total: number
  /** 항목 점수의 합(포지션 보정 전, 소수 첫째 자리) */
  base: number
  /** 포지션 보정(0~1) */
  gate: number
  /** 포지션 보정을 한 줄로 */
  gateNote: string
  components: RecommendComponent[]
  /** 점수에는 넣지 않았지만 알려 둘 것(영입이 어려울 수 있는 이유) */
  warnings: string[]
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

type BenchContext = Pick<RecommendContext, 'starter' | 'backup' | 'norm'>

/** 즉시 전력의 충족도. 주전(나이 하락 반영)·두 번째와의 점수 차이를 그 역할의 σ로 재서 */
export function immediateFit(roleScore: number, ctx: BenchContext, category: CandidateCategory, goalkeeper = false): number {
  const norm = ctx.norm ?? FALLBACK_NORM
  if (!ctx.starter) return gainOf(roleScore - norm.mu, norm)
  const { anchor } = benchmarkOf(ctx.starter, norm, goalkeeper)
  const vsStarter = gainOf(roleScore - anchor, norm)
  if (!ctx.backup) return vsStarter
  const share = STARTER_SHARE[category]
  return share * vsStarter + (1 - share) * gainOf(roleScore - ctx.backup.score, norm)
}

/**
 * 성장 가능성의 충족도: 성장으로 "추가로" 얻는 효용.
 * max(0, g(예상 적합도 - 기준) - g(지금 적합도 - 기준)). 지금도 이미 충분히 높은 선수는 성장해도 더 얹히는 것이 적고,
 * 27세 이상은 성장을 기대하지 않아 0이다.
 */
export function growthFit(roleScore: number, age: number | null, ca: number, pa: number, ctx: BenchContext, goalkeeper = false): number {
  if (age === null) return 0
  const norm = ctx.norm ?? FALLBACK_NORM
  const anchor = ctx.starter
    ? benchmarkOf(ctx.starter, norm, goalkeeper).anchor
    : norm.mu
  const projected = projectedScore(roleScore, age, ca, pa, norm.beta)
  return Math.max(0, gainOf(projected - anchor, norm) - gainOf(roleScore - anchor, norm))
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
  /** 0~1 */
  fit: number
  /** 값을 몰라 보통(0.5)으로 본 항목 */
  assumed: boolean
  note: string
}

const unknown = (reason: string): Part => ({ fit: UNKNOWN_FIT, assumed: true, note: `${reason} ${UNKNOWN_NOTE}` })

function immediatePart(input: RecommendInput, ctx: RecommendContext, notes: boolean): Part {
  const norm = ctx.norm ?? FALLBACK_NORM
  const fit = immediateFit(input.roleScore, ctx, input.category, input.goalkeeper)
  if (!notes) return { fit, assumed: false, note: '' }
  const own = `적합도 ${fixed1(input.roleScore)}점`
  const need = ctx.need ?? null
  const weighting =
    need === null ? '' : need >= 60 ? ` 이 자리는 보강 필요도가 ${Math.round(need)}로 높아 이 항목의 비중을 키웠습니다.` : need <= 35 ? ` 이 자리는 보강 필요도가 ${Math.round(need)}로 낮아 이 항목의 비중을 줄였습니다.` : ''
  if (!ctx.starter) {
    return {
      fit,
      assumed: false,
      note: `내 팀에 이 자리를 뛸 선수가 없어, ${own}을 이 역할 상위권 평균(${fixed1(norm.mu)}점)과 견주었습니다(점수 차이 ${fixed1(input.roleScore - norm.mu)}점).${weighting}`
    }
  }
  const { drop } = benchmarkOf(ctx.starter, norm, input.goalkeeper)
  const delta = input.roleScore - ctx.starter.score
  const versus = `내 주전(${fixed1(ctx.starter.score)}점)보다 ${fixed1(Math.abs(delta))}점 ${delta >= 0 ? '높습니다' : '낮습니다'}`
  const aging =
    drop > 0
      ? ` ${ctx.starter.name ? withJosa(ctx.starter.name, '이/가') : '주전이'} ${ctx.starter.age}세라 내년 하락을 감안해 기준을 ${fixed1(drop)}점 낮춰(${fixed1(ctx.starter.score - drop)}점) 견주었습니다.`
      : ''
  const scale = ` 이 역할에서 점수 차이의 보통 크기(표준편차)는 ${fixed1(norm.sigma)}점입니다.`
  if (!ctx.backup) return { fit, assumed: false, note: `${versus}. 두 번째 선수가 없어 주전과만 견주었습니다.${aging}${scale}${weighting}` }
  const second = input.roleScore - ctx.backup.score
  return {
    fit,
    assumed: false,
    note: `${versus}. 두 번째 선수(${fixed1(ctx.backup.score)}점)보다는 ${fixed1(Math.abs(second))}점 ${second >= 0 ? '높습니다' : '낮습니다'}.${aging}${scale}${weighting}`
  }
}

function growthPart(input: RecommendInput, ctx: RecommendContext, notes: boolean): Part {
  if (input.age === null) return { fit: 0, assumed: false, note: notes ? '나이를 알 수 없어 성장은 따지지 않았습니다(0점).' : '' }
  const norm = ctx.norm ?? FALLBACK_NORM
  const fit = growthFit(input.roleScore, input.age, input.ca, input.pa, ctx, input.goalkeeper)
  if (!notes) return { fit, assumed: false, note: '' }
  const room = input.pa - input.ca
  if (growthRatio(input.age) === 0) return { fit, assumed: false, note: `${input.age}세는 더 크기를 기대하지 않아 0점입니다(27세부터).` }
  if (room <= 0) return { fit, assumed: false, note: `${input.age}세이지만 잠재 능력이 현재 능력과 같아 더 크지 않습니다.` }
  const projected = projectedScore(input.roleScore, input.age, input.ca, input.pa, norm.beta)
  return {
    fit,
    assumed: false,
    note: `${input.age}세이고 잠재 능력이 현재 능력보다 ${room} 높습니다(${input.ca} → ${input.pa}). 다 크면 적합도가 ${fixed1(input.roleScore)}점에서 약 ${fixed1(projected)}점으로 오를 것으로 보고, 내 주전 기준을 넘는 정도가 지금보다 얼마나 늘어나는지만 점수에 넣었습니다.`
  }
}

function agePart(input: RecommendInput, notes: boolean): Part {
  if (input.age === null) return unknown('나이를 알 수 없어서,')
  const fit = ageFit(input.age, input.goalkeeper)
  if (!notes) return { fit, assumed: false, note: '' }
  const [from, to] = input.goalkeeper ? PEAK_GOALKEEPER : PEAK_OUTFIELD
  const kind = input.goalkeeper ? '골키퍼' : '필드 선수'
  const where = input.age < from ? '아직 전성기 전입니다' : input.age <= to ? '전성기입니다' : '전성기가 지났습니다'
  return { fit, assumed: false, note: `${input.age}세로 ${where}(${kind}의 전성기는 ${from}~${to}세).` }
}

function costPart(input: RecommendInput, ctx: RecommendContext, notes: boolean): Part {
  if (!ctx.money) return unknown('내 팀의 주급·몸값 수준을 알 수 없어서,')
  const { medianWage, topWage, medianValue, topValue } = ctx.money
  const wageKnown = input.wage !== null
  const wageFit = wageKnown ? affordability(input.wage!, medianWage, topWage) : UNKNOWN_FIT

  let valueFit: number = UNKNOWN_FIT
  let feeNote = ''
  let feeKnown = true
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
    feeKnown = false
    feeNote = `몸값은 정보가 없어 보통(${UNKNOWN_FIT})으로 보았습니다.`
  }
  const fit = WAGE_SHARE * wageFit + (1 - WAGE_SHARE) * valueFit
  const assumed = !wageKnown || !feeKnown
  if (!notes) return { fit, assumed, note: '' }
  const ratio = wageKnown ? input.wage! / medianWage : 0
  const wageNote = !wageKnown
    ? `주급은 정보가 없어 보통(${UNKNOWN_FIT})으로 보았습니다${input.hasClub ? '' : '(자유 계약 선수는 세이브에 주급이 적혀 있지 않습니다)'}.`
    : input.wage! > topWage
      ? `주급 ${formatPounds(input.wage!)}는 내 팀 최고 주급(${formatPounds(topWage)})보다 많아 팀에서 가장 많이 받는 선수가 됩니다.`
      : ratio < COST_LOW_RATIO
        ? `주급 ${formatPounds(input.wage!)}는 내 팀 중간(${formatPounds(medianWage)})의 절반에도 못 미쳐 부담이 거의 없습니다.`
        : `주급 ${formatPounds(input.wage!)}는 내 팀 중간(${formatPounds(medianWage)})의 ${fixed1(ratio)}배입니다.`
  return { fit, assumed, note: `${wageNote} ${feeNote}` }
}

function easePart(input: RecommendInput, ctx: RecommendContext, notes: boolean): Part {
  if (!input.hasClub) return { fit: 1, assumed: false, note: notes ? '소속 구단이 없어 협상할 상대가 선수 본인뿐이라 가장 쉽습니다.' : '' }
  const days = input.contractEnd && ctx.today ? daysUntil(input.contractEnd, ctx.today) : null
  const contractFit = days === null ? null : interpolate(CONTRACT_EASE, Math.max(0, days))
  const statusFit = STATUS_EASE[input.squadStatus] ?? null
  let fit: number | null = null
  if (contractFit !== null && statusFit !== null) fit = CONTRACT_SHARE * contractFit + (1 - CONTRACT_SHARE) * statusFit
  else fit = contractFit ?? statusFit
  if (fit === null) return unknown('계약 만료일과 계약상 입지를 모두 알 수 없어서,')
  if (!notes) return { fit, assumed: false, note: '' }
  const parts: string[] = []
  if (days !== null) parts.push(days <= 0 ? '계약이 곧 끝납니다' : days < 60 ? `계약이 ${days}일 남았습니다` : `계약이 ${Math.round(days / 30.44)}개월 남았습니다`)
  else parts.push('계약 만료일은 알 수 없어 반영하지 않았습니다')
  const label = SQUAD_STATUS_LABEL[input.squadStatus]
  if (statusFit !== null && label) parts.push(`구단이 약속한 입지는 "${label}"입니다`)
  else parts.push('계약상 입지는 알 수 없어 반영하지 않았습니다')
  return { fit, assumed: false, note: `${parts.join(', ')}.` }
}

function reliabilityPart(input: RecommendInput, notes: boolean): Part {
  const fit = reliabilityFit(input.traits)
  if (fit === null) return unknown('숨은 능력치를 읽지 못해서,')
  if (!notes) return { fit, assumed: false, note: '' }
  const shown = (['consistency', 'injuryProneness', 'importantMatches', 'naturalFitness'] as TraitId[])
    .filter((id) => input.traits[id] !== null)
    .map((id) => `${TRAIT_LABEL[id]} ${input.traits[id]}${LOWER_IS_BETTER.has(id) ? '(낮을수록 좋음)' : ''}`)
  return { fit, assumed: false, note: `${shown.join(', ')} 등으로 꾸준함과 건강을 보았습니다.` }
}

/** 점수에는 넣지 않고 알려만 두는 것들 */
export function warningsOf(input: RecommendInput, ctx: Pick<RecommendContext, 'starter' | 'today'>): string[] {
  const found: string[] = []
  if (input.hasClub && IMPORTANT_STATUS.has(input.squadStatus)) found.push('소속팀에서 중요한 선수라 데려오기 어려울 수 있습니다.')
  if (ctx.starter && input.ca >= ctx.starter.ca + WARN_CA_MARGIN) found.push('현재 능력이 우리 주전보다 높아 큰 구단의 핵심일 수 있습니다.')
  if (input.hasClub && input.contractEnd && ctx.today && daysUntil(input.contractEnd, ctx.today) >= WARN_LONG_CONTRACT_DAYS) {
    found.push('계약이 길게 남아 이적료가 비쌀 수 있습니다.')
  }
  return found
}

function gateNoteOf(rating: number | null, gate: number): string {
  if (rating === null) return '이 역할 자리의 숙련도를 알 수 없어 포지션 보정을 하지 않았습니다(×1).'
  const shown = `×${Math.round(gate * 1000) / 1000}`
  if (rating >= POSITION_NATURAL) return `포지션 보정 ${shown}(숙련 ${rating}, 자연스러운 자리라 보정이 없습니다)`
  if (rating >= PLAYABLE_RATING) return `포지션 보정 ${shown}(숙련 ${rating}, 능숙하지만 자연스러운 자리(20)는 아닙니다)`
  return `포지션 보정 ${shown}(숙련 ${rating}, 능숙(${PLAYABLE_RATING}) 미만이라 크게 깎았습니다)`
}

/**
 * 추천 점수를 계산한다. withNotes가 false이면 설명 글을 만들지 않아 빠르다(줄 세우기용).
 * 점수는 withNotes와 상관없이 같다.
 */
export function recommend(input: RecommendInput, ctx: RecommendContext, withNotes = true): Recommendation {
  const weights = { ...RECOMMEND_WEIGHTS[input.category] }
  const need = ctx.need ?? NEED_DEFAULT
  weights.immediate *= NEED_WEIGHT_LOW + (NEED_WEIGHT_HIGH - NEED_WEIGHT_LOW) * clamp01(need / 100)
  const parts: Record<ComponentId, Part> = {
    immediate: immediatePart(input, ctx, withNotes),
    growth: growthPart(input, ctx, withNotes),
    age: agePart(input, withNotes),
    cost: costPart(input, ctx, withNotes),
    ease: easePart(input, ctx, withNotes),
    reliability: reliabilityPart(input, withNotes)
  }

  // 항목은 늘 들어간다. 가중치 합이 100이 되도록 나누는 것은 필요도에 따른 즉시 전력 비중 조정 때문이다
  let total = 0
  for (const id of COMPONENT_ORDER) total += weights[id]
  const scale = total > 0 ? 100 / total : 0

  let sum = 0
  const components = COMPONENT_ORDER.map((id): RecommendComponent => {
    const { fit, assumed, note } = parts[id]
    const used = weights[id] > 0
    const max = used ? weights[id] * scale : 0
    const points = used ? fit * max : 0
    sum += points
    return {
      id,
      label: COMPONENT_LABEL[id],
      points: round1(points),
      max: round1(max),
      counted: used,
      assumed: used && assumed,
      note: !withNotes ? '' : used ? note : '이 유형에서는 점수에 반영하지 않습니다.'
    }
  })

  const base = round1(Math.min(100, Math.max(0, sum)))
  const gate = input.roleRating === null ? 1 : positionGate(input.roleRating)
  return {
    total: round1(base * gate),
    base,
    gate,
    gateNote: withNotes ? gateNoteOf(input.roleRating, gate) : '',
    components,
    warnings: withNotes ? warningsOf(input, ctx) : []
  }
}
