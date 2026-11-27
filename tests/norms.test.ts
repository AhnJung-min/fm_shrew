import { describe, expect, it } from 'vitest'
import { assignMaximum } from '../src/shared/depth'
import { hasBatchim, joinClauses, josa, linkForm, withJosa } from '../src/shared/korean'
import {
  betaFromScores,
  meanCaAbove,
  DEFAULT_BETA,
  FALLBACK_NORM,
  NORM_MIN_SIGMA,
  normFromScores,
  pickCaRef,
  referenceCa,
  zOf,
  zWords,
  type RoleNorm
} from '../src/shared/norms'
import { AGING_DROP_PER_YEAR, benchmarkOf, categoriesOf, growthShare, hasGrowthRoom, projectedScore, rotationBoundaryLine, type CandidateBench } from '../src/shared/world'

describe('기준 능력', () => {
  it('내 상위 11명 현재 능력의 중간값에서 10을 뺀 값이고 100 아래로는 내려가지 않는다', () => {
    const squad = [175, 173, 170, 166, 163, 162, 160, 157, 155, 153, 150, 140, 120]
    // 상위 11명 중 6번째가 중간값(162)
    expect(referenceCa(squad)).toBe(152)
    expect(referenceCa([120, 110, 100, 90])).toBe(100)
    expect(referenceCa([])).toBe(100)
  })
  it('모집단이 40명 미만이면 10씩 낮추고 최저 60이다', () => {
    const abilities = [...Array(10).fill(150), ...Array(10).fill(135), ...Array(25).fill(112)]
    expect(pickCaRef(abilities, 150)).toBe(110)
    expect(pickCaRef([150, 100, 70], 150)).toBe(60)
    expect(pickCaRef(Array(60).fill(155), 150)).toBe(150)
  })
})

describe('기준 분포', () => {
  it('기준 능력 이상인 선수들의 평균과 모표준편차, 선수 수를 구한다', () => {
    const scores = [70, 72, 74, 76, 78, 40, 30]
    const abilities = [150, 150, 150, 150, 150, 70, 61]
    const norm = normFromScores(scores, abilities, 150)
    // 150 이상이 5명뿐이라 40명이 될 때까지 낮춰도 60에서 멈춘다: 이 경우 모두가 표본(poolCa 60). 기준 능력 caRef는 모든 역할이 같은 150이다(4회차)
    expect(norm.poolCa).toBe(60)
    expect(norm.caRef).toBe(150)
    expect(norm.n).toBe(7)
    const many = normFromScores(
      Array.from({ length: 50 }, (_, i) => 70 + (i % 5) * 5),
      Array(50).fill(155),
      150
    )
    expect(many.caRef).toBe(150)
    expect(many.poolCa).toBe(150)
    expect(many.shift).toBe(0)
    expect(many.n).toBe(50)
    expect(many.mu).toBeCloseTo(80, 6)
    expect(many.sigma).toBeCloseTo(Math.sqrt(50), 6)
  })
  it('표준편차에는 하한이 있다', () => {
    const norm = normFromScores(Array(50).fill(72), Array(50).fill(155), 150)
    expect(norm.sigma).toBe(NORM_MIN_SIGMA)
  })
  it('기울기: 현재 능력 1점당 점수. 표본이 40명 미만이거나 기울기가 0 이하이면 0.28', () => {
    const abilities = Array.from({ length: 60 }, (_, i) => 60 + i)
    const scores = abilities.map((ca) => 20 + 0.3 * ca)
    expect(betaFromScores(scores, abilities)).toBeCloseTo(0.3, 6)
    expect(betaFromScores(scores.slice(0, 30), abilities.slice(0, 30))).toBe(DEFAULT_BETA)
    expect(betaFromScores(scores.map((value) => -value), abilities)).toBe(DEFAULT_BETA)
    expect(betaFromScores(Array(60).fill(70), Array(60).fill(100))).toBe(DEFAULT_BETA)
  })
  it('z 점수와 쉬운 말', () => {
    const norm: RoleNorm = { mu: 71.7, sigma: 3, beta: 0.28, n: 100, caRef: 150 }
    expect(zOf(norm, 73.3)).toBeCloseTo(0.533, 3)
    expect(zOf(norm, 68.7)).toBeCloseTo(-1, 6)
    expect(zWords(1.2)).toContain('뛰어납니다')
    expect(zWords(0.5)).toContain('조금 높습니다')
    expect(zWords(-0.5)).toContain('조금 낮습니다')
    expect(zWords(-1.5)).toContain('크게 낮습니다')
  })
})

describe('모든 역할을 하나의 기준 능력으로(4회차)', () => {
  // 적합도가 현재 능력의 직선(0.3·CA + 40)인 역할 둘. 한 역할은 상위권이 많고, 다른 역할은 150 이상이 얼마 없다
  const linear = (cas: number[]): { scores: number[]; abilities: number[]; ids: number[] } => ({
    scores: cas.map((ca) => 0.3 * ca + 40),
    abilities: cas,
    ids: cas.map((_, i) => i)
  })
  const rich = Array.from({ length: 3000 }, (_, i) => 60 + (i % 131)) // 60~190이 고르게
  const poor = [...Array.from({ length: 1500 }, (_, i) => 60 + (i % 91)), ...Array.from({ length: 15 }, (_, i) => 150 + i)] // 60~150, 150 이상은 소수

  it('meanCaAbove: 여러 역할의 풀을 합쳐 기준 능력 이상인 선수의 평균 현재 능력(같은 선수는 한 번만)', () => {
    const a = { abilities: [160, 150, 140], ids: [1, 2, 3] }
    const b = { abilities: [160, 170, 100], ids: [1, 4, 5] }
    expect(meanCaAbove([a, b], 150)).toBeCloseTo((160 + 150 + 170) / 3, 10)
    expect(meanCaAbove([a, b], 200)).toBeUndefined()
  })

  it('표본을 넓힌 역할도 caRef는 모두 같은 C*이고, poolCa·shift에 넓힌 정도와 보정량이 남는다', () => {
    const star = 150
    const a = linear(rich)
    const b = linear(poor)
    const meanStar = meanCaAbove([a, b], star)!
    const normA = normFromScores(a.scores, a.abilities, star, meanStar)
    const normB = normFromScores(b.scores, b.abilities, star, meanStar)
    expect(normA.caRef).toBe(star)
    expect(normB.caRef).toBe(star)
    expect(normA.poolCa).toBe(star)
    expect(normB.poolCa).toBeLessThan(star)
    expect(normB.shift!).toBeGreaterThan(0)
    expect(Math.abs(normA.shift!)).toBeLessThan(Math.abs(normB.shift!))
  })

  it('보정하면 풀이 넓은 역할도 "C* 이상 선수의 평균"에 맞는다: 직선 관계에서 두 역할의 μ가 같다(0.3 × C̄* + 40)', () => {
    const star = 150
    const a = linear(rich)
    const b = linear(poor)
    const meanStar = meanCaAbove([a, b], star)!
    const normA = normFromScores(a.scores, a.abilities, star, meanStar)
    const normB = normFromScores(b.scores, b.abilities, star, meanStar)
    expect(normA.mu).toBeCloseTo(0.3 * meanStar + 40, 6)
    expect(normB.mu).toBeCloseTo(0.3 * meanStar + 40, 6)
    // 보정하지 않으면 풀이 낮은 역할의 μ가 한참 낮다(검토 4회차: 풀백·골키퍼가 0.9σ 부풀던 까닭)
    const raw = normFromScores(b.scores, b.abilities, star)
    expect(raw.shift).toBe(0)
    expect(normB.mu - raw.mu).toBeGreaterThan(2)
    // σ는 풀의 표준편차 그대로다
    expect(normB.sigma).toBe(raw.sigma)
  })

  it('보정량은 표본이 충분한 역할에서 작다(기울기 × 평균 현재 능력 차이)', () => {
    const star = 150
    const a = linear(rich)
    const meanStar = meanCaAbove([a], star)!
    expect(meanStar).toBeGreaterThan(star)
    const normA = normFromScores(a.scores, a.abilities, star, meanStar)
    // 같은 풀에서 C* 이상의 평균을 쓰므로 보정이 0
    expect(Math.abs(normA.shift!)).toBeLessThan(1e-6)
  })

  it('풀 안의 기울기를 못 구하면(표본 부족·분산 0) 그 역할의 기본 기울기로 보정한다. 선수가 없으면 대신하는 값이다', () => {
    const flat = normFromScores(Array(50).fill(70), Array(50).fill(120), 150, 160)
    expect(flat.shift).toBeCloseTo(DEFAULT_BETA * (160 - 120), 6)
    const empty = normFromScores([], [], 150, 160)
    expect(empty.n).toBe(0)
    expect(empty.caRef).toBe(150)
    expect(empty.shift).toBe(0)
  })
})

describe('로테이션 탭 경계 안내(4회차)', () => {
  const norm: RoleNorm = { mu: 74.4, sigma: 3.2, beta: 0.265, n: 49, caRef: 153 }
  it('주전 기준 점수와 0.25 표준편차를 숫자로 적는다. 주전이 나이 들어 기준이 내려가면 그 점수를 쓴다', () => {
    const bench: CandidateBench = { starter: { name: '주전', score: 76.3, ca: 157, age: 26 }, backup: null }
    expect(rotationBoundaryLine(bench, norm)).toBe('주전 기준(76.3점)보다 0.8점 아래부터')
    const old: CandidateBench = { starter: { name: '노장', score: 80, ca: 160, age: 33 }, backup: null }
    expect(rotationBoundaryLine(old, norm)).toBe('주전 기준(78.0점)보다 0.8점 아래부터')
    expect(rotationBoundaryLine({ starter: null, backup: null }, norm)).toBeNull()
  })
})

describe('한국어 조사', () => {
  it('받침 있는 이름은 이/은/을, 없는 이름은 가/는/를', () => {
    expect(withJosa('반 다이크', '이/가')).toBe('반 다이크가')
    expect(withJosa('케르케즈', '이/가')).toBe('케르케즈가')
    expect(withJosa('김민재', '은/는')).toBe('김민재는')
    expect(withJosa('손흥민', '은/는')).toBe('손흥민은')
    expect(withJosa('손흥민', '을/를')).toBe('손흥민을')
    expect(withJosa('이강인', '과/와')).toBe('이강인과')
    expect(hasBatchim('아')).toBe(false)
    expect(hasBatchim('악')).toBe(true)
  })
  it('한글로 끝나지 않으면 둘을 함께 적는다', () => {
    expect(josa('Rodri', '이/가')).toBe('이(가)')
    expect(josa('Player 7', '은/는')).toBe('은(는)')
    expect(josa('', '이/가')).toBe('이(가)')
  })
})

describe('최대 가중 매칭(헝가리안)', () => {
  it('탐욕이 놓치는 최적 배정을 찾는다', () => {
    // 탐욕은 (0,0)=10을 먼저 잡아 (1,1)=0이 남지만, 최적은 (0,1)+(1,0) = 18
    expect(assignMaximum([[10, 9], [9, 0]])).toEqual([1, 0])
  })
  it('못 뛰는 쌍(가중치 0)은 짝에서 빠지고 뛸 선수가 없는 자리는 비운다', () => {
    expect(assignMaximum([[0, 0, 0], [5, 0, 0]])).toEqual([null, 0])
    expect(assignMaximum([[0], [0]])).toEqual([null, null])
  })
  it('자리가 선수보다 많거나 적어도 한 선수는 한 자리다', () => {
    const picked = assignMaximum([[3, 0], [2, 0], [1, 0]])
    expect(picked.filter((each) => each !== null)).toEqual([0])
    expect(picked[0]).toBe(0)
    const wide = assignMaximum([[1, 5, 2, 0]])
    expect(wide).toEqual([1])
  })
  it('무작위 행렬에서 가능한 가장 많은 자리를 채우고 합이 완전탐색 최적과 같다', () => {
    let state = 12345
    const next = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
    for (let trial = 0; trial < 60; trial++) {
      const rows = 1 + Math.floor(next() * 4)
      const cols = 1 + Math.floor(next() * 5)
      const matrix = Array.from({ length: rows }, () => Array.from({ length: cols }, () => (next() < 0.35 ? 0 : 1000 + Math.round(next() * 20))))
      const picked = assignMaximum(matrix)
      const used = picked.filter((each): each is number => each !== null)
      expect(new Set(used).size).toBe(used.length)
      const total = picked.reduce<number>((sum, col, row) => sum + (col === null ? 0 : matrix[row][col]), 0)
      // 완전탐색
      const best = (row: number, taken: number): number => {
        if (row === rows) return 0
        let top = best(row + 1, taken)
        for (let col = 0; col < cols; col++) {
          if (taken & (1 << col) || matrix[row][col] === 0) continue
          top = Math.max(top, matrix[row][col] + best(row + 1, taken | (1 << col)))
        }
        return top
      }
      expect(total).toBe(best(0, 0))
    }
  })
})

describe('영입 유형 판정', () => {
  // 중앙 수비 1: 주전 83.6(CA 175, 34세), 후보 73.1, σ 3.6
  const norm: RoleNorm = { mu: 74.6, sigma: 3.6, beta: 0.265, n: 80, caRef: 150 }
  const bench: CandidateBench = { starter: { name: '주전', score: 83.6, ca: 175, age: 27 }, backup: { name: '후보', score: 73.1 } }
  const player = (patch: Partial<Parameters<typeof categoriesOf>[0]> = {}): Parameters<typeof categoriesOf>[0] => ({
    score: 78,
    age: 26,
    ca: 160,
    pa: 160,
    hasClub: true,
    ...patch
  })

  it('실력이 모자란 자유 계약 선수는 어느 유형에도 들지 않는다(적합 67.8, CA 138)', () => {
    expect(categoriesOf(player({ score: 67.8, ca: 138, hasClub: false }), bench, norm)).toEqual([])
  })
  it('즉시 전력: 주전보다 0.25σ(0.9점)까지 낮아도 주전 수준이다', () => {
    expect(categoriesOf(player({ score: 82.8 }), bench, norm)).toContain('starter')
    expect(categoriesOf(player({ score: 82.6 }), bench, norm)).not.toContain('starter')
  })
  it('로테이션: 주전 수준보다 낮고 max(첫 후보, 주전 - 1.5σ) - 0.25σ 이상(여기서는 77.3)', () => {
    expect(categoriesOf(player({ score: 77.4 }), bench, norm)).toContain('rotation')
    expect(categoriesOf(player({ score: 77.2 }), bench, norm)).toEqual([])
    // 후보가 없으면 주전 - 1.5σ - 0.25σ = 77.3
    expect(categoriesOf(player({ score: 77.4 }), { ...bench, backup: null }, norm)).toContain('rotation')
  })
  it('현재 능력이 내 주전의 85% 미만이면 즉시 전력·로테이션이 아니다(174 × 0.85 → 148.75)', () => {
    expect(categoriesOf(player({ score: 80, ca: 148 }), bench, norm)).toEqual([])
    expect(categoriesOf(player({ score: 80, ca: 149 }), bench, norm)).toContain('rotation')
  })
  it('나이 든 주전은 한 해마다 1점씩 기준을 낮춘다(34세 필드 선수 → 3점)', () => {
    const old: CandidateBench = { ...bench, starter: { ...bench.starter!, age: 34 } }
    expect(benchmarkOf(old.starter, norm, false).anchor).toBeCloseTo(83.6 - 3 * AGING_DROP_PER_YEAR)
    expect(categoriesOf(player({ score: 79.8 }), bench, norm)).not.toContain('starter')
    expect(categoriesOf(player({ score: 79.8 }), old, norm)).toContain('starter')
    // 골키퍼는 34세까지는 낮추지 않는다
    expect(benchmarkOf(old.starter, norm, true).drop).toBe(0)
    expect(benchmarkOf({ ...old.starter!, age: 36 }, norm, true).drop).toBe(2)
  })
  it('유망주: 크고 나면 주전 수준에 이르는 어린 선수만(왼쪽 수비: 17세 CA 120/PA 168은 들고 16세 CA 86/PA 175는 아니다)', () => {
    const lb: RoleNorm = { mu: 70, sigma: 3, beta: 0.283, n: 100, caRef: 150 }
    const lbBench: CandidateBench = { starter: { name: '주전', score: 73.3, ca: 153, age: 25 }, backup: { name: '후보', score: 71.1 } }
    const a = categoriesOf({ score: 66.9, age: 17, ca: 120, pa: 168, hasClub: true }, lbBench, lb)
    expect(a).toEqual(['prospect'])
    // 17세의 성장 몫은 0.78(3회차 단면 실측표)
    expect(projectedScore(66.9, 17, 120, 168, 0.283)).toBeCloseTo(66.9 + 0.283 * 0.78 * 48, 5)
    expect(categoriesOf({ score: 50.6, age: 16, ca: 86, pa: 175, hasClub: true }, lbBench, lb)).toEqual([])
    expect(projectedScore(50.6, 16, 86, 175, 0.283)).toBeCloseTo(50.6 + 0.283 * 0.78 * 89, 5)
  })
  it('유망주는 23세 이하이고 잠재 여지가 10 이상이어야 한다', () => {
    const lb: RoleNorm = { mu: 70, sigma: 3, beta: 0.283, n: 100, caRef: 150 }
    const lbBench: CandidateBench = { starter: { name: '주전', score: 60, ca: 153, age: 25 }, backup: null }
    expect(categoriesOf({ score: 70, age: 23, ca: 120, pa: 168, hasClub: true }, lbBench, lb)).toContain('prospect')
    expect(categoriesOf({ score: 70, age: 24, ca: 120, pa: 168, hasClub: true }, lbBench, lb)).not.toContain('prospect')
    expect(categoriesOf({ score: 70, age: 20, ca: 160, pa: 165, hasClub: true }, lbBench, lb)).not.toContain('prospect')
    expect(categoriesOf({ score: 70, age: 20, ca: 120, pa: 135, hasClub: true }, lbBench, lb)).toContain('prospect')
    expect(categoriesOf({ score: 70, age: null, ca: 120, pa: 168, hasClub: true }, lbBench, lb)).not.toContain('prospect')
  })
  it('후보도 포지션 숙련과 나이 하락을 뺀 적합도로 견준다(f_eff)', () => {
    // 숙련 16이면 0.32σ = 1.15점, 33세 필드 선수는 2점을 뺀다
    expect(categoriesOf(player({ score: 84, rating: 16 }), bench, norm)).toContain('starter')
    expect(categoriesOf(player({ score: 83.6, rating: 16 }), bench, norm)).not.toContain('starter')
    expect(categoriesOf(player({ score: 84.6, age: 33 }), bench, norm)).not.toContain('starter')
    expect(categoriesOf(player({ score: 84.8, age: 33 }), bench, norm)).toContain('starter')
    // 골키퍼는 34세까지는 빼지 않는다
    expect(categoriesOf(player({ score: 83.8, age: 33 }), bench, norm, true)).toContain('starter')
  })
  it('주전이 없으면 이 역할 상위권 평균(mu)을 기준으로, CA 문턱은 0.85 × 기준 능력이다', () => {
    const none: CandidateBench = { starter: null, backup: null }
    expect(categoriesOf(player({ score: 74.5, ca: 140 }), none, norm)).toContain('starter')
    expect(categoriesOf(player({ score: 74.5, ca: 120 }), none, norm)).toEqual([])
    expect(benchmarkOf(null, norm, false).anchor).toBe(norm.mu)
  })
  it('자유 계약은 별도 유형이 아니라 소속 없음 조건이다: 위 유형에 들 때만 붙는다', () => {
    expect(categoriesOf(player({ score: 84, hasClub: false }), bench, norm)).toEqual(['starter', 'free'])
    expect(categoriesOf(player({ score: 84, hasClub: true }), bench, norm)).toEqual(['starter'])
    expect(categoriesOf(player({ score: 60, hasClub: false }), bench, norm)).toEqual([])
  })
  it('기준 분포를 못 받아도(옛 호출) 계산이 깨지지 않는다', () => {
    expect(categoriesOf(player({ score: 84 }), bench)).toContain('starter')
    expect(Number.isFinite(FALLBACK_NORM.sigma)).toBe(true)
  })
})

describe('기준 분포의 안정성(검토 2회차 4.1-10)', () => {
  it('내 선수 가운데 CA 1위를 빼도 평균 μ가 0.1σ(약 0.3점) 안에서만 움직인다', () => {
    // 모집단: CA 60~190이 고르게 있고 적합도 = 0.3·CA + 40 + 흔들림
    const abilities: number[] = []
    const scores: number[] = []
    for (let i = 0; i < 4000; i++) {
      const ca = 60 + (i % 131)
      abilities.push(ca)
      scores.push(0.3 * ca + 40 + (((i * 7919) % 61) - 30) / 10)
    }
    const squad = [175, 170, 165, 162, 160, 158, 157, 155, 153, 150, 148, 145, 140]
    const withTop = normFromScores(scores, abilities, referenceCa(squad))
    const withoutTop = normFromScores(scores, abilities, referenceCa(squad.slice(1)))
    expect(Math.abs(withTop.mu - withoutTop.mu)).toBeLessThanOrEqual(0.1 * withTop.sigma + 0.3)
    expect(Math.abs((withTop.mu - withoutTop.mu) / withTop.sigma)).toBeLessThan(0.15)
  })
})

describe('절 잇기', () => {
  it('앞 절은 잇는 꼴로, 마지막 절만 맺는다', () => {
    expect(linkForm('주전 A가 34세입니다')).toBe('주전 A가 34세이고')
    expect(linkForm('후보가 B 한 명뿐입니다')).toBe('후보가 B 한 명뿐이고')
    expect(linkForm('크게 낮습니다')).toBe('크게 낮고')
    expect(linkForm('그 밖의 꼴')).toBe('그 밖의 꼴')
    expect(joinClauses(['주전 A가 34세입니다', '후보가 B 한 명뿐입니다'])).toBe('주전 A가 34세이고, 후보가 B 한 명뿐입니다.')
    expect(joinClauses(['후보가 없습니다'])).toBe('후보가 없습니다.')
    expect(joinClauses([])).toBe('')
  })
})

describe('성장 몫과 유망주 자격(3회차)', () => {
  it('growthShare: 17세 이하 0.78, 18세 0.70, 20세 0.57, 22세 0.38, 24세 0.15, 26세 이상 0이고 사이는 직선이다', () => {
    const table: Array<[number, number]> = [[14, 0.78], [17, 0.78], [18, 0.7], [20, 0.57], [22, 0.38], [24, 0.15], [26, 0], [30, 0]]
    for (const [age, share] of table) expect(growthShare(age), `${age}세`).toBeCloseTo(share, 10)
    expect(growthShare(19)).toBeCloseTo(0.635, 10)
    expect(growthShare(23)).toBeCloseTo(0.265, 10)
    expect(growthShare(25)).toBeCloseTo(0.075, 10)
  })

  it('나이가 많을수록 성장 몫이 줄지 않는 방향으로만 바뀐다(어릴수록 크다)', () => {
    for (let age = 15; age < 35; age++) expect(growthShare(age + 1)).toBeLessThanOrEqual(growthShare(age) + 1e-12)
  })

  it('성숙 시 적합도: 22세 CA150/PA170(β 0.265)은 +2.0점, 26세 이상이나 나이를 모르면 그대로다', () => {
    expect(projectedScore(70, 22, 150, 170, 0.265) - 70).toBeCloseTo(0.38 * 20 * 0.265, 6)
    expect(projectedScore(70, 22, 150, 170, 0.265) - 70).toBeCloseTo(2.01, 2)
    expect(projectedScore(70, 26, 150, 190, 0.265)).toBe(70)
    expect(projectedScore(70, null, 150, 190, 0.265)).toBe(70)
  })

  it('유망주 자격: 23세 CA152/PA164(β 0.265, σ 3.15)는 아니고 18세 CA165/PA183은 맞다', () => {
    expect(hasGrowthRoom(23, 152, 164, 0.265, 3.15)).toBe(false)
    expect(hasGrowthRoom(18, 165, 183, 0.265, 3.15)).toBe(true)
    // 성숙 시 이득: 23세 0.265 × 0.265 × 12 = 0.84점(0.27σ), 18세 0.70 × 0.265 × 18 = 3.34점(1.06σ)
    expect(0.265 * growthShare(23) * 12).toBeCloseTo(0.84, 2)
    expect(0.265 * growthShare(18) * 18).toBeCloseTo(3.34, 2)
  })

  it('나이 ≤ 23, 잠재 여지 ≥ 10, 이득 ≥ 0.5σ를 모두 만족해야 하고, 나이를 모르면 아니다', () => {
    expect(hasGrowthRoom(24, 120, 180, 0.265, 3.15)).toBe(false)
    expect(hasGrowthRoom(18, 150, 159, 0.265, 3.15)).toBe(false)
    expect(hasGrowthRoom(null, 120, 180, 0.265, 3.15)).toBe(false)
    // 여지 12라도 21세이면 이득 0.265 × 0.465 × 12 = 1.48점 < 1.575점(0.5σ): 아니다. 22세 여지 16이면 1.61점: 맞다
    expect(hasGrowthRoom(21, 150, 162, 0.265, 3.15)).toBe(false)
    expect(hasGrowthRoom(22, 150, 166, 0.265, 3.15)).toBe(true)
  })

  it('categoriesOf의 유망주 유형도 같은 자격을 쓴다(자격에서 빠진 23세는 로테이션에는 남는다)', () => {
    const cb: RoleNorm = { mu: 74.4, sigma: 3.15, beta: 0.265, n: 49, caRef: 153 }
    const bench: CandidateBench = { starter: { name: '주전', score: 76, ca: 157, age: 26 }, backup: { name: '후보', score: 72.5 } }
    const javarni = categoriesOf({ score: 76, age: 23, ca: 152, pa: 164, hasClub: true }, bench, cb)
    expect(javarni).not.toContain('prospect')
    expect(javarni).toContain('starter')
    expect(categoriesOf({ score: 74, age: 18, ca: 165, pa: 183, hasClub: true }, bench, cb)).toContain('prospect')
  })
})
