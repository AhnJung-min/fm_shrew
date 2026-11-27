import { describe, expect, it } from 'vitest'
import {
  ageStructure,
  buildBrief,
  contractWindows,
  expectedWage,
  firstTeamPlayers,
  fitRiskOf,
  fitWageModel,
  FIT_GAP_SIGMAS,
  NO_SLOT_PREMIUM,
  OVERPAID_Z,
  overpaidPlayers,
  surplusReport,
  surplusScore,
  SURPLUS_MIN_SHOWN,
  UNKNOWN_RISK,
  WAGE_Z_FULL,
  type FirstTeamPlayer
} from '@shared/dashboard'
import type { RoleNorm, RoleNorms } from '@shared/norms'
import { POSITION_KEYS, positionsLabel } from '@shared/positions'
import { ROLES } from '@shared/roles'
import type { SeasonMatch, SeasonTableRow } from '@shared/season'
import { analyseTactic } from '@shared/tactic'
import type { PlayerRow } from '@shared/types'
import { REPRESENTATIVE_SIGMA } from '@shared/world'
import { loanLender, loanParent, type SaveContract } from '../src/main/save/contracts'
import { mockSquad } from '../src/renderer/src/lib/mockWorld'

const player = (over: Partial<FirstTeamPlayer> & { uid: number }): FirstTeamPlayer => ({
  name: `선수${over.uid}`,
  age: 25,
  position: 'M (C)',
  ca: 120,
  pa: 125,
  wage: 50_000,
  contractEnd: null,
  ...over
})

describe('주급 기준선(로그 선형 회귀, 능력 + 나이 더미)', () => {
  it('정확히 지수 관계인 자료에서 a, b와 R²=1을 되찾고, 나이를 모르면 더미는 0이다', () => {
    const points = Array.from({ length: 60 }, (_, i) => ({ ca: 80 + i, wage: Math.exp(3 + 0.05 * (80 + i)) }))
    const model = fitWageModel(points)!
    // a는 CA 145에서의 로그 주급이다(5회차): 3 + 0.05 × 145. 정확한 지수 관계라 2차항은 0이다
    expect(model.a).toBeCloseTo(3 + 0.05 * 145, 6)
    expect(model.b).toBeCloseTo(0.05, 8)
    expect(model.b2).toBeCloseTo(0, 8)
    expect(model.c1).toBe(0)
    expect(model.c2).toBe(0)
    expect(model.r2).toBeCloseTo(1, 8)
    expect(model.n).toBe(60)
    expect(expectedWage(model, 100)).toBeCloseTo(Math.exp(8), 3)
  })

  it('잡음이 있으면 R²가 1보다 작고, 주급 0과 능력을 모르는 선수는 표본에서 뺀다', () => {
    const points = Array.from({ length: 80 }, (_, i) => ({ ca: 60 + i, wage: Math.exp(3 + 0.05 * (60 + i) + (i % 2 === 0 ? 0.4 : -0.4)) }))
    const noisy = fitWageModel([...points, { ca: 100, wage: 0 }, { ca: 0, wage: 500 }])!
    expect(noisy.n).toBe(80)
    expect(noisy.r2).toBeGreaterThan(0.5)
    expect(noisy.r2).toBeLessThan(1)
    // 잔차는 ±0.4이므로 표준편차는 0.4 안팎
    expect(noisy.s).toBeGreaterThan(0.35)
    expect(noisy.s).toBeLessThan(0.45)
  })

  it('표본이 적거나 능력이 모두 같으면 만들지 않는다', () => {
    expect(fitWageModel([{ ca: 100, wage: 1000 }])).toBeNull()
    expect(fitWageModel(Array.from({ length: 40 }, () => ({ ca: 100, wage: 1000 })))).toBeNull()
  })

  it('T9. 이상치 한 번 제거: |z| > 3인 선수는 빼고 다시 맞춘다(극단값이 s를 부풀린다). 뺀 인원을 모델에 싣는다', () => {
    const random = (() => {
      let state = 777
      return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        return state / 0x7fffffff
      }
    })()
    // 정규에 가까운 잡음(균일 12개의 합): 표준편차 0.43
    const normal = (): number => (Array.from({ length: 12 }, random).reduce((sum, value) => sum + value, 0) - 6) * 0.43
    const clean = Array.from({ length: 460 }, () => {
      const ca = 70 + Math.floor(random() * 100)
      return { ca, age: 22 + Math.floor(random() * 10), wage: Math.exp(4 + 0.05 * ca + normal()) }
    })
    // 주급이 기대보다 7σ쯤 낮은 선수 셋(예: 주급이 거의 0인 선수)
    const outliers = [100, 120, 140].map((ca) => ({ ca, age: 25, wage: Math.exp(4 + 0.05 * ca - 3.2) }))
    const withOutliers = fitWageModel([...clean, ...outliers])!
    const without = fitWageModel(clean)!
    expect(without.removed).toBeLessThanOrEqual(3)
    expect(withOutliers.removed).toBeGreaterThanOrEqual(3)
    expect(withOutliers.removed).toBeLessThanOrEqual(8)
    expect(withOutliers.n).toBe(clean.length + outliers.length - withOutliers.removed)
    // 뺀 뒤의 s는 이상치가 없는 자료와 거의 같고 0.43 안팎이다. 기대 배수 e^s는 1.5 안팎
    expect(withOutliers.s).toBeGreaterThan(0.39)
    expect(withOutliers.s).toBeLessThan(0.47)
    expect(Math.abs(withOutliers.s - without.s)).toBeLessThan(0.03)
    expect(Math.exp(withOutliers.s)).toBeGreaterThan(1.45)
    expect(Math.exp(withOutliers.s)).toBeLessThan(1.6)
    // 잘 맞는 자료에서는 아무도 빼지 않는다
    expect(fitWageModel(Array.from({ length: 60 }, (_, i) => ({ ca: 80 + i, wage: Math.exp(3 + 0.05 * (80 + i)) })))!.removed).toBe(0)
  })

  it('나이 더미의 부호를 합성 자료에서 되찾는다(21세 미만 c1 < 0, 30세 이상 c2 > 0)', () => {
    const random = (() => {
      let state = 12345
      return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        return state / 0x7fffffff
      }
    })()
    const points = Array.from({ length: 600 }, (_, i) => {
      const ca = 70 + Math.floor(random() * 100)
      const age = 17 + (i % 20)
      const noise = (random() - 0.5) * 0.4
      return { ca, age, wage: Math.exp(3.8 + 0.05 * ca - (age < 21 ? 0.5 : 0) + (age >= 30 ? 0.22 : 0) + noise) }
    })
    const model = fitWageModel(points)!
    expect(model.c1).toBeLessThan(0)
    expect(model.c2).toBeGreaterThan(0)
    expect(model.c1).toBeCloseTo(-0.5, 1)
    expect(model.c2).toBeCloseTo(0.22, 1)
    expect(model.a).toBeCloseTo(3.8 + 0.05 * 145, 1)
    expect(model.b).toBeCloseTo(0.05, 2)
    expect(Math.abs(model.b2)).toBeLessThan(0.05)
    expect(model.s).toBeLessThan(0.15)
    // 같은 능력이라도 어린 선수의 기대 주급은 낮고 나이 든 선수는 높다
    expect(expectedWage(model, 120, 19)).toBeLessThan(expectedWage(model, 120, 25))
    expect(expectedWage(model, 120, 32)).toBeGreaterThan(expectedWage(model, 120, 25))
    expect(expectedWage(model, 120, null)).toBeCloseTo(expectedWage(model, 120, 25), 6)
  })

  it('z가 1 이상인 선수만 z가 큰 순서로 고르고, 임대로 들어온 선수는 뺀다', () => {
    const model = { a: 3, b: 0.05, c1: 0, c2: 0, s: 0.5 }
    const at = (ca: number): number => expectedWage(model, ca)
    // z = ln(비율)/0.5: 1.29배 0.51, 1.5배 0.81, 1.7배 1.06, 2배 1.39, 2.2배 1.58
    const players = [
      player({ uid: 1, ca: 100, wage: Math.round(at(100) * 1.29) }),
      player({ uid: 2, ca: 100, wage: Math.round(at(100) * 1.5) }),
      player({ uid: 3, ca: 140, wage: Math.round(at(140) * 2) }),
      player({ uid: 4, ca: 120, wage: null }),
      player({ uid: 5, ca: 90, wage: Math.round(at(90) * 0.8) }),
      player({ uid: 6, ca: 110, wage: Math.round(at(110) * 1.7) }),
      player({ uid: 7, ca: 130, wage: Math.round(at(130) * 2.2) })
    ]
    const found = overpaidPlayers(players, model)
    expect(OVERPAID_Z).toBe(1)
    expect(found.total).toBe(3)
    expect(found.rows.map((row) => row.uid)).toEqual([7, 3, 6])
    expect(found.rows[0].strong).toBe(true)
    expect(found.rows[1].strong).toBe(false)
    expect(found.rows[1].z).toBeCloseTo(1.39, 1)
    expect(found.rows[1].ratio).toBeCloseTo(2, 1)
    expect(found.rows[1].excess).toBe(found.rows[1].wage - found.rows[1].expected)
    // 임대로 들어온 선수는 판정하지 않는다
    expect(overpaidPlayers(players, model, new Set([7])).rows.map((row) => row.uid)).toEqual([3, 6])
    // 1.3배(z 0.5 안팎)는 더 이상 의심이 아니다
    expect(found.rows.map((row) => row.uid)).not.toContain(1)
  })

  it('정렬은 초과액이 아니라 z 순서다(고주급 스타보다 비율이 큰 선수가 위)', () => {
    const model = { a: 3, b: 0.05, c1: 0, c2: 0, s: 0.5 }
    const star = player({ uid: 1, ca: 180, wage: Math.round(expectedWage(model, 180) * 1.75) })
    const small = player({ uid: 2, ca: 90, wage: Math.round(expectedWage(model, 90) * 2.5) })
    const found = overpaidPlayers([star, small], model)
    expect(found.rows.map((row) => row.uid)).toEqual([2, 1])
    expect(found.rows[1].excess).toBeGreaterThan(found.rows[0].excess)
  })
})

describe('정리 후보 나이·정체 항(4회차)', () => {
  // 정리 후보 점수에서 나이 항(25점 만점)만 본다
  const ageTerm = (age: number, ca: number, pa: number): number => surplusScore({ fitRisk: 0, wageZ: 0, age, ca, pa }).parts.age

  it('T4. 35세 CA140/PA159는 25.0, 28세 CA140/PA140은 17.5, 33세 CA140/PA156은 25.0이다', () => {
    expect(ageTerm(35, 140, 159)).toBe(25)
    expect(ageTerm(28, 140, 140)).toBe(17.5)
    expect(ageTerm(33, 140, 156)).toBe(25)
  })
  it('26세 이하는 예전 식 그대로다: 24세 CA140/PA160은 0, 24세 CA140/PA140은 10', () => {
    expect(ageTerm(24, 140, 160)).toBe(0)
    expect(ageTerm(24, 140, 140)).toBe(10)
    // 27세는 정체 위험을 반쯤만 나이에 맡긴다
    expect(ageTerm(27, 140, 140)).toBeGreaterThan(ageTerm(27, 140, 160))
  })
  it('T8. 속성: 28세 이상에서 나이 항은 PA와 무관하고 나이에 대해 줄지 않는다', () => {
    for (let ca = 100; ca <= 170; ca += 10) {
      for (let age = 28; age <= 38; age++) {
        const terms = Array.from({ length: 26 }, (_, room) => ageTerm(age, ca, ca + room))
        for (const term of terms) expect(term).toBeCloseTo(terms[0], 10)
        if (age > 28) expect(ageTerm(age, ca, ca + 10)).toBeGreaterThanOrEqual(ageTerm(age - 1, ca, ca + 10) - 1e-9)
      }
    }
  })
  it('점수 하한: 30점 미만은 보여 주지 않고(SURPLUS_MIN_SHOWN), 하한을 빼면 낮은 점수도 나온다', () => {
    expect(SURPLUS_MIN_SHOWN).toBe(30)
    const squad = mockSquad(false)
    const players = firstTeamPlayers(squad.rows, squad.columns)
    const analysis = analyseTactic({ rows: squad.rows, columns: squad.columns, today: squad.today, formation: '4-2-3-1', slotRoles: {}, roleWeights: {} })!
    const shown = surplusReport({ players, rows: squad.rows, columns: squad.columns, analysis, roleWeights: {} }).rows
    for (const row of shown) expect(row.score).toBeGreaterThanOrEqual(SURPLUS_MIN_SHOWN)
    const all = surplusReport({ players, rows: squad.rows, columns: squad.columns, analysis, roleWeights: {}, minScore: 0 }).rows
    expect(all.length).toBeGreaterThanOrEqual(shown.length)
  })
})

describe('잉여 점수', () => {
  const base = { fitRisk: fitRiskOf(1.2), wageZ: 0.8, age: 27, ca: 120, pa: 125 }

  it('0~100 안이고, 위험이 클수록 높다', () => {
    const calm = surplusScore({ fitRisk: 0, wageZ: -1, age: 22, ca: 120, pa: 150 })
    const heavy = surplusScore({ fitRisk: fitRiskOf(FIT_GAP_SIGMAS), wageZ: WAGE_Z_FULL, age: 33, ca: 120, pa: 120 })
    expect(calm.score).toBe(0)
    expect(heavy.score).toBe(100)
    expect(surplusScore(base).score).toBeGreaterThan(calm.score)
    expect(surplusScore(base).score).toBeLessThan(heavy.score)
  })

  it('적합도 차이·주급·나이가 각각 점수를 올린다', () => {
    const score = (over: Partial<typeof base>): number => surplusScore({ ...base, ...over }).score
    expect(score({ fitRisk: fitRiskOf(2.4) })).toBeGreaterThan(score({ fitRisk: fitRiskOf(0.4) }))
    expect(score({ wageZ: 1.5 })).toBeGreaterThan(score({ wageZ: 0.2 }))
    expect(score({ age: 31 })).toBeGreaterThan(score({ age: 25 }))
    expect(score({ pa: 120 })).toBeGreaterThan(score({ pa: 140 }))
  })

  it('주급은 기대 이하면 0, +2σ면 최대다', () => {
    expect(surplusScore({ ...base, wageZ: -0.7 }).parts.wage).toBe(0)
    expect(surplusScore({ ...base, wageZ: 0 }).parts.wage).toBe(0)
    expect(surplusScore({ ...base, wageZ: 1 }).parts.wage).toBe(12.5)
    expect(surplusScore({ ...base, wageZ: 2.6 }).parts.wage).toBe(25)
  })

  it('모르는 항목은 보통(0.5)으로 계산하고 재분배하지 않는다', () => {
    const unknownFit = surplusScore({ ...base, fitRisk: null })
    expect(unknownFit.unknown).toEqual(['fit'])
    expect(unknownFit.parts.fit).toBe(50 * UNKNOWN_RISK)
    const unknownWage = surplusScore({ ...base, wageZ: null })
    expect(unknownWage.unknown).toEqual(['wage'])
    expect(unknownWage.parts.wage).toBe(25 * UNKNOWN_RISK)
    const unknownAge = surplusScore({ ...base, age: null })
    expect(unknownAge.unknown).toEqual(['age'])
    expect(unknownAge.parts.age).toBe(25 * UNKNOWN_RISK)
    // 재분배가 없으므로 모르는 항목이 있어도 합은 100을 넘지 않는다
    expect(surplusScore({ fitRisk: 1, wageZ: null, age: null, ca: null, pa: null }).score).toBe(75)
  })

  it('적합도 차이는 σ 단위다: 같은 점수 차이라도 σ가 작은 역할에서는 더 큰 차이다', () => {
    expect(surplusScore({ ...base, fitRisk: fitRiskOf(6 / 2) }).parts.fit).toBeGreaterThan(surplusScore({ ...base, fitRisk: fitRiskOf(6 / 4) }).parts.fit)
    expect(surplusScore({ ...base, fitRisk: fitRiskOf(FIT_GAP_SIGMAS * 2) }).parts.fit).toBe(50)
  })
})

/** 정리 후보를 시험하는 지어낸 선수단: 능력치는 모두 같은 값, 포지션 숙련은 직접 정한다 */
describe('정리 후보 고르기(3회차)', () => {
  const base = mockSquad(false)
  const header = (field: string): string => base.columns.find((col) => col.field === field)!.header
  const attrColumns = base.columns.filter((col) => col.isAttr)
  const norm: RoleNorm = { mu: 60, sigma: 3, beta: 0.265, n: 100, caRef: 100 }
  const norms: RoleNorms = Object.fromEntries(ROLES.map((role) => [role.id, norm]))
  const model = { a: 8, b: 0.05, c1: 0, c2: 0, s: 0.5 }
  const expectedAt = (ca: number): number => Math.exp(model.a + model.b * ca)

  interface Spec {
    name: string
    /** 포지션 숙련. 적힌 자리만 그 값이고 나머지는 1 */
    spots: Partial<Record<(typeof POSITION_KEYS)[number], number>>
    /** 능력치 값(1~20). 역할 점수는 이 값 × 5 */
    level: number
    age?: number
    ca?: number
    pa?: number
    wage?: number
  }
  const makeRow = (idx: number, spec: Spec): PlayerRow => {
    const ratings = POSITION_KEYS.map((key) => spec.spots[key] ?? 1)
    const num = (value: number): { raw: string; num: number } => ({ raw: String(value), num: value })
    const cells: PlayerRow['cells'] = {
      [header('name')]: { raw: spec.name, num: null },
      [header('position')]: { raw: positionsLabel(ratings), num: null },
      [header('age')]: num(spec.age ?? 26),
      [header('ability')]: num(spec.ca ?? 140),
      [header('potential')]: num(spec.pa ?? spec.ca ?? 140),
      [header('wage')]: num(spec.wage ?? Math.round(expectedAt(spec.ca ?? 140)))
    }
    for (const col of attrColumns) cells[col.header] = num(spec.level)
    return { idx, name: spec.name, ratings, cells }
  }
  const everywhere = (value: number): Spec['spots'] => ({ DL: value, DC: value, DR: value, DM: value, ML: value, MC: value, MR: value, AMC: value, ST: value, AML: value, AMR: value })
  // 점수 하한(30점)은 따로 시험하고, 여기서는 낮은 점수의 이유도 볼 수 있게 하한 없이 돌린다
  const report = (specs: Spec[], formation: string, extra: { loanedIn?: Set<number>; minScore?: number } = {}) => {
    const rows = specs.map((spec, i) => makeRow(i + 1, spec))
    const analysis = analyseTactic({ rows, columns: base.columns, today: base.today, formation, slotRoles: {}, roleWeights: {}, norms })!
    const players = firstTeamPlayers(rows, base.columns)
    return { analysis, result: surplusReport({ players, rows, columns: base.columns, analysis, roleWeights: {}, norms, wageModel: model, loanedIn: extra.loanedIn, minScore: extra.minScore ?? 0 }), players }
  }
  const keepersOf = (levels: number[], cas: number[]): Spec[] => levels.map((level, i) => ({ name: `골키퍼${i + 1}`, spots: { GK: 20 }, level, ca: cas[i], age: 28 }))
  // 필드 선수 16명: 모두 어느 자리든 뛴다. 점수 60(z 0)
  const field = (count: number, patch: Partial<Spec> = {}): Spec[] =>
    Array.from({ length: count }, (_, i) => ({ name: `필드${i + 1}`, spots: everywhere(20), level: 12, age: 27, ca: 140, pa: 142, ...patch }))
  // 점수가 높은 왼쪽·오른쪽 공격수만 가능한 선수(4-2-3-1에는 자리가 있고 4-4-2에는 없다)
  const star: Spec = { name: '별', spots: { AML: 20, AMR: 20 }, level: 16, age: 23, ca: 163, pa: 177, wage: Math.round(expectedAt(163)) }
  // 정리 후보가 될 만한 선수: 나이 많고 주급이 기대의 3배
  const spare = (count: number): Spec[] => field(count, { age: 33, pa: 140, wage: Math.round(expectedAt(140) * 3) }).map((spec, i) => ({ ...spec, name: `잉여${i + 1}` }))
  const squad = (): Spec[] => [...keepersOf([12, 12, 12], [150, 140, 130]), ...field(10), star, ...spare(5)]

  it('4-4-2에서 자리가 없는 주전급은 적합도 위험 0.5/3 ≈ 0.17이고 상위 3위 밖이다. 4-2-3-1에서는 주전이라 대상이 아니다', () => {
    const wide = report(squad(), '4-4-2')
    const row = wide.result.rows.find((each) => each.name === '별')
    expect(row, '별이 정리 후보 5명 안에 있어야 확인할 수 있다').toBeDefined()
    expect(row!.fit).toBe('noSlot')
    expect(row!.bestRole).toBeTruthy()
    // 최약 주전보다 z가 높으므로 가산 0.5σ만 남는다
    expect(row!.parts.fit).toBeCloseTo(50 * (NO_SLOT_PREMIUM / FIT_GAP_SIGMAS), 1)
    expect(row!.reason).toContain('4-4-2에는 별이 뛸 자리가 없습니다')
    expect(row!.reason).toContain('전술을 바꾸면 주전감')
    expect(wide.result.rows.slice(0, 3).map((each) => each.name)).not.toContain('별')
    // 같은 선수가 4-2-3-1 주전이면 대상이 아니다
    const narrow = report(squad(), '4-2-3-1')
    const starter = narrow.analysis.slots.some((slot) => slot.slot.starter?.name === '별')
    expect(starter).toBe(true)
    expect(narrow.result.rows.map((each) => each.name)).not.toContain('별')
  })

  it('자리가 없는 선수의 실력이 낮으면 위험이 더 올라간다(가장 약한 주전보다 낮은 만큼 + 0.5σ)', () => {
    const weak: Spec = { ...star, name: '약한별', level: 10, ca: 120, pa: 125 }
    const row = report([...keepersOf([12, 12, 12], [150, 140, 130]), ...field(10), weak, ...spare(5)], '4-4-2').result.rows.find((each) => each.name === '약한별')!
    expect(row.fit).toBe('noSlot')
    // 점수 50, μ 60, σ 3 → z -3.33 - 숙련 감점 0. 최약 주전 z 0. 갭 3.33 + 0.5 → 위험 1
    expect(row.parts.fit).toBe(50)
    expect(row.reason).toContain('보통 점수 차이의')
  })

  it('골키퍼 5명: 상위 3명은 대상이 아니고 4·5번째는 위험 1이며 이유에 "4번째 이후"가 있다', () => {
    const specs = [...keepersOf([12, 12, 12, 12, 12], [175, 159, 130, 113, 92]), ...field(13)]
    const { result } = report(specs, '4-2-3-1')
    const names = result.rows.map((each) => each.name)
    for (const kept of ['골키퍼1', '골키퍼2', '골키퍼3']) expect(names).not.toContain(kept)
    const fourth = result.rows.find((each) => each.name === '골키퍼4')!
    const fifth = result.rows.find((each) => each.name === '골키퍼5')!
    for (const row of [fourth, fifth]) {
      expect(row.fit).toBe('keeper')
      expect(row.parts.fit).toBe(50)
      expect(row.reason).toContain('골키퍼가 5명이라 4번째 이후')
      expect(row.reason).not.toContain('첫 후보보다')
    }
  })

  it('숙련 16인 자리에서는 f_eff로 비교한다: 같은 능력이면 숙련 20보다 갭이 σ의 0.32배(0.96점) 크다', () => {
    const lowGuy = (name: string, rating: number): Spec => ({ name, spots: { ST: rating }, level: 11, age: 27, ca: 130, pa: 132 })
    const { result } = report([...keepersOf([12, 12, 12], [150, 140, 130]), ...field(14), lowGuy('숙련20', 20), lowGuy('숙련16', 16)], '4-4-2')
    const a = result.rows.find((each) => each.name === '숙련20')
    const b = result.rows.find((each) => each.name === '숙련16')
    expect(a && b).toBeTruthy()
    expect(a!.fit).toBe('slot')
    expect(b!.fitGap! - a!.fitGap!).toBeGreaterThan(0.85)
    expect(b!.fitGap! - a!.fitGap!).toBeLessThan(1.05)
    expect(b!.reason).toContain('포지션 숙련이 16이라 1.0점 뺐')
    expect(a!.reason).not.toContain('포지션 숙련이')
  })

  it('임대로 들어온 선수는 정리 후보에서 뺀다', () => {
    const specs = [...keepersOf([12, 12, 12], [150, 140, 130]), ...field(13), ...spare(4)]
    const withLoan = report(specs, '4-2-3-1').result.rows.map((each) => each.name)
    const loaned = report(specs, '4-2-3-1', { loanedIn: new Set([withLoan.length > 0 ? specs.findIndex((spec) => spec.name === withLoan[0]) + 1 : 0]) }).result.rows.map((each) => each.name)
    expect(withLoan.length).toBeGreaterThan(0)
    expect(loaned).not.toContain(withLoan[0])
  })

  it('클 여지가 있는 어린 선수는 임대 유망주로 나눈다(18세 CA165/PA183). 클 여지가 작은 23세 CA152/PA164는 정리 후보로 본다', () => {
    // 5회차: 클 여지만으로는 부족하고 다 컸을 때 우리 주전 수준(그 자리 기준선 이상)이어야 임대 유망주다. 적합도 60(z 0)인 18세가 다 크면 약 63점이다
    const young: Spec = { name: '신예', spots: { ST: 20 }, level: 12, age: 18, ca: 165, pa: 183 }
    const almost: Spec = { name: '거의다큼', spots: { ST: 20 }, level: 10, age: 23, ca: 152, pa: 164 }
    const { result } = report([...keepersOf([12, 12, 12], [150, 140, 130]), ...field(14), young, almost], '4-4-2')
    expect(result.prospects.map((each) => each.name)).toContain('신예')
    expect(result.prospects.map((each) => each.name)).not.toContain('거의다큼')
    expect(result.rows.map((each) => each.name)).toContain('거의다큼')
    expect(result.prospects[0].gain).toBeGreaterThan(0)
  })

  it('5회차 T3. 22세 다섯 번째 골키퍼(CA 92/PA 122): 클 여지는 있지만 다 커도 이 자리 기준에 못 미쳐 정리 후보다(적합 위험 1 → 적합 항목 50점)', () => {
    const young: Spec = { name: '어린골키퍼', spots: { GK: 20 }, level: 8, age: 22, ca: 92, pa: 122 }
    const specs = [...keepersOf([12, 12, 12, 12], [175, 159, 130, 113]), young, ...field(13)]
    const { result } = report(specs, '4-2-3-1')
    expect(result.prospects.map((each) => each.name)).not.toContain('어린골키퍼')
    const row = result.rows.find((each) => each.name === '어린골키퍼')!
    expect(row).toBeDefined()
    expect(row.fit).toBe('keeper')
    expect(row.parts.fit).toBe(50)
    // 이유 앞에 "클 여지(+점)는 있지만 다 커도 이 자리 기준(점)에 못 미칩니다(예상 점)"
    expect(row.reason).toMatch(/^클 여지\(\+3\.7점\)는 있지만 다 커도 골키퍼 자리 기준\(59\.3점\)에 못 미칩니다\(예상 43\.7점\)\. 골키퍼가 5명이라 4번째 이후/)
  })

  it('5회차 T12. 주급 기준 모델이 없으면(순위표를 못 읽은 리그) 정리 후보의 주급 위험은 0.5(모름)이고 이유에 그렇게 적는다', () => {
    const rows = [...keepersOf([12, 12, 12], [150, 140, 130]), ...field(13), ...spare(4)].map((spec, i) => makeRow(i + 1, spec))
    const analysis = analyseTactic({ rows, columns: base.columns, today: base.today, formation: '4-2-3-1', slotRoles: {}, roleWeights: {}, norms })!
    const players = firstTeamPlayers(rows, base.columns)
    const none = surplusReport({ players, rows, columns: base.columns, analysis, roleWeights: {}, norms, wageModel: null, minScore: 0 })
    expect(none.rows.length).toBeGreaterThan(0)
    for (const row of none.rows) {
      expect(row.parts.wage).toBe(25 * UNKNOWN_RISK)
      expect(row.unknown).toContain('wage')
      expect(row.wageZ).toBeNull()
      expect(row.reason).toContain('몰라 보통(0.5)으로 보았')
    }
  })

  it('5회차: 골키퍼의 클 여지는 골키퍼 성장 표를 쓴다(22세 이득 0.46 몫). 적합도가 기준 이상이면 임대 유망주로 남는다', () => {
    const young: Spec = { name: '어린골키퍼', spots: { GK: 20 }, level: 12, age: 22, ca: 92, pa: 122 }
    const specs = [...keepersOf([12, 12, 12, 12], [175, 159, 130, 113]), young, ...field(13)]
    const { result } = report(specs, '4-2-3-1')
    const prospect = result.prospects.find((each) => each.name === '어린골키퍼')!
    expect(prospect).toBeDefined()
    // β 0.265 × 골키퍼 몫 0.46 × (122 - 92) = 3.66
    expect(prospect.gain).toBeCloseTo(0.265 * 0.46 * 30, 1)
  })

  it('5회차: 전술에 뛸 자리가 없어도 다 컸을 때 가장 약한 필드 주전 수준이면 임대 유망주이고, 못 미치면 정리 후보다', () => {
    const strong: Spec = { name: '유망한공미', spots: { AMC: 20 }, level: 14, age: 17, ca: 130, pa: 170 }
    const weak: Spec = { name: '약한공미', spots: { AMC: 20 }, level: 8, age: 17, ca: 130, pa: 170 }
    const { result } = report([...keepersOf([12, 12, 12], [150, 140, 130]), ...field(14), strong, weak], '4-4-2')
    expect(result.prospects.map((each) => each.name)).toContain('유망한공미')
    expect(result.prospects.map((each) => each.name)).not.toContain('약한공미')
    const row = result.rows.find((each) => each.name === '약한공미')!
    expect(row.fit).toBe('noSlot')
    expect(row.reason).toContain('다 커도 지금 전술의 가장 약한 주전 수준에 못 미칩니다')
  })

  it('경계: 주급 0, 나이 모름, 숙련 숫자 없음, 역할 기준 분포 없음, 전술에 없는 포지션만 있는 선수단에서도 예외가 없다', () => {
    const rows = [...keepersOf([12, 12, 12], [150, 140, 130]), ...field(14), star].map((spec, i) => makeRow(i + 1, spec))
    // 일부 선수: 나이·주급·숙련 숫자를 지운다
    rows[5].cells[header('age')] = { raw: '', num: null }
    rows[6].cells[header('wage')] = { raw: '', num: null }
    delete rows[7].ratings
    const analysis = analyseTactic({ rows, columns: base.columns, today: base.today, formation: '4-4-2', slotRoles: {}, roleWeights: {} })!
    const players = firstTeamPlayers(rows, base.columns)
    for (const args of [{ norms }, { norms: undefined }, { norms, wageModel: null }, { norms, wageModel: model }]) {
      const result = surplusReport({ players, rows, columns: base.columns, analysis, roleWeights: {}, ...args })
      for (const row of result.rows) {
        expect(Number.isFinite(row.score)).toBe(true)
        expect(row.reason.endsWith('.')).toBe(true)
      }
    }
    // 기준 분포가 없으면 자리가 없는 선수의 적합도 위험은 보통(0.5)이다
    const none = surplusReport({ players, rows, columns: base.columns, analysis, roleWeights: {}, norms: undefined, wageModel: model })
    const unknown = none.rows.find((row) => row.name === '별')
    if (unknown) {
      expect(unknown.fit).toBe('unknown')
      expect(unknown.unknown).toContain('fit')
      expect(unknown.parts.fit).toBe(50 * UNKNOWN_RISK)
    }
    // 포지션이 전술에 하나도 없는 선수만 있는 1군
    const odd = Array.from({ length: 12 }, (_, i) => makeRow(i + 1, { name: `윙${i}`, spots: { AML: 20, AMR: 20 }, level: 12 }))
    const oddAnalysis = analyseTactic({ rows: odd, columns: base.columns, today: base.today, formation: '4-4-2', slotRoles: {}, roleWeights: {}, norms })!
    expect(() => surplusReport({ players: firstTeamPlayers(odd, base.columns), rows: odd, columns: base.columns, analysis: oddAnalysis, roleWeights: {}, norms, wageModel: model })).not.toThrow()
  })
})

describe('정리 후보 고르기(목업 선수단)', () => {
  const squad = mockSquad(false)
  const players = firstTeamPlayers(squad.rows, squad.columns)
  const analysis = analyseTactic({ rows: squad.rows, columns: squad.columns, today: squad.today, formation: '4-2-3-1', slotRoles: {}, roleWeights: {} })!
  const report = surplusReport({ players, rows: squad.rows, columns: squad.columns, analysis, roleWeights: {} })

  it('선발과 자리별 첫 후보는 대상이 아니고, 점수가 높은 순서다', () => {
    const used = new Set<number>()
    for (const slot of analysis.slots) {
      if (slot.slot.starter) used.add(slot.slot.starter.idx)
      if (slot.slot.backups[0]) used.add(slot.slot.backups[0].idx)
    }
    expect(report.rows.length).toBeGreaterThan(0)
    expect(report.rows.length).toBeLessThanOrEqual(5)
    for (const row of report.rows) expect(used.has(row.uid)).toBe(false)
    const scores = report.rows.map((row) => row.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    for (const row of report.rows) expect(row.reason.endsWith('.')).toBe(true)
    for (const row of report.rows.filter((each) => each.fit === 'slot' && each.fitGap !== null && each.fitGap >= 0.5)) expect(row.reason).toContain('보통 점수 차이의')
  })

  it('임대 유망주는 정리 후보와 겹치지 않고, 클 여지가 있다(나이 ≤ 23, PA - CA ≥ 10, 이득 ≥ 0.5σ)', () => {
    const prospectIds = new Set(report.prospects.map((row) => row.uid))
    for (const row of report.rows) expect(prospectIds.has(row.uid)).toBe(false)
    for (const row of report.prospects) {
      expect(row.age!).toBeLessThanOrEqual(23)
      expect(row.room).toBeGreaterThanOrEqual(10)
      expect(row.gain).toBeGreaterThanOrEqual(0.5 * REPRESENTATIVE_SIGMA - 0.1)
    }
  })

  it('골키퍼는 능력이 높은 세 명을 정리 후보에서 뺀다', () => {
    const keepers = players.filter((each) => each.position.startsWith('GK'))
    const top3 = new Set([...keepers].sort((a, b) => (b.ca ?? 0) - (a.ca ?? 0)).slice(0, 3).map((each) => each.uid))
    for (const row of report.rows) expect(top3.has(row.uid)).toBe(false)
  })
})

describe('연령 구조와 계약 만료', () => {
  it('네 구간으로 나누고 비율의 합이 1이다', () => {
    const ages = [18, 21, 22, 25, 26, 29, 30, 34, null]
    const result = ageStructure(ages.map((age, i) => player({ uid: i + 1, age })))
    expect(result.bands.map((band) => band.count)).toEqual([2, 2, 2, 2])
    expect(result.known).toBe(8)
    expect(result.bands.reduce((sum, band) => sum + band.share, 0)).toBeCloseTo(1, 10)
    expect(result.average).toBe(25.6)
    expect(result.bands[3].players.map((each) => each.age)).toEqual([34, 30])
  })

  it('오늘부터 1년 이내와 1~2년 사이로 나눈다', () => {
    const today = { year: 2026, month: 1, day: 3 }
    const at = (year: number, month: number, day: number) => ({ year, month, day })
    const result = contractWindows(
      [
        player({ uid: 1, contractEnd: at(2026, 6, 30), wage: 1000 }),
        player({ uid: 2, contractEnd: at(2027, 1, 3), wage: 2000 }),
        player({ uid: 3, contractEnd: at(2027, 6, 30) }),
        player({ uid: 4, contractEnd: at(2028, 1, 3) }),
        player({ uid: 5, contractEnd: at(2029, 6, 30) }),
        player({ uid: 6, contractEnd: null })
      ],
      today
    )
    expect(result.known).toBe(5)
    expect(result.within1y.map((row) => row.uid)).toEqual([1, 2])
    expect(result.within2y.map((row) => row.uid)).toEqual([3, 4])
    expect(result.wageWithin1y).toBe(3000)
    expect(contractWindows([player({ uid: 1, contractEnd: at(2026, 6, 30) })], undefined).known).toBe(0)
  })

  it('이미 계약이 끝난 선수는 "12개월 안" 목록에서 빼고 따로 센다(4회차)', () => {
    const today = { year: 2026, month: 1, day: 3 }
    const at = (year: number, month: number, day: number) => ({ year, month, day })
    const result = contractWindows(
      [
        player({ uid: 1, contractEnd: at(2025, 12, 31), wage: 700 }),
        player({ uid: 2, contractEnd: at(2026, 1, 3), wage: 1000 }),
        player({ uid: 3, contractEnd: at(2026, 6, 30), wage: 2000 })
      ],
      today
    )
    expect(result.expired.map((row) => row.uid)).toEqual([1])
    expect(result.within1y.map((row) => row.uid)).toEqual([2, 3])
    expect(result.known).toBe(3)
    expect(result.wageWithin1y).toBe(3000)
    const line = buildBrief({ table: null, recent: [], next: null, need: null, expiring: { known: 3, count: 2, names: ['가', '나'], expired: 1 } })[0]
    expect(line.text).toContain('12개월 안에 계약이 끝나는 1군 선수가 2명입니다')
    expect(line.text).toContain('이미 계약이 끝난 선수가 1명 있습니다')
    const none = buildBrief({ table: null, recent: [], next: null, need: null, expiring: { known: 3, count: 0, names: [], expired: 1 } })[0]
    expect(none.text).toContain('12개월 안에 계약이 끝나는 1군 선수는 없습니다')
    expect(none.text).toContain('이미 계약이 끝난 선수가 1명')
    expect(none.tone).toBe('info')
    expect(buildBrief({ table: null, recent: [], next: null, need: null, expiring: { known: 3, count: 0, names: [] } })[0].tone).toBe('good')
  })
})

describe('오늘의 브리핑', () => {
  const row = (position: number, teamId: number, points: number, mine = false): SeasonTableRow => ({
    position, teamId, name: `팀${teamId}`, clubUid: null, played: 10, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points, mine
  })
  const table = [row(1, 1, 30), row(2, 2, 27), row(3, 3, 25, true), row(4, 4, 20)]
  const match = (over: Partial<SeasonMatch>): SeasonMatch => ({
    date: { year: 2026, month: 1, day: 10 }, time: null, opponentId: 4, opponent: '팀4', clubUid: null, home: true, league: true, round: 1, played: true,
    goalsFor: 2, goalsAgainst: 0, result: 'win', ...over
  })

  it('자료가 있는 문장만, 근거 숫자와 함께 쓴다', () => {
    const lines = buildBrief({
      table,
      recent: [match({}), match({ goalsFor: 1, goalsAgainst: 1, result: 'draw' }), match({ goalsFor: 3, goalsAgainst: 1 })],
      next: match({ played: false, goalsFor: null, goalsAgainst: null, result: null }),
      need: { label: '중앙 수비 1', roleLabel: '중앙 수비수', need: 62, level: 'urgent', levelLabel: '시급', reason: '주전이 약합니다.', formation: '4-2-3-1' },
      expiring: { known: 20, count: 4, names: ['가', '나', '다', '라'] }
    })
    expect(lines.map((line) => line.id)).toEqual(['standing', 'form', 'next', 'need', 'contracts'])
    expect(lines[0].text).toContain('리그 3위')
    expect(lines[0].text).toContain('승점 5점 뒤져')
    expect(lines[0].text).toContain('2위와는 2점 차이')
    expect(lines[1].text).toContain('2승 1무')
    expect(lines[1].text).toContain('6득점 2실점')
    expect(lines[2].text).toContain('홈, 팀4(리그 4위, 승점 20점)')
    expect(lines[3].tone).toBe('bad')
    expect(lines[4].text).toContain('4명')
    expect(lines[4].text).toContain('외')
  })

  const needLine = (level: 'urgent' | 'recommended' | 'normal' | 'fine', levelLabel: string, value: number): string =>
    buildBrief({ table: null, recent: [], next: null, need: { label: '중앙 수비 2자리', roleLabel: '센터백', need: value, level, levelLabel, reason: '주전이 약합니다.', formation: '4-2-3-1' }, expiring: null })[0].text

  it('"가장 보강이 급한 자리"는 보강 권장·시급에만 쓰고, 보통이면 "보강 필요도가 가장 높은 자리"로 쓴다', () => {
    expect(needLine('urgent', '시급', 62)).toContain('가장 보강이 급한 자리는')
    expect(needLine('recommended', '보강 권장', 40)).toContain('가장 보강이 급한 자리는')
    const normal = needLine('normal', '보통', 25.3)
    expect(normal).not.toContain('급한')
    expect(normal).toContain('보강 필요도가 가장 높은 자리는 중앙 수비 2자리(센터백)입니다. 보강 필요도 25.3점(보통).')
  })

  it('최근 경기 어조: 무패이고 절반 이상 승리, 또는 5경기 기준 패 1 이하·승 4 이상(경기 수가 적으면 비례)이면 좋음이다', () => {
    const tone = (results: Array<'win' | 'draw' | 'loss'>): string =>
      buildBrief({ table: null, recent: results.map((result) => match({ result, goalsFor: result === 'win' ? 2 : 0, goalsAgainst: result === 'loss' ? 1 : 0 })), next: null, need: null, expiring: null })[0].tone
    expect(tone(['win', 'win', 'win', 'win', 'loss'])).toBe('good')
    expect(tone(['win', 'win', 'win', 'draw', 'draw'])).toBe('good')
    expect(tone(['win', 'win', 'draw', 'loss', 'loss'])).toBe('info')
    expect(tone(['win', 'win', 'win', 'loss', 'loss'])).toBe('info')
    expect(tone(['win', 'win', 'loss', 'loss', 'loss'])).toBe('bad')
    // 3경기라면 비례: 패 1은 0.6 초과라 좋음이 아니고, 무패 3승만 좋음
    expect(tone(['win', 'win', 'loss'])).toBe('info')
    expect(tone(['win', 'win', 'win'])).toBe('good')
    expect(tone(['win', 'win', 'win', 'win', 'win', 'loss', 'loss', 'draw', 'win', 'win'])).toBe('info')
  })

  it('읽은 경기가 3경기 미만이면 좋음·위험 대신 참고(info)다. 1경기 1패를 위험으로 쓰지 않는다(4회차)', () => {
    const tone = (results: Array<'win' | 'draw' | 'loss'>): string =>
      buildBrief({ table: null, recent: results.map((result) => match({ result, goalsFor: result === 'win' ? 2 : 0, goalsAgainst: result === 'loss' ? 1 : 0 })), next: null, need: null, expiring: null })[0].tone
    expect(tone(['loss'])).toBe('info')
    expect(tone(['win'])).toBe('info')
    expect(tone(['win', 'loss'])).toBe('info')
    expect(tone(['loss', 'loss'])).toBe('info')
    // 3경기부터는 예전 규칙
    expect(tone(['loss', 'loss', 'win'])).toBe('bad')
    expect(tone(['win', 'win', 'win'])).toBe('good')
  })

  it('자료가 없으면 그 문장을 건너뛴다', () => {
    expect(buildBrief({ table: null, recent: [], next: null, need: null, expiring: null })).toEqual([])
    const first = buildBrief({ table: [row(1, 1, 30, true), row(2, 2, 27)], recent: [], next: null, need: null, expiring: { known: 5, count: 0, names: [] } })
    expect(first[0].text).toContain('리그 1위')
    expect(first[0].text).toContain('3점 앞서')
    expect(first[1].text).toContain('끝나는 1군 선수는 없습니다')
  })
})

describe('임대 선수 가리기', () => {
  const rec = (teamId: number, start: number, end: number | null): SaveContract => ({
    teamId,
    wage: 1000,
    start: { year: 2025, day: start },
    end: end === null ? null : { year: 2028, day: end },
    status: end === null ? 0 : 3
  })
  const today = { year: 2026, day: 3 }

  it('원 소속 계약과 임대받은 팀의 만료일 없는 기록이 함께 있으면 원 소속을 돌려준다', () => {
    expect(loanLender([rec(10, 100, 181), rec(20, 174, null)], today, 20)).toBe(10)
    // 원 소속이 임대 뒤에 재계약해도 마찬가지
    expect(loanLender([rec(20, 174, null), rec(10, 178, 181)], today, 20)).toBe(10)
  })

  it('임대 선수의 주급·만료일·입지는 원 소속 계약 기록(loanParent)에서 읽는다', () => {
    const parent = { ...rec(10, 100, 181), wage: 207_000, status: 2 }
    const loan = { ...rec(20, 174, null), wage: 0 }
    expect(loanParent([parent, loan], today, 20)).toBe(parent)
    expect(loanParent([parent, loan], today, 20)?.end).not.toBeNull()
    expect(loanParent([rec(10, 100, 181)], today, 10)).toBeNull()
  })

  it('이적이거나 계약이 하나뿐이거나 아직 시작하지 않은 기록은 임대가 아니다', () => {
    expect(loanLender([rec(10, 100, 181), rec(20, 174, 181)], today, 20)).toBeNull()
    expect(loanLender([rec(20, 174, null)], today, 20)).toBeNull()
    expect(loanLender([rec(10, 100, 181)], today, 10)).toBeNull()
    expect(loanLender([rec(10, 100, 181), { ...rec(20, 174, null), start: { year: 2026, day: 200 } }], today, 20)).toBeNull()
    // 임대받은 팀이 선수의 현재 소속이 아니면 임대로 보지 않는다
    expect(loanLender([rec(10, 100, 181), rec(20, 174, null)], today, 30)).toBeNull()
  })
})
