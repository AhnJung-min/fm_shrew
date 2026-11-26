import { describe, expect, it } from 'vitest'
import { assignMaximum } from '../src/shared/depth'
import { hasBatchim, josa, withJosa } from '../src/shared/korean'
import {
  betaFromScores,
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
import { AGING_DROP_PER_YEAR, benchmarkOf, categoriesOf, projectedScore, type CandidateBench } from '../src/shared/world'

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
    // 150 이상이 5명뿐이라 40명이 될 때까지 낮춰도 60에서 멈춘다: 이 경우 모두가 모집단
    expect(norm.caRef).toBe(60)
    expect(norm.n).toBe(7)
    const many = normFromScores(
      Array.from({ length: 50 }, (_, i) => 70 + (i % 5) * 5),
      Array(50).fill(155),
      150
    )
    expect(many.caRef).toBe(150)
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
    expect(projectedScore(66.9, 17, 120, 168, 0.283)).toBeCloseTo(77.1, 1)
    expect(categoriesOf({ score: 50.6, age: 16, ca: 86, pa: 175, hasClub: true }, lbBench, lb)).toEqual([])
    expect(projectedScore(50.6, 16, 86, 175, 0.283)).toBeCloseTo(69.5, 1)
  })
  it('유망주는 21세 이하이고 잠재 여지가 10 이상이어야 한다', () => {
    const lb: RoleNorm = { mu: 70, sigma: 3, beta: 0.283, n: 100, caRef: 150 }
    const lbBench: CandidateBench = { starter: { name: '주전', score: 60, ca: 153, age: 25 }, backup: null }
    expect(categoriesOf({ score: 70, age: 22, ca: 120, pa: 168, hasClub: true }, lbBench, lb)).not.toContain('prospect')
    expect(categoriesOf({ score: 70, age: 20, ca: 160, pa: 165, hasClub: true }, lbBench, lb)).not.toContain('prospect')
    expect(categoriesOf({ score: 70, age: 20, ca: 120, pa: 135, hasClub: true }, lbBench, lb)).toContain('prospect')
    expect(categoriesOf({ score: 70, age: null, ca: 120, pa: 168, hasClub: true }, lbBench, lb)).not.toContain('prospect')
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
