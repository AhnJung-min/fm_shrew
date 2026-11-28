import { describe, expect, it } from 'vitest'
import { K, withLedger } from '../src/shared/ledger'
import { SHARE_SCALE } from '../src/shared/limits'
import { posPenaltySigma } from '../src/shared/positions'
import { prepareWeights, savedRoleScore, scoreRole, type AttributeValue } from '../src/shared/roles'
import {
  compositeWeights,
  defaultSharePct,
  gateRatingOf,
  groupIdOf,
  isSinglePhase,
  mixedPenaltySigma,
  penaltySigmaOf,
  shareLabel,
  type SlotProfile,
  type Weights
} from '../src/shared/slotProfile'
import { SAVE_ATTRIBUTE_ORDER } from '../src/shared/world'

/** 같은 씨앗이면 같은 수열(시험 결과가 흔들리지 않게) */
function random32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ATTRIBUTES: readonly string[] = SAVE_ATTRIBUTE_ORDER

/** 0~5 정수 가중치. 능력치 54개 가운데 density만큼에 1~5를 주고, 적어도 하나는 양수다 */
function randomWeights(random: () => number, density = 0.35): Record<string, number> {
  const weights: Record<string, number> = {}
  for (const id of ATTRIBUTES) if (random() < density) weights[id] = 1 + Math.floor(random() * 5)
  if (Object.keys(weights).length === 0) weights[ATTRIBUTES[Math.floor(random() * ATTRIBUTES.length)]] = 1 + Math.floor(random() * 5)
  return weights
}

/** 능력치 54개의 게임 표시값(1~20) */
function randomValues(random: () => number): Record<string, number> {
  return Object.fromEntries(ATTRIBUTES.map((id) => [id, 1 + Math.floor(random() * 20)]))
}

/** 한 선수를 두 경로(표, 세이브)가 읽는 모양으로 */
interface Player {
  values: Record<string, number>
  table: Record<string, AttributeValue>
  /** 세이브에 저장된 능력치(게임 표시값 × 5, 못 읽은 것은 0) */
  stored: number[]
}

function playerOf(values: Record<string, number>, missing: ReadonlySet<string> = new Set()): Player {
  return {
    values,
    table: Object.fromEntries(ATTRIBUTES.filter((id) => !missing.has(id)).map((id) => [id, { value: values[id], ranged: false }])),
    stored: ATTRIBUTES.map((id) => (missing.has(id) ? 0 : values[id] * 5))
  }
}

/** 표 경로와 세이브 경로가 낸 적합도(가릴 때는 null). 두 경로가 다르면 시험이 실패한다 */
function fitness(weights: Weights, player: Player): number | null {
  const fromTable = scoreRole(player.table, weights)
  const fromSave = savedRoleScore(player.stored, 0, prepareWeights(weights))
  expect(fromSave === null, '두 경로의 가림이 같다').toBe(fromTable === null)
  if (fromTable && fromSave !== null) expect(Object.is(fromSave, fromTable.score), `표 ${fromTable.score} 세이브 ${fromSave}`).toBe(true)
  return fromTable ? fromTable.score : null
}

const sum = (weights: Weights): number => Object.values(weights).reduce((total, weight) => total + Math.max(0, weight), 0)

describe('compositeWeights: 점유 시와 비점유 시 가중치를 정수로 섞는다', () => {
  it('손으로 센 예: 4·2 / 2·4, 비중 60', () => {
    const ip = { a: 4, b: 2 } // 합 6
    const oop = { a: 2, c: 4 } // 합 6
    // w = 60 · wIp · 6 + 40 · wOop · 6
    expect(compositeWeights(ip, oop, 60)).toEqual({ a: 60 * 4 * 6 + 40 * 2 * 6, b: 60 * 2 * 6, c: 40 * 4 * 6 })
    // 합이 다르면 합으로 맞춘다: 합 6 / 합 3
    expect(compositeWeights({ a: 4, b: 2 }, { a: 3 }, 50)).toEqual({ a: 50 * 4 * 3 + 50 * 3 * 6, b: 50 * 2 * 3 })
  })

  it('(가) 비중 100(이상)이면 점유 시 표 객체를 그대로 돌려주고, 두 경로의 적합도가 점유 시 표와 Object.is로 같다(무작위 1만 쌍)', () => {
    const random = random32(1)
    for (let n = 0; n < 10_000; n++) {
      const ip = randomWeights(random)
      const oop = randomWeights(random)
      const player = playerOf(randomValues(random))
      const expected = fitness(ip, player)
      for (const share of [SHARE_SCALE, SHARE_SCALE + 40]) {
        const composite = compositeWeights(ip, oop, share)
        expect(composite).toBe(ip)
        expect(Object.is(fitness(composite, player), expected)).toBe(true)
      }
    }
  })

  it('비중이 0 이하이면 비점유 시 표 객체를 그대로 돌려준다', () => {
    const random = random32(2)
    for (let n = 0; n < 500; n++) {
      const ip = randomWeights(random)
      const oop = randomWeights(random)
      if (JSON.stringify(ip) === JSON.stringify(oop)) continue
      expect(compositeWeights(ip, oop, 0)).toBe(oop)
      expect(compositeWeights(ip, oop, -5)).toBe(oop)
    }
  })

  it('(나) 두 표가 같으면(배수 관계 포함) 비중 0~100 모든 정수에서 적합도가 같다', () => {
    const random = random32(3)
    // 같은 표, 키 순서와 0 항목만 다른 표, 정수 배수와 분수 배수(2:3, 3:2, 1:3 ...)
    const ratios: Array<[number, number]> = [[1, 1], [1, 2], [2, 1], [2, 3], [3, 2], [1, 3], [3, 1], [4, 5], [5, 4], [1, 5]]
    let cases = 0
    for (let n = 0; n < 400; n++) {
      const [p, q] = ratios[n % ratios.length]
      const unit = Math.floor(5 / Math.max(p, q))
      const base: Record<string, number> = {}
      for (const id of ATTRIBUTES) if (random() < 0.35) base[id] = 1 + Math.floor(random() * unit)
      if (Object.keys(base).length === 0) base[ATTRIBUTES[0]] = 1
      const ip = Object.fromEntries(Object.entries(base).map(([id, weight]) => [id, weight * p]))
      // 키 순서를 거꾸로 하고, 0 항목을 끼워 넣는다
      const oop: Record<string, number> = { 없는능력치: 0 }
      for (const [id, weight] of Object.entries(base).reverse()) oop[id] = weight * q
      const player = playerOf(randomValues(random))
      const expected = fitness(ip, player)
      for (let share = 0; share <= SHARE_SCALE; share++) {
        expect(Object.is(fitness(compositeWeights(ip, oop, share), player), expected), `${p}:${q} 비중 ${share}`).toBe(true)
        cases++
      }
    }
    expect(cases).toBe(400 * 101)
  })

  it('두 표가 같으면 섞지 않고 점유 시 표 객체를 그대로 돌려준다', () => {
    const ip = { a: 4, b: 2 }
    expect(compositeWeights(ip, { b: 2, a: 4, c: 0 }, 60)).toBe(ip)
    expect(compositeWeights(ip, ip, 37)).toBe(ip)
  })

  it('(다) 표 경로와 세이브 경로가 같다(무작위 1만 쌍, 비중 무작위, 값이 빠진 선수도 섞는다)', () => {
    const random = random32(4)
    let masked = 0
    let scored = 0
    for (let n = 0; n < 10_000; n++) {
      const ip = randomWeights(random)
      const oop = randomWeights(random)
      const share = Math.floor(random() * (SHARE_SCALE + 1))
      const missing = new Set<string>()
      if (n % 3 === 0) for (const id of ATTRIBUTES) if (random() < 0.45) missing.add(id)
      const result = fitness(compositeWeights(ip, oop, share), playerOf(randomValues(random), missing))
      if (result === null) masked++
      else scored++
    }
    // 60% 가림이 합성 표에도 걸려 가려진 경우와 계산된 경우가 모두 있다
    expect(masked).toBeGreaterThan(100)
    expect(scored).toBeGreaterThan(5_000)
  })

  it('(라) 반올림 전 값이 요구서 식(두 역할의 가중치를 합 1로 맞춰 섞는다)과 1e-9 안이다(무작위 1만 쌍)', () => {
    const random = random32(5)
    for (let n = 0; n < 10_000; n++) {
      const ip = randomWeights(random)
      const oop = randomWeights(random)
      const values = randomValues(random)
      const share = Math.floor(random() * (SHARE_SCALE + 1))
      const composite = compositeWeights(ip, oop, share)
      // 이 앱의 식: 반올림 전의 적합도 = (Σ w·a / Σ w / 20) · 100
      let weighted = 0
      let total = 0
      for (const [id, weight] of Object.entries(composite)) {
        weighted += weight * values[id]
        total += weight
      }
      const mine = (weighted / total / 20) * 100
      // 요구서의 식: 가중치 w_i = λ·(wIp_i / sIp) + (1 − λ)·(wOop_i / sOop), λ = 비중
      const lambda = share / SHARE_SCALE
      let top = 0
      let bottom = 0
      for (const id of ATTRIBUTES) {
        const w = lambda * ((ip[id] ?? 0) / sum(ip)) + (1 - lambda) * ((oop[id] ?? 0) / sum(oop))
        top += w * values[id]
        bottom += w
      }
      expect(Math.abs(mine - (top / bottom / 20) * 100)).toBeLessThan(1e-9)
    }
  })

  it('(마) 능력치가 1 오르면 적합도가 줄지 않는다(무작위 1만 쌍)', () => {
    const random = random32(6)
    let raised = 0
    for (let n = 0; n < 10_000; n++) {
      const ip = randomWeights(random)
      const oop = randomWeights(random)
      const values = randomValues(random)
      const share = Math.floor(random() * (SHARE_SCALE + 1))
      const composite = compositeWeights(ip, oop, share)
      const before = fitness(composite, playerOf(values))!
      const id = ATTRIBUTES[Math.floor(random() * ATTRIBUTES.length)]
      if (values[id] >= 20) continue
      const after = fitness(composite, playerOf({ ...values, [id]: values[id] + 1 }))!
      expect(after, `${id} 비중 ${share}`).toBeGreaterThanOrEqual(before)
      raised++
    }
    expect(raised).toBeGreaterThan(8_000)
  })

  it('(바) 한쪽 합이 0이면 다른 쪽만 쓰고, 둘 다 0이면 양수 항목이 없는 표(적합도 없음)다', () => {
    const random = random32(7)
    for (let n = 0; n < 200; n++) {
      const some = randomWeights(random)
      const player = playerOf(randomValues(random))
      for (const empty of [{}, { [ATTRIBUTES[0]]: 0 }, { [ATTRIBUTES[1]]: -3 }]) {
        for (const share of [1, 37, 60, 99]) {
          expect(compositeWeights(empty, some, share)).toBe(some)
          expect(compositeWeights(some, empty, share)).toBe(some)
          expect(fitness(compositeWeights(empty, some, share), player)).toBe(fitness(some, player))
        }
      }
    }
    expect(compositeWeights({}, {}, 60)).toEqual({})
    // 양수가 하나도 없으면(0이나 음수뿐) 어느 쪽이든 양수 항목이 없는 표이고 적합도가 나오지 않는다
    expect(Object.values(compositeWeights({ a: 0 }, { b: -1 }, 60)).filter((weight) => weight > 0)).toEqual([])
    expect(Object.values(compositeWeights({ a: 0 }, { b: 2 }, 60)).filter((weight) => weight > 0)).toEqual([2])
    expect(fitness(compositeWeights({}, {}, 60), playerOf(randomValues(random32(8))))).toBeNull()
    expect(fitness(compositeWeights({ [ATTRIBUTES[0]]: 0 }, { [ATTRIBUTES[1]]: -1 }, 60), playerOf(randomValues(random32(9))))).toBeNull()
  })

  it('끝값은 짧은 길의 차례를 따른다: 표의 합이 0인지보다 비중을 먼저 본다', () => {
    const some = { [ATTRIBUTES[2]]: 3, [ATTRIBUTES[5]]: 1 }
    const zeros = { [ATTRIBUTES[0]]: 0, [ATTRIBUTES[1]]: -2 }
    const player = playerOf(randomValues(random32(10)))
    // 비중이 가득이면 점유 시 표의 합이 0이어도 그 표를 쓰고(적합도 없음), 99면 점유 시 합이 0이라 비점유 시 표를 쓴다
    expect(compositeWeights(zeros, some, SHARE_SCALE)).toBe(zeros)
    expect(fitness(compositeWeights(zeros, some, SHARE_SCALE), player)).toBeNull()
    expect(compositeWeights(zeros, some, SHARE_SCALE - 1)).toBe(some)
    // 비중 0이면 비점유 시 표의 합이 0이어도 그 표를 쓰고(적합도 없음), 1이면 비점유 시 합이 0이라 점유 시 표를 쓴다
    expect(compositeWeights(some, zeros, 0)).toBe(zeros)
    expect(fitness(compositeWeights(some, zeros, 0), player)).toBeNull()
    expect(compositeWeights(some, zeros, 1)).toBe(some)
    // 두 표의 합이 모두 0이면 같은 표로 보아 어느 비중에서든 점유 시 표이고, 적합도가 나오지 않는다
    for (const share of [0, 1, 50, 99, SHARE_SCALE]) {
      expect(compositeWeights(zeros, { 다른능력치: 0 }, share), `비중 ${share}`).toBe(zeros)
      expect(fitness(compositeWeights(zeros, { 다른능력치: 0 }, share), player), `비중 ${share}`).toBeNull()
    }
  })

  it('음수와 0 가중치는 합성에 들어가지 않고, 입력 표를 바꾸지 않는다', () => {
    const ip = Object.freeze({ a: 4, b: -3, c: 0 })
    const oop = Object.freeze({ a: 1, d: 2 })
    const mixed = compositeWeights(ip, oop, 50)
    expect(Object.keys(mixed).sort()).toEqual(['a', 'd'])
    for (const weight of Object.values(mixed)) expect(weight).toBeGreaterThan(0)
  })
})

describe('mixedPenaltySigma: 두 국면 숙련의 감점을 섞는다', () => {
  it('두 숙련이 같으면 현행 감점과 Object.is로 같다(숙련 1~20, 비중 0~100)', () => {
    for (let rating = 1; rating <= 20; rating++) {
      for (let share = 0; share <= SHARE_SCALE; share++) {
        expect(Object.is(mixedPenaltySigma(rating, rating, share), posPenaltySigma(rating)), `숙련 ${rating} 비중 ${share}`).toBe(true)
      }
    }
  })

  it('비중 100이면 점유 시 값, 비중 0이면 비점유 시 값이다', () => {
    for (let ip = 1; ip <= 20; ip++) {
      for (let oop = 1; oop <= 20; oop++) {
        expect(Object.is(mixedPenaltySigma(ip, oop, SHARE_SCALE), posPenaltySigma(ip))).toBe(true)
        expect(Object.is(mixedPenaltySigma(ip, oop, 0), posPenaltySigma(oop))).toBe(true)
      }
    }
  })

  it('그 밖의 비중은 두 값의 가중 평균이고, 두 값 사이에 있다', () => {
    for (let ip = 1; ip <= 20; ip++) {
      for (let oop = 1; oop <= 20; oop++) {
        for (const share of [1, 25, 40, 50, 60, 75, 99]) {
          const mixed = mixedPenaltySigma(ip, oop, share)
          const a = posPenaltySigma(ip)
          const b = posPenaltySigma(oop)
          expect(mixed).toBeCloseTo((share * a + (SHARE_SCALE - share) * b) / SHARE_SCALE, 12)
          expect(mixed).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-12)
          expect(mixed).toBeLessThanOrEqual(Math.max(a, b) + 1e-12)
        }
      }
    }
  })

  it('각 국면의 숙련이 오르면 감점이 줄거나 같다', () => {
    for (let ip = 1; ip < 20; ip++) {
      for (let oop = 1; oop < 20; oop++) {
        for (const share of [0, 1, 30, 60, 99, 100]) {
          const now = mixedPenaltySigma(ip, oop, share)
          expect(mixedPenaltySigma(ip + 1, oop, share), `점유 시 ${ip}→${ip + 1} 비점유 시 ${oop} 비중 ${share}`).toBeLessThanOrEqual(now)
          expect(mixedPenaltySigma(ip, oop + 1, share), `점유 시 ${ip} 비점유 시 ${oop}→${oop + 1} 비중 ${share}`).toBeLessThanOrEqual(now)
        }
      }
    }
  })

  it('penaltySigmaOf와 gateRatingOf: 숫자는 지금 뜻 그대로, 두 국면 숙련은 섞거나(감점) 점유 시만 본다(자격)', () => {
    for (let rating = 1; rating <= 20; rating++) {
      expect(Object.is(penaltySigmaOf(rating), posPenaltySigma(rating))).toBe(true)
      expect(gateRatingOf(rating)).toBe(rating)
    }
    const ratings = { ip: 12, oop: 20, sharePct: 40 }
    expect(penaltySigmaOf(ratings)).toBe(mixedPenaltySigma(12, 20, 40))
    expect(penaltySigmaOf(ratings)).toBeLessThan(posPenaltySigma(12))
    expect(penaltySigmaOf(ratings)).toBeGreaterThan(0)
    // 자격은 점유 시 숙련만: 비점유 시 숙련이 낮아도 점유 시 숙련 그대로다
    expect(gateRatingOf({ ip: 20, oop: 1, sharePct: 40 })).toBe(20)
    expect(gateRatingOf({ ip: 12, oop: 20, sharePct: 40 })).toBe(12)
  })
})

describe('묶음 id와 비중 글', () => {
  const spot = (position: SlotProfile['ip']['position'], roleId: string): SlotProfile['ip'] => ({ position, roleId })

  it('두 국면이 같으면 지금 꼴, 다르면 ~로 이은 꼴(비중은 id에 넣지 않는다)', () => {
    const same: SlotProfile = { ip: spot('DC', 'cb'), oop: spot('DC', 'cb'), sharePct: 60 }
    expect(isSinglePhase(same)).toBe(true)
    expect(groupIdOf(same)).toBe('DC:cb')
    expect(groupIdOf({ ...same, sharePct: 10 })).toBe('DC:cb')
    const moves: SlotProfile = { ip: spot('AMR', 'if'), oop: spot('MR', 'winger'), sharePct: 60 }
    expect(isSinglePhase(moves)).toBe(false)
    expect(groupIdOf(moves)).toBe('AMR:if~MR:winger')
    expect(groupIdOf({ ...moves, sharePct: 90 })).toBe('AMR:if~MR:winger')
    // 포지션만 달라도, 역할만 달라도 다른 묶음이다
    expect(isSinglePhase({ ip: spot('AMR', 'if'), oop: spot('MR', 'if'), sharePct: 60 })).toBe(false)
    expect(groupIdOf({ ip: spot('DC', 'cb'), oop: spot('DC', 'bpd'), sharePct: 60 })).toBe('DC:cb~DC:bpd')
  })

  it('비중 기본값은 대장의 IP_SHARE_DEFAULT를 그때그때 읽는다', () => {
    expect(defaultSharePct()).toBe(60)
    expect(withLedger({ IP_SHARE_DEFAULT: 0.7 }, () => defaultSharePct())).toBe(70)
    expect(withLedger({ IP_SHARE_DEFAULT: 0.4 }, () => defaultSharePct())).toBe(40)
    expect(K.IP_SHARE_DEFAULT).toBe(0.6)
  })

  it('shareLabel은 게임 한국어판의 국면 이름으로 "공 소유 시 60 : 공 미소유 시 40"이다', () => {
    expect(shareLabel(60)).toBe('공 소유 시 60 : 공 미소유 시 40')
    expect(shareLabel(0)).toBe('공 소유 시 0 : 공 미소유 시 100')
    expect(shareLabel(100)).toBe('공 소유 시 100 : 공 미소유 시 0')
    expect(shareLabel(35)).toBe('공 소유 시 35 : 공 미소유 시 65')
  })
})
