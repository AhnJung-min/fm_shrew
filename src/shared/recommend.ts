import { withJosa } from './korean'
import { FALLBACK_NORM, gainOf, type RoleNorm } from './norms'
import { formatPounds } from './playerView'
import { lowGate, PLAYABLE_RATING } from './positions'
import {
  benchmarkOf,
  effectiveFit,
  growthBetaOf,
  growthGain,
  growthShare,
  projectedScore,
  SQUAD_STATUS_LABEL,
  type BenchStarter,
  type CandidateCategory,
  type FitAdjust
} from './world'

/**
 * 영입 추천 점수 (0~100).
 *
 * 역할 점수 하나로 줄을 세우면 "능력은 좋지만 내 팀 최고 주급을 요구하는 34세"가 맨 위에 오른다.
 * 그래서 영입을 정할 때 실제로 따지는 여섯 가지를 따로 점수로 매겨 더한다. 항목마다 0~1의 "충족도"를 구하고,
 * 선택한 유형에 따라 정해진 가중치(합 100)를 곱한다. 가중치는 RECOMMEND_WEIGHTS 표에 모여 있다.
 *
 * 순서: 자격(유형 판정, shared/world.ts의 categoriesOf) → 비교에 쓰는 적합도 f_eff(포지션 숙련·나이 하락을 뺀 값) → 더하는 점수(항목 여섯 개)
 * → 숙련이 10 미만인 자리에만 곱하는 보정(lowGate).
 * 실력이 모자란 선수가 다른 항목 점수만으로 위에 오르지 않도록, 점수를 매기기 전에 자격을 먼저 따진다.
 *
 * 원칙
 * - 모르는 값 때문에 항목을 빼거나 가중치를 다시 나누지 않는다. 항목은 늘 들어가고, 모르는 값은 보통(0.5)으로 보며
 *   설명에 "정보가 없어 보통(0.5)으로 보았습니다"를 적는다. (값이 없는 선수가 값이 있는 선수보다 유리해지지 않게 한다.)
 * - 점수 차이는 그 역할의 표준편차(σ)로 잰다(shared/norms.ts). 역할이 달라도 같은 σ 단위 차이는 같은 점수를 받는다.
 * - 포지션 숙련과 나이 하락은 총점에 곱하지 않고 적합도에서 뺀다(2회차). 내 선수도 같은 식으로 뺀다(shared/depth.ts).
 * - 즉시 전력과 성숙 시 전력은 모두 "수준"이라 적합도가 오르면 총점이 줄지 않는다(1회차의 증분 방식은 비단조였다).
 * - 이 점수는 게임의 계산식이 아니라 이 앱이 정한 어림 기준이다. 숫자 하나하나의 이유는 각 항목의 설명에 적는다.
 * - 이적 예산, 선수의 성격(야망·충성심 등), 이적 가능 표시는 세이브에서 읽지 못해 쓰지 않는다. 대신 어려울 수 있는 경우는
 *   경고 문구(warnings)로 알리고, 현재 능력 격차(체급)만 영입 난이도에 조금 넣는다.
 *
 * 이 모듈은 순수 계산만 한다(세이브·화면을 모른다).
 */

export type ComponentId = 'immediate' | 'maturity' | 'age' | 'cost' | 'ease' | 'reliability'

export const COMPONENT_ORDER: ComponentId[] = ['immediate', 'maturity', 'age', 'cost', 'ease', 'reliability']

export const COMPONENT_LABEL: Record<ComponentId, string> = {
  immediate: '즉시 전력',
  maturity: '성숙 시 전력',
  age: '나이 가치',
  cost: '비용 부담',
  ease: '영입 난이도',
  reliability: '신뢰성'
}

/** 점수 설명에 쓰는 항목별 한 줄 풀이 */
export const COMPONENT_HELP: Record<ComponentId, string> = {
  immediate: '이 자리 역할의 적합도가 내 주전과 두 번째 선수보다 얼마나 높은가. 차이는 그 역할 선수들의 보통 점수 차이로 재고, 차이가 클수록 좋지만 어느 정도부터는 더 얹히는 점수가 줄어듭니다. 포지션 숙련이 20보다 낮거나 31세를 넘으면(골키퍼는 34세) 그만큼 뺀 적합도로 견주고, 같은 포지션·역할의 자리가 여럿이면 가장 약한 주전을 기준으로 합니다. 보강 필요도가 높은 자리일수록 이 항목의 비중이 커집니다.',
  maturity: '다 컸을 때의 적합도가 내 주전 기준을 얼마나 넘는가. 어릴수록, 잠재 능력이 현재 능력보다 높을수록 크게 오릅니다. 잠재와 현재의 차이 가운데 이루어질 몫(성장 몫)은 나이별 성장 기록을 따라 17세 이하 78%에서 26세 이상 0%까지 줄어듭니다(골키퍼는 늦게 커서 별도 표를 씁니다). 26세 이상은 지금 적합도가 곧 성숙 시 전력입니다.',
  age: '지금 나이가 전성기에 가까운가. 필드 선수는 24~29세, 골키퍼는 27~33세를 전성기로 봅니다. 너무 어리면 당장은 약하고, 전성기가 지나면 가치가 떨어집니다.',
  cost: '이 선수의 주급과 몸값이 내 팀의 주급·몸값 수준에 비해 부담스럽지 않은가. 팀에서 가장 많이 받게 되는 선수는 크게 깎습니다.',
  ease: '데려오기 쉬운가. 계약이 얼마 안 남았거나 자유 계약이면 쉽고, 구단이 핵심 선수로 약속한 선수는 어렵습니다. 이적 의사와 평판을 읽지 못하는 동안, 현재 능력이 내 주전보다 훨씬 높은 선수(체급이 다른 선수)는 어렵다고 보아 조금 깎습니다.',
  reliability: '꾸준히 제 몫을 하고 다치지 않는가. 일관성, 큰 경기, 부상 빈도, 타고난 체력, 결단력, 비매너 플레이로 봅니다.'
}

/** 유망주 탭의 나이 가치 풀이: 어릴수록 높다(전성기를 가리는 다른 탭과 반대 방향) */
export const AGE_HELP_PROSPECT = '지금 나이가 어린가. 어릴수록 클 시간이 길고 되팔 때 값이 오릅니다(17세 이하 1, 21세 0.56, 23세 0.33, 26세 이상 0).'

/** 항목 풀이. 유망주 탭의 나이 가치만 설명이 다르다 */
export function componentHelp(id: ComponentId, category: CandidateCategory): string {
  return id === 'age' && category === 'prospect' ? AGE_HELP_PROSPECT : COMPONENT_HELP[id]
}

/** 화면 어디서나 같은 말로 쓰는 세 가지 점수의 풀이(풍선 도움말과 설명에 그대로 쓴다) */
export const TERM_HELP = {
  fit: '적합도: 그 자리 역할에 중요한 능력치를 가중 평균해 0~100점으로 만든 값입니다. 스쿼드, 전술판, 영입 후보가 모두 같은 식으로 계산합니다. 자리를 뛰는 포지션 숙련이 20보다 낮으면 그만큼 뺀 값으로 선수끼리 견줍니다.',
  need: '보강 필요도: 이 자리에 선수를 더 영입해야 하는 정도(0~100)입니다. 주전이 같은 역할의 상위권 선수들에 견줘 얼마나 약한지, 후보 수와 격차, 주전의 나이와 계약 기간으로 계산합니다.',
  recommend: '추천 점수: 영입 후보를 즉시 전력, 성숙 시 전력, 나이 가치, 비용 부담, 영입 난이도, 신뢰성으로 나눠 매긴 0~100점입니다. 포지션 숙련과 나이 하락은 적합도에서 빼서 반영합니다. 즉시 전력·로테이션·유망주 가운데 하나 이상의 자격을 갖춘 선수만 점수를 매깁니다.'
} as const

/**
 * 유형별 가중치(합 100). 같은 선수라도 무엇을 찾느냐에 따라 중요한 것이 다르다.
 * ('포지션 숙련'은 더하는 항목이 아니라 적합도에서 뺀다.)
 *
 * - 전체: 골고루. 즉시 전력을 가장 크게 본다.
 * - 즉시 전력: 지금 주전을 바꿀 선수를 찾는 것이므로 즉시 전력이 절반이고 성숙 시 전력은 거의 보지 않는다.
 * - 로테이션 자원: 주전이 아닌 뒤를 받칠 선수라 능력 격차보다 몸값·주급 부담과 데려오기 쉬운지가 더 중요하다.
 * - 유망주: 지금 능력은 거의 보지 않고 성숙 시 전력이 40이다. 나이 가치(어릴수록 되팔 때 값이 오른다)도 본다.
 * - 자유 계약: 이적료가 없고 계약·입지가 걸리지 않아 비용·난이도의 비중은 작게 두지만(4회차까지는 0이었다), 0은 아니다.
 *   세이브에는 소속 없는 선수의 주급이 적혀 있지 않아 같은 리그에서 현재 능력·나이가 비슷한 선수의 기대 주급으로 어림하고
 *   (비용 = 0.6·주급 부담 + 0.4·1), 난이도는 체급만 본다(0.8·1 + 0.2·체급). 비중은 추정이다. 실력과 믿음직함도 더 본다.
 *
 * 성숙 시 전력은 증분이 아니라 수준이라, 27세 이상의 선수는 (즉시 전력 + 성숙 시 전력) 둘 다 지금 적합도에 걸린다.
 * 그래서 1회차보다 총점 눈금이 약 10점 올랐다(2회차).
 */
export const RECOMMEND_WEIGHTS: Record<CandidateCategory, Record<ComponentId, number>> = {
  all: { immediate: 40, maturity: 12, age: 10, cost: 14, ease: 12, reliability: 12 },
  starter: { immediate: 50, maturity: 4, age: 10, cost: 14, ease: 10, reliability: 12 },
  rotation: { immediate: 36, maturity: 6, age: 8, cost: 20, ease: 16, reliability: 14 },
  prospect: { immediate: 12, maturity: 40, age: 10, cost: 14, ease: 12, reliability: 12 },
  free: { immediate: 44, maturity: 10, age: 12, cost: 10, ease: 8, reliability: 16 }
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
 * 등급은 점수의 절대값이 아니라 "같은 유형 탭의 자격 후보 전체" 안에서의 순위로 매긴다.
 * 유형마다 점수 눈금이 달라서 75점 같은 고정 경계는 유형에 따라 다른 뜻이 되기 때문이다.
 * 경계는 영입 현실성이 낮지 않은 후보만으로 센다(tierRanker). 누적 비율: 상위 5% 강력 추천, 다음 15%(상위 20%까지) 추천, 다음 30%(상위 50%까지) 고려, 나머지 보류. (비율은 이 앱이 정한 어림)
 * 인원은 올림해서 센다: n명이면 k1 = max(1, ⌈0.05n⌉), k2 = max(k1+1, ⌈0.20n⌉), k3 = max(k2+1, ⌈0.50n⌉).
 * 그러면 후보가 5명이어도 강력 추천 1, 추천 1, 고려 1, 보류 2로 모든 등급이 나온다(2회차. 백분위로 나누면 5명에서 추천이 비었다).
 */
export const TIER_CUMULATIVE_SHARE = [0.05, 0.2, 0.5] as const
/**
 * 점수가 이보다 낮으면 순위가 높아도 보류(절대 하한).
 * 추정: 1회차는 50이었으나 2회차에 성숙 시 전력이 수준으로 바뀌어 총점 눈금이 약 10점 올라 60으로 올렸다.
 */
export const TIER_MIN_TOTAL = 60

/** 자격 후보가 n명일 때 등급을 가르는 순위(k1, k2, k3). 순위가 k 이하이면 그 등급 */
export function tierCutoffs(count: number): [number, number, number] {
  const k1 = Math.max(1, Math.ceil(TIER_CUMULATIVE_SHARE[0] * count))
  const k2 = Math.max(k1 + 1, Math.ceil(TIER_CUMULATIVE_SHARE[1] * count))
  const k3 = Math.max(k2 + 1, Math.ceil(TIER_CUMULATIVE_SHARE[2] * count))
  return [k1, k2, k3]
}

/**
 * 등급을 매기는 함수를 만든다(4회차). 경계(k1, k2, k3)는 같은 탭 자격 후보 가운데 "영입 현실성이 낮지 않은" 후보만으로 정한다.
 * 순위 = 나보다 총점이 높은 현실적 후보 수 + 1(동점은 같은 순위, 같은 등급). 총점이 TIER_MIN_TOTAL 미만이면 순위와 상관없이 보류다.
 * 현실성이 낮은 선수(low)는 후보 수에 들지 않고, 같은 순위 규칙으로 등급을 구한 뒤 "고려"까지로 제한한다.
 * 그래서 현실성 낮은 후보를 더해도 현실적인 후보의 등급은 내려가지 않는다(1~3회차에는 낮은 선수가 강력 추천·추천 칸을 쓴 채 "고려"로 남아 가장 현실적인 선수가 보류로 밀렸다).
 */
export function tierRanker(candidates: Array<{ total: number; low: boolean }>): (total: number, low?: boolean) => Exclude<RecommendTierId, 'outside'> {
  const sorted = candidates.filter((each) => !each.low).map((each) => each.total).sort((a, b) => b - a)
  const count = sorted.length
  const [k1, k2, k3] = tierCutoffs(count)
  return (total, low = false) => {
    if (total < TIER_MIN_TOTAL || count === 0) return 'low'
    // 나보다 점수가 높은 현실적 후보 수(이분 탐색)
    let lo = 0
    let hi = count
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] > total) lo = mid + 1
      else hi = mid
    }
    const rank = lo + 1
    const tier = rank <= k1 ? 'top' : rank <= k2 ? 'good' : rank <= k3 ? 'maybe' : 'low'
    return capTierByRealism(tier, { low, reasons: [] }) as Exclude<RecommendTierId, 'outside'>
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
/**
 * 영입 난이도(소속 있음) = 0.4·계약 기간 + 0.4·계약상 입지 + 0.2·체급. 모르는 값은 0.5로 본다. 소속이 없으면 1.
 * 계약과 입지를 같은 비중으로 둔 것은 1회차부터 이어 온 어림이고(추정), 체급 0.2는 이적 의사·평판을 못 읽는 동안의 임시 대용이다(2회차, 추정).
 */
export const EASE_CONTRACT_SHARE = 0.4
export const EASE_STATUS_SHARE = 0.4
export const EASE_STATURE_SHARE = 0.2
/**
 * 체급 = 1 - clamp01((CA - 내 약한 주전의 CA) / 25): 내 주전과 같거나 낮으면 1, 25 이상 높으면 0.
 * 추정: 25는 어림이다. 현재 능력이 훨씬 높은 선수는 우리 구단으로 오려 하지 않을 가능성이 크다는 생각에서 정했다.
 */
export const STATURE_SPAN_CA = 25
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
/**
 * 영입 현실성(3회차): 이적 의사·평판·예산을 읽지 못하는 동안 실현 가능성이 낮은 선수에 등급 상한을 둔다. 총점과 정렬은 그대로 두고 등급만 "고려"까지로 제한한다.
 *   낮음 = 소속 있음 ∧ ( 주급 ≥ 1.3 × 내 1군 최고 주급  ∨  ( CA - 비교 주전 CA ≥ STATURE_SPAN_CA(25) ∧ 계약상 입지 ∈ {핵심 선수, 중요 선수} ) )
 * 1.3은 비용 곡선이 0이 되는 배수(COST_OVER_TOP_RATIO)와 같고, 25는 체급과 같다(추정). 최고 주급이나 비교 주전을 모르면 그 조건은 보지 않는다.
 * 입지 번호는 SQUAD_STATUS_LABEL의 1(핵심 선수)·2(중요 선수).
 */
export const REALISM_WAGE_RATIO = COST_OVER_TOP_RATIO
export const REALISM_STATUS: ReadonlySet<number> = new Set([1, 2])
export const REALISM_LABEL = '영입 현실성 낮음'

/**
 * 구단 체급(5회차): 그 팀에 소속된 남자 선수의 현재 능력 상위 11명의 중간값. 선수가 5명 미만이면 모른다(null).
 * 파는 구단이 우리와 비슷하거나 강하면 그 팀의 주전급 선수는 내주지 않을 가능성이 크다(선수 한 명의 현재 능력으로는 가려지지 않는다).
 * 임대 중인 선수는 원 소속 팀의 체급으로 본다(호출하는 쪽이 팀을 정한다).
 */
export const STATURE_TOP_COUNT = 11
export const STATURE_MIN_PLAYERS = 5
export function clubStature(abilities: ArrayLike<number>): number | null {
  if (abilities.length < STATURE_MIN_PLAYERS) return null
  const top = Array.from(abilities).sort((a, b) => b - a).slice(0, STATURE_TOP_COUNT)
  const mid = top.length >> 1
  return top.length % 2 === 1 ? top[mid] : (top[mid - 1] + top[mid]) / 2
}
/**
 * 파는 구단의 체급이 내 체급보다 이만큼(점) 낮은 데까지는 "비슷하다"고 본다. 추정: 3은 어림이다(게임에서 협상 시작 비율로 맞춘다. 검토 5회차 4.2절 1번).
 * 낮음_체급 = 소속 있음 ∧ 입지 ∈ {핵심 1, 중요 2, 주전 3, 주전 골키퍼 15} ∧ S(파는 팀) ≥ S_me - STATURE_CLUB_MARGIN
 */
export const STATURE_CLUB_MARGIN = 3

export interface Realism {
  low: boolean
  /** 낮은 이유(문장). 낮지 않으면 빈 목록 */
  reasons: string[]
}

export function realismOf(
  input: Pick<RecommendInput, 'hasClub' | 'wage' | 'ca' | 'squadStatus' | 'sellerStature' | 'signedWith'>,
  ctx: Pick<RecommendContext, 'starter' | 'money' | 'myStature'>
): Realism {
  const reasons: string[] = []
  // 소속은 없지만 다른 구단과 계약을 마친 선수(5회차): 협상할 수 없다
  if (input.signedWith !== undefined && input.signedWith !== null) {
    reasons.push(input.signedWith ? `다른 구단(${input.signedWith})과 계약을 마쳤습니다` : '다른 구단과 계약을 마쳤습니다')
  }
  if (input.hasClub) {
    if (input.wage !== null && ctx.money && ctx.money.topWage > 0 && input.wage >= REALISM_WAGE_RATIO * ctx.money.topWage) {
      reasons.push(`주급이 내 팀 최고 주급의 ${fixed1(input.wage / ctx.money.topWage)}배입니다`)
    }
    if (ctx.starter && REALISM_STATUS.has(input.squadStatus) && input.ca - ctx.starter.ca >= STATURE_SPAN_CA) {
      reasons.push(`소속 팀의 ${SQUAD_STATUS_LABEL[input.squadStatus]}이고 현재 능력이 내 주전보다 ${input.ca - ctx.starter.ca} 높습니다`)
    }
    const seller = input.sellerStature ?? null
    const mine = ctx.myStature ?? null
    if (seller !== null && mine !== null && IMPORTANT_STATUS.has(input.squadStatus) && seller >= mine - STATURE_CLUB_MARGIN) {
      reasons.push(`소속 구단의 주전 수준(현재 능력 ${Math.round(seller)})이 우리(${Math.round(mine)})와 비슷하거나 높고, 그 팀의 주전급이라 내주지 않을 가능성이 큽니다`)
    }
  }
  return { low: reasons.length > 0, reasons }
}

/** 영입 현실성이 낮으면 등급을 "고려"까지로 제한한다(보류·유형 밖은 그대로). tierRanker가 낮은 선수에게 같은 제한을 건다 */
export function capTierByRealism(tier: RecommendTierId, realism: Realism): RecommendTierId {
  return realism.low && (tier === 'top' || tier === 'good') ? 'maybe' : tier
}

/** 현재 능력이 내 주전보다 이만큼 이상 높으면 큰 구단의 핵심일 수 있다고 알린다 */
export const WARN_CA_MARGIN = 10
/** 계약이 이 일수(4년) 이상 남았으면 이적료가 비쌀 수 있다고 알린다 */
export const WARN_LONG_CONTRACT_DAYS = 4 * 365

// ---------- 입력과 출력 ----------

export type Traits = Record<TraitId, number | null>

export interface RecommendInput {
  category: CandidateCategory
  /** 고른 역할이 골키퍼 역할인가(전성기 나이가 다르고, 나이 하락이 34세부터다) */
  goalkeeper: boolean
  /** 고른 역할의 점수(0~100). 화면에 보이는 적합도이고, 숙련 감점·나이 하락은 recommend()가 뺀다 */
  roleScore: number
  /** 그 역할의 자리(들) 가운데 가장 높은 포지션 숙련도(1~20). 모르면 null(감점하지 않는다) */
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
  /** 소속 구단이 있는가(없으면 자유 계약). 소속이 없어도 다른 구단과 계약을 마친 선수는 true로 두고 signedWith를 적는다 */
  hasClub: boolean
  /**
   * 파는 구단의 체급 S(t)(clubStature). 임대 중이면 원 소속 팀의 것. 모르면 null/없음(체급 조건은 보지 않는다)
   */
  sellerStature?: number | null
  /** 소속은 없지만 다른 구단과 계약을 마친 선수의 계약 구단 이름(구단을 알 수 없으면 빈 글자). 아니면 없다 */
  signedWith?: string | null
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
  /**
   * 비교 기준 주전. 같은 포지션·같은 역할의 자리가 여럿이면 그 가운데 가장 약한 주전(shared/tactic.ts의 SlotGroup.bench).
   * score는 포지션 숙련을 뺀 적합도, 나이 하락은 benchmarkOf가 더 뺀다. 없으면 null
   */
  starter: BenchStarter | null
  backup: { score: number; shownScore?: number } | null
  /** 게임의 오늘(연도, 연중 일수). 모르면 null */
  today: { year: number; day: number } | null
  /** 내 팀의 주급·몸값 수준. 알 수 없으면 null */
  money: SquadMoney | null
  /** 내 체급 S_me(내 1군의 clubStature). 모르면 null/없음 */
  myStature?: number | null
  /** 고른 자리(그룹)의 보강 필요도(0~100). 자리를 고르지 않았으면 없다(50으로 본다) */
  need?: number | null
  /** 이 역할의 기준 분포. 없으면 FALLBACK_NORM */
  norm?: RoleNorm
  /** 고른 자리가 속한 그룹의 자리 수(같은 포지션·역할). 2 이상이면 설명에 적는다 */
  groupSlots?: number
  /**
   * 같은 리그에서 현재 능력·나이가 비슷한 선수의 기대 주급(파운드). 대시보드의 주급 모델이다. 모르면 없다.
   * 세이브에 주급이 적혀 있지 않은 자유 계약 선수의 주급을 어림하는 데 쓴다(4회차)
   */
  expectedWage?: ((ca: number, age: number | null) => number) | null
}

export interface RecommendComponent {
  id: ComponentId
  label: string
  /** 이 항목이 더해 준 점수(소수 첫째 자리). 숙련이 낮은 자리의 보정(lowGate)을 곱하기 전의 점수다 */
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
  /** 항목 점수의 합(소수 첫째 자리) */
  base: number
  /** 숙련이 10 미만인 자리에만 곱하는 보정(0~1). 그 밖에는 1 */
  gate: number
  /** 숙련이 10 미만이어서 총점에 곱한 보정을 한 줄로. 곱하지 않았으면 빈 글자 */
  gateNote: string
  /** 적합도에서 무엇을 얼마나 뺐는가(포지션 숙련, 나이 하락) */
  fit: FitAdjust
  /** 위의 내용을 한 줄로("포지션 숙련 16이라 적합도에서 1.0점(0.32 표준편차) 뺐습니다") */
  fitNote: string
  components: RecommendComponent[]
  /** 점수에는 넣지 않았지만 알려 둘 것(영입이 어려울 수 있는 이유) */
  warnings: string[]
  /** 영입 현실성. 낮으면 등급을 "고려"까지로 제한한다(capTierByRealism) */
  realism: Realism
}

// ---------- 도구 ----------

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
const round1 = (x: number): number => Math.round(x * 10) / 10
const fixed1 = (x: number): string => x.toFixed(1)
const fixed2 = (x: number): string => x.toFixed(2)

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

/**
 * 유망주 유형의 나이 가치(3회차): 어릴수록 높다. 17세 이하 1, 21세 0.56, 23세 0.33, 26세 이상 0.
 * 다른 유형의 ageFit(전성기 24~29세)을 유망주 탭에 쓰면 18세가 24세보다 낮아져 "어릴수록 되팔 때 값이 오른다"는 설명과 거꾸로였다.
 */
export const AGE_PROSPECT_FROM = 17
export const AGE_PROSPECT_SPAN = 9
export function ageProspect(age: number): number {
  return clamp01(1 - (age - AGE_PROSPECT_FROM) / AGE_PROSPECT_SPAN)
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

/**
 * 즉시 전력의 충족도. fEff는 숙련 감점·나이 하락을 뺀 후보의 적합도(f_eff).
 * 주전(나이 하락 반영)·두 번째와의 점수 차이를 그 역할의 σ로 재서 구한다.
 */
export function immediateFit(fEff: number, ctx: BenchContext, category: CandidateCategory, goalkeeper = false): number {
  const norm = ctx.norm ?? FALLBACK_NORM
  if (!ctx.starter) return gainOf(fEff - norm.mu, norm)
  const { anchor } = benchmarkOf(ctx.starter, norm, goalkeeper)
  const vsStarter = gainOf(fEff - anchor, norm)
  if (!ctx.backup) return vsStarter
  const share = STARTER_SHARE[category]
  return share * vsStarter + (1 - share) * gainOf(fEff - ctx.backup.score, norm)
}

/**
 * 성숙 시 전력의 충족도: 다 컸을 때의 적합도 proj_eff가 기준(주전 anchor, 없으면 μ)을 얼마나 넘는가 g(proj_eff - anchor).
 * 증분이 아니라 수준이므로 f_eff·PA가 오르면 줄지 않는다. 27세 이상이거나 나이를 모르면 proj_eff = f_eff라 즉시 전력의 주전 몫과 같은 값이다.
 */
export function maturityFit(fEff: number, age: number | null, ca: number, pa: number, ctx: BenchContext, goalkeeper = false): number {
  const norm = ctx.norm ?? FALLBACK_NORM
  const anchor = ctx.starter ? benchmarkOf(ctx.starter, norm, goalkeeper).anchor : norm.mu
  return gainOf(projectedScore(fEff, age, ca, pa, growthBetaOf(norm), goalkeeper) - anchor, norm)
}

/** 체급의 충족도: 내 약한 주전과 같거나 낮으면 1, 25 이상 높으면 0 */
export function statureFit(ca: number, referenceCa: number): number {
  return 1 - clamp01((ca - referenceCa) / STATURE_SPAN_CA)
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

/** 포지션 숙련·나이 하락을 뺀 값을 한 줄로 */
export function fitNoteOf(adjust: FitAdjust, rating: number | null, age: number | null): string {
  const pieces: string[] = []
  if (adjust.positionPoints > 0.05 && rating !== null) {
    pieces.push(`포지션 숙련 ${rating}이라 적합도에서 ${fixed1(adjust.positionPoints)}점 뺐습니다`)
  }
  if (adjust.agePoints > 0 && age !== null) {
    pieces.push(`${age}세라 내년 하락을 감안해 ${fixed1(adjust.agePoints)}점 뺐습니다`)
  }
  if (pieces.length === 0) {
    return rating === null ? '이 역할 자리의 숙련도를 알 수 없어 포지션 감점을 하지 않았습니다.' : '포지션 숙련과 나이로 뺀 점수는 없습니다.'
  }
  return `${pieces.join('. ')}. 비교에는 ${fixed1(adjust.effective)}점을 씁니다(화면의 적합도 ${fixed1(adjust.shown)}점).`
}

function immediatePart(input: RecommendInput, ctx: RecommendContext, adjust: FitAdjust, notes: boolean): Part {
  const norm = ctx.norm ?? FALLBACK_NORM
  const f = adjust.effective
  const fit = immediateFit(f, ctx, input.category, input.goalkeeper)
  if (!notes) return { fit, assumed: false, note: '' }
  const own = adjust.effective === adjust.shown ? `적합도 ${fixed1(f)}점` : `숙련·나이를 뺀 적합도 ${fixed1(f)}점`
  const need = ctx.need ?? null
  const weighting =
    need === null ? '' : need >= 60 ? ` 이 자리는 보강 필요도가 ${Math.round(need)}로 높아 이 항목의 비중을 키웠습니다.` : need <= 35 ? ` 이 자리는 보강 필요도가 ${Math.round(need)}로 낮아 이 항목의 비중을 줄였습니다.` : ''
  if (!ctx.starter) {
    return {
      fit,
      assumed: false,
      note: `내 팀에 이 자리를 뛸 선수가 없어, ${own}을 이 역할 상위권 평균(${fixed1(norm.mu)}점)과 견주었습니다(점수 차이 ${fixed1(f - norm.mu)}점).${weighting}`
    }
  }
  const { drop } = benchmarkOf(ctx.starter, norm, input.goalkeeper)
  const delta = f - ctx.starter.score
  const group = (ctx.groupSlots ?? 1) > 1 ? `같은 포지션·역할의 자리가 ${ctx.groupSlots}곳이라 그 가운데 가장 약한 주전을 기준으로 했습니다. ` : ''
  const versus = `${group}내 주전(${fixed1(ctx.starter.score)}점)보다 ${fixed1(Math.abs(delta))}점 ${delta >= 0 ? '높습니다' : '낮습니다'}`
  const aging =
    drop > 0
      ? ` ${ctx.starter.name ? withJosa(ctx.starter.name, '이/가') : '주전이'} ${ctx.starter.age}세라 내년 하락을 감안해 기준을 ${fixed1(drop)}점 낮춰(${fixed1(ctx.starter.score - drop)}점) 견주었습니다.`
      : ''
  const scale = ` 이 역할에서 점수 차이의 보통 크기는 ${fixed1(norm.sigma)}점입니다.`
  if (!ctx.backup) return { fit, assumed: false, note: `${versus}. 두 번째 선수가 없어 주전과만 견주었습니다.${aging}${scale}${weighting}` }
  const second = f - ctx.backup.score
  return {
    fit,
    assumed: false,
    note: `${versus}. 두 번째 선수(${fixed1(ctx.backup.score)}점)보다는 ${fixed1(Math.abs(second))}점 ${second >= 0 ? '높습니다' : '낮습니다'}.${aging}${scale}${weighting}`
  }
}

function maturityPart(input: RecommendInput, ctx: RecommendContext, adjust: FitAdjust, notes: boolean): Part {
  const norm = ctx.norm ?? FALLBACK_NORM
  const f = adjust.effective
  const fit = maturityFit(f, input.age, input.ca, input.pa, ctx, input.goalkeeper)
  if (!notes) return { fit, assumed: false, note: '' }
  const anchor = ctx.starter ? benchmarkOf(ctx.starter, norm, input.goalkeeper).anchor : norm.mu
  const beta = growthBetaOf(norm)
  const projectedNow = projectedScore(f, input.age, input.ca, input.pa, beta, input.goalkeeper)
  const versus = `다 컸을 때의 적합도가 주전 기준(${fixed1(anchor)}점)보다 ${fixed1(Math.abs(projectedNow - anchor))}점 ${projectedNow >= anchor ? '높습니다' : '낮습니다'}.`
  if (input.age === null) return { fit, assumed: false, note: `나이를 알 수 없어 성장은 따지지 않고 지금 적합도 ${fixed1(f)}점으로 보았습니다. ${versus}` }
  const room = input.pa - input.ca
  const share = growthShare(input.age, input.goalkeeper)
  if (share === 0) {
    return { fit, assumed: false, note: `${input.age}세는 더 크기를 기대하지 않아(26세부터) 지금 적합도 ${fixed1(f)}점이 곧 성숙 시 전력입니다. ${versus}` }
  }
  if (room <= 0) {
    return { fit, assumed: false, note: `${input.age}세이지만 잠재 능력이 현재 능력과 같아 더 크지 않습니다. 성숙 시 전력은 지금 적합도 ${fixed1(f)}점입니다. ${versus}` }
  }
  const projected = projectedNow
  const gain = growthGain(input.age, input.ca, input.pa, beta, input.goalkeeper)
  const keeper = input.goalkeeper ? '골키퍼는 늦게 커서 별도 표를 씁니다. ' : ''
  return {
    fit,
    assumed: false,
    note: `${input.age}세, 잠재 ${input.pa}(지금 ${input.ca})와의 차이 ${room} 가운데 ${Math.round(share * 100)}%(성장 몫 ${fixed2(share)}: 이 나이 선수들의 성장 기록)가 이루어진다고 보아 적합도가 ${fixed1(gain)}점 올라 약 ${fixed1(projected)}점을 예상합니다. ${keeper}${versus}`
  }
}

function agePart(input: RecommendInput, notes: boolean): Part {
  if (input.age === null) return unknown('나이를 알 수 없어서,')
  if (input.category === 'prospect') {
    const young = ageProspect(input.age)
    return { fit: young, assumed: false, note: notes ? `${input.age}세로 어릴수록 클 시간이 길고 되팔 때 값이 오릅니다(17세 이하 1, 26세 이상 0 사이에서 ${fixed2(young)}).` : '' }
  }
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
  // 소속 없는 선수는 세이브에 주급이 없다: 같은 리그의 기대 주급(능력·나이)으로 어림한다(4회차)
  const estimated = !input.hasClub && input.wage === null && ctx.expectedWage ? ctx.expectedWage(input.ca, input.age) : null
  const wage = input.wage ?? estimated
  const wageKnown = wage !== null
  const wageFit = wageKnown ? affordability(wage, medianWage, topWage) : UNKNOWN_FIT

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
    feeNote = `${withJosa(`몸값 ${formatPounds(input.value)}${fee < input.value ? `(계약이 짧아 ${formatPounds(Math.round(fee))}쯤으로 봄)` : ''}`, '은/는')} 내 팀 선수 몸값 중간(${formatPounds(medianValue)}) 기준 ${valueFit >= 0.7 ? '부담이 크지 않습니다' : valueFit >= 0.4 ? '다소 큽니다' : '매우 큽니다'}.`
  } else {
    feeKnown = false
    feeNote = `몸값은 정보가 없어 보통(${UNKNOWN_FIT})으로 보았습니다.`
  }
  const fit = WAGE_SHARE * wageFit + (1 - WAGE_SHARE) * valueFit
  const assumed = !wageKnown || !feeKnown
  if (!notes) return { fit, assumed, note: '' }
  const ratio = wageKnown ? wage / medianWage : 0
  const wageLabel = estimated !== null ? '이 주급' : `주급 ${formatPounds(wage!)}`
  const wageNote = !wageKnown
    ? `주급은 정보가 없어 보통(${UNKNOWN_FIT})으로 보았습니다${input.hasClub ? '' : '(자유 계약 선수는 세이브에 주급이 적혀 있지 않습니다)'}.`
    : `${estimated !== null ? `자유 계약 선수라 주급은 같은 리그에서 현재 능력·나이가 비슷한 선수의 기대 주급(${formatPounds(estimated)})으로 어림했습니다. ` : ''}${
        wage > topWage
          ? `${withJosa(wageLabel, '은/는')} 내 팀 최고 주급(${formatPounds(topWage)})보다 많아 팀에서 가장 많이 받는 선수가 됩니다.`
          : ratio < COST_LOW_RATIO
            ? `${withJosa(wageLabel, '은/는')} 내 팀 중간(${formatPounds(medianWage)})의 절반에도 못 미쳐 부담이 거의 없습니다.`
            : `${withJosa(wageLabel, '은/는')} 내 팀 중간(${formatPounds(medianWage)})의 ${fixed1(ratio)}배입니다.`
      }`
  return { fit, assumed, note: `${wageNote} ${feeNote}` }
}

function easePart(input: RecommendInput, ctx: RecommendContext, notes: boolean): Part {
  const norm = ctx.norm ?? FALLBACK_NORM
  if (!input.hasClub) {
    // 계약·입지는 걸리지 않아 1이고, 체급(내 약한 주전보다 현재 능력이 얼마나 높은가)만 본다(4회차: 0.8·1 + 0.2·체급)
    const reference = ctx.starter ? ctx.starter.ca : norm.caRef
    const stature = statureFit(input.ca, reference)
    const fit = 1 - EASE_STATURE_SHARE * (1 - stature)
    const gap = input.ca - reference
    const heavy = gap > 0 && stature < 1 ? ` 다만 현재 능력 ${input.ca}이 ${ctx.starter ? '내 약한 주전' : '내 팀 기준 능력'}(${reference})보다 ${gap} 높아 체급이 달라 이 부분은 ${Math.round(stature * 100)}%만 쳤습니다.` : ''
    return { fit, assumed: false, note: notes ? `소속 구단이 없어 협상할 상대가 선수 본인뿐이라 계약과 입지는 가장 쉽습니다.${heavy}` : '' }
  }
  const days = input.contractEnd && ctx.today ? daysUntil(input.contractEnd, ctx.today) : null
  const contractFit = days === null ? null : interpolate(CONTRACT_EASE, Math.max(0, days))
  const statusFit = STATUS_EASE[input.squadStatus] ?? null
  const referenceCa = ctx.starter ? ctx.starter.ca : norm.caRef
  const stature = statureFit(input.ca, referenceCa)
  const fit = EASE_CONTRACT_SHARE * (contractFit ?? UNKNOWN_FIT) + EASE_STATUS_SHARE * (statusFit ?? UNKNOWN_FIT) + EASE_STATURE_SHARE * stature
  const assumed = contractFit === null || statusFit === null
  if (!notes) return { fit, assumed, note: '' }
  const parts: string[] = []
  if (days !== null) parts.push(days <= 0 ? '계약이 곧 끝납니다' : days < 60 ? `계약이 ${days}일 남았습니다` : `계약이 ${Math.round(days / 30.44)}개월 남았습니다`)
  else parts.push(`계약 만료일은 정보가 없어 보통(${UNKNOWN_FIT})으로 보았습니다`)
  const label = SQUAD_STATUS_LABEL[input.squadStatus]
  if (statusFit !== null && label) parts.push(`구단이 약속한 입지는 "${label}"입니다`)
  else parts.push(`계약상 입지는 정보가 없어 보통(${UNKNOWN_FIT})으로 보았습니다`)
  const gap = input.ca - referenceCa
  const stand = ctx.starter ? '내 약한 주전' : '내 팀 기준 능력'
  parts.push(
    gap <= 0
      ? `현재 능력 ${input.ca}은 ${stand}(${referenceCa})과 같거나 낮아 체급 걱정이 없습니다`
      : `현재 능력 ${input.ca}은 ${stand}(${referenceCa})보다 ${gap} 높아 ${stature < 1 ? `체급이 달라 데려오기 어려울 수 있어 이 부분은 ${Math.round(stature * 100)}%만 쳤습니다` : '체급 걱정이 크지 않습니다'}(이적 의사와 평판을 읽지 못해 능력 격차로 대신 어림했습니다)`
  )
  return { fit, assumed, note: `${parts.join(', ')}.` }
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

/** 숙련이 10 미만이라 총점에도 곱한 보정을 한 줄로. 곱하지 않았으면 빈 글자 */
function gateNoteOf(rating: number | null, gate: number): string {
  if (rating === null || rating >= PLAYABLE_RATING || gate >= 1) return ''
  return `포지션 숙련 ${rating}은 뛸 수 있는 수준(${PLAYABLE_RATING})에 한참 못 미쳐, 위 항목 점수의 합에 ×${Math.round(gate * 100) / 100}를 더 곱했습니다.`
}

/**
 * 추천 점수를 계산한다. withNotes가 false이면 설명 글을 만들지 않아 빠르다(줄 세우기용).
 * 점수는 withNotes와 상관없이 같다.
 */
export function recommend(input: RecommendInput, ctx: RecommendContext, withNotes = true): Recommendation {
  const norm = ctx.norm ?? FALLBACK_NORM
  const weights = { ...RECOMMEND_WEIGHTS[input.category] }
  const need = ctx.need ?? NEED_DEFAULT
  weights.immediate *= NEED_WEIGHT_LOW + (NEED_WEIGHT_HIGH - NEED_WEIGHT_LOW) * clamp01(need / 100)
  // f_eff: 포지션 숙련과 나이 하락을 뺀, 비교에 쓰는 적합도
  const adjust = effectiveFit(input.roleScore, input.roleRating, input.age, norm, input.goalkeeper)
  const parts: Record<ComponentId, Part> = {
    immediate: immediatePart(input, ctx, adjust, withNotes),
    maturity: maturityPart(input, ctx, adjust, withNotes),
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
  const gate = input.roleRating === null ? 1 : lowGate(input.roleRating)
  return {
    total: round1(base * gate),
    base,
    gate,
    gateNote: withNotes ? gateNoteOf(input.roleRating, gate) : '',
    fit: adjust,
    fitNote: withNotes ? fitNoteOf(adjust, input.roleRating, input.age) : '',
    components,
    warnings: withNotes ? warningsOf(input, ctx) : [],
    realism: realismOf(input, ctx)
  }
}
