/**
 * 수식 검토 5회차 반영(fix-5)의 단위 시험. 선수·구단 이름과 숫자는 모두 지어낸 것이다.
 * 시험 사례 T1~T12는 검토 보고서 4.1절의 모양을 지어낸 값으로 옮겼다.
 */
import { describe, expect, it } from 'vitest'
import {
  buildBrief,
  contractWindows,
  expectedWage,
  fitWageModel,
  wageZ,
  type FirstTeamPlayer
} from '../src/shared/dashboard'
import { FIELDS } from '../src/shared/fields'
import { joinClauses, linkForm } from '../src/shared/korean'
import {
  betaGrowFromScores,
  BETA_MIN_POPULATION,
  normFromScores,
  type RoleNorm
} from '../src/shared/norms'
import { formatPounds, formatWon } from '../src/shared/playerView'
import {
  clubStature,
  immediateFit,
  maturityFit,
  realismOf,
  recommend,
  STATURE_CLUB_MARGIN,
  tierCutoffs,
  tierRanker,
  TRAIT_WEIGHTS,
  type RecommendContext,
  type RecommendInput,
  type TraitId,
  type Traits
} from '../src/shared/recommend'
import { analyseTactic, loanEndFrom, type TacticInput } from '../src/shared/tactic'
import type { CellValue, ColumnInfo, PlayerRow } from '../src/shared/types'
import {
  categoriesOf,
  gapVsAnchor,
  GROWTH_SHARE_TABLE,
  GROWTH_SHARE_TABLE_GOALKEEPER,
  growthBetaOf,
  growthGain,
  growthShare,
  hasGrowthRoom,
  prospectCheck,
  rotationWindowOf,
  type CandidateBench
} from '../src/shared/world'

const norm = (over: Partial<RoleNorm> = {}): RoleNorm => ({ mu: 72, sigma: 3.15, beta: 0.28, n: 100, caRef: 153, ...over })

/** 난수(같은 씨앗이면 같은 값) */
function rng(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

// ---------- 수정 A: 구단 체급 ----------

describe('수정 A: 영입 현실성에 파는 구단의 체급', () => {
  const asked = (over: Partial<RecommendInput> = {}): Pick<RecommendInput, 'hasClub' | 'wage' | 'ca' | 'squadStatus' | 'sellerStature' | 'signedWith'> => ({
    hasClub: true,
    wage: null,
    ca: 150,
    squadStatus: 3,
    sellerStature: 167,
    signedWith: null,
    ...over
  })
  const mine = { starter: null, money: null, myStature: 163 }

  it('구단 체급: 상위 11명의 중간값이고, 선수가 5명 미만이면 모른다', () => {
    expect(clubStature([150, 140, 130, 120])).toBeNull()
    expect(clubStature([150, 140, 130, 120, 110])).toBe(130)
    // 12명이면 상위 11명만: 중간값은 6번째
    const twelve = Array.from({ length: 12 }, (_, i) => 100 + i * 2)
    expect(clubStature(twelve)).toBe(twelve.slice().sort((a, b) => b - a)[5])
    // 5~10명이면 있는 사람만으로(짝수면 가운데 둘의 평균)
    expect(clubStature([170, 160, 150, 140, 130, 120])).toBe(145)
  })

  it('같거나 강한 구단의 주전이면 낮다(T2: 체급 167 대 163). 이유 문장에 두 체급이 들어간다', () => {
    const result = realismOf(asked(), mine)
    expect(result.low).toBe(true)
    expect(result.reasons[0]).toBe('소속 구단의 주전 수준(현재 능력 167)이 우리(163)와 비슷하거나 높고, 그 팀의 주전급이라 내주지 않을 가능성이 큽니다')
  })

  it('약한 구단(153)이면 낮음이 아니다(T2: 핵심 선수여도)', () => {
    expect(realismOf(asked({ sellerStature: 153, squadStatus: 1 }), mine).low).toBe(false)
  })

  it('경계: 내 체급 - 3과 같으면 낮고, 그보다 1 낮으면 낮지 않다', () => {
    expect(STATURE_CLUB_MARGIN).toBe(3)
    expect(realismOf(asked({ sellerStature: 160 }), mine).low).toBe(true)
    expect(realismOf(asked({ sellerStature: 159 }), mine).low).toBe(false)
  })

  it('입지가 로테이션(4)이나 교체 카드(5)이면 같은 구단이어도 낮음이 아니다. 핵심·중요·주전·주전 골키퍼는 낮다', () => {
    for (const status of [4, 5, 7, 9, 10]) expect(realismOf(asked({ squadStatus: status }), mine).low, `입지 ${status}`).toBe(false)
    for (const status of [1, 2, 3, 15]) expect(realismOf(asked({ squadStatus: status }), mine).low, `입지 ${status}`).toBe(true)
  })

  it('체급을 모르면(파는 팀 선수 5명 미만, 내 팀 선수 5명 미만) 이 조건은 보지 않는다. 소속이 없으면 보지 않는다', () => {
    expect(realismOf(asked({ sellerStature: null }), mine).low).toBe(false)
    expect(realismOf(asked(), { ...mine, myStature: null }).low).toBe(false)
    expect(realismOf(asked({ hasClub: false }), mine).low).toBe(false)
  })

  it('등급만 바꾸고 총점은 그대로다: 체급·계약 정보가 있어도 없어도 총점과 항목 점수가 같다', () => {
    const traits = {} as Traits
    for (const id of Object.keys(TRAIT_WEIGHTS) as TraitId[]) traits[id] = 12
    const input: RecommendInput = {
      category: 'starter', goalkeeper: false, roleScore: 76, roleRating: 20, age: 26, ca: 160, pa: 165, value: 40_000_000, wage: 100_000,
      contractEnd: 2028 * 1000 + 100, squadStatus: 3, hasClub: true, traits
    }
    const ctx: RecommendContext = {
      starter: { name: '가온', score: 74, ca: 155, age: 27 }, backup: { score: 71 }, today: { year: 2026, day: 3 },
      money: { medianWage: 50_000, topWage: 200_000, medianValue: 20_000_000, topValue: 90_000_000 }, norm: norm()
    }
    const plain = recommend(input, ctx)
    const crowded = recommend({ ...input, sellerStature: 170 }, { ...ctx, myStature: 163 })
    expect(plain.realism.low).toBe(false)
    expect(crowded.realism.low).toBe(true)
    expect(crowded.total).toBe(plain.total)
    expect(crowded.components.map((each) => each.points)).toEqual(plain.components.map((each) => each.points))
  })

  it('T2. 현실적인 후보만으로 등급 경계를 정한다: 낮은 선수 하나가 맨 위여도 현실적인 9명은 k = (1, 2, 5)이고 낮은 선수는 고려까지다', () => {
    const realistic = [73.0, 69.8, 69.5, 65.8, 63.6, 63.0, 62.9, 61.6, 60.9]
    const ranker = tierRanker([{ total: 80.1, low: true }, ...realistic.map((total) => ({ total, low: false }))])
    expect(tierCutoffs(realistic.length)).toEqual([1, 2, 5])
    expect(ranker(80.1, true)).toBe('maybe')
    expect(realistic.map((total) => ranker(total))).toEqual(['top', 'good', 'maybe', 'maybe', 'maybe', 'low', 'low', 'low', 'low'])
  })
})

// ---------- 수정 H: 로테이션 창 ----------

describe('수정 H: 로테이션 창과 내년의 기준', () => {
  const n = norm()

  it('T6. 후보가 한 명뿐인 그룹은 창을 아래로 연다: [68.9, 72.0)', () => {
    const bench: CandidateBench = { starter: { name: '주전', score: 72.8, ca: 157, age: 26 }, backup: { name: '후보', score: 72.5, age: 20 }, thin: true }
    const window = rotationWindowOf(bench, n)
    expect(window.line).toBeCloseTo(72.8 - 0.25 * 3.15, 6)
    expect(window.floor).toBeCloseTo(72.8 - 3.15 - 0.25 * 3.15, 6)
    expect(window.floor).toBeCloseTo(68.86, 2)
    // 적합도 70은 새 창에서는 로테이션이고, 얇지 않은 그룹(예전 식)에서는 후보보다 낮아 아니다
    const player = { score: 70, age: 27, ca: 150, pa: 150, hasClub: true }
    expect(categoriesOf(player, bench, n)).toEqual(['rotation'])
    expect(categoriesOf(player, { ...bench, thin: false }, n)).toEqual([])
  })

  it('후보가 둘 이상이면(얇지 않음) 예전과 같다: floor = max(첫 후보, 기준 - 1.5σ) - 0.25σ', () => {
    const bench: CandidateBench = { starter: { name: '주전', score: 72.8, ca: 157, age: 26 }, backup: { name: '후보', score: 72.5, age: 20 }, thin: false }
    const window = rotationWindowOf(bench, n)
    expect(window.floor).toBeCloseTo(72.5 - 0.25 * 3.15, 6)
    // 후보가 없으면 기준 - 1.5σ - 0.25σ(예전과 같다)
    const none = rotationWindowOf({ starter: bench.starter, backup: null }, n)
    expect(none.floor).toBeCloseTo(72.8 - 1.5 * 3.15 - 0.25 * 3.15, 6)
  })

  it('T7. 나이 비대칭: 주전 76.0(34세, 기준 73.0)보다 첫 후보 74.0(28세)이 낫다면 그 후보가 내년의 기준이고 로테이션 창은 비어 있다', () => {
    const bench: CandidateBench = { starter: { name: '노장', score: 76, ca: 160, age: 34 }, backup: { name: '후보', score: 74, age: 28 }, thin: false }
    const window = rotationWindowOf(bench, n)
    expect(window.anchor).toBeCloseTo(73, 6)
    expect(window.next).toBeCloseTo(74, 6)
    expect(window.line).toBeCloseTo(73.2125, 4)
    expect(window.floor).toBeCloseTo(window.line, 6)
    // 73.1은 첫 후보(74.0)보다 낮아 즉시 전력도 로테이션도 아니다. 예전 식(기준 73.0)이면 즉시 전력이었다
    const low = { score: 73.1, age: 27, ca: 155, pa: 155, hasClub: true }
    expect(categoriesOf(low, bench, n)).toEqual([])
    expect(73.1 >= 73 - 0.25 * 3.15).toBe(true)
    // 73.3은 즉시 전력이다
    expect(categoriesOf({ ...low, score: 73.3 }, bench, n)).toEqual(['starter'])
  })

  it('첫 후보에게도 나이 하락을 뺀다(31세부터 해마다 1점, 골키퍼는 34세부터)', () => {
    const bench: CandidateBench = { starter: { name: '주전', score: 72, ca: 150, age: 25 }, backup: { name: '노장 후보', score: 76, age: 34 }, thin: false }
    expect(rotationWindowOf(bench, n).backupEff).toBeCloseTo(73, 6)
    expect(rotationWindowOf(bench, n).next).toBeCloseTo(73, 6)
    expect(rotationWindowOf(bench, n, true).backupEff).toBeCloseTo(76, 6)
  })

  it('즉시 전력 항과 표의 "주전 대비"는 anchor를 그대로 쓴다(내년의 기준 anchor\'가 아니다)', () => {
    const bench: CandidateBench = { starter: { name: '노장', score: 76, ca: 160, age: 34, shownScore: 77 }, backup: { name: '후보', score: 74, age: 28 }, thin: false }
    const withBackup = immediateFit(75, { starter: bench.starter!, backup: { score: 74 }, norm: n }, 'starter')
    const anchorOnly = immediateFit(75, { starter: bench.starter!, backup: null, norm: n }, 'starter')
    expect(withBackup).not.toBe(anchorOnly)
    expect(gapVsAnchor(75, bench, n)).toBeCloseTo(75 - 73, 1)
  })

  it('유망주 자격도 anchor\'를 쓴다: 첫 후보가 기준을 끌어올리면 예전에는 들던 어린 선수가 빠진다', () => {
    const bench: CandidateBench = { starter: { name: '노장', score: 70, ca: 150, age: 34 }, backup: { name: '후보', score: 74, age: 27 }, thin: false }
    // 18세 CA 130/PA 170: 이득 0.28 × 0.7 × 40 = 7.8 ≥ 0.5σ. 적합도 63 + 7.8 = 70.8
    const player = { score: 63, age: 18, ca: 130, pa: 170, hasClub: true }
    const check = prospectCheck(player, bench, n)
    expect(check.room).toBe(true)
    expect(check.line).toBeCloseTo(74 - 0.25 * 3.15, 6)
    expect(check.margin).toBeLessThan(0)
    expect(categoriesOf(player, bench, n)).not.toContain('prospect')
    // 예전 기준(주전 67 = 70 - 3)이면 들었다: 70.8 ≥ 67 - 0.79
    expect(63 + check.gain >= 70 - 3 - 0.25 * 3.15).toBe(true)
  })
})

// ---------- 수정 D: 성장 예측 ----------

describe('수정 D: 성장 예측(β_grow, 골키퍼 전용 성장 몫)', () => {
  it('골키퍼 성장 몫: 17세 이하 0.73, 18세 0.72, 20세 0.58, 22세 0.46, 24세 0.28, 26세 이상 0이고 사이는 직선이다. 필드 표는 그대로다', () => {
    for (const [age, share] of GROWTH_SHARE_TABLE_GOALKEEPER) expect(growthShare(age, true), `${age}세`).toBeCloseTo(share, 10)
    expect(growthShare(15, true)).toBeCloseTo(0.73, 10)
    expect(growthShare(19, true)).toBeCloseTo(0.65, 10)
    expect(growthShare(23, true)).toBeCloseTo(0.37, 10)
    expect(growthShare(30, true)).toBe(0)
    for (const [age, share] of GROWTH_SHARE_TABLE) expect(growthShare(age), `필드 ${age}세`).toBeCloseTo(share, 10)
    for (let age = 15; age < 35; age++) expect(growthShare(age + 1, true)).toBeLessThanOrEqual(growthShare(age, true) + 1e-12)
  })

  it('T9. 22세 골키퍼 CA 140/PA 160, β 0.299: 지금 식(필드 표) 이득 2.27점 → 수정 2.75점', () => {
    expect(growthGain(22, 140, 160, 0.299, false)).toBeCloseTo(0.299 * 0.38 * 20, 6)
    expect(growthGain(22, 140, 160, 0.299, false)).toBeCloseTo(2.27, 2)
    expect(growthGain(22, 140, 160, 0.299, true)).toBeCloseTo(0.299 * 0.46 * 20, 6)
    expect(growthGain(22, 140, 160, 0.299, true)).toBeCloseTo(2.75, 2)
  })

  it('T10. 19세 수비형 미드 CA 130/PA 170: 지금 β 0.313이면 7.95점, β_grow 0.259이면 6.58점(-1.37점 = -0.35σ, σ 3.92)', () => {
    expect(growthShare(19)).toBeCloseTo(0.635, 10)
    expect(growthGain(19, 130, 170, 0.313)).toBeCloseTo(7.95, 2)
    const grow = growthGain(19, 130, 170, 0.259)
    expect(grow).toBeCloseTo(6.58, 2)
    expect((grow - 7.95) / 3.92).toBeCloseTo(-0.35, 1)
  })

  it('성장을 쓰는 곳이 모두 β_grow를 쓴다: 성숙 시 전력, 유망주 자격, 대시보드 임대 유망주 판정(growthBetaOf)', () => {
    const n = norm({ beta: 0.313, betaGrow: 0.259, sigma: 3.92, mu: 72.8 })
    expect(growthBetaOf(n)).toBe(0.259)
    expect(growthBetaOf(norm({ beta: 0.3 }))).toBe(0.3)
    // 성숙 시 전력
    const ctx = { starter: { name: '주전', score: 72, ca: 150, age: 27 }, backup: null, norm: n }
    const expected = 0.5 + 0.5 * Math.tanh((66 + 0.259 * 0.635 * 40 - 72) / (1.5 * 3.92))
    expect(maturityFit(66, 19, 130, 170, ctx)).toBeCloseTo(expected, 8)
    // 골키퍼는 골키퍼 표를 쓴다
    const gk = 0.5 + 0.5 * Math.tanh((66 + 0.259 * 0.65 * 40 - 72) / (1.5 * 3.92))
    expect(maturityFit(66, 19, 130, 170, ctx, true)).toBeCloseTo(gk, 8)
    // 유망주 자격(클 여지): 이득이 0.5σ = 1.96점 이상이어야 한다
    expect(hasGrowthRoom(19, 130, 170, growthBetaOf(n), n.sigma)).toBe(true)
    expect(hasGrowthRoom(23, 150, 160, growthBetaOf(n), n.sigma)).toBe(false)
    // 골키퍼는 늦게 커서 같은 23세 CA 150/PA 164(σ 3, β 0.3)에서 이득이 1.55점(≥ 1.5)이다. 필드 표면 1.11점이라 클 여지가 없다
    expect(hasGrowthRoom(23, 150, 164, 0.3, 3, true)).toBe(true)
    expect(hasGrowthRoom(23, 150, 164, 0.3, 3, false)).toBe(false)
  })

  it('betaGrow: 현재 능력 110~180 선수들의 기울기. 그 구간 표본이 40명 미만이거나 기울기가 0 이하이면 β', () => {
    // 60~109는 기울기 0.2, 110~180은 0.35, 181~200은 0.1인 지어낸 풀(구간 밖은 기울기에 들어가지 않는다)
    const abilities: number[] = []
    const scores: number[] = []
    for (let ca = 60; ca <= 200; ca++) {
      for (let copy = 0; copy < 3; copy++) {
        abilities.push(ca)
        scores.push(ca < 110 ? 30 + 0.2 * (ca - 60) : ca <= 180 ? 40 + 0.35 * (ca - 110) : 65 + 0.1 * (ca - 181))
      }
    }
    const made = normFromScores(scores, abilities, 150)
    expect(made.betaGrow).toBeCloseTo(0.35, 6)
    expect(made.beta).not.toBeCloseTo(0.35, 2)
    // 구간 표본이 모자라면 β
    const few = betaGrowFromScores([60, 65, 70], [120, 130, 140], 0.28)
    expect(few).toBe(0.28)
    expect(BETA_MIN_POPULATION).toBe(40)
    // 기울기가 0 이하이면 β
    const down = betaGrowFromScores(Array.from({ length: 60 }, (_, i) => 80 - i * 0.1), Array.from({ length: 60 }, (_, i) => 120 + i), 0.31)
    expect(down).toBe(0.31)
    // 선수가 없는 역할도 betaGrow를 싣는다
    expect(normFromScores([], [], 150).betaGrow).toBeDefined()
  })

  it('유망주 탭 점수가 β_grow로 바뀐다: 같은 선수의 성숙 시 전력이 달라진다', () => {
    const traits = {} as Traits
    for (const id of Object.keys(TRAIT_WEIGHTS) as TraitId[]) traits[id] = 12
    const input: RecommendInput = {
      category: 'prospect', goalkeeper: false, roleScore: 62, roleRating: 20, age: 19, ca: 130, pa: 170, value: null, wage: null, contractEnd: null, squadStatus: 0, hasClub: false, traits
    }
    const context = (n: RoleNorm): RecommendContext => ({ starter: { name: '주전', score: 70, ca: 150, age: 27 }, backup: null, today: null, money: null, norm: n })
    const low = recommend(input, context(norm({ beta: 0.313, betaGrow: 0.259 })))
    const high = recommend(input, context(norm({ beta: 0.313, betaGrow: 0.313 })))
    expect(high.total).toBeGreaterThan(low.total)
    expect(low.components.find((each) => each.id === 'maturity')!.note).toContain('6.6점 올라')
  })
})

// ---------- 회귀: 단조성 ----------

describe('회귀: 추천 점수의 단조성은 5회차 뒤에도 그대로다(소규모 무작위 표본)', () => {
  const random = rng(20260105)
  const pick = <T,>(list: T[]): T => list[Math.floor(random() * list.length)]
  const traits = {} as Traits
  for (const id of Object.keys(TRAIT_WEIGHTS) as TraitId[]) traits[id] = 12
  const categories = ['all', 'starter', 'rotation', 'prospect', 'free'] as const

  const sample = (): { input: RecommendInput; ctx: RecommendContext } => {
    const goalkeeper = random() < 0.15
    const age = 16 + Math.floor(random() * 22)
    const ca = 90 + Math.floor(random() * 90)
    const hasClub = random() < 0.8
    return {
      input: {
        category: pick([...categories]),
        goalkeeper,
        roleScore: 55 + random() * 30,
        roleRating: pick([20, 18, 16, 15, 12, 10, 8, 3]),
        age,
        ca,
        pa: ca + Math.floor(random() * 40),
        value: random() < 0.7 ? Math.round(1_000_000 + random() * 80_000_000) : null,
        wage: hasClub && random() < 0.9 ? Math.round(10_000 + random() * 300_000) : null,
        contractEnd: hasClub ? (2026 + Math.floor(random() * 5)) * 1000 + 150 : null,
        squadStatus: pick([0, 1, 2, 3, 4, 5, 15]),
        hasClub,
        traits,
        sellerStature: hasClub && random() < 0.7 ? 130 + random() * 40 : null,
        signedWith: random() < 0.1 ? '가상 FC' : null
      },
      ctx: {
        starter: random() < 0.9 ? { name: '주전', score: 65 + random() * 15, ca: 130 + Math.floor(random() * 30), age: 22 + Math.floor(random() * 14) } : null,
        backup: random() < 0.8 ? { score: 60 + random() * 12 } : null,
        today: { year: 2026, day: 3 },
        money: { medianWage: 60_000, topWage: 220_000, medianValue: 20_000_000, topValue: 90_000_000 },
        myStature: 150,
        need: random() * 100,
        norm: norm({ beta: 0.28, betaGrow: 0.2 + random() * 0.15 })
      }
    }
  }

  it('적합도·잠재 능력·숙련이 오르면 총점이 줄지 않고, 체급·계약 정보는 총점을 바꾸지 않는다(등급만 바꾼다)', () => {
    for (let i = 0; i < 400; i++) {
      const { input, ctx } = sample()
      const total = (patch: Partial<RecommendInput>, extra: Partial<RecommendContext> = {}): number => recommend({ ...input, ...patch }, { ...ctx, ...extra }, false).total
      const here = total({})
      expect(total({ roleScore: input.roleScore + 3 }), `적합도 ${i}`).toBeGreaterThanOrEqual(here - 1e-9)
      expect(total({ pa: input.pa + 10 }), `잠재 ${i}`).toBeGreaterThanOrEqual(here - 1e-9)
      if (input.roleRating !== null && input.roleRating < 20) expect(total({ roleRating: input.roleRating + 1 }), `숙련 ${i}`).toBeGreaterThanOrEqual(here - 1e-9)
      expect(total({ sellerStature: null, signedWith: null }, { myStature: null }), `체급 ${i}`).toBe(here)
      expect(total({ sellerStature: 200, signedWith: '가상 FC' }, { myStature: 100 }), `체급 높음 ${i}`).toBe(here)
    }
  })

  it('낮은 현실성(체급·계약 체결)은 등급만 고려로 막는다: 총점이 같은데 낮음 표지가 붙는다', () => {
    let crowded = 0
    for (let i = 0; i < 200; i++) {
      const { input, ctx } = sample()
      const plain = recommend({ ...input, sellerStature: null, signedWith: null }, { ...ctx, myStature: null }, false)
      const full = recommend(input, ctx, false)
      expect(full.total).toBe(plain.total)
      if (full.realism.low && !plain.realism.low) crowded++
    }
    expect(crowded).toBeGreaterThan(0)
  })
})

// ---------- 수정 F: 표의 주전 대비 ----------

describe('수정 F: 표의 "주전 대비"를 설명과 같은 기준으로', () => {
  it('T5. 화면 76.3·숙련 감점 0인 후보와 화면 76.5·f_eff 74.9인 주전: gapEff +1.4, 화면끼리는 -0.2이고 설명 문장은 "1.4점 높습니다"', () => {
    const bench: CandidateBench = { starter: { name: '주전', score: 74.9, shownScore: 76.5, ca: 160, age: 25 }, backup: { name: '후보', score: 72 } }
    expect(gapVsAnchor(76.3, bench, norm())).toBe(1.4)
    expect(Math.round((76.3 - bench.starter!.shownScore!) * 10) / 10).toBe(-0.2)
    const traits = {} as Traits
    for (const id of Object.keys(TRAIT_WEIGHTS) as TraitId[]) traits[id] = 12
    const result = recommend(
      { category: 'starter', goalkeeper: false, roleScore: 76.3, roleRating: 20, age: 24, ca: 160, pa: 165, value: null, wage: null, contractEnd: null, squadStatus: 0, hasClub: false, traits },
      { starter: bench.starter, backup: bench.backup, today: null, money: null, norm: norm() }
    )
    expect(result.components[0].note).toContain('1.4점 높습니다')
    expect(gapVsAnchor(result.fit.effective, bench, norm())).toBeGreaterThan(0)
  })

  it('주전이 나이 들어 기준이 내려가면 그 기준과 견준다. 비교 기준 주전이 없으면 null', () => {
    const bench: CandidateBench = { starter: { name: '노장', score: 76, shownScore: 77, ca: 160, age: 34 }, backup: null }
    expect(gapVsAnchor(75, bench, norm())).toBe(2)
    expect(gapVsAnchor(75, { starter: null, backup: null }, norm())).toBeNull()
  })
})

// ---------- 수정 J: 주급 모델 2차항 ----------

describe('수정 J: 주급 모델에 현재 능력의 2차항', () => {
  it('휘어진 합성 자료에서 b2가 음수로 나오고 계수를 되찾는다(CA 145 기준)', () => {
    const random = rng(4242)
    const normal = (): number => (Array.from({ length: 12 }, random).reduce((sum, value) => sum + value, 0) - 6) * 0.2
    const points = Array.from({ length: 900 }, (_, i) => {
      const ca = 80 + Math.floor(random() * 105)
      const age = 17 + (i % 20)
      const x = ca - 145
      return { ca, age, wage: Math.exp(11.28 + 0.046 * x - 0.018 * (x / 10) ** 2 - (age < 21 ? 0.417 : 0) + (age >= 30 ? 0.23 : 0) + normal()) }
    })
    const model = fitWageModel(points)!
    expect(model.b2).toBeLessThan(0)
    expect(model.b2).toBeCloseTo(-0.018, 2)
    expect(model.b).toBeCloseTo(0.046, 2)
    expect(model.a).toBeCloseTo(11.28, 1)
    expect(model.c1).toBeCloseTo(-0.417, 1)
    expect(model.c2).toBeCloseTo(0.23, 1)
    // 직선 모델이면 스타(CA 185)를 크게 과대 예측한다: 2차항 모델의 예측이 더 낮다
    const flat = { ...model, b2: 0 }
    expect(expectedWage(model, 185, 27)).toBeLessThan(expectedWage(flat, 185, 27))
  })

  it('T8. CA 166, 26세, 주급 300,000파운드: 예측 약 192,000파운드, 배수 1.56, z ≈ 1.06 → 과다 의심(z ≥ 1)', () => {
    const model = { a: 11.28, b: 0.046, b2: -0.018, c1: -0.417, c2: 0.23, s: 0.421 }
    const result = wageZ(model, 300_000, 166, 26)
    expect(result.expected).toBeGreaterThan(191_000)
    expect(result.expected).toBeLessThan(193_500)
    expect(result.ratio).toBeCloseTo(1.56, 2)
    expect(result.z).toBeCloseTo(1.06, 2)
    // 2차항이 없으면(예전 모델 모양) 같은 주급이 의심 밖이다
    const straight = { ...model, b2: 0, a: 11.28 - 0.0135 }
    expect(wageZ(straight, 300_000, 166, 26).z).toBeLessThan(wageZ(model, 300_000, 166, 26).z + 1)
  })

  it('능력이 서로 다른 값이 둘뿐이면 2차항을 세우지 못해 b2 0인 직선 모델로 맞춘다', () => {
    const points = Array.from({ length: 60 }, (_, i) => ({ ca: i % 2 === 0 ? 100 : 140, wage: Math.exp(8 + (i % 2 === 0 ? 0 : 1.6) + (i % 3) * 0.01) }))
    const model = fitWageModel(points)
    expect(model).not.toBeNull()
    expect(model!.b2).toBe(0)
    expect(model!.b).toBeCloseTo(0.04, 2)
  })

  it('자유 계약 기대 주급도 같은 식이다. 2차항을 모르는(옛) 계수는 0으로 본다', () => {
    const model = { a: 11.28, b: 0.046, b2: -0.018, c1: -0.417, c2: 0.23 }
    const x = 166 - 145
    expect(expectedWage(model, 166, 26)).toBeCloseTo(Math.exp(11.28 + 0.046 * x - 0.018 * (x / 10) ** 2), 6)
    expect(expectedWage({ a: 11.28, b: 0.046, c1: 0, c2: 0 }, 166)).toBeCloseTo(Math.exp(11.28 + 0.046 * x), 6)
  })
})

// ---------- 수정 L: 금액 표시 ----------

describe('수정 L: 금액 표시 반올림', () => {
  it('1만~1억 구간: 반올림 결과가 10,000만이 되면 1억 원', () => {
    expect(formatWon(99_995_000)).toBe('1억 원')
    expect(formatWon(99_994_999)).toBe('9,999만 원')
    expect(formatWon(99_999_999)).toBe('1억 원')
    expect(formatWon(100_000_000)).toBe('1억 원')
  })

  it('다른 구간의 경계: 10억 직전·100억 직전·1만 원 직전도 맞는 단위로 쓴다', () => {
    expect(formatWon(999_950_000)).toBe('10억 원')
    expect(formatWon(999_400_000)).toBe('9.99억 원')
    expect(formatWon(9_999_500_000)).toBe('100억 원')
    expect(formatWon(9_994_999_999)).toBe('99.9억 원')
    expect(formatWon(9_999.5)).toBe('1만 원')
    expect(formatWon(9_999.4)).toBe('9,999원')
    expect(formatWon(10_000)).toBe('1만 원')
    expect(formatWon(-99_995_000)).toBe('-1억 원')
  })

  it('파운드로 계산한 값을 원화로 적는다(1파운드 = 1,875원)', () => {
    expect(formatPounds(18_398)).toBe('3,450만 원')
    expect(formatPounds(0)).toBe('')
  })
})

// ---------- 한국어 이음 ----------

describe('이유 문장을 잇는 꼴', () => {
  it('"ㅂ니다"로 끝나는 동사도 앞 절에서는 이음꼴로 바뀐다', () => {
    expect(linkForm('주전이 34세입니다')).toBe('주전이 34세이고')
    expect(linkForm('후보가 없습니다')).toBe('후보가 없고')
    expect(linkForm('임대 선수라 6월 30일에 원 소속 팀으로 돌아갑니다')).toBe('임대 선수라 6월 30일에 원 소속 팀으로 돌아가고')
    expect(linkForm('뛰어난 수준(76.0점)에는 못 미칩니다')).toBe('뛰어난 수준(76.0점)에는 못 미치고')
    expect(linkForm('후보가 하나뿐이다')).toBe('후보가 하나뿐이다')
    expect(joinClauses(['주전이 임대 선수라 돌아갑니다', '후보가 한 명뿐입니다'])).toBe('주전이 임대 선수라 돌아가고, 후보가 한 명뿐입니다.')
  })
})

// ---------- 전술 분석 시험 도구 ----------

const ATTRS = FIELDS.filter((field) => field.isAttr)
const info = (header: string, field: string): ColumnInfo => ({ header, field, group: 'info', short: header, label: header, isAttr: false, numeric: field !== 'name' && field !== 'position' })
const COLUMNS: ColumnInfo[] = [
  info('이름', 'name'),
  info('포지션', 'position'),
  info('나이', 'age'),
  info('현재 능력', 'ability'),
  info('잠재 능력', 'potential'),
  info('계약 만료', 'contractEnd'),
  ...ATTRS.map((field): ColumnInfo => ({ header: field.label, field: field.id, group: field.group, short: field.short, label: field.label, isAttr: true, numeric: true }))
]
const num = (value: number): CellValue => ({ raw: String(value), num: value })

interface Spec {
  name: string
  position: string
  level: number
  age?: number
  ca?: number
  pa?: number
  end?: number
  loanFrom?: string
}

let counter = 5000
function row(spec: Spec, today: { year: number; month: number; day: number }): PlayerRow {
  const cells: Record<string, CellValue> = {
    이름: { raw: spec.name, num: null },
    포지션: { raw: spec.position, num: null },
    나이: num(spec.age ?? 27),
    '현재 능력': num(spec.ca ?? 120),
    '잠재 능력': num(spec.pa ?? 125),
    '계약 만료': spec.end ? num(spec.end) : { raw: '', num: null }
  }
  for (const field of ATTRS) cells[field.label] = num(spec.level)
  return { idx: counter++, name: spec.name, cells, ...(spec.loanFrom !== undefined ? { loan: { end: loanEndFrom(today), from: spec.loanFrom } } : {}) }
}

const JAN3 = { year: 2026, month: 1, day: 3 }
const base = (rows: PlayerRow[], patch: Partial<TacticInput> = {}): TacticInput => ({
  rows,
  columns: COLUMNS,
  today: JAN3,
  formation: '4-4-2',
  slotRoles: {},
  roleWeights: {},
  ...patch
})

/** 4-4-2를 채우는 선수들. 나이 위험·후계자 완화가 끼어들지 않게 모두 26세 이상이고 계약이 길다 */
function squadSpecs(patch: Partial<Record<string, Partial<Spec>>> = {}): Spec[] {
  const specs: Spec[] = [
    { name: '골키퍼1', position: 'GK', level: 14, age: 28, end: 20300630 },
    { name: '골키퍼2', position: 'GK', level: 11, age: 27, end: 20300630 },
    { name: '왼풀백', position: 'D (L)', level: 13, age: 27, end: 20300630 },
    { name: '왼풀백후보', position: 'D (L)', level: 11, age: 26, end: 20300630 },
    { name: '오른풀백', position: 'D (R)', level: 13, age: 27, end: 20300630 },
    { name: '센터백1', position: 'D (C)', level: 14, age: 28, end: 20300630 },
    { name: '센터백2', position: 'D (C)', level: 13, age: 28, end: 20300630 },
    { name: '센터백3', position: 'D (C)', level: 12, age: 28, end: 20300630 },
    { name: '센터백4', position: 'D (C)', level: 11, age: 30, end: 20300630 },
    { name: '왼미드', position: 'M (L)', level: 13, age: 27, end: 20300630 },
    { name: '오른미드', position: 'M (R)', level: 13, age: 27, end: 20300630 },
    { name: '중미1', position: 'M (C)', level: 14, age: 27, end: 20300630 },
    { name: '중미2', position: 'M (C)', level: 13, age: 28, end: 20300630 },
    { name: '중미3', position: 'M (C)', level: 12, age: 30, end: 20300630 },
    { name: '공격수1', position: 'ST (C)', level: 14, age: 27, end: 20300630 },
    { name: '공격수2', position: 'ST (C)', level: 13, age: 26, end: 20300630 }
  ]
  return specs.map((spec) => ({ ...spec, ...(patch[spec.name] ?? {}) }))
}

describe('수정 B: 임대로 온 선수의 계약 끝(T1)', () => {
  const analyse = (specs: Spec[]) => analyseTactic(base(specs.map((spec) => row(spec, JAN3))))!
  const contractOf = (analysis: ReturnType<typeof analyse>, name: string) => {
    const slot = analysis.slots.find((each) => each.slot.starter?.name === name)!
    return { slot, factor: slot.factors.find((factor) => factor.id === 'contract')! }
  }

  it('임대 끝은 오늘 이후 첫 6월 30일이다(2026-01-03 → 2026-06-30, 178일). 7월이면 다음 해다', () => {
    expect(loanEndFrom(JAN3)).toEqual({ year: 2026, month: 6, day: 30 })
    expect(loanEndFrom({ year: 2026, month: 6, day: 30 })).toEqual({ year: 2026, month: 6, day: 30 })
    expect(loanEndFrom({ year: 2026, month: 7, day: 1 })).toEqual({ year: 2027, month: 6, day: 30 })
    expect(Math.round((Date.UTC(2026, 5, 30) - Date.UTC(2026, 0, 3)) / 86_400_000)).toBe(178)
  })

  it('T1. 임대 주전의 계약 위험은 남은 178일로 계산한다: 0.3 + 0.7·(1 - 178/365) = 0.659 → 계약 항목 +9.9점', () => {
    const owned = analyse(squadSpecs())
    const loaned = analyse(squadSpecs({ 센터백1: { loanFrom: '가상 FC' } }))
    const before = contractOf(owned, '센터백1')
    const after = contractOf(loaned, '센터백1')
    expect(before.factor.points).toBe(0)
    expect(after.factor.points).toBeCloseTo(9.9, 1)
    expect(after.factor.points).toBe(Math.round((0.3 + 0.7 * (1 - 178 / 365)) * 15 * 10) / 10)
    // 필요도가 그만큼 오르고 이유에 임대 이야기가 들어간다
    expect(after.slot.need - before.slot.need).toBeCloseTo(9.9, 1)
    expect(after.slot.reason).toContain('임대 선수라 6월 30일에')
    expect(after.slot.reason).toContain('원 소속 팀(가상 FC)으로 돌아가')
    // 계약 항목 설명에는 날짜가 추정이라고 적는다
    expect(after.factor.note).toContain('추정')
    expect(after.factor.note).toContain('가상 FC')
  })

  it('원 소속을 모르면 "원 소속 팀으로"라고만 적는다', () => {
    const loaned = analyse(squadSpecs({ 센터백1: { loanFrom: '' } }))
    expect(contractOf(loaned, '센터백1').slot.reason).toContain('원 소속 팀으로 돌아가')
    expect(contractOf(loaned, '센터백1').slot.reason).not.toContain('()')
  })

  it('임대가 아닌 선수의 계약 위험은 그대로다(계약이 12개월 넘게 남으면 0)', () => {
    const analysis = analyse(squadSpecs({ 센터백1: { loanFrom: '가상 FC' } }))
    expect(contractOf(analysis, '센터백2').factor.points).toBe(0)
  })

  it('임대 주전의 계약 끝이 오늘과 같은 날이어도 예외 없이 계산한다(위험 1)', () => {
    const june30 = { year: 2026, month: 6, day: 30 }
    const specs = squadSpecs({ 센터백1: { loanFrom: '가상 FC' } })
    const analysis = analyseTactic(base(specs.map((spec) => row(spec, june30)), { today: june30 }))!
    expect(analysis.slots.find((each) => each.slot.starter?.name === '센터백1')!.factors.find((factor) => factor.id === 'contract')!.points).toBe(15)
  })
})

describe('수정 B: 계약 카드와 브리핑이 임대 복귀를 안다', () => {
  const player = (over: Partial<FirstTeamPlayer> & { uid: number }): FirstTeamPlayer => ({
    name: `선수${over.uid}`, age: 25, position: 'M (C)', ca: 120, pa: 125, wage: 50_000, contractEnd: null, ...over
  })

  it('임대 영입 선수는 1년 이내 목록에 임대 끝 날짜로 들어가고 "임대 복귀" 표지를 받는다. 주급 합계에는 넣지 않는다', () => {
    const players = [
      player({ uid: 1, contractEnd: { year: 2026, month: 9, day: 1 }, wage: 70_000 }),
      player({ uid: 2, contractEnd: { year: 2031, month: 6, day: 30 }, wage: 200_000, loan: { end: { year: 2026, month: 6, day: 30 }, from: '가상 FC' } })
    ]
    const windows = contractWindows(players, JAN3)
    expect(windows.within1y.map((each) => each.uid)).toEqual([2, 1])
    const loan = windows.within1y.find((each) => each.uid === 2)!
    expect(loan.daysLeft).toBe(178)
    expect(loan.end).toEqual({ year: 2026, month: 6, day: 30 })
    expect(loan.loan).toEqual({ from: '가상 FC' })
    expect(windows.within1y.find((each) => each.uid === 1)!.loan).toBeUndefined()
    expect(windows.wageWithin1y).toBe(70_000)
    expect(windows.within2y).toHaveLength(0)
  })

  it('브리핑 계약 줄: 임대 복귀가 1명 이상이면 "좋음"이 아니고 문장에 이름이 들어간다', () => {
    const lines = buildBrief({ table: null, recent: [], next: null, need: null, expiring: { known: 25, count: 0, names: [], expired: 0, loans: { count: 1, names: ['가온'] } } })
    const contracts = lines.find((line) => line.id === 'contracts')!
    expect(contracts.text).toBe('12개월 안에 계약이 끝나는 1군 선수는 없습니다. 임대로 온 선수 1명(가온)은 시즌 끝에 원 소속 팀으로 돌아갑니다.')
    expect(contracts.tone).not.toBe('good')
    // 임대 복귀가 없으면 예전과 같다
    const none = buildBrief({ table: null, recent: [], next: null, need: null, expiring: { known: 25, count: 0, names: [], expired: 0, loans: { count: 0, names: [] } } })
    expect(none.find((line) => line.id === 'contracts')!.tone).toBe('good')
    // 계약이 끝나는 선수와 임대 복귀를 합쳐 3명 이상이면 주의
    const many = buildBrief({ table: null, recent: [], next: null, need: null, expiring: { known: 25, count: 2, names: ['가', '나'], loans: { count: 1, names: ['다'] } } })
    expect(many.find((line) => line.id === 'contracts')!.tone).toBe('warn')
    expect(many.find((line) => line.id === 'contracts')!.text).toContain('12개월 안에 계약이 끝나는 1군 선수가 2명입니다(가, 나). 임대로 온 선수 1명(다)은')
  })
})

describe('수정 I: 필요도 이유 문장', () => {
  it('0 ≤ z_eff < 1이면 "조금 높지만 뛰어난 수준(μ+σ)에는 못 미칩니다"로 쓴다', () => {
    // 모든 능력치 13 → 적합도 65. 기준 μ 63.0, σ 4.0이면 z 0.5
    const norms = Object.fromEntries(['gk', 'cb', 'fb', 'wb', 'dm', 'dlp', 'b2b', 'ap', 'am', 'winger', 'if', 'st', 'tm', 'bpd'].map((id) => [id, norm({ mu: 63, sigma: 4 })]))
    const specs: Spec[] = [
      { name: '골키퍼1', position: 'GK', level: 13, age: 28, end: 20300630 },
      { name: '왼풀백', position: 'D (L)', level: 13, age: 27, end: 20300630 },
      { name: '오른풀백', position: 'D (R)', level: 13, age: 27, end: 20300630 },
      { name: '센터백1', position: 'D (C)', level: 13, age: 28, end: 20300630 },
      { name: '센터백2', position: 'D (C)', level: 13, age: 28, end: 20300630 },
      { name: '왼미드', position: 'M (L)', level: 13, age: 27, end: 20300630 },
      { name: '오른미드', position: 'M (R)', level: 13, age: 27, end: 20300630 },
      { name: '중미1', position: 'M (C)', level: 13, age: 27, end: 20300630 },
      { name: '중미2', position: 'M (C)', level: 13, age: 28, end: 20300630 },
      { name: '공격수1', position: 'ST (C)', level: 13, age: 27, end: 20300630 },
      { name: '공격수2', position: 'ST (C)', level: 13, age: 26, end: 20300630 }
    ]
    const analysis = analyseTactic(base(specs.map((spec) => row(spec, JAN3)), { norms }))!
    const slot = analysis.slots.find((each) => each.slot.starter?.name === '센터백1')!
    // 후보가 없어 후보 두께가 큰 이유다. 앞 절이 주전 전력 문장이다
    expect(slot.starterZ).toBeCloseTo(0.5, 1)
    expect(slot.reason).toContain('조금 높지만, 뛰어난 수준(67점)에는 못 미칩니다.')
    expect(slot.reason).not.toContain('조금 높은 수준')
  })

  it('z가 음수이면 예전 문장이다("조금 낮습니다")', () => {
    const norms = Object.fromEntries(['gk', 'cb', 'fb', 'wb', 'dm', 'dlp', 'b2b', 'ap', 'am', 'winger', 'if', 'st', 'tm', 'bpd'].map((id) => [id, norm({ mu: 67, sigma: 4 })]))
    const analysis = analyseTactic(base(squadSpecs().map((spec) => row({ ...spec, level: 13, position: spec.position }, JAN3)), { norms }))!
    const reasons = analysis.slots.map((each) => each.reason).join(' ')
    expect(reasons).toContain('조금 낮')
    expect(reasons).not.toContain('뛰어난 수준')
  })
})

describe('수정 H: 그룹의 얇음과 첫 후보의 나이', () => {
  it('중앙 수비 두 자리에 후보가 둘이면 얇지 않고, 한 명이면 얇다. 첫 후보의 나이가 비교 기준에 실린다', () => {
    const thick = analyseTactic(base(squadSpecs().map((spec) => row(spec, JAN3))))!
    const group = thick.groups.find((each) => each.position === 'DC')!
    expect(group.slots).toHaveLength(2)
    expect(group.bench.thin).toBe(false)
    expect(group.bench.backup?.age).toBeTypeOf('number')

    const thinSpecs = squadSpecs().filter((spec) => spec.name !== '센터백4')
    const thin = analyseTactic(base(thinSpecs.map((spec) => row(spec, JAN3))))!
    const thinGroup = thin.groups.find((each) => each.position === 'DC')!
    expect(thinGroup.bench.thin).toBe(true)
    expect(thin.slots.find((each) => each.slot.position === 'DC')!.backupAge).toBeTypeOf('number')
  })
})
