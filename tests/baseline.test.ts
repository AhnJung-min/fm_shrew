/**
 * 고정 세이브 기준 결과와 시간 검사(N-04, N-01).
 *
 * 환경 변수가 없으면 건너뛴다(저장소에는 세이브도 기준 결과 파일도 두지 않는다).
 *   FMB_TEST_SAVE       고정해 둔 세이브 사본의 경로
 *   FMB_TEST_TEAM       그 세이브에서 내 팀 번호
 *   FMB_BASELINE        기준 결과 JSON의 경로(없으면 대조는 건너뛰고 시간만 잰다)
 *   FMB_BASELINE_EXACT  정밀 기준 결과 JSON의 경로(2단계). 있으면 반올림하지 않은 값으로 따로 대조한다(아래 두 번째 시험)
 *   FMB_UPDATE_BASELINE 1이면 대조하지 않고 기준 결과를 새로 쓴다(FMB_BASELINE과 FMB_BASELINE_EXACT가 있으면 두 파일 모두)
 *
 * 기준 결과는 선수 고유 번호로만 적는다(이름 없음). 역할 가중치는 언제나 기본값이고 사용자 설정은 읽지 않는다.
 * 시간은 항상 찍고, 예산(후보 찾기 일반 50ms·가장 넓은 100ms, 기준 분포 0.5초)을 넘을 때만 실패한다. 세이브 읽기 시간은 찍기만 한다.
 *
 * 정밀 기준 결과(FMB_BASELINE_EXACT)는 1자리 기준 결과와 따로 만든다: 반올림 때문에 가려지는 끝자리의 흔들림을 잡으려고, 자리별 주전·후보의
 * score·effScore·z·숙련·임시 주전 여부, 필요도와 항목 점수, 묶음 id와 비교 기준, 줄의 z 평균, 기준 분포 전 항목, 탭별 상위 30명의 추천 점수와 풀이 값,
 * 대시보드 목록을 반올림 없이 적고, 포메이션마다 자리 하나씩 다른 옛 역할로 바꾼 전술의 분석도 적는다(후보 찾기 없이).
 * 옛 카탈로그(14역할)로 고정한 기준이라 2단계 뒤에도 영구히 돈다. 1자리 기준 결과의 모드와 파일은 이 모드가 바꾸지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIELDS } from '../src/shared/fields'
import { FORMATIONS } from '../src/shared/depth'
import { DEFAULT_ROLE, rolesFor } from '../src/shared/roles'
import { analyseTactic, type SlotGroup } from '../src/shared/tactic'
import type { CellValue, ColumnInfo, PlayerRow } from '../src/shared/types'
import { type CandidateCategory } from '../src/shared/world'
import { BUDGET_MS, diffJson, formatDiff, r1, timeIt, type Json } from './helpers/baselineDiff'
import { groupQuery, openBaselineWorld } from './helpers/baselineWorld'
import { alternativeRoleVariants, exact, exactAnalysis, exactCandidates, exactDashboard, exactNorms } from './helpers/exactSnapshot'

const SAVE = process.env.FMB_TEST_SAVE
const TEAM = Number(process.env.FMB_TEST_TEAM)
const BASELINE = process.env.FMB_BASELINE
const BASELINE_EXACT = process.env.FMB_BASELINE_EXACT
const UPDATE = process.env.FMB_UPDATE_BASELINE === '1'
const TABS: CandidateCategory[] = ['starter', 'rotation', 'prospect', 'free', 'all']
const TOP = 30

describe('기준 결과 대조 도구', () => {
  it('차이를 늘어남·없어짐·바뀜으로 모으고 읽기 쉽게 적는다', () => {
    const before: Json = { tabs: { 'a/b': { '10': { rank: 1, score: 70.1 }, '11': { rank: 2, score: 69 } } }, dash: { '5': 3 } }
    const after: Json = { tabs: { 'a/b': { '10': { rank: 2, score: 70.1 }, '12': { rank: 1, score: 71 } } }, dash: { '5': 3 } }
    const lines = diffJson(before, after)
    expect(lines.map((line) => `${line.kind} ${line.path}`).sort()).toEqual(
      ['added tabs.a/b.12', 'changed tabs.a/b.10.rank', 'removed tabs.a/b.11'].sort()
    )
    const text = formatDiff(lines)
    expect(text).toContain('3곳이 다릅니다')
    expect(text).toContain('바뀜 tabs.a/b.10.rank: 1 -> 2')
    expect(formatDiff(diffJson(before, before))).toBe('기준 결과와 같습니다.')
  })

  it('1자리 반올림과 중앙값 시간 재기', () => {
    expect(r1(71.24)).toBe(71.2)
    expect(r1(null)).toBeNull()
    const { median, all } = timeIt(() => 1 + 1, 5)
    expect(all).toHaveLength(5)
    expect(median).toBeGreaterThanOrEqual(0)
  })
})

describe('정밀 기준 결과 도구(tests/helpers/exactSnapshot.ts)', () => {
  const ATTRIBUTES = FIELDS.filter((field) => field.isAttr)
  const info = (header: string, field: string): ColumnInfo => ({ header, field, group: 'info', short: header, label: header, isAttr: false, numeric: field !== 'name' && field !== 'position' })
  const COLUMNS: ColumnInfo[] = [
    info('이름', 'name'),
    info('포지션', 'position'),
    info('나이', 'age'),
    info('현재 능력', 'ability'),
    info('잠재 능력', 'potential'),
    info('계약 만료', 'contractEnd'),
    ...ATTRIBUTES.map((field): ColumnInfo => ({ header: field.label, field: field.id, group: field.group, short: field.short, label: field.label, isAttr: true, numeric: true }))
  ]
  const num = (value: number): CellValue => ({ raw: String(value), num: value })
  // 지어낸 선수단: [포지션 글, 그 자리의 숙련 열 번호, 능력치 수준, 그 자리 숙련]
  const SPEC: Array<[string, number, number, number]> = [
    ['GK', 0, 12, 20], ['GK', 0, 9, 16], ['D (L)', 2, 13, 18], ['D (R)', 4, 12, 17], ['D (C)', 3, 14, 19], ['D (C)', 3, 13, 16], ['D (C)', 3, 11, 20],
    ['DM', 5, 12, 18], ['DM', 5, 11, 15], ['M (C)', 7, 14, 17], ['M (C)', 7, 12, 20], ['M (L)', 6, 12, 18], ['M (R)', 8, 13, 16],
    ['AM (C)', 10, 13, 19], ['AM (L)', 9, 12, 17], ['AM (R)', 11, 13, 20], ['ST (C)', 12, 14, 18], ['ST (C)', 12, 11, 15]
  ]
  const NAMES = SPEC.map((_, p) => `시험 선수 ${p + 1}`)
  const rows: PlayerRow[] = SPEC.map(([position, ratingAt, level, rating], p) => {
    const cells: Record<string, CellValue> = {
      이름: { raw: NAMES[p], num: null },
      포지션: { raw: position, num: null },
      나이: num(20 + (p % 12)),
      '현재 능력': num(110 + p),
      '잠재 능력': num(130 + p),
      '계약 만료': num(20280630)
    }
    ATTRIBUTES.forEach((field, j) => (cells[field.label] = num(Math.min(20, Math.max(1, level + ((p * 3 + j) % 5) - 2)))))
    return { idx: 9_000_001 + p, name: NAMES[p], cells, ratings: Array.from({ length: 15 }, (_, at) => (at === ratingAt ? rating : 1)) }
  })
  const analyse = (formation: string, slotRoles: Record<string, string> = {}) =>
    analyseTactic({ rows, columns: COLUMNS, today: { year: 2026, month: 7, day: 1 }, formation, slotRoles, roleWeights: {} })!

  /** 객체 안의 모든 숫자 */
  const numbersIn = (value: unknown): number[] => (typeof value === 'number' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(numbersIn) : [])

  it('반올림하지 않은 값을 그대로 담고, 선수는 번호로만 적는다', () => {
    const analysis = analyse('4-2-3-1')
    const snapshot = exactAnalysis(analysis) as { slots: Record<string, { starter: { idx: number; effScore: number; z: number } | null }>; groups: Record<string, unknown>; lines: Record<string, unknown> }
    expect(Object.keys(snapshot.slots).sort((a, b) => Number(a) - Number(b))).toEqual([...Array(11).keys()].map(String))
    let unrounded = 0
    analysis.slots.forEach((slot, i) => {
      const starter = slot.slot.starter
      expect(snapshot.slots[String(i)].starter?.idx ?? null).toBe(starter?.idx ?? null)
      if (!starter) return
      expect(Object.is(snapshot.slots[String(i)].starter!.effScore, starter.effScore)).toBe(true)
      expect(Object.is(snapshot.slots[String(i)].starter!.z, starter.z)).toBe(true)
      if (Math.round(starter.effScore * 10) / 10 !== starter.effScore) unrounded++
    })
    // 숙련 감점을 빼면 1자리가 아닌 값이 생긴다: 1자리 기준 결과가 가리는 값이 여기에는 그대로 있다
    expect(unrounded).toBeGreaterThan(0)
    expect(Object.keys(snapshot.groups)).toEqual(analysis.groups.map((group) => group.id))
    expect(Object.keys(snapshot.lines)).toEqual(analysis.lines.map((line) => line.id))
    const text = JSON.stringify(snapshot)
    for (const name of NAMES) expect(text, name).not.toContain(name)
    for (const value of numbersIn(snapshot)) expect(Number.isFinite(value)).toBe(true)
  })

  it('같은 입력이면 같은 JSON이고, 자리 역할이 달라지면 그 자리의 값이 달라진다', () => {
    expect(JSON.stringify(exactAnalysis(analyse('4-3-3')))).toBe(JSON.stringify(exactAnalysis(analyse('4-3-3'))))
    const base = exactAnalysis(analyse('4-3-3')) as { slots: Record<string, { role: string }> }
    const changed = exactAnalysis(analyse('4-3-3', { '4-3-3:7': 'bpd' })) as { slots: Record<string, { role: string }> }
    expect(base.slots['7'].role).toBe('cb')
    expect(changed.slots['7'].role).toBe('bpd')
    expect(diffJson(base as unknown as Json, changed as unknown as Json).some((line) => line.path.startsWith('slots.7.'))).toBe(true)
  })

  it('유한하지 않은 수는 멈추게 하고, 없는 값은 null로 적는다', () => {
    expect(exact(1.23456789)).toBe(1.23456789)
    expect(exact(null)).toBeNull()
    expect(exact(undefined)).toBeNull()
    expect(() => exact(Number.NaN)).toThrow('유한하지 않은')
    expect(() => exact(Number.POSITIVE_INFINITY)).toThrow('유한하지 않은')
  })

  it('기준 분포는 전 항목을, 없는 칸은 null로 적는다', () => {
    expect(exactNorms({ cb: { mu: 70.5, sigma: 3.25, beta: 0.28, n: 400, caRef: 100 } })).toEqual({ cb: { mu: 70.5, sigma: 3.25, beta: 0.28, betaGrow: null, n: 400, caRef: 100, poolCa: null, shift: null } })
    expect(exactNorms(undefined)).toEqual({})
  })

  it('후보 찾기 결과와 대시보드는 선수 번호로만 적고 이름을 담지 않는다', () => {
    const fit = { shown: 71.4, effective: 70.11, positionPoints: 0.64, positionSigma: 0.16, agePoints: 0.6 }
    const result = {
      ok: true,
      counts: { all: 3, starter: 1, rotation: 1, prospect: 1, free: 0 },
      matched: 3,
      ranked: 3,
      need: 61.5,
      bench: { starter: null, backup: null },
      rows: [
        { uid: 9100001, name: '지어낸 영입 후보', score: 71.4, gap: 1.5, gapEff: 0.97, categories: ['starter', 'rotation'], tier: 'strong', recommend: { total: 77.7, base: 77.7, gate: 1, fit, realism: { low: false, reasons: [] }, components: [{ id: 'immediate', points: 31.4 }] } },
        { uid: 9100002, name: '지어낸 다른 후보', score: 70.2, gap: null, gapEff: null, categories: [], tier: 'hold', recommend: { total: 60.1, base: 60.1, gate: 1, fit, realism: { low: true, reasons: ['예'] }, components: [] } }
      ]
    }
    const candidates = exactCandidates(result as never, 1) as { rows: Record<string, { rank: number; total: number; fit: Record<string, number>; low: boolean }>; counts: unknown; need: number }
    expect(Object.keys(candidates.rows)).toEqual(['9100001'])
    expect(candidates.rows['9100001']).toMatchObject({ rank: 1, total: 77.7, low: false, fit })
    expect(candidates.need).toBe(61.5)
    expect(JSON.stringify(candidates)).not.toContain('지어낸')
    const board = {
      surplus: { rows: [{ uid: 9100003, name: '지어낸 정리 후보', score: 44.44, wage: 1000, parts: { fit: 20.1, wage: 12.2, age: 12.1 }, unknown: [], fit: 'slot', slotLabel: '중앙 수비', fitGap: 3.1, fitGapSigma: 0.8, bestRole: null, wageZ: 0.3, reason: '지어낸 이름이 든 문장' }], prospects: [{ uid: 9100004, name: '지어낸 유망주', room: 15, gain: 2.345 }] },
      overpaid: { rows: [], total: 0, model: null },
      contracts: { known: 1, expired: [], within1y: [{ uid: 9100005, name: '지어낸 계약 선수', daysLeft: 120, wage: null }], within2y: [], wageWithin1y: 0 },
      recommend: { matched: 0, slot: null, rows: [] }
    }
    const dashboard = exactDashboard(board as never) as { surplus: { rows: Record<string, { score: number }>; prospects: Record<string, { gain: number }> }; contracts: { within1y: Record<string, { daysLeft: number; wage: number | null }> } }
    expect(dashboard.surplus.rows['9100003'].score).toBe(44.44)
    expect(dashboard.surplus.prospects['9100004'].gain).toBe(2.345)
    expect(dashboard.contracts.within1y['9100005']).toEqual({ daysLeft: 120, wage: null })
    expect(JSON.stringify(dashboard)).not.toContain('지어낸')
  })

  it('자리 하나씩 다른 옛 역할로 바꾼 전술들: 역할이 하나뿐인 자리는 빼고, 바꾼 역할은 그 포지션에서 고를 수 있는 기본이 아닌 역할이다', () => {
    const variants = alternativeRoleVariants(FORMATIONS)
    const expected = FORMATIONS.reduce((total, formation) => total + formation.rows.flat().filter((position) => rolesFor(position).length > 1).length, 0)
    expect(variants).toHaveLength(expected)
    expect(new Set(variants.map((variant) => variant.key)).size).toBe(variants.length)
    for (const variant of variants) {
      const [[slotKey, roleId]] = Object.entries(variant.slotRoles)
      const [formationId, index] = slotKey.split(':')
      const position = FORMATIONS.find((formation) => formation.id === formationId)!.rows.flat()[Number(index)]
      expect(formationId).toBe(variant.formation)
      expect(rolesFor(position).map((role) => role.id)).toContain(roleId)
      expect(roleId).not.toBe(DEFAULT_ROLE[position])
      expect(position).not.toBe('GK')
      expect(variant.key).toBe(`${slotKey}=${roleId}`)
    }
  })
})

describe.skipIf(!SAVE || !Number.isInteger(TEAM) || TEAM <= 0)('고정 세이브: 기준 결과와 시간', () => {
  it(
    '기준 결과와 같고, 시간이 예산 안이다',
    async () => {
      const report: string[] = []

      // ---- 세이브 읽기(찍기만 한다) ----
      const { ws, dash, state, readMs } = await openBaselineWorld(SAVE!, TEAM)
      report.push(`세이브 읽기 ${Math.round(readMs)}ms (찍기만 함)`)

      // ---- 기준 분포(역할 14개 전체) ----
      const normCache = ws as unknown as { normCache: unknown }
      const norms = timeIt(() => {
        normCache.normCache = null
        ws.roleNorms()
      }, 3)
      report.push(`기준 분포 계산 중앙값 ${Math.round(norms.median)}ms (예산 ${BUDGET_MS.norms}ms)`)

      const squad = ws.squad()
      expect(squad.ok, squad.message).toBe(true)
      const snapshot: Record<string, Json> = { team: TEAM, formations: {}, tabs: {}, dashboard: {} }
      const searches: Array<{ key: string; ordinary: number; widest: number }> = []

      // ---- 포메이션 5개: 자리마다 주전·적합도·필요도, 그룹마다 탭별 상위 30명 ----
      for (const formation of FORMATIONS) {
        const analysis = analyseTactic({ rows: squad.rows, columns: squad.columns, today: squad.today, formation: formation.id, slotRoles: {}, roleWeights: {}, norms: squad.roleNorms })!
        const slots: Record<string, Json> = {}
        for (const slot of analysis.slots) {
          slots[String(slot.slot.index)] = {
            position: slot.slot.position,
            role: slot.slot.roleId,
            starter: slot.slot.starter?.idx ?? null,
            fit: r1(slot.starterScore),
            need: r1(slot.need),
            level: slot.level
          }
        }
        ;(snapshot.formations as Record<string, Json>)[formation.id] = slots

        const groups: SlotGroup[] = analysis.groups
        for (const group of groups) {
          for (const category of TABS) {
            const result = ws.candidates(groupQuery(group, formation.id, category))
            const top: Record<string, Json> = {}
            result.rows.slice(0, TOP).forEach((row, rank) => {
              top[String(row.uid)] = { rank: rank + 1, score: r1(row.recommend.total), tier: row.tier, low: row.recommend.realism.low }
            })
            ;(snapshot.tabs as Record<string, Json>)[`${formation.id}/${group.id}/${category}`] = top
          }
        }
        // 시간은 4-2-3-1의 첫 그룹(전술판 맨 위)과 중앙 수비로 잰다
        if (formation.id === '4-2-3-1') {
          const probe = groups.find((group) => group.position === 'DC') ?? groups[0]
          for (const category of TABS) {
            const ask = (widest: boolean) => groupQuery(probe, formation.id, category, widest)
            searches.push({
              key: category,
              ordinary: timeIt(() => ws.candidates(ask(false))).median,
              widest: timeIt(() => ws.candidates(ask(true))).median
            })
          }
        }
      }

      // ---- 대시보드 목록(4-2-3-1): 정리 후보, 주급 과다 의심, 계약 만료 ----
      state.formation = '4-2-3-1'
      const board = await dash.dashboard()
      expect(board.ok, board.message).toBe(true)
      const keyed = <T extends { uid: number }>(list: T[], value: (item: T) => Json): Json => Object.fromEntries(list.map((item) => [String(item.uid), value(item)]))
      snapshot.dashboard = {
        surplus: keyed(board.surplus.rows, (row) => r1(row.score)),
        prospects: keyed(board.surplus.prospects, (row) => r1(row.gain)),
        overpaid: keyed(board.overpaid.rows, (row) => r1(row.z)),
        overpaidTotal: board.overpaid.total,
        contracts: {
          expired: keyed(board.contracts.expired, (row) => row.daysLeft),
          within1y: keyed(board.contracts.within1y, (row) => row.daysLeft),
          within2y: keyed(board.contracts.within2y, (row) => row.daysLeft)
        }
      }

      // ---- 시간 출력 ----
      for (const each of searches) {
        report.push(`후보 찾기 ${each.key.padEnd(8)} 일반 ${each.ordinary.toFixed(1)}ms (예산 ${BUDGET_MS.searchOrdinary}) / 가장 넓은 조건 ${each.widest.toFixed(1)}ms (예산 ${BUDGET_MS.searchWidest})`)
      }
      console.log(`\n[시간]\n${report.join('\n')}\n`)

      // ---- 기준 결과 쓰기 또는 대조 ----
      if (BASELINE) {
        if (UPDATE) {
          mkdirSync(dirname(BASELINE), { recursive: true })
          writeFileSync(BASELINE, `${JSON.stringify(snapshot)}\n`)
          console.log(`[기준 결과] 새로 썼습니다: ${BASELINE}`)
        } else {
          expect(existsSync(BASELINE), `기준 결과 파일이 없습니다. FMB_UPDATE_BASELINE=1로 먼저 만드세요: ${BASELINE}`).toBe(true)
          const was = JSON.parse(readFileSync(BASELINE, 'utf8')) as Json
          const lines = diffJson(was, JSON.parse(JSON.stringify(snapshot)) as Json)
          const text = formatDiff(lines)
          console.log(`[기준 결과 대조]\n${text}`)
          expect(lines.length, text).toBe(0)
        }
      }

      // ---- 예산 ----
      expect(norms.median, '기준 분포 계산').toBeLessThanOrEqual(BUDGET_MS.norms)
      for (const each of searches) {
        expect(each.ordinary, `후보 찾기(일반) ${each.key}`).toBeLessThanOrEqual(BUDGET_MS.searchOrdinary)
        expect(each.widest, `후보 찾기(가장 넓은 조건) ${each.key}`).toBeLessThanOrEqual(BUDGET_MS.searchWidest)
      }
    },
    600_000
  )
})

describe.skipIf(!SAVE || !Number.isInteger(TEAM) || TEAM <= 0 || !BASELINE_EXACT)('고정 세이브: 정밀 기준 결과(반올림 없음, FMB_BASELINE_EXACT)', () => {
  it(
    '정밀 기준 결과와 같다(FMB_UPDATE_BASELINE=1이면 새로 쓴다)',
    async () => {
      const { ws, dash, state } = await openBaselineWorld(SAVE!, TEAM)
      const squad = ws.squad()
      expect(squad.ok, squad.message).toBe(true)
      const analyse = (formation: string, slotRoles: Record<string, string>) =>
        analyseTactic({ rows: squad.rows, columns: squad.columns, today: squad.today, formation, slotRoles, roleWeights: {}, norms: squad.roleNorms })!

      const formations: Record<string, Json> = {}
      const tabs: Record<string, Json> = {}
      for (const formation of FORMATIONS) {
        const analysis = analyse(formation.id, {})
        formations[formation.id] = exactAnalysis(analysis)
        for (const group of analysis.groups) {
          for (const category of TABS) tabs[`${formation.id}/${group.id}/${category}`] = exactCandidates(ws.candidates(groupQuery(group, formation.id, category)), TOP)
        }
      }
      // 포메이션마다 자리 하나씩 다른 옛 역할로 바꾼 전술의 분석(후보 찾기는 하지 않는다)
      const alternatives: Record<string, Json> = {}
      for (const variant of alternativeRoleVariants(FORMATIONS)) alternatives[variant.key] = exactAnalysis(analyse(variant.formation, variant.slotRoles))

      state.formation = '4-2-3-1'
      const board = await dash.dashboard()
      expect(board.ok, board.message).toBe(true)
      const snapshot: Record<string, Json> = { team: TEAM, norms: exactNorms(squad.roleNorms), formations, alternatives, tabs, dashboard: exactDashboard(board) }
      const now = JSON.parse(JSON.stringify(snapshot)) as Json

      if (UPDATE) {
        mkdirSync(dirname(BASELINE_EXACT!), { recursive: true })
        writeFileSync(BASELINE_EXACT!, `${JSON.stringify(snapshot)}\n`)
        console.log(`[정밀 기준 결과] 새로 썼습니다: ${BASELINE_EXACT} (자리 분석 ${Object.keys(formations).length + Object.keys(alternatives).length}개, 후보 목록 ${Object.keys(tabs).length}개)`)
      } else {
        expect(existsSync(BASELINE_EXACT!), `정밀 기준 결과 파일이 없습니다. FMB_UPDATE_BASELINE=1로 먼저 만드세요: ${BASELINE_EXACT}`).toBe(true)
        const lines = diffJson(JSON.parse(readFileSync(BASELINE_EXACT!, 'utf8')) as Json, now)
        const text = formatDiff(lines)
        console.log(`[정밀 기준 결과 대조]\n${text}`)
        expect(lines.length, text).toBe(0)
      }
    },
    600_000
  )
})
