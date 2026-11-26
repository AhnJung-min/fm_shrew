import { describe, expect, it } from 'vitest'
import {
  ABSOLUTE_FLOOR,
  ABSOLUTE_TOP,
  affordability,
  ageFit,
  COMPONENT_ORDER,
  daysUntil,
  growthFit,
  immediateFit,
  interpolate,
  NEED_WEIGHT_HIGH,
  NEED_WEIGHT_LOW,
  positionFit,
  RECOMMEND_WEIGHTS,
  recommend,
  reliabilityFit,
  squadMoney,
  STARTER_SHARE,
  STATUS_EASE,
  type ComponentId,
  type RecommendContext,
  type RecommendInput,
  type Traits
} from '../src/shared/recommend'
import { SQUAD_STATUS_LABEL, type CandidateCategory } from '../src/shared/world'

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
  starter: { score: 66, ca: 125 },
  backup: { score: 58 },
  today: { year: 2026, day: 181 },
  money,
  ...patch
})

const part = (id: ComponentId, patch: Partial<RecommendInput> = {}, ctx: RecommendContext = context()) =>
  recommend(input(patch), ctx).components.find((each) => each.id === id)!

describe('가중치 표', () => {
  it('유형마다 합이 100이다', () => {
    for (const category of CATEGORIES) {
      const sum = COMPONENT_ORDER.reduce((total, id) => total + RECOMMEND_WEIGHTS[category][id], 0)
      expect(sum, category).toBe(100)
    }
  })
  it('유형마다 중요하게 보는 항목이 다르다', () => {
    expect(RECOMMEND_WEIGHTS.starter.immediate).toBeGreaterThan(RECOMMEND_WEIGHTS.prospect.immediate)
    expect(RECOMMEND_WEIGHTS.prospect.growth).toBeGreaterThan(RECOMMEND_WEIGHTS.starter.growth)
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

describe('즉시 전력', () => {
  const both = { starter: { score: 60, ca: 120 }, backup: { score: 50 } }
  it('주전과 같으면 0.5, 크게 앞서면 1에 가깝고 크게 뒤지면 0에 가깝다', () => {
    expect(immediateFit(60, { starter: both.starter, backup: null }, 'all')).toBeCloseTo(0.5)
    expect(immediateFit(75, { starter: both.starter, backup: null }, 'all')).toBeGreaterThan(0.95)
    expect(immediateFit(40, { starter: both.starter, backup: null }, 'all')).toBeLessThan(0.05)
  })
  it('격차가 클수록 좋지만 점점 덜 오른다(수확 체감)', () => {
    const f = (score: number): number => immediateFit(score, { starter: both.starter, backup: null }, 'all')
    expect(f(68) - f(60)).toBeGreaterThan(f(76) - f(68))
    expect(f(61)).toBeGreaterThan(f(60))
  })
  it('내 팀에 그 자리를 뛸 선수가 없으면 점수 자체를 40~80 구간으로 본다', () => {
    const none = { starter: null, backup: null }
    expect(immediateFit(ABSOLUTE_FLOOR, none, 'all')).toBe(0)
    expect(immediateFit(ABSOLUTE_TOP, none, 'all')).toBe(1)
    expect(immediateFit(60, none, 'all')).toBeCloseTo(0.5)
  })
  it('두 번째 선수가 없으면 주전과만 견준다', () => {
    expect(immediateFit(66, { starter: both.starter, backup: null }, 'rotation')).toBe(immediateFit(66, { starter: both.starter, backup: null }, 'starter'))
  })
  it('교체 자원을 찾을 때는 두 번째 선수를 넘는지를 더 본다', () => {
    // 주전보다 낮고 두 번째보다 높은 선수
    const rotation = immediateFit(55, both, 'rotation')
    const starter = immediateFit(55, both, 'starter')
    expect(rotation).toBeGreaterThan(starter)
    expect(STARTER_SHARE.rotation).toBeLessThan(STARTER_SHARE.starter)
  })
})

describe('포지션 숙련', () => {
  it('자연스러운 자리가 가장 좋고 능숙, 겨우 뛰는 자리 순', () => {
    expect(positionFit(20)).toBe(1)
    expect(positionFit(19)).toBeCloseTo(0.9)
    expect(positionFit(15)).toBeCloseTo(0.6)
    expect(positionFit(14)).toBeLessThan(0.35)
    expect(positionFit(1)).toBeGreaterThan(0)
    expect(positionFit(20)).toBeGreaterThan(positionFit(17))
    expect(positionFit(17)).toBeGreaterThan(positionFit(15))
    expect(positionFit(15)).toBeGreaterThan(positionFit(14))
  })
  it('숙련도를 모르면 점수에서 빼고 이유를 적는다', () => {
    const result = part('position', { roleRating: null })
    expect(result.counted).toBe(false)
    expect(result.note).toContain('반영하지 않았습니다')
  })
})

describe('성장 가능성', () => {
  it('어릴수록, 잠재 여유가 클수록 크고 28세부터는 0이다', () => {
    expect(growthFit(19, 100, 140, null)).toBe(1)
    expect(growthFit(18, 100, 160, null)).toBe(1)
    expect(growthFit(28, 100, 160, null)).toBe(0)
    expect(growthFit(33, 100, 160, null)).toBe(0)
    expect(growthFit(19, 100, 120, null)).toBeCloseTo(0.5)
    expect(growthFit(21, 100, 140, null)).toBeGreaterThan(growthFit(25, 100, 140, null))
    expect(growthFit(23, 100, 100, null)).toBe(0)
  })
  it('성장해도 내 주전의 현재 능력을 못 넘으면 인정하지 않는다', () => {
    expect(growthFit(19, 80, 120, 150)).toBe(0)
    expect(growthFit(19, 80, 120, 100)).toBe(1)
    expect(growthFit(19, 80, 120, 115)).toBeGreaterThan(0)
    expect(growthFit(19, 80, 120, 115)).toBeLessThan(1)
  })
  it('나이를 모르면 성장과 나이 항목을 모두 뺀다', () => {
    const result = recommend(input({ age: null }), context())
    expect(result.components.find((each) => each.id === 'growth')!.counted).toBe(false)
    expect(result.components.find((each) => each.id === 'age')!.counted).toBe(false)
  })
  it('28세 이상은 0점이지만 반영은 한다', () => {
    const result = part('growth', { age: 30 })
    expect(result.counted).toBe(true)
    expect(result.points).toBe(0)
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
  it('몸값을 모르면 주급만 본다', () => {
    const result = part('cost', { value: null })
    expect(result.counted).toBe(true)
    expect(result.note).toContain('주급만')
  })
  it('내 팀 수준이나 선수의 주급을 모르면 빼고 이유를 적는다', () => {
    expect(part('cost', {}, context({ money: null })).counted).toBe(false)
    const noWage = part('cost', { wage: null })
    expect(noWage.counted).toBe(false)
    expect(noWage.note).toContain('반영하지 않았습니다')
    const free = part('cost', { wage: null, hasClub: false })
    expect(free.counted).toBe(false)
    expect(free.note).toContain('자유 계약')
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
  it('계약과 입지를 모두 모르면 빼고 이유를 적는다', () => {
    const result = part('ease', { contractEnd: null, squadStatus: 0 })
    expect(result.counted).toBe(false)
    expect(result.note).toContain('반영하지 않았습니다')
  })
  it('하나만 알면 그것으로 본다', () => {
    expect(part('ease', { contractEnd: null, squadStatus: 7 }).counted).toBe(true)
    expect(part('ease', { contractEnd: 2027 * 1000 + 10, squadStatus: 0 }).counted).toBe(true)
  })
  it('오늘 날짜를 모르면 계약 기간은 못 센다', () => {
    const result = part('ease', { squadStatus: 0 }, context({ today: null }))
    expect(result.counted).toBe(false)
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
  it('일부 값만 알면 아는 값으로, 하나도 모르면 null', () => {
    expect(reliabilityFit({ ...all(null), consistency: 20 })).toBe(1)
    expect(reliabilityFit(all(null))).toBeNull()
    const result = part('reliability', { traits: all(null) })
    expect(result.counted).toBe(false)
  })
})

describe('daysUntil', () => {
  it('연도와 연중 일수로 남은 일수를 센다', () => {
    expect(daysUntil(2027 * 1000 + 1, { year: 2026, day: 1 })).toBe(365)
    expect(daysUntil(2026 * 1000 + 100, { year: 2026, day: 40 })).toBe(60)
    expect(daysUntil(2026 * 1000 + 10, { year: 2026, day: 40 })).toBe(-30)
  })
})

describe('합계와 다시 나누기', () => {
  it('모든 값을 알면 항목 최대 점수의 합이 100이고 합계는 항목 점수의 합이다', () => {
    for (const category of CATEGORIES) {
      const result = recommend(input({ category }), context())
      const max = result.components.reduce((sum, each) => sum + each.max, 0)
      const points = result.components.reduce((sum, each) => sum + each.points, 0)
      expect(max, category).toBeGreaterThan(99.6)
      expect(max, category).toBeLessThan(100.4)
      expect(Math.abs(points - result.total), category).toBeLessThan(0.5)
      expect(result.total).toBeGreaterThanOrEqual(0)
      expect(result.total).toBeLessThanOrEqual(100)
      expect(result.components.map((each) => each.id)).toEqual(COMPONENT_ORDER)
    }
  })
  it('모르는 항목을 빼도 남은 항목의 최대 점수 합은 100이다', () => {
    const result = recommend(input({ age: null, wage: null, contractEnd: null, squadStatus: 0 }), context())
    const skipped = result.components.filter((each) => !each.counted).map((each) => each.id)
    expect(skipped).toEqual(expect.arrayContaining(['growth', 'age', 'cost', 'ease']))
    const max = result.components.reduce((sum, each) => sum + each.max, 0)
    expect(max).toBeGreaterThan(99.6)
    expect(max).toBeLessThan(100.4)
    for (const each of result.components.filter((component) => !component.counted)) {
      expect(each.points).toBe(0)
      expect(each.max).toBe(0)
      expect(each.note).toMatch(/반영하지 않/)
    }
  })
  it('모든 항목이 만점이면 100, 모두 0이면 0에 가깝다', () => {
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

describe('유형에 따른 차이', () => {
  const youngster = input({ age: 19, ca: 90, pa: 160, roleScore: 50 })
  const veteran = input({ age: 29, ca: 140, pa: 140, roleScore: 80 })
  it('유망주 유형에서는 성장하는 어린 선수가 앞서고 즉시 전력감 유형에서는 즉시 쓸 수 있는 선수가 앞선다', () => {
    const ctx = context({ starter: { score: 60, ca: 120 }, backup: { score: 50 } })
    const prospectYoung = recommend({ ...youngster, category: 'prospect' }, ctx).total
    const prospectVet = recommend({ ...veteran, category: 'prospect' }, ctx).total
    expect(prospectYoung).toBeGreaterThan(prospectVet)
    const starterYoung = recommend({ ...youngster, category: 'starter' }, ctx).total
    const starterVet = recommend({ ...veteran, category: 'starter' }, ctx).total
    expect(starterVet).toBeGreaterThan(starterYoung)
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
  it('필요도가 높을수록 즉시 전력의 비중이 커지고 낮을수록 줄어든다', () => {
    expect(immediateMax(100)).toBeGreaterThan(immediateMax(50))
    expect(immediateMax(50)).toBeGreaterThan(immediateMax(0))
    expect(immediateMax(50)).toBeCloseTo(immediateMax(null), 0)
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
    expect(NEED_WEIGHT_LOW).toBeLessThan(1)
    expect(NEED_WEIGHT_HIGH).toBeGreaterThan(1)
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
  it('성장은 잠재 여유를 적는다', () => {
    expect(part('growth', { age: 20, ca: 100, pa: 150 }, context({ starter: { score: 60, ca: 110 }, backup: null })).note).toContain('50 높습니다')
  })
})
