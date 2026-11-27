/**
 * 역할 기준 분포(RoleNorm).
 *
 * 적합도(0~100)는 역할마다 눈금이 다르다. 같은 상위권 선수들의 적합도 평균이 역할마다 최대 6점 차이 나고,
 * 흩어진 정도(표준편차)도 2.8~5.9점으로 다르다(리버풀 세이브 실측, 검토 1회차). 그래서 "주전이 약한가", "후보와 얼마나 차이 나는가",
 * "후보 선수가 주전보다 낫다고 할 만한 차이인가"를 점수 그대로가 아니라 그 역할의 눈금(평균 mu, 표준편차 sigma)으로 잰다.
 *
 * 이 모듈은 순수 계산만 한다. 세이브를 돌며 점수 목록을 모으는 일은 main(src/main/roleNorms.ts)이 한다.
 */

/** 한 역할의 기준 분포 */
export interface RoleNorm {
  /** 모집단 적합도의 평균 */
  mu: number
  /** 모집단 적합도의 모표준편차(하한 NORM_MIN_SIGMA) */
  sigma: number
  /** 현재 능력(CA) 1점이 적합도 몇 점에 해당하는지(CA에 대한 적합도의 회귀 기울기). 성장 예측에 쓴다 */
  beta: number
  /**
   * 성장 예측에 쓰는 기울기 β_grow(5회차): 이 역할 풀(숙련 ≥ 15, 여자 아님)에서 현재 능력 110~180인 선수의 적합도-현재 능력 기울기.
   * 표본이 40명 미만이거나 기울기가 0 이하이면 β와 같다. 없으면(옛 기록) β를 쓴다(shared/world.ts의 growthBetaOf)
   */
  betaGrow?: number
  /** 모집단의 선수 수 */
  n: number
  /** 기준 현재 능력 C*: 내 1군 상위 11명 중간값 - 10(최저 100). 모든 역할이 같은 값이다(4회차) */
  caRef: number
  /** 표본을 채우려고 실제로 쓴 최소 현재 능력 c_r(C*보다 낮으면 표본을 넓힌 것). 없으면 caRef와 같다 */
  poolCa?: number
  /** 표본이 C*보다 낮은 선수까지 포함해서 생긴 평균 차이를 메우려고 μ에 더한 점수 β_hi·(C̄* - C̄_r). 없으면 0 */
  shift?: number
}

/** 이 숙련도 이상이어야 그 역할의 자리를 뛰는 선수로 본다(positions.ts의 PLAYABLE_RATING과 같은 15) */
export const NORM_MIN_RATING = 15
/** 기준 능력의 하한: 내 팀이 약해도 상위권을 100 아래로 잡지 않는다 */
export const NORM_CA_FLOOR = 100
/** 내 주전 11명의 현재 능력 중간값에서 이만큼 낮은 선수부터를 "내가 데려올 수준의 상위권"으로 본다 */
export const NORM_CA_MARGIN = 10
/** 중간값을 구하는 내 선수 수(상위 11명 = 한 경기 선발진) */
export const NORM_TOP_COUNT = 11
/** 모집단이 이 인원보다 적으면 기준 능력을 한 걸음씩 낮춰 다시 센다 */
export const NORM_MIN_POPULATION = 40
export const NORM_CA_STEP = 10
/** 기준 능력을 이보다 낮추지 않는다 */
export const NORM_CA_MIN = 60
/** 표준편차 하한. 모집단이 너무 모여 있으면 작은 차이가 과장되므로 최소값을 둔다(역할별 실측은 2.8 이상) */
export const NORM_MIN_SIGMA = 2.5
/** 기울기를 못 구할 때의 값(추정: 리버풀 세이브에서 역할별 0.236~0.336의 가운데쯤) */
export const DEFAULT_BETA = 0.28
/** 기울기를 구하는 데 쓰는 선수의 최소 현재 능력과 최소 인원 */
export const BETA_MIN_CA = 60
export const BETA_MIN_POPULATION = 40
/** 성장 기울기 β_grow를 재는 현재 능력 구간(5회차): 어린 선수가 실제로 지나가는 구간. 이 구간 표본이 BETA_MIN_POPULATION 미만이면 β */
export const BETA_GROW_MIN_CA = 110
export const BETA_GROW_MAX_CA = 180

/**
 * 기준 분포를 못 구했을 때(옛 호출, 미리보기) 쓰는 값.
 * 추정: 상위권 적합도 평균 72, 표준편차 4(역할별 실측 평균이 약 3.9).
 */
export const FALLBACK_NORM: RoleNorm = { mu: 72, sigma: 4, beta: DEFAULT_BETA, n: 0, caRef: NORM_CA_FLOOR }

/** 점수 차이를 충족도로 바꾸는 폭(표준편차의 몇 배에서 0.88에 이르는가). g(Δ) = 0.5 + 0.5·tanh(Δ / (1.5σ)) */
export const GAIN_WIDTH_SIGMAS = 1.5

/** z 점수: 이 역할 기준에서 평균보다 표준편차의 몇 배 위인가 */
export function zOf(norm: RoleNorm, score: number): number {
  return (score - norm.mu) / norm.sigma
}

/** 점수 차이 Δ(적합도 점수)의 충족도 0~1. 같으면 0.5, +1.5σ 높으면 0.88, -1.5σ 낮으면 0.12. 역할이 달라도 σ 단위 차이가 같으면 같다 */
export function gainOf(delta: number, norm: RoleNorm): number {
  return 0.5 + 0.5 * Math.tanh(delta / (GAIN_WIDTH_SIGMAS * norm.sigma))
}

/** 기준 능력의 시작값: 내 상위 11명 현재 능력의 중간값 - 10, 단 100 이상 */
export function referenceCa(myAbilities: number[]): number {
  const top = [...myAbilities].sort((a, b) => b - a).slice(0, NORM_TOP_COUNT)
  if (top.length === 0) return NORM_CA_FLOOR
  const mid = top.length >> 1
  const median = top.length % 2 === 1 ? top[mid] : (top[mid - 1] + top[mid]) / 2
  return Math.max(NORM_CA_FLOOR, Math.round(median - NORM_CA_MARGIN))
}

/** start부터, 그 능력 이상인 선수가 40명 이상이 될 때까지 10씩 낮춘 기준 능력(최저 60) */
export function pickCaRef(abilities: ArrayLike<number>, start: number): number {
  let ref = start
  for (;;) {
    let count = 0
    for (let i = 0; i < abilities.length; i++) if (abilities[i] >= ref) count++
    if (count >= NORM_MIN_POPULATION || ref <= NORM_CA_MIN) return Math.max(NORM_CA_MIN, Math.min(ref, start))
    ref = Math.max(NORM_CA_MIN, ref - NORM_CA_STEP)
  }
}

/** 점수를 현재 능력에 단순 회귀한 기울기. minCa 미만은 제외. 표본이 minN 미만이거나 분산이 0이거나 기울기가 0 이하이면 null */
function slopeOf(scores: ArrayLike<number>, abilities: ArrayLike<number>, minCa: number, minN: number, maxCa = Infinity): number | null {
  let n = 0
  let sumX = 0
  let sumY = 0
  for (let i = 0; i < scores.length; i++) {
    if (abilities[i] < minCa || abilities[i] > maxCa) continue
    n++
    sumX += abilities[i]
    sumY += scores[i]
  }
  if (n < minN || n === 0) return null
  const meanX = sumX / n
  const meanY = sumY / n
  let covariance = 0
  let variance = 0
  for (let i = 0; i < scores.length; i++) {
    if (abilities[i] < minCa || abilities[i] > maxCa) continue
    covariance += (abilities[i] - meanX) * (scores[i] - meanY)
    variance += (abilities[i] - meanX) ** 2
  }
  if (variance === 0) return null
  const slope = covariance / variance
  return Number.isFinite(slope) && slope > 0 ? slope : null
}

/** 점수를 현재 능력에 단순 회귀한 기울기(현재 능력 60 이상). 표본이 모자라거나 기울기가 0 이하이면 DEFAULT_BETA */
export function betaFromScores(scores: ArrayLike<number>, abilities: ArrayLike<number>): number {
  return slopeOf(scores, abilities, BETA_MIN_CA, BETA_MIN_POPULATION) ?? DEFAULT_BETA
}

/**
 * 성장 예측용 기울기 β_grow(5회차): 현재 능력 110~180인 선수의 적합도-현재 능력 기울기. 표본이 40명 미만이거나 기울기가 0 이하이면 β를 돌려준다.
 * β는 현재 능력 60 이상 전체의 기울기라 유망주가 지나가는 구간(110~180)과 어긋난다: 이 세이브에서 스트라이커 0.237 → 0.279, 수비형 미드 0.313 → 0.259.
 */
export function betaGrowFromScores(scores: ArrayLike<number>, abilities: ArrayLike<number>, beta: number): number {
  return slopeOf(scores, abilities, BETA_GROW_MIN_CA, BETA_MIN_POPULATION, BETA_GROW_MAX_CA) ?? beta
}

/**
 * 한 역할의 기준 분포. scores·abilities는 그 역할의 자리를 뛸 수 있는(숙련 15 이상) 여자가 아닌 선수들의 적합도와 현재 능력이다.
 * startCa는 referenceCa()가 준 기준 능력 C*.
 *
 * 4회차: 모든 역할이 같은 기준 능력 C*를 쓴다(caRef = C*). 표본이 40명 모자라는 역할은 표본용 기준 c_r(pickCaRef)을 낮춰 채우되,
 * 그 풀이 C* 이상 선수보다 약한 만큼 평균을 보정한다.
 *   μ_r = (풀의 적합도 평균) + β_hi · (C̄* - C̄_r)       C̄_r = 풀의 평균 현재 능력, β_hi = 풀 안에서 적합도를 CA에 회귀한 기울기
 * meanCaStar(C̄*: 모든 역할의 풀을 합쳐 C* 이상인 선수의 평균 현재 능력)를 주지 않으면 보정하지 않는다. σ는 풀의 표준편차 그대로다.
 */
export function normFromScores(scores: ArrayLike<number>, abilities: ArrayLike<number>, startCa: number, meanCaStar?: number): RoleNorm {
  const poolCa = pickCaRef(abilities, startCa)
  const beta = betaFromScores(scores, abilities)
  const betaGrow = betaGrowFromScores(scores, abilities, beta)
  let n = 0
  let sum = 0
  let sumCa = 0
  for (let i = 0; i < scores.length; i++) {
    if (abilities[i] < poolCa) continue
    n++
    sum += scores[i]
    sumCa += abilities[i]
  }
  if (n === 0) return { ...FALLBACK_NORM, beta, betaGrow, caRef: startCa, poolCa, shift: 0 }
  const mean = sum / n
  let squares = 0
  for (let i = 0; i < scores.length; i++) {
    if (abilities[i] < poolCa) continue
    squares += (scores[i] - mean) ** 2
  }
  const betaHi = slopeOf(scores, abilities, poolCa, BETA_MIN_POPULATION) ?? beta
  const shift = meanCaStar === undefined ? 0 : betaHi * (meanCaStar - sumCa / n)
  return {
    mu: mean + shift,
    sigma: Math.max(NORM_MIN_SIGMA, Math.sqrt(squares / n)),
    beta,
    betaGrow,
    n,
    caRef: startCa,
    poolCa,
    shift
  }
}

/** C̄*: 모든 역할의 풀을 합쳐(선수 중복 제거) 현재 능력이 C* 이상인 선수의 평균 현재 능력. 그런 선수가 없으면 undefined */
export function meanCaAbove(pools: Array<{ abilities: ArrayLike<number>; ids: ArrayLike<number> }>, startCa: number): number | undefined {
  const seen = new Set<number>()
  let sum = 0
  for (const pool of pools) {
    for (let i = 0; i < pool.abilities.length; i++) {
      if (pool.abilities[i] < startCa || seen.has(pool.ids[i])) continue
      seen.add(pool.ids[i])
      sum += pool.abilities[i]
    }
  }
  return seen.size === 0 ? undefined : sum / seen.size
}

/** 역할 id → 기준 분포 */
export type RoleNorms = Record<string, RoleNorm>

/** 기준 분포가 없는 역할은 FALLBACK_NORM으로 */
export function normOf(norms: RoleNorms | undefined, roleId: string): RoleNorm {
  return norms?.[roleId] ?? FALLBACK_NORM
}

/** z 점수를 쉬운 말로. 점수 ≥ 1 상위권에서도 뛰어남, 0~1 조금 높음, -1~0 조금 낮음, -1 미만 크게 낮음 */
export function zWords(z: number): string {
  if (z >= 1) return '상위권에서도 뛰어납니다'
  if (z >= 0) return '상위권 평균보다 조금 높습니다'
  if (z >= -1) return '상위권 평균보다 조금 낮습니다'
  return '상위권 평균보다 크게 낮습니다'
}
