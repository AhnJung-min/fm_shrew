import { describe, expect, it } from 'vitest'
import { FALLBACK_NORM, gainOf, type RoleNorm } from '../src/shared/norms'
import {
  affordability,
  ageFit,
  COMPONENT_ORDER,
  daysUntil,
  immediateFit,
  interpolate,
  maturityFit,
  NEED_WEIGHT_HIGH,
  NEED_WEIGHT_LOW,
  RECOMMEND_WEIGHTS,
  recommend,
  reliabilityFit,
  squadMoney,
  STARTER_SHARE,
  STATUS_EASE,
  statureFit,
  tierCutoffs,
  tierRanker,
  TIER_MIN_TOTAL,
  warningsOf,
  type ComponentId,
  type RecommendContext,
  type RecommendInput,
  type Traits
} from '../src/shared/recommend'
import { lowGate, posPenaltySigma } from '../src/shared/positions'
import { realizationOf, SQUAD_STATUS_LABEL, type CandidateCategory } from '../src/shared/world'

const CATEGORIES: CandidateCategory[] = ['all', 'starter', 'rotation', 'prospect', 'free']

const goodTraits: Traits = { consistency: 14, injuryProneness: 6, importantMatches: 14, naturalFitness: 12, determination: 14, dirtiness: 6 }

const input = (patch: Partial<RecommendInput> = {}): RecommendInput => ({
  category: 'all',
  goalkeeper: false,
  roleScore: 70,
  roleRating: 20,
  age: 26,
  ca: 130,
  pa: 135,
  value: 8_000_000,
  wage: 40_000,
  contractEnd: 2028 * 1000 + 181,
  squadStatus: 4,
  hasClub: true,
  traits: goodTraits,
  ...patch
})

const money = { medianWage: 40_000, topWage: 150_000, medianValue: 8_000_000, topValue: 45_000_000 }
const context = (patch: Partial<RecommendContext> = {}): RecommendContext => ({
  starter: { name: '주전', score: 66, ca: 125, age: 27 },
  backup: { score: 58 },
  today: { year: 2026, day: 181 },
  money,
  ...patch
})

const part = (id: ComponentId, patch: Partial<RecommendInput> = {}, ctx: RecommendContext = context()) =>
  recommend(input(patch), ctx).components.find((each) => each.id === id)!

/** 같은 순번이면 늘 같은 값이 나오는 난수 */
function rng(seed: number): () => number {
  let state = seed * 2654435761
  return () => {
    state = (state ^ (state << 13)) >>> 0
    state = (state ^ (state >>> 17)) >>> 0
    state = (state ^ (state << 5)) >>> 0
    return state / 0xffffffff
  }
}

describe('가중치 표', () => {
  it('유형마다 합이 100이다', () => {
    for (const category of CATEGORIES) {
      const sum = COMPONENT_ORDER.reduce((total, id) => total + RECOMMEND_WEIGHTS[category][id], 0)
      expect(sum, category).toBe(100)
    }
  })
  it('유형마다 중요하게 보는 항목이 다르다', () => {
    expect(RECOMMEND_WEIGHTS.starter.immediate).toBeGreaterThan(RECOMMEND_WEIGHTS.prospect.immediate)
    expect(RECOMMEND_WEIGHTS.prospect.maturity).toBeGreaterThan(RECOMMEND_WEIGHTS.starter.maturity)
    expect(RECOMMEND_WEIGHTS.rotation.cost).toBeGreaterThan(RECOMMEND_WEIGHTS.starter.cost)
    expect(RECOMMEND_WEIGHTS.free.cost).toBe(0)
    expect(RECOMMEND_WEIGHTS.free.ease).toBe(0)
  })
})

describe('interpolate', () => {
  const points: Array<[number, number]> = [[0, 1], [10, 0.5], [20, 0]]
  it('점 사이를 직선으로 잇고 범위 밖은 끝 값을 쓴다', () => {
    expect(interpolate(points, -5)).toBe(1)
    expect(interpolate(points, 5)).toBe(0.75)
    expect(interpolate(points, 10)).toBe(0.5)
    expect(interpolate(points, 30)).toBe(0)
  })
})

describe('격차 곡선 g(Δ)는 역할의 σ로 잰다', () => {
  const norm = (sigma: number): RoleNorm => ({ ...FALLBACK_NORM, sigma })
  it('같으면 0.5, +1.5σ면 0.88, -1.5σ면 0.12', () => {
    expect(gainOf(0, norm(3))).toBeCloseTo(0.5)
    expect(gainOf(4.5, norm(3))).toBeCloseTo(0.5 + 0.5 * Math.tanh(1), 6)
    expect(gainOf(4.5, norm(3))).toBeGreaterThan(0.88)
    expect(gainOf(-4.5, norm(3))).toBeLessThan(0.12)
  })
  it('σ 단위 차이가 같으면 역할이 달라도 같은 값이다(풀백 σ 3.0, 타깃맨 σ 5.9)', () => {
    expect(gainOf(4.5, norm(3.0))).toBeCloseTo(gainOf(8.85, norm(5.9)), 6)
  })
})

describe('즉시 전력', () => {
  const both = { starter: { score: 60, ca: 120 }, backup: { score: 50 }, norm: FALLBACK_NORM }
  const single = { starter: both.starter, backup: null, norm: FALLBACK_NORM }
  it('주전과 같으면 0.5, 크게 앞서면 1에 가깝고 크게 뒤지면 0에 가깝다', () => {
    expect(immediateFit(60, single, 'all')).toBeCloseTo(0.5)
    expect(immediateFit(75, single, 'all')).toBeGreaterThan(0.95)
    expect(immediateFit(40, single, 'all')).toBeLessThan(0.05)
  })
  it('격차가 클수록 좋지만 점점 덜 오른다(수확 체감)', () => {
    const f = (score: number): number => immediateFit(score, single, 'all')
    expect(f(68) - f(60)).toBeGreaterThan(f(76) - f(68))
    expect(f(61)).toBeGreaterThan(f(60))
  })
  it('내 팀에 그 자리를 뛸 선수가 없으면 이 역할 상위권 평균(mu)과 견준다', () => {
    const none = { starter: null, backup: null, norm: FALLBACK_NORM }
    expect(immediateFit(FALLBACK_NORM.mu, none, 'all')).toBeCloseTo(0.5)
    expect(immediateFit(FALLBACK_NORM.mu + 10, none, 'all')).toBeGreaterThan(0.9)
  })
  it('두 번째 선수가 없으면 주전과만 견준다', () => {
    expect(immediateFit(66, single, 'rotation')).toBe(immediateFit(66, single, 'starter'))
  })
  it('교체 자원을 찾을 때는 두 번째 선수를 넘는지를 더 본다', () => {
    expect(immediateFit(55, both, 'rotation')).toBeGreaterThan(immediateFit(55, both, 'starter'))
    expect(STARTER_SHARE.rotation).toBeLessThan(STARTER_SHARE.starter)
  })
  it('나이 든 주전은 내년 하락을 감안해 기준을 낮춘다(34세 필드 선수는 3점)', () => {
    const young = { starter: { score: 70, ca: 150, age: 28 }, backup: null, norm: FALLBACK_NORM }
    const old = { starter: { score: 70, ca: 150, age: 34 }, backup: null, norm: FALLBACK_NORM }
    expect(immediateFit(68, old, 'starter')).toBeGreaterThan(immediateFit(68, young, 'starter'))
    // 골키퍼는 34세까지 하락을 따지지 않는다
    expect(immediateFit(68, old, 'starter', true)).toBeCloseTo(immediateFit(68, young, 'starter', true))
    const note = part('immediate', { roleScore: 68 }, context({ starter: { name: '반 다이크', score: 70, ca: 150, age: 34 }, backup: null })).note
    expect(note).toContain('반 다이크가 34세라 내년 하락을 감안해 기준을 3.0점 낮춰')
  })
})

describe('포지션 숙련은 적합도에서 뺀다', () => {
  it('감점(σ의 배수): 20이면 0, 16이면 0.32, 15이면 0.40, 12이면 1.30, 10이면 1.90, 1이면 6.40', () => {
    expect(posPenaltySigma(20)).toBe(0)
    expect(posPenaltySigma(16)).toBeCloseTo(0.32)
    expect(posPenaltySigma(15)).toBeCloseTo(0.4)
    expect(posPenaltySigma(12)).toBeCloseTo(1.3)
    expect(posPenaltySigma(10)).toBeCloseTo(1.9)
    expect(posPenaltySigma(1)).toBeCloseTo(6.4)
  })
  it('경계(10, 15, 20)에서 끊기지 않고 숙련이 오를수록 줄어든다', () => {
    expect(posPenaltySigma(14.999)).toBeCloseTo(posPenaltySigma(15), 2)
    expect(posPenaltySigma(9.999)).toBeCloseTo(posPenaltySigma(10), 2)
    let last = Infinity
    for (let rating = 0; rating <= 20; rating++) {
      expect(posPenaltySigma(rating)).toBeLessThanOrEqual(last)
      last = posPenaltySigma(rating)
    }
  })
  it('총점에 곱하는 보정은 숙련이 10 미만일 때만이다(1이면 0.1, 9이면 0.9)', () => {
    expect(lowGate(20)).toBe(1)
    expect(lowGate(10)).toBe(1)
    expect(lowGate(9)).toBeCloseTo(0.9)
    expect(lowGate(1)).toBeCloseTo(0.1)
    const natural = recommend(input({ roleRating: 20 }), context())
    const poor = recommend(input({ roleRating: 5 }), context())
    expect(natural.gate).toBe(1)
    expect(natural.total).toBe(natural.base)
    expect(poor.gate).toBeCloseTo(0.5)
    expect(poor.total).toBeCloseTo(Math.round(poor.base * 0.5 * 10) / 10, 5)
    expect(poor.gateNote).toContain('×0.5')
    expect(recommend(input({ roleRating: 16 }), context()).gate).toBe(1)
  })
  it('숙련 16이어도 충분히 나은 선수는 숙련 20인 선수 위에 오른다(총점이 막히지 않는다)', () => {
    const natural = recommend(input({ roleScore: 70, roleRating: 20 }), context()).total
    const accomplished = recommend(input({ roleScore: 74, roleRating: 16 }), context()).total
    expect(accomplished).toBeGreaterThan(natural)
  })
  it('설명에 얼마나 뺐는지 적는다(1.0점, 0.32 표준편차)', () => {
    const result = recommend(input({ roleScore: 70, roleRating: 16 }), context({ norm: { ...FALLBACK_NORM, sigma: 3.15 } }))
    expect(result.fitNote).toContain('포지션 숙련 16이라 적합도에서 1.0점(0.32 표준편차) 뺐습니다')
    expect(result.fit.effective).toBeCloseTo(70 - 3.15 * 0.32, 5)
  })
  it('숙련도를 모르면 감점하지 않고 그렇게 적는다', () => {
    const result = recommend(input({ roleRating: null }), context())
    expect(result.gate).toBe(1)
    expect(result.fit.effective).toBe(result.fit.shown)
    expect(result.fitNote).toContain('알 수 없어')
  })
})

describe('나이 하락은 영입 후보에도 같은 식으로 뺀다', () => {
  it('31세부터 해마다 1점(골키퍼는 34세부터)이고 설명에 적는다', () => {
    const young = recommend(input({ roleScore: 70, age: 31 }), context())
    const old = recommend(input({ roleScore: 70, age: 33 }), context())
    expect(young.fit.agePoints).toBe(0)
    expect(old.fit.effective).toBeCloseTo(68)
    expect(old.fitNote).toContain('33세라 내년 하락을 감안해 2.0점 뺐습니다')
    expect(recommend(input({ roleScore: 70, age: 33, goalkeeper: true }), context()).fit.agePoints).toBe(0)
  })
})

describe('성숙 시 전력(수준)', () => {
  const lb: RecommendContext = {
    starter: { name: '주전', score: 73.3, ca: 153, age: 25 },
    backup: { score: 71.1 },
    today: { year: 2026, day: 181 },
    money,
    norm: { mu: 70, sigma: 3, beta: 0.283, n: 100, caRef: 150 }
  }
  it('다 컸을 때의 적합도가 주전 기준을 넘는 정도(17세 CA 120/PA 168, 적합 66.9 → 74.9점, 기준 73.3 → 0.63)', () => {
    expect(maturityFit(66.9, 17, 120, 168, lb)).toBeCloseTo(gainOf(66.9 + 0.283 * 0.59 * 48 - 73.3, lb.norm!), 6)
    expect(maturityFit(66.9, 17, 120, 168, lb)).toBeCloseTo(0.63, 1)
  })
  it('지금 적합도가 오르면 줄지 않는다(1회차에는 오히려 내려갔다)', () => {
    let last = -1
    for (let score = 55; score <= 90; score += 1) {
      const next = maturityFit(score, 17, 120, 168, lb)
      expect(next).toBeGreaterThanOrEqual(last)
      last = next
    }
  })
  it('어릴수록 같은 잠재 여지에서 실현률이 낮다(24세 0.80, 21세 0.71, 18세 0.62, 16세 0.56)', () => {
    expect(realizationOf(24)).toBeCloseTo(0.8)
    expect(realizationOf(21)).toBeCloseTo(0.71)
    expect(realizationOf(18)).toBeCloseTo(0.62)
    expect(realizationOf(16)).toBeCloseTo(0.56)
  })
  it('27세 이상이나 잠재 여지가 없으면 지금 적합도 그대로의 수준이다', () => {
    expect(maturityFit(70, 27, 100, 160, lb)).toBeCloseTo(gainOf(70 - 73.3, lb.norm!))
    expect(maturityFit(70, 19, 140, 140, lb)).toBeCloseTo(gainOf(70 - 73.3, lb.norm!))
  })
  it('나이를 모르면 성장은 따지지 않고 지금 적합도로 보며, 나이 가치는 보통(0.5)이다', () => {
    const result = recommend(input({ age: null }), context())
    const maturity = result.components.find((each) => each.id === 'maturity')!
    const age = result.components.find((each) => each.id === 'age')!
    expect(maturity.note).toContain('나이를 알 수 없어')
    expect(age.assumed).toBe(true)
    expect(age.points).toBeCloseTo(age.max * 0.5, 1)
    expect(age.note).toContain('보통(0.5)')
  })
})

describe('나이 가치', () => {
  it('필드 선수는 24~29세, 골키퍼는 27~33세가 전성기다', () => {
    expect(ageFit(24, false)).toBe(1)
    expect(ageFit(29, false)).toBe(1)
    expect(ageFit(25, true)).toBeLessThan(1)
    expect(ageFit(31, true)).toBe(1)
    expect(ageFit(31, false)).toBeLessThan(1)
    expect(ageFit(33, true)).toBe(1)
  })
  it('어린 선수는 0.7에서 시작해 전성기로 오르고, 전성기가 지나면 해마다 떨어진다', () => {
    expect(ageFit(17, false)).toBe(0.7)
    expect(ageFit(18, false)).toBe(0.7)
    expect(ageFit(21, false)).toBeGreaterThan(0.7)
    expect(ageFit(21, false)).toBeLessThan(1)
    expect(ageFit(30, false)).toBeCloseTo(0.88)
    expect(ageFit(40, false)).toBe(0)
  })
})

describe('비용 부담', () => {
  it('팀 수준에 견준 곡선: 중간값의 절반 이하 1, 중간값 0.8, 팀 최고 0.2, 최고의 1.3배 0', () => {
    expect(affordability(10_000, 40_000, 150_000)).toBe(1)
    expect(affordability(20_000, 40_000, 150_000)).toBe(1)
    expect(affordability(40_000, 40_000, 150_000)).toBeCloseTo(0.8)
    expect(affordability(150_000, 40_000, 150_000)).toBeCloseTo(0.2)
    expect(affordability(195_000, 40_000, 150_000)).toBe(0)
    expect(affordability(300_000, 40_000, 150_000)).toBe(0)
  })
  it('중간값이 클수록 같은 금액이 덜 부담스럽다', () => {
    expect(affordability(60_000, 80_000, 200_000)).toBeGreaterThan(affordability(60_000, 40_000, 200_000))
  })
  it('팀이 거의 평평해도 곡선이 무너지지 않는다', () => {
    const flat = (amount: number): number => affordability(amount, 50_000, 50_000)
    expect(flat(50_000)).toBeCloseTo(0.8)
    expect(flat(60_000)).toBeCloseTo(0.2)
    expect(flat(100_000)).toBe(0)
  })
  it('팀 최고 주급보다 많이 받게 되면 크게 깎고 그렇다고 적는다', () => {
    const median = part('cost', { wage: 40_000 })
    const top = part('cost', { wage: 200_000 })
    expect(top.points).toBeLessThan(median.points)
    expect(top.note).toContain('가장 많이 받는')
  })
  it('주급이 중간값의 절반에도 못 미치면 그렇게 말한다', () => {
    expect(part('cost', { wage: 3_000 }).note).toContain('절반에도 못 미쳐')
    expect(part('cost', { wage: 60_000 }).note).toContain('1.5배')
  })
  it('몸값이 비쌀수록 점수가 낮다', () => {
    expect(part('cost', { value: 3_000_000 }).points).toBeGreaterThan(part('cost', { value: 40_000_000 }).points)
  })
  it('계약이 짧게 남으면 이적료가 내려간다고 본다', () => {
    const long = part('cost', { value: 30_000_000, contractEnd: 2031 * 1000 + 181 })
    const short = part('cost', { value: 30_000_000, contractEnd: 2026 * 1000 + 300 })
    expect(short.points).toBeGreaterThan(long.points)
    expect(short.note).toContain('계약이 짧아')
  })
  it('몸값을 모르면 그 쪽만 보통(0.5)으로 보고 주급은 그대로 본다', () => {
    const result = part('cost', { value: null })
    expect(result.counted).toBe(true)
    expect(result.assumed).toBe(true)
    expect(result.note).toContain('몸값은 정보가 없어 보통(0.5)')
  })
  it('주급을 모르면 그 쪽만 보통(0.5)으로 본다. 자유 계약이면 이적료 쪽은 1이다', () => {
    const noWage = part('cost', { wage: null })
    expect(noWage.counted).toBe(true)
    expect(noWage.assumed).toBe(true)
    expect(noWage.note).toContain('주급은 정보가 없어 보통(0.5)')
    const free = part('cost', { wage: null, hasClub: false })
    expect(free.points / free.max).toBeCloseTo(0.6 * 0.5 + 0.4 * 1, 1)
    expect(free.note).toContain('자유 계약')
  })
  it('내 팀 수준을 모르면 비용 전체를 보통(0.5)으로 본다', () => {
    const result = part('cost', {}, context({ money: null }))
    expect(result.assumed).toBe(true)
    expect(result.points / result.max).toBeCloseTo(0.5, 1)
  })
})

describe('내 팀의 주급·몸값 수준', () => {
  it('아는 선수가 8명 미만이면 믿을 수 없어 null', () => {
    expect(squadMoney([1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7])).toBeNull()
  })
  it('0은 모르는 값으로 빼고 중간값과 최고를 구한다', () => {
    const result = squadMoney([10, 20, 30, 40, 50, 60, 70, 80, 0, 0], [100, 200, 300, 400, 500, 600, 700, 800, 0])!
    expect(result.medianWage).toBe(45)
    expect(result.topWage).toBe(80)
    expect(result.medianValue).toBe(450)
    expect(result.topValue).toBe(800)
  })
  it('몸값을 아는 선수가 적으면 몸값 수준만 null', () => {
    const result = squadMoney([10, 20, 30, 40, 50, 60, 70, 80], [100, 200, 300])!
    expect(result.medianWage).toBe(45)
    expect(result.medianValue).toBeNull()
    expect(result.topValue).toBeNull()
  })
  it('홀수 명이면 가운데 값', () => {
    expect(squadMoney([1, 2, 3, 4, 5, 6, 7, 8, 9], [])!.medianWage).toBe(5)
  })
})

describe('영입 난이도', () => {
  it('자유 계약은 가장 쉽다', () => {
    const result = part('ease', { hasClub: false, contractEnd: null, squadStatus: 0 })
    expect(result.counted).toBe(true)
    expect(result.points).toBeCloseTo(result.max)
  })
  it('계약이 짧을수록 쉽다', () => {
    const f = (end: number): number => part('ease', { contractEnd: end, squadStatus: 0 }).points
    expect(f(2026 * 1000 + 250)).toBeGreaterThan(f(2027 * 1000 + 181))
    expect(f(2027 * 1000 + 181)).toBeGreaterThan(f(2030 * 1000 + 181))
  })
  it('핵심 선수는 어렵고 비주전은 쉽다', () => {
    const star = part('ease', { squadStatus: 1, contractEnd: null }).points
    const rotation = part('ease', { squadStatus: 4, contractEnd: null }).points
    const surplus = part('ease', { squadStatus: 7, contractEnd: null }).points
    expect(star).toBeLessThan(rotation)
    expect(rotation).toBeLessThan(surplus)
  })
  it('입지 표에 있는 모든 코드가 난이도를 가진다', () => {
    for (const code of Object.keys(SQUAD_STATUS_LABEL).map(Number)) expect(STATUS_EASE[code], String(code)).toBeGreaterThan(0)
  })
  it('계약과 입지를 모두 모르면 각각 보통(0.5)으로 보고 이유를 적는다(체급이 1이면 0.4·0.5 + 0.4·0.5 + 0.2)', () => {
    const result = part('ease', { contractEnd: null, squadStatus: 0 })
    expect(result.counted).toBe(true)
    expect(result.assumed).toBe(true)
    expect(result.points / result.max).toBeCloseTo(0.6, 1)
    expect(result.note).toContain('보통(0.5)')
  })
  it('하나만 몰라도 그 쪽을 보통(0.5)으로 보고 재분배하지 않는다', () => {
    expect(part('ease', { contractEnd: null, squadStatus: 7 }).assumed).toBe(true)
    expect(part('ease', { contractEnd: 2027 * 1000 + 10, squadStatus: 0 }).assumed).toBe(true)
    const known = part('ease', { contractEnd: 2026 * 1000 + 181, squadStatus: 7 })
    expect(known.assumed).toBe(false)
    expect(known.points / known.max).toBeCloseTo(0.4 * 1 + 0.4 * 0.95 + 0.2, 1)
  })
  it('체급: 내 약한 주전과 같거나 낮으면 1, 25 이상 높으면 0이고 그만큼 난이도가 깎인다', () => {
    expect(statureFit(125, 125)).toBe(1)
    expect(statureFit(100, 125)).toBe(1)
    expect(statureFit(137.5, 125)).toBeCloseTo(0.5)
    expect(statureFit(150, 125)).toBe(0)
    const same = part('ease', { ca: 125, squadStatus: 4 })
    const star = part('ease', { ca: 150, squadStatus: 4 })
    expect(same.points - star.points).toBeCloseTo(0.2 * same.max, 1)
    expect(star.note).toContain('체급')
    // 주전이 없으면 이 역할의 기준 능력(caRef)과 견준다
    expect(part('ease', { ca: FALLBACK_NORM.caRef + 25 }, context({ starter: null, backup: null })).note).toContain('25 높아')
  })
  it('오늘 날짜를 모르면 계약 기간은 못 센다(모르는 값으로 본다)', () => {
    expect(part('ease', { squadStatus: 0 }, context({ today: null })).assumed).toBe(true)
  })
})

describe('신뢰성', () => {
  const all = (value: number | null): Traits => ({ consistency: value, injuryProneness: value, importantMatches: value, naturalFitness: value, determination: value, dirtiness: value })
  it('좋은 값은 1, 나쁜 값은 0이고 부상 빈도와 비매너는 뒤집어 본다', () => {
    const best: Traits = { ...all(20), injuryProneness: 1, dirtiness: 1 }
    const worst: Traits = { ...all(1), injuryProneness: 20, dirtiness: 20 }
    expect(reliabilityFit(best)).toBe(1)
    expect(reliabilityFit(worst)).toBe(0)
  })
  it('부상 빈도가 낮을수록 점수가 높다', () => {
    expect(reliabilityFit({ ...goodTraits, injuryProneness: 3 })!).toBeGreaterThan(reliabilityFit({ ...goodTraits, injuryProneness: 17 })!)
  })
  it('일부 값만 알면 아는 값으로, 하나도 모르면 null이고 점수에서는 보통(0.5)이다', () => {
    expect(reliabilityFit({ ...all(null), consistency: 20 })).toBe(1)
    expect(reliabilityFit(all(null))).toBeNull()
    const result = part('reliability', { traits: all(null) })
    expect(result.counted).toBe(true)
    expect(result.assumed).toBe(true)
    expect(result.points / result.max).toBeCloseTo(0.5, 1)
  })
})

describe('daysUntil', () => {
  it('연도와 연중 일수로 남은 일수를 센다', () => {
    expect(daysUntil(2027 * 1000 + 1, { year: 2026, day: 1 })).toBe(365)
    expect(daysUntil(2026 * 1000 + 100, { year: 2026, day: 40 })).toBe(60)
    expect(daysUntil(2026 * 1000 + 10, { year: 2026, day: 40 })).toBe(-30)
  })
})

describe('모르는 값은 점수를 부풀리지 않는다', () => {
  it('계약 만료일·입지를 모르는 선수의 총점은 같은 값(0.5)을 아는 선수와 정확히 같다', () => {
    // 계약 730일 남음(0.5)과 입지 "주전"(0.5)이면 난이도가 정확히 0.5다
    const known = recommend(input({ contractEnd: 2028 * 1000 + 181, squadStatus: 3 }), context())
    const unknown = recommend(input({ contractEnd: null, squadStatus: 0 }), context())
    expect(unknown.total).toBe(known.total)
    expect(unknown.components.find((each) => each.id === 'ease')!.assumed).toBe(true)
  })
  it('모르는 값이 있어도 항목은 모두 들어가고 최대 점수의 합은 100이다', () => {
    const result = recommend(input({ age: null, wage: null, contractEnd: null, squadStatus: 0 }), context())
    const max = result.components.reduce((sum, each) => sum + each.max, 0)
    expect(max).toBeGreaterThan(99.6)
    expect(max).toBeLessThan(100.4)
    expect(result.components.every((each) => each.counted)).toBe(true)
    expect(result.components.filter((each) => each.assumed).map((each) => each.id)).toEqual(expect.arrayContaining(['age', 'cost', 'ease']))
  })
})

describe('합계', () => {
  it('항목 점수의 합이 base이고 total = base × 포지션 보정이다', () => {
    for (const category of CATEGORIES) {
      for (const roleRating of [20, 17, 12, 5]) {
        const result = recommend(input({ category, roleRating }), context())
        const max = result.components.reduce((sum, each) => sum + each.max, 0)
        const points = result.components.reduce((sum, each) => sum + each.points, 0)
        expect(max, category).toBeGreaterThan(99.6)
        expect(max, category).toBeLessThan(100.4)
        expect(Math.abs(points - result.base), category).toBeLessThan(0.5)
        expect(Math.abs(result.base * result.gate - result.total), category).toBeLessThan(0.06)
        expect(result.total).toBeGreaterThanOrEqual(0)
        expect(result.total).toBeLessThanOrEqual(100)
        expect(result.components.map((each) => each.id)).toEqual(COMPONENT_ORDER)
      }
    }
  })
  it('모든 항목이 만점이면 높고 모두 나쁘면 낮다', () => {
    const perfect = recommend(
      input({
        category: 'starter',
        roleScore: 100,
        roleRating: 20,
        age: 19,
        ca: 100,
        pa: 200,
        wage: 10_000,
        value: 1_000_000,
        hasClub: false,
        traits: { consistency: 20, injuryProneness: 1, importantMatches: 20, naturalFitness: 20, determination: 20, dirtiness: 1 }
      }),
      context({ starter: { score: 40, ca: 100 }, backup: { score: 30 } })
    )
    expect(perfect.total).toBeGreaterThan(85)
    const poor = recommend(
      input({
        category: 'starter',
        roleScore: 10,
        roleRating: 1,
        age: 38,
        wage: 400_000,
        value: 90_000_000,
        squadStatus: 1,
        contractEnd: 2032 * 1000 + 1,
        traits: { consistency: 1, injuryProneness: 20, importantMatches: 1, naturalFitness: 1, determination: 1, dirtiness: 20 }
      }),
      context()
    )
    expect(poor.total).toBeLessThan(10)
  })
  it('설명 글 없이 계산해도 점수는 같고 글만 비어 있다', () => {
    for (const category of CATEGORIES) {
      const full = recommend(input({ category }), context())
      const fast = recommend(input({ category }), context(), false)
      expect(fast.total).toBe(full.total)
      expect(fast.base).toBe(full.base)
      expect(fast.components.map((each) => each.points)).toEqual(full.components.map((each) => each.points))
      expect(fast.components.every((each) => each.note === '')).toBe(true)
      expect(full.components.every((each) => each.note.length > 0)).toBe(true)
    }
  })
  it('역할 점수가 높을수록 추천 점수도 높다', () => {
    let last = -1
    for (const score of [30, 45, 60, 70, 80, 95]) {
      const total = recommend(input({ roleScore: score }), context()).total
      expect(total).toBeGreaterThan(last)
      last = total
    }
  })
})

describe('단조성(무작위 1,000건)', () => {
  const random = rng(7)
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)]
  const randomCase = (): { input: RecommendInput; ctx: RecommendContext } => ({
    input: input({
      category: pick(CATEGORIES),
      goalkeeper: random() < 0.1,
      roleScore: 40 + random() * 50,
      roleRating: 1 + Math.floor(random() * 20),
      age: 17 + Math.floor(random() * 20),
      ca: 80 + Math.floor(random() * 90),
      pa: 100 + Math.floor(random() * 80),
      value: random() < 0.1 ? null : 1_000_000 + random() * 80_000_000,
      wage: random() < 0.1 ? null : 5_000 + random() * 300_000,
      contractEnd: random() < 0.1 ? null : (2026 + Math.floor(random() * 5)) * 1000 + 1 + Math.floor(random() * 364),
      squadStatus: pick([0, 1, 2, 3, 4, 7]),
      hasClub: random() < 0.9
    }),
    ctx: context({
      starter: random() < 0.1 ? null : { name: '주전', score: 55 + random() * 25, ca: 110 + Math.floor(random() * 60), age: 20 + Math.floor(random() * 17) },
      backup: random() < 0.2 ? null : { score: 45 + random() * 25 },
      need: random() < 0.3 ? null : random() * 100,
      norm: { mu: 70 + random() * 6, sigma: 2.5 + random() * 3.5, beta: 0.2 + random() * 0.15, n: 50, caRef: 150 }
    })
  })

  it('적합도가 오르면 모든 유형에서 총점이 줄지 않는다', () => {
    for (let i = 0; i < 1000; i++) {
      const { input: base, ctx } = randomCase()
      const better = recommend({ ...base, roleScore: base.roleScore + 0.1 + random() * 10 }, ctx, false).total
      expect(better, `score ${i}`).toBeGreaterThanOrEqual(recommend(base, ctx, false).total)
    }
  })
  it('잠재 능력이 오르면 총점이 줄지 않는다', () => {
    for (let i = 0; i < 1000; i++) {
      const { input: base, ctx } = randomCase()
      const higher = recommend({ ...base, pa: base.pa + 1 + Math.floor(random() * 30) }, ctx, false).total
      expect(higher, `pa ${i}`).toBeGreaterThanOrEqual(recommend(base, ctx, false).total)
    }
  })
  it('31세 이상에서 나이가 오르면 총점이 늘지 않는다', () => {
    for (let i = 0; i < 1000; i++) {
      const { input: base, ctx } = randomCase()
      const old = { ...base, age: 31 + Math.floor(random() * 6) }
      const older = recommend({ ...old, age: old.age + 1 }, ctx, false).total
      expect(older, `age ${i}`).toBeLessThanOrEqual(recommend(old, ctx, false).total + 1e-9)
    }
  })
  it('숙련이 오르면 총점이 줄지 않는다', () => {
    for (let i = 0; i < 1000; i++) {
      const { input: base, ctx } = randomCase()
      const trained = recommend({ ...base, roleRating: Math.min(20, (base.roleRating ?? 1) + 1) }, ctx, false).total
      expect(trained, `rating ${i}`).toBeGreaterThanOrEqual(recommend(base, ctx, false).total)
    }
  })
  it('나이 가치는 18세에서 24세까지 줄지 않고, 주급이 오르면 비용 점수가 늘지 않는다', () => {
    for (let age = 18; age < 24; age++) expect(ageFit(age + 1, false)).toBeGreaterThanOrEqual(ageFit(age, false))
    for (let i = 0; i < 1000; i++) {
      const { input: base, ctx } = randomCase()
      if (!ctx.money) continue
      const cost = (wage: number): number => recommend({ ...base, wage }, ctx, false).components.find((each) => each.id === 'cost')!.points
      const wage = 5_000 + random() * 300_000
      expect(cost(wage * 1.5)).toBeLessThanOrEqual(cost(wage) + 1e-9)
    }
  })
  it('어떤 입력에서도 0~100이고 NaN이 없다(주전·후보 없음, 골키퍼, 자유 계약, 모르는 값)', () => {
    for (let i = 0; i < 1000; i++) {
      const { input: base, ctx } = randomCase()
      const result = recommend(base, ctx)
      expect(Number.isFinite(result.total)).toBe(true)
      expect(result.total).toBeGreaterThanOrEqual(0)
      expect(result.total).toBeLessThanOrEqual(100)
      for (const each of result.components) expect(Number.isFinite(each.points)).toBe(true)
    }
  })
})

describe('유형에 따른 차이', () => {
  const youngster = input({ age: 19, ca: 90, pa: 160, roleScore: 62 })
  const veteran = input({ age: 29, ca: 140, pa: 140, roleScore: 80 })
  it('즉시 전력감 유형에서는 즉시 쓸 수 있는 선수가 앞서고, 유망주 유형에서는 같은 지금 적합도라면 잠재가 높은 어린 선수가 앞선다', () => {
    const ctx = context({ starter: { score: 60, ca: 120 }, backup: { score: 50 } })
    expect(recommend({ ...veteran, category: 'starter' }, ctx).total).toBeGreaterThan(recommend({ ...youngster, category: 'starter' }, ctx).total)
    expect(recommend({ ...youngster, pa: 170, category: 'prospect' }, ctx).total).toBeGreaterThan(recommend({ ...youngster, pa: 120, category: 'prospect' }, ctx).total)
  })
  it('자유 계약 유형은 비용과 난이도를 보지 않는다', () => {
    const result = recommend(input({ category: 'free', hasClub: false, wage: null }), context())
    for (const id of ['cost', 'ease'] as const) {
      const each = result.components.find((component) => component.id === id)!
      expect(each.counted).toBe(false)
      expect(each.max).toBe(0)
      expect(each.note).toContain('이 유형에서는')
    }
  })
})

describe('자리의 보강 필요도', () => {
  const immediateMax = (need: number | null): number => recommend(input(), context({ need })).components.find((each) => each.id === 'immediate')!.max
  it('필요도가 높을수록 즉시 전력의 비중이 커지고 낮을수록 줄어든다(0.8~1.2배)', () => {
    expect(immediateMax(100)).toBeGreaterThan(immediateMax(50))
    expect(immediateMax(50)).toBeGreaterThan(immediateMax(0))
    expect(immediateMax(50)).toBeCloseTo(immediateMax(null), 5)
    expect(NEED_WEIGHT_LOW).toBe(0.8)
    expect(NEED_WEIGHT_HIGH).toBe(1.2)
  })
  it('비중이 바뀌어도 최대 점수의 합은 100이다', () => {
    for (const need of [0, 25, 50, 75, 100]) {
      const sum = recommend(input(), context({ need })).components.reduce((total, each) => total + each.max, 0)
      expect(sum).toBeGreaterThan(99.6)
      expect(sum).toBeLessThan(100.4)
    }
  })
  it('필요도가 높은 자리에서는 같은 업그레이드가 더 높은 점수를 받는다', () => {
    const upgrade = input({ roleScore: 80 })
    expect(recommend(upgrade, context({ need: 90 })).total).toBeGreaterThan(recommend(upgrade, context({ need: 10 })).total)
  })
  it('필요도를 반영했다는 말이 설명에 들어간다', () => {
    expect(part('immediate', {}, context({ need: 90 })).note).toContain('비중을 키웠')
    expect(part('immediate', {}, context({ need: 10 })).note).toContain('비중을 줄였')
    expect(part('immediate', {}, context({ need: 50 })).note).not.toContain('비중')
  })
})

describe('설명 글', () => {
  it('즉시 전력은 주전과 두 번째 선수와의 차이를 수로 말한다', () => {
    const note = part('immediate', { roleScore: 70.2 }).note
    expect(note).toContain('내 주전(66.0점)보다 4.2점 높습니다')
    expect(note).toContain('두 번째 선수(58.0점)')
  })
  it('주전이 없으면 그렇게 적는다', () => {
    expect(part('immediate', {}, context({ starter: null, backup: null })).note).toContain('뛸 선수가 없어')
  })
  it('나이 가치는 전성기 범위를 적는다', () => {
    expect(part('age', { age: 31 }).note).toContain('24~29세')
    expect(part('age', { age: 31, goalkeeper: true }).note).toContain('27~33세')
  })
  it('성숙 시 전력은 나이, 잠재, 예상 적합도와 실현률을 적는다', () => {
    const note = part('maturity', { age: 20, ca: 100, pa: 150, roleScore: 60 }, context({ starter: { score: 60, ca: 110 }, backup: null })).note
    expect(note).toContain('20세, 잠재 150')
    expect(note).toContain('적합도 약')
    expect(note).toContain('실현률 0.68')
  })
})

describe('경고(점수에는 넣지 않는다)', () => {
  const ctx = context({ starter: { score: 66, ca: 125 } })
  it('핵심·중요·주전 입지면 데려오기 어렵다고 알린다', () => {
    for (const status of [1, 2, 3]) expect(warningsOf(input({ squadStatus: status }), ctx).join()).toContain('중요한 선수')
    expect(warningsOf(input({ squadStatus: 4 }), ctx).join()).not.toContain('중요한 선수')
    expect(warningsOf(input({ squadStatus: 1, hasClub: false }), ctx)).toEqual([])
  })
  it('현재 능력이 내 주전보다 10 이상 높으면, 계약이 4년 이상 남으면 알린다', () => {
    expect(warningsOf(input({ ca: 135, squadStatus: 4 }), ctx).join()).toContain('큰 구단의 핵심')
    expect(warningsOf(input({ ca: 134, squadStatus: 4 }), ctx).join()).not.toContain('큰 구단의 핵심')
    expect(warningsOf(input({ contractEnd: 2030 * 1000 + 181, squadStatus: 4 }), ctx).join()).toContain('계약이 길게 남아')
  })
  it('경고 문구 자체는 점수에 넣지 않는다(설명 글 없이 계산해도 같다). 현재 능력 격차는 체급으로만 난이도에 들어간다', () => {
    const a = recommend(input({ squadStatus: 4, contractEnd: 2028 * 1000 + 181 }), ctx)
    const b = recommend(input({ squadStatus: 4, contractEnd: 2028 * 1000 + 181, ca: 200, pa: 205 }), ctx)
    expect(b.warnings.length).toBeGreaterThan(a.warnings.length)
    expect(recommend(input({ ca: 200, pa: 205 }), ctx, false).total).toBe(recommend(input({ ca: 200, pa: 205 }), ctx).total)
    const easeOf = (r: typeof a): number => r.components.find((each) => each.id === 'ease')!.points
    expect(easeOf(b)).toBeLessThan(easeOf(a))
  })
})

describe('등급(같은 유형의 자격 후보 안에서의 순위, 올림 인원)', () => {
  const grades = (totals: number[]): Record<string, number> => {
    const tier = tierRanker(totals)
    const count: Record<string, number> = { top: 0, good: 0, maybe: 0, low: 0 }
    for (const total of totals) count[tier(total)]++
    return count
  }
  it('후보 1,000명이면 상위 50명 강력 추천, 다음 150명 추천, 다음 300명 고려, 나머지 보류', () => {
    const totals = Array.from({ length: 1000 }, (_, i) => 99.9 - i * 0.04)
    expect(grades(totals)).toEqual({ top: 50, good: 150, maybe: 300, low: 500 })
  })
  it('인원 경계: k1 = max(1, ⌈0.05n⌉), k2 = max(k1+1, ⌈0.20n⌉), k3 = max(k2+1, ⌈0.50n⌉)', () => {
    expect(tierCutoffs(1)).toEqual([1, 2, 3])
    expect(tierCutoffs(5)).toEqual([1, 2, 3])
    expect(tierCutoffs(21)).toEqual([2, 5, 11])
    expect(tierCutoffs(100)).toEqual([5, 20, 50])
  })
  it('후보 5명(70.8, 66.9, 61.0, 58.9, 55.9)이면 강력 추천, 추천, 고려, 보류, 보류(60 미만은 보류)', () => {
    const tier = tierRanker([70.8, 66.9, 61.0, 58.9, 55.9])
    expect([70.8, 66.9, 61.0, 58.9, 55.9].map(tier)).toEqual(['top', 'good', 'maybe', 'low', 'low'])
  })
  it('점수가 60 미만이면 순위가 높아도 보류이고, 후보 한 명이면 60 이상일 때 강력 추천이다', () => {
    expect(tierRanker([59.9])(59.9)).toBe('low')
    expect(tierRanker([TIER_MIN_TOTAL])(TIER_MIN_TOTAL)).toBe('top')
    expect(tierRanker([80])(80)).toBe('top')
    expect(grades([58, 57, 56, 55])).toEqual({ top: 0, good: 0, maybe: 0, low: 4 })
    expect(TIER_MIN_TOTAL).toBe(60)
  })
  it('점수가 같으면 같은 순위, 같은 등급이다', () => {
    const tier = tierRanker([70, 70, 70, 60, 60, 55])
    expect(tier(70)).toBe('top')
    const ties = tierRanker([80, 80, 80, 80, 80, 80, 80, 80, 80, 80])
    expect(ties(80)).toBe('top')
  })
})

describe('2회차 검토 시나리오(검토 보고서 4.1, 값은 ±1점)', () => {
  const norm: RoleNorm = { mu: 74.4, sigma: 3.15, beta: 0.265, n: 49, caRef: 153 }
  const reviewMoney = { medianWage: 140_000, topWage: 350_000, medianValue: 49_313_267, topValue: 184_863_648 }
  const candidate = (category: CandidateCategory, patch: Partial<RecommendInput> = {}): RecommendInput =>
    input({
      category,
      roleScore: 75,
      roleRating: 20,
      age: 25,
      ca: 150,
      pa: 150,
      value: 40_000_000,
      wage: 100_000,
      contractEnd: 2028 * 1000 + 180,
      squadStatus: 4,
      traits: { consistency: 14, injuryProneness: 8, importantMatches: 14, naturalFitness: 13, determination: 14, dirtiness: 8 },
      ...patch
    })
  // 센터백 2: 주전 f76(CA 157, 26세), 백업 72.5, 필요도 22.4
  const cb2 = (patch: Partial<RecommendContext> = {}): RecommendContext => ({
    starter: { name: '주전', score: 76, ca: 157, age: 26 },
    backup: { score: 72.5 },
    today: { year: 2026, day: 15 },
    money: reviewMoney,
    need: 22.4,
    norm,
    ...patch
  })
  // 센터백 1: 주전 34세 f81.5 → 기준선 78.5, 백업 72.5, 필요도 25.3
  const cb1: RecommendContext = cb2({ starter: { name: '노장', score: 81.5, ca: 175, age: 34 }, need: 25.3 })
  const total = (category: CandidateCategory, patch: Partial<RecommendInput>, ctx: RecommendContext): number => recommend(candidate(category, patch), ctx, false).total

  it('1. 유망주 탭에서 지금 적합도가 오르면 총점이 오른다(18세 CA140/PA170, f 60~86)', () => {
    const expected = new Map([[60, 35.3], [64, 36.9], [68, 44.2], [72, 61.7], [76, 77.4], [80, 84.0], [86, 86.0]])
    let last = -1
    for (const [f, want] of expected) {
      const got = total('prospect', { age: 18, ca: 140, pa: 170, roleScore: f }, cb2())
      expect(Math.abs(got - want), `f ${f}: ${got}`).toBeLessThanOrEqual(1)
      expect(got).toBeGreaterThanOrEqual(last)
      last = got
    }
  })
  it('2. 18세 CA165/PA183이 16세 CA91보다 위다(63.6 > 59.8 > 40.6)', () => {
    const a = total('prospect', { age: 18, ca: 165, pa: 183, roleScore: 74 }, cb2())
    const b = total('prospect', { age: 18, ca: 154, pa: 168, roleScore: 73.8 }, cb2())
    const c = total('prospect', { age: 16, ca: 91, pa: 160, roleScore: 61.5 }, cb2())
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)
    expect(Math.abs(a - 63.6)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(b - 59.8)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(c - 40.6)).toBeLessThanOrEqual(1.5)
  })
  it('3. 숙련 16·f80이 숙련 20·f78보다 높다(전체 탭: 76.3, 79.8, 79.0, 82.3, 49.7)', () => {
    const cases: Array<[number, number, number]> = [[20, 78, 76.3], [16, 80, 79.8], [15, 80, 79.0], [12, 84, 82.3], [8, 84, 49.7]]
    const got = cases.map(([roleRating, roleScore]) => total('all', { roleRating, roleScore }, cb2()))
    cases.forEach(([, , want], i) => expect(Math.abs(got[i] - want), `case ${i}: ${got[i]}`).toBeLessThanOrEqual(1.5))
    expect(got[1]).toBeGreaterThan(got[0])
  })
  it('4. 주전이 34세인 자리: 같은 f80 후보가 나이가 많을수록 점수가 내려간다(74.0, 71.5, 59.4, 53.4, 42.8)', () => {
    const want = [74.0, 71.5, 59.4, 53.4, 42.8]
    const got = [25, 31, 33, 34, 36].map((age) => total('starter', { age, ca: 165, pa: 165, roleScore: 80 }, cb1))
    want.forEach((value, i) => expect(Math.abs(got[i] - value), `age case ${i}: ${got[i]}`).toBeLessThanOrEqual(1.5))
    for (let i = 1; i < got.length; i++) expect(got[i]).toBeLessThan(got[i - 1])
  })
  it('9. 경계: 자유 계약, 몸값 0, 주급 0, 골키퍼, 주전·후보 없음에서 예외 없이 0~100이다', () => {
    const cases: Array<[Partial<RecommendInput>, RecommendContext]> = [
      [{ hasClub: false, value: null, wage: null, contractEnd: null, squadStatus: 0 }, cb2()],
      [{ value: 0, wage: 0 }, cb2()],
      [{ goalkeeper: true, age: 34 }, cb2()],
      [{}, cb2({ starter: null, backup: null })],
      [{ age: null, roleRating: null }, cb2({ starter: null, backup: null, money: null, today: null })]
    ]
    for (const [patch, ctx] of cases) {
      const result = recommend(candidate('all', patch), ctx)
      expect(Number.isFinite(result.total)).toBe(true)
      expect(result.total).toBeGreaterThanOrEqual(0)
      expect(result.total).toBeLessThanOrEqual(100)
    }
    const free = recommend(candidate('all', { hasClub: false, value: null, wage: null, contractEnd: null }), cb2())
    expect(free.components.find((each) => each.id === 'ease')!.points / free.components.find((each) => each.id === 'ease')!.max).toBe(1)
    expect(free.components.find((each) => each.id === 'cost')!.assumed).toBe(true)
    // 주전이 없으면 기준은 이 역할 상위권 평균이다(주전·후보 없음 → 평균과 같으면 0.5)
    const none = cb2({ starter: null, backup: null })
    expect(immediateFit(norm.mu, none, 'all')).toBeCloseTo(0.5)
  })
})
