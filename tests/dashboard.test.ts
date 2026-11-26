import { describe, expect, it } from 'vitest'
import {
  ageStructure,
  buildBrief,
  contractWindows,
  expectedWage,
  firstTeamPlayers,
  fitWageModel,
  FIT_GAP_SIGMAS,
  UNKNOWN_RISK,
  overpaidPlayers,
  OVERPAID_RATIO,
  surplusReport,
  surplusScore,
  type FirstTeamPlayer
} from '@shared/dashboard'
import type { SeasonMatch, SeasonTableRow } from '@shared/season'
import { analyseTactic } from '@shared/tactic'
import { loanLender, type SaveContract } from '../src/main/save/contracts'
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

describe('주급 기준선(로그 선형 회귀)', () => {
  it('정확히 지수 관계인 자료에서 a, b와 R²=1을 되찾는다', () => {
    const points = Array.from({ length: 60 }, (_, i) => ({ ca: 80 + i, wage: Math.exp(3 + 0.05 * (80 + i)) }))
    const model = fitWageModel(points)!
    expect(model.a).toBeCloseTo(3, 6)
    expect(model.b).toBeCloseTo(0.05, 8)
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
  })

  it('표본이 적거나 능력이 모두 같으면 만들지 않는다', () => {
    expect(fitWageModel([{ ca: 100, wage: 1000 }])).toBeNull()
    expect(fitWageModel(Array.from({ length: 40 }, () => ({ ca: 100, wage: 1000 })))).toBeNull()
  })

  it('기대 주급의 1.3배 이상 받는 선수만 초과액이 큰 순서로 고른다', () => {
    const model = { a: 3, b: 0.05 }
    const at = (ca: number): number => expectedWage(model, ca)
    const found = overpaidPlayers(
      [
        player({ uid: 1, ca: 100, wage: Math.round(at(100) * 1.29) }),
        player({ uid: 2, ca: 100, wage: Math.round(at(100) * 1.5) }),
        player({ uid: 3, ca: 140, wage: Math.round(at(140) * 2) }),
        player({ uid: 4, ca: 120, wage: null }),
        player({ uid: 5, ca: 90, wage: Math.round(at(90) * 0.8) })
      ],
      model
    )
    expect(OVERPAID_RATIO).toBe(1.3)
    expect(found.total).toBe(2)
    expect(found.rows.map((row) => row.uid)).toEqual([3, 2])
    expect(found.rows[0].ratio).toBeCloseTo(2, 1)
    expect(found.rows[0].excess).toBe(found.rows[0].wage - found.rows[0].expected)
  })
})

describe('잉여 점수', () => {
  const base = { fitGapSigma: 1.2, wage: 100_000, medianWage: 100_000, age: 27, ca: 120, pa: 125 }

  it('0~100 안이고, 위험이 클수록 높다', () => {
    const calm = surplusScore({ fitGapSigma: 0, wage: 40_000, medianWage: 100_000, age: 22, ca: 120, pa: 150 })
    const heavy = surplusScore({ fitGapSigma: FIT_GAP_SIGMAS, wage: 250_000, medianWage: 100_000, age: 33, ca: 120, pa: 120 })
    expect(calm.score).toBe(0)
    expect(heavy.score).toBe(100)
    expect(surplusScore(base).score).toBeGreaterThan(calm.score)
    expect(surplusScore(base).score).toBeLessThan(heavy.score)
  })

  it('적합도 차이·주급·나이가 각각 점수를 올린다', () => {
    const score = (over: Partial<typeof base>): number => surplusScore({ ...base, ...over }).score
    expect(score({ fitGapSigma: 2.4 })).toBeGreaterThan(score({ fitGapSigma: 0.4 }))
    expect(score({ wage: 200_000 })).toBeGreaterThan(score({ wage: 60_000 }))
    expect(score({ age: 31 })).toBeGreaterThan(score({ age: 25 }))
    expect(score({ pa: 120 })).toBeGreaterThan(score({ pa: 140 }))
  })

  it('전술에 뛸 자리가 없으면 적합도 위험이 최대이고, 모르는 항목은 보통(0.5)으로 계산한다', () => {
    expect(surplusScore({ ...base, fitGapSigma: null }).parts.fit).toBe(50)
    const unknownWage = surplusScore({ ...base, wage: null })
    expect(unknownWage.unknown).toEqual(['wage'])
    expect(unknownWage.parts.wage).toBe(25 * UNKNOWN_RISK)
    expect(unknownWage.wageRatio).toBeNull()
    const unknownAge = surplusScore({ ...base, age: null })
    expect(unknownAge.unknown).toEqual(['age'])
    expect(unknownAge.parts.age).toBe(25 * UNKNOWN_RISK)
    // 재분배가 없으므로 모르는 항목이 있어도 합은 100을 넘지 않는다
    expect(surplusScore({ fitGapSigma: FIT_GAP_SIGMAS, wage: null, medianWage: null, age: null, ca: null, pa: null }).score).toBe(75)
  })

  it('적합도 차이는 σ 단위다: 같은 점수 차이라도 σ가 작은 역할에서는 더 큰 차이다', () => {
    expect(surplusScore({ ...base, fitGapSigma: 6 / 2 }).parts.fit).toBeGreaterThan(surplusScore({ ...base, fitGapSigma: 6 / 4 }).parts.fit)
    expect(surplusScore({ ...base, fitGapSigma: FIT_GAP_SIGMAS * 2 }).parts.fit).toBe(50)
  })
})

describe('정리 후보 고르기', () => {
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
    for (const row of report.rows.filter((each) => each.fitGap !== null && each.fitGap >= 0.5)) expect(row.reason).toContain('표준편차')
  })

  it('21세 이하이고 잠재가 10 이상 높은 선수는 정리 후보가 아니라 임대 유망주로 나눈다', () => {
    const prospectIds = new Set(report.prospects.map((row) => row.uid))
    for (const row of report.rows) expect(prospectIds.has(row.uid)).toBe(false)
    for (const row of report.prospects) {
      expect(row.age!).toBeLessThanOrEqual(21)
      expect(row.room).toBeGreaterThanOrEqual(10)
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

  it('이적이거나 계약이 하나뿐이거나 아직 시작하지 않은 기록은 임대가 아니다', () => {
    expect(loanLender([rec(10, 100, 181), rec(20, 174, 181)], today, 20)).toBeNull()
    expect(loanLender([rec(20, 174, null)], today, 20)).toBeNull()
    expect(loanLender([rec(10, 100, 181)], today, 10)).toBeNull()
    expect(loanLender([rec(10, 100, 181), { ...rec(20, 174, null), start: { year: 2026, day: 200 } }], today, 20)).toBeNull()
    // 임대받은 팀이 선수의 현재 소속이 아니면 임대로 보지 않는다
    expect(loanLender([rec(10, 100, 181), rec(20, 174, null)], today, 30)).toBeNull()
  })
})
