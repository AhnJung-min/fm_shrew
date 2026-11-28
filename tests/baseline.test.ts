/**
 * 고정 세이브 기준 결과와 시간 검사(N-04, N-01).
 *
 * 환경 변수가 없으면 건너뛴다(저장소에는 세이브도 기준 결과 파일도 두지 않는다).
 *   FMB_TEST_SAVE       고정해 둔 세이브 사본의 경로
 *   FMB_TEST_TEAM       그 세이브에서 내 팀 번호
 *   FMB_BASELINE        기준 결과 JSON의 경로(없으면 대조는 건너뛰고 시간만 잰다)
 *   FMB_UPDATE_BASELINE 1이면 대조하지 않고 기준 결과를 새로 쓴다
 *
 * 기준 결과는 선수 고유 번호로만 적는다(이름 없음). 역할 가중치는 언제나 기본값이고 사용자 설정은 읽지 않는다.
 * 시간은 항상 찍고, 예산(후보 찾기 일반 50ms·가장 넓은 100ms, 기준 분포 0.5초)을 넘을 때만 실패한다. 세이브 읽기 시간은 찍기만 한다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FORMATIONS } from '../src/shared/depth'
import { analyseTactic, type SlotGroup } from '../src/shared/tactic'
import { type CandidateCategory } from '../src/shared/world'
import { BUDGET_MS, diffJson, formatDiff, r1, timeIt, type Json } from './helpers/baselineDiff'
import { groupQuery, openBaselineWorld } from './helpers/baselineWorld'

const SAVE = process.env.FMB_TEST_SAVE
const TEAM = Number(process.env.FMB_TEST_TEAM)
const BASELINE = process.env.FMB_BASELINE
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
