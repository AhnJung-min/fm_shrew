/**
 * 민감도 회귀(F-11): 대장의 상수를 하나씩 ±20%로 바꿔(숙련 감점 계수는 절반과 두 배) 고정 세이브에서
 * 영입 후보의 탭별 상위 10명이 얼마나 그대로인지 잰다. 결과는 대장의 측정 표(src/shared/ledger.ts의 MEASURED)에 옮겨 적고, 항목의 민감도는 거기서 정해진다.
 *
 * 환경 변수가 모두 있어야 돌고, 없으면 건너뛴다(느리다: 상수 100개 남짓 × 2방향 × 후보 찾기 수십 번).
 *   FMB_TEST_SAVE       고정해 둔 세이브 사본의 경로(tests/baseline.test.ts와 같다)
 *   FMB_TEST_TEAM       그 세이브에서 내 팀 번호
 *   FMB_SENSITIVITY     1이어야 돈다(18분쯤 걸려서, 세이브 변수만 준 채 시험 전체를 돌릴 때 끼지 않게 했다)
 *   FMB_SENSITIVITY_OUT 보고서 JSON을 쓸 경로(없으면 쓰지 않는다). 상수 이름이 열쇠이고 선수 이름은 없다
 *   FMB_SENSITIVITY_ONLY 쉼표로 나눈 상수 이름만 잰다(고칠 때 빠르게 보는 용도)
 *
 * 무엇을 재나
 * - 포메이션은 기본 프리셋(4-2-3-1), 역할 가중치는 기본값. 자리 묶음(같은 포지션·같은 역할)마다 탭 5개
 *   (즉시 전력, 로테이션, 유망주, 자유 계약, 전체)의 후보 찾기를 돌려 상위 10명을 모은다(앱이 쓰는 WorldService.candidates 그대로).
 * - 조건은 둘이다. 기본(후보 화면의 "뛸 수 있는 선수만"이 켜진 상태, 화면의 처음 값)과 넓힘(그것을 끈 상태: 숙련 15 미만 선수도 후보에 든다).
 *   숙련 15 미만 구간의 감점 계수(PENALTY_AWKWARD_*, PENALTY_POOR_*, LOW_GATE_*)는 기본 조건에서는 그 선수가 목록에 못 들어 닿지 않으므로 넓힘에서만 드러난다.
 *   상수의 점수는 두 조건을 모두 아울러 가장 나쁜 값이다.
 * - 겹침@10 = |기준 상위 10 ∩ 변형 상위 10| / 10. 기준 목록이 10명보다 적으면 그 수로 나누고, 비어 있으면 그 묶음은 뺀다.
 * - 탭마다 자리 묶음의 평균을 내고, 상수의 점수는 (조건 × 변형 방향 × 탭) 가운데 가장 나쁜 값이다. 그 조건·탭·방향을 함께 적는다.
 * - 자유 계약 탭은 이 세이브에서 기준 목록이 거의 비어(자유 계약 선수 가운데 어느 유형에도 드는 선수가 없다) 견줄 수 없다. 출력에 '-'로 나온다.
 * - 점수가 0.8 미만이면 민감이다. 검사는 민감한 상수가 있어도 실패하지 않고, 목록(이름, 점수, 탭, 방향)만 출력한다.
 * - 새로 잰 결과가 대장의 측정 표와 다르면 어느 상수가 어떻게 다른지도 출력만 한다(실패하지 않는다).
 *   끝까지 돌리면(FMB_SENSITIVITY_ONLY 없이) 표에 붙일 줄도 출력한다. 상수나 식을 바꾼 뒤에는 이 검사를 다시 돌려 표를 고치고, npm run docs:ledger로 문서를 다시 만든다.
 * - 값이 바뀌어도 어느 목록도 바뀌지 않은 상수는 "변화 없음"으로 표시한다. 보통(0.8 이상)이지만 이 세이브에서 영향을 주지 못했다는 뜻이다(목록에 들지 못한 영역의 상수이거나 경계에 닿지 않은 것).
 *
 * 어떻게 바꾸나(규칙은 tests/helpers/sensitivity.ts)
 * - 숫자 하나는 ×0.8과 ×1.2. 포지션 숙련 감점 계수 5개(PENALTY_ACCOMPLISHED_PER_POINT, PENALTY_AWKWARD_BASE,
 *   PENALTY_AWKWARD_PER_POINT, PENALTY_POOR_BASE, PENALTY_POOR_PER_POINT)는 ×0.5와 ×2.
 * - 정수로 읽는 상수(나이·일수·인원·경기 수·숙련·현재 능력 단위)는 반올림한다. 반올림해도 같으면 한 칸 움직인다.
 * - 비율·충족도·위험·확신도는 0~1로, 숙련은 1~20으로, 현재 능력은 0~200으로 자른다. 자르고 나니 값이 같으면 그 방향은 뺀다.
 * - 숫자 배열과 묶음은 모든 숫자를 바꾼다. [축, 값] 쌍의 표(성장 몫, 계약 쉬움)는 축(나이·일수)을 두고 값만 바꾼다.
 * - 항목 가중치 표(추천 가중치, 숨은 능력치 비중, 필요도 항목 가중치)는 항목을 하나씩 바꾼다. 추천 가중치는 총점을 합 100으로 다시
 *   나누므로 전부 함께 곱하면 아무것도 바뀌지 않는다. 숨은 능력치 비중도 상대 비중이라 같다. 항목마다 따로 재고 가장 나쁜 것을 점수로 한다.
 * - 한 번에 상수 하나만 바꾼다(withLedger). 같은 값에서 파생된 다른 상수(예: 15인 NORM_MIN_RATING과 PLAYABLE_RATING)도 따로 바꾼다.
 *
 * 건너뛰는 것(점수를 매기지 않고 '미측정'으로 둔다)
 * - 이 검사의 후보 찾기가 읽지 않는 상수: 읽기 감시로 가려낸다. 대장의 값 읽기에 감시를 달아 기준 측정 한 번 동안 어떤 상수를 읽는지
 *   적고, 읽지 않은 것은 뺀다(대시보드·스쿼드 진단·직접 답변 전용이거나, 이 세이브가 지나지 않는 대체 경로). 이유는 출력에 적힌다.
 * - 표시용: 점수에 영향이 없고 이유 문장에만 쓰이는 것(REASON_MIN_POINTS).
 *
 * 캐시
 * - withLedger는 상수에서 계산한 캐시를 비우지 않는다. 변형마다 역할 기준 분포와 구단 체급 캐시를 비워 새로 구하게 한다(WorldService의
 *   비공개 값을 시험에서 직접 비운다. baseline.test.ts가 기준 분포 시간을 잴 때 하던 것과 같다). 기준 분포는 0.5초 안이라 세이브를 다시 읽지 않는다.
 * - 주급 모델(영입 후보의 자유 계약 비용 어림)을 세우는 데 읽는 상수(WAGE_*)는 변형마다 모델을 다시 세운다.
 * - 변형이 끝나면 캐시를 다시 비우고(바뀐 값으로 만든 캐시가 남지 않게) 주급 모델도 기본값으로 되돌린다.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { K, LEDGER, SENSITIVE_BELOW, withLedger, type LedgerEntry, type LedgerMeasure } from '../src/shared/ledger'
import { analyseTactic, type SlotGroup } from '../src/shared/tactic'
import { groupQuery, openBaselineWorld, type BaselineWorld } from './helpers/baselineWorld'
import {
  ledgerDisagreements,
  ledgerTableLine,
  meanOverlap,
  overlapAt10,
  scaleNumber,
  TAB_LABEL,
  TABS,
  toLedgerMeasure,
  variantsOf,
  type Tab,
  type Variant
} from './helpers/sensitivity'

const SAVE = process.env.FMB_TEST_SAVE
const TEAM = Number(process.env.FMB_TEST_TEAM)
const RUN = process.env.FMB_SENSITIVITY === '1'
const OUT = process.env.FMB_SENSITIVITY_OUT
const ONLY = (process.env.FMB_SENSITIVITY_ONLY ?? '').split(',').map((text) => text.trim()).filter(Boolean)
const FORMATION = '4-2-3-1'
const THRESHOLD = SENSITIVE_BELOW
/** 후보 화면의 "뛸 수 있는 선수만" 켬(기본)과 끔(넓힘) */
const MODES = ['기본', '넓힘'] as const
type Mode = (typeof MODES)[number]

/** 점수에 영향이 없는 상수(읽기는 하지만 문장에만 쓰인다) */
const DISPLAY_ONLY: Record<string, string> = {
  REASON_MIN_POINTS: '표시용: 이유 문장에 올릴 항목을 고르는 기준이라 순위와 점수에 영향이 없다'
}

describe('민감도 검사의 바꾸기·세기 규칙, 대장 표 모양과 견주기', () => {
  const find = (name: string): LedgerEntry => LEDGER.find((entry) => entry.name === name)!

  it('숫자는 ±20%, 정수 단위는 반올림하고 같으면 한 칸, 감점 계수는 절반과 두 배', () => {
    expect(scaleNumber(1.5, 0.8, 'σ')).toBeCloseTo(1.2, 10)
    expect(scaleNumber(3, 0.8, '명')).toBe(2)
    expect(scaleNumber(3, 1.2, '명')).toBe(4)
    expect(scaleNumber(1, 1.2, '명')).toBe(2)
    expect(variantsOf(find('PENALTY_ACCOMPLISHED_PER_POINT')).map((v) => [v.direction, v.value])).toEqual([
      ['×0.5', 0.04],
      ['×2', 0.16]
    ])
    expect(variantsOf(find('AGE_YOUNG_FROM')).map((v) => v.value)).toEqual([14, 22])
  })

  it('비율은 0~1로 자르고, 자르고 나니 같으면 그 방향을 뺀다', () => {
    const share = variantsOf(find('STARTER_SHARE'))
    expect((share[1].value as Record<string, number>).starter).toBe(1)
    const risk = variantsOf(find('DEPTH_COUNT_RISK'))
    expect(risk[1].value).toEqual([1, 0.6, 0])
    expect(scaleNumber(18, 1.2, '숙련')).toBe(20)
    expect(scaleNumber(18, 1.2, '현재 능력')).toBe(22)
    expect(scaleNumber(190, 1.2, '현재 능력')).toBe(200)
  })

  it('[축, 값] 표는 값만 바꾸고, 항목 가중치 표는 항목을 하나씩 바꾼다', () => {
    const growth = variantsOf(find('GROWTH_SHARE_TABLE'))
    expect((growth[0].value as number[][]).map(([age]) => age)).toEqual([17, 18, 20, 22, 24, 26])
    expect((growth[0].value as number[][])[0][1]).toBeCloseTo(0.624, 10)
    expect((growth[1].value as number[][])[0][1]).toBeCloseTo(0.936, 10)
    const weights = variantsOf(find('RECOMMEND_WEIGHTS'))
    expect(weights).toHaveLength(12)
    const maturity = weights.find((v: Variant) => v.entry === 'maturity' && v.direction === '+20%')!.value as Record<string, Record<string, number>>
    expect(maturity.prospect.maturity).toBeCloseTo(48, 10)
    expect(maturity.prospect.immediate).toBe(12)
    expect(variantsOf(find('TRAIT_WEIGHTS'))).toHaveLength(12)
  })

  it('겹침@10: 기준이 10명보다 적으면 그 수로 나누고, 비면 견줄 것이 없다', () => {
    expect(overlapAt10([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [10, 9, 8, 7, 6, 5, 4, 3, 2, 11])).toBe(0.9)
    expect(overlapAt10([1, 2, 3], [3, 2, 9])).toBeCloseTo(2 / 3, 10)
    expect(overlapAt10([], [1])).toBeNull()
    expect(meanOverlap([1, 0.5, null])).toBe(0.75)
    expect(meanOverlap([null])).toBeNull()
  })

  it('대장 표의 모양: 값이 바뀐 상수는 탭과 방향을, 안 바뀐 상수는 겹침 1만 적는다', () => {
    const found = { score: 0.5222, tab: 'rotation' as const, wide: false, direction: '×2', entry: null, changed: true }
    expect(toLedgerMeasure(found)).toEqual({ overlap: 0.52, tab: '로테이션', direction: '×2' })
    expect(toLedgerMeasure({ ...found, wide: true, entry: 'immediate', direction: '-20%' })).toEqual({ overlap: 0.52, tab: '로테이션', wide: true, direction: 'immediate -20%' })
    expect(toLedgerMeasure({ ...found, score: 1, changed: false })).toEqual({ overlap: 1 })
    expect(ledgerTableLine('A', { overlap: 0.52, tab: '로테이션', direction: '×2' })).toBe("  A: { overlap: 0.52, tab: '로테이션', direction: '×2' },")
    expect(ledgerTableLine('A', { overlap: 0.31, tab: '유망주', wide: true, direction: '+20%' })).toBe("  A: { overlap: 0.31, tab: '유망주', wide: true, direction: '+20%' },")
    expect(ledgerTableLine('A', { overlap: 1 })).toBe('  A: { overlap: 1 },')
  })

  it('대장과 견주기: 같으면 비고, 다르면 어디가 다른지 적고, 일부만 쟀으면 안 잰 상수는 따지지 않는다', () => {
    const table = new Map(LEDGER.flatMap((entry): Array<[string, LedgerMeasure]> => (entry.measured ? [[entry.name, entry.measured]] : [])))
    expect(table.size).toBeGreaterThan(0)
    expect(ledgerDisagreements(table, LEDGER, true)).toEqual([])
    const [first, second] = [...table.keys()]
    const fresh = new Map(table)
    fresh.set(first, { overlap: 0.01, tab: '전체', direction: '+20%' })
    fresh.delete(second)
    const unmeasured = LEDGER.find((entry) => !entry.measured)
    if (unmeasured) fresh.set(unmeasured.name, { overlap: 0.9, tab: '전체', direction: '-20%' })
    const all = ledgerDisagreements(fresh, LEDGER, true)
    expect(all).toHaveLength(unmeasured ? 3 : 2)
    expect(all.some((line) => line.startsWith(`${first}: 대장 `) && line.includes('새로 잰 값 민감 0.01 (전체 탭, +20%)'))).toBe(true)
    expect(all.some((line) => line.startsWith(`${second}: 대장 `) && line.endsWith('새로 잰 값 미측정'))).toBe(true)
    // 일부만 쟀을 때(FMB_SENSITIVITY_ONLY)는 새로 재지 않은 상수를 따지지 않는다
    expect(ledgerDisagreements(fresh, LEDGER, false)).toHaveLength(unmeasured ? 2 : 1)
  })
})

interface Measured {
  name: string
  score: number
  tab: Tab
  mode: Mode
  direction: string
  entry: string | null
  /** 탭마다 가장 나쁜 겹침(방향·항목 가운데) */
  tabs: Record<Tab, number | null>
  /** 어느 변형에서든 상위 10명이 하나라도 바뀌었는가 */
  changed: boolean
}

/** 대장의 값 읽기에 감시를 달아 run 동안 읽힌 상수 이름을 모은다. 끝나면 감시를 떼고 보통 값으로 되돌린다 */
async function watchReads(run: (used: ReadonlySet<string>) => Promise<void>): Promise<Set<string>> {
  const raw = K as unknown as Record<string, unknown>
  const used = new Set<string>()
  const held = new Map<string, unknown>(LEDGER.map((entry) => [entry.name, raw[entry.name]]))
  for (const name of held.keys()) {
    Object.defineProperty(raw, name, {
      get: () => {
        used.add(name)
        return held.get(name)
      },
      set: (value: unknown) => held.set(name, value),
      configurable: true,
      enumerable: true
    })
  }
  try {
    await run(used)
  } finally {
    for (const [name, value] of held) Object.defineProperty(raw, name, { value, writable: true, configurable: true, enumerable: true })
  }
  return used
}

describe.skipIf(!SAVE || !Number.isInteger(TEAM) || TEAM <= 0 || !RUN)('고정 세이브: 상수 민감도(FMB_TEST_SAVE, FMB_TEST_TEAM, FMB_SENSITIVITY=1이 모두 있을 때만 돈다)', () => {
  it(
    '상수마다 ±20%로 바꿔 탭별 상위 10명 겹침을 잰다',
    async () => {
      const started = performance.now()
      const world: BaselineWorld = await openBaselineWorld(SAVE!, TEAM)
      const { ws, dash } = world
      const caches = ws as unknown as { normCache: unknown; statureCache: unknown }
      const wageModel = dash as unknown as { model: unknown }

      const clearCaches = (): void => {
        caches.normCache = null
        caches.statureCache = null
      }
      const refitWage = async (): Promise<void> => {
        wageModel.model = null
        await dash.prepareWageModel()
      }

      const squad = ws.squad()
      expect(squad.ok, squad.message).toBe(true)
      const groups: SlotGroup[] = analyseTactic({ rows: squad.rows, columns: squad.columns, today: squad.today, formation: FORMATION, slotRoles: {}, roleWeights: {}, norms: squad.roleNorms })!.groups

      type Lists = Record<Mode, Record<Tab, number[][]>>
      /** 조건 × 탭 × 자리 묶음의 상위 10명(선수 고유 번호) */
      const collect = (): Lists => {
        const lists = {} as Lists
        for (const mode of MODES) {
          lists[mode] = {} as Record<Tab, number[][]>
          for (const tab of TABS) {
            lists[mode][tab] = groups.map((group) =>
              ws.candidates({ ...groupQuery(group, FORMATION, tab), onlyEligible: mode === '기본' }).rows.slice(0, 10).map((row) => row.uid)
            )
          }
        }
        return lists
      }

      // ---- 기준 측정과 읽기 감시: 어떤 상수를 읽는가(주급 모델을 세울 때 읽는 것은 따로 적는다) ----
      let base = {} as Lists
      let fitReads = new Set<string>()
      const reads = await watchReads(async (used) => {
        await refitWage()
        fitReads = new Set(used)
        clearCaches()
        base = collect()
      })
      clearCaches()

      for (const mode of MODES) {
        const counts = TABS.map((tab) => `${TAB_LABEL[tab]} ${base[mode][tab].filter((list) => list.length > 0).length}`)
        console.log(`\n[민감도] 조건 ${mode}: 자리 묶음 ${groups.length}개, 기준 목록이 있는 묶음 수: ${counts.join(', ')}`)
      }
      expect(base['기본'].all.some((list) => list.length > 0), '기준 목록이 비어 있다').toBe(true)

      /** 변형 하나를 돌려 조건·탭별 겹침 평균을 낸다 */
      const run = async (name: string, variant: Variant): Promise<Record<Mode, Record<Tab, number | null>>> => {
        const refit = fitReads.has(name)
        const result = await withLedger({ [name]: variant.value } as never, async () => {
          clearCaches()
          if (refit) await refitWage()
          return collect()
        })
        clearCaches()
        if (refit) await refitWage()
        const out = {} as Record<Mode, Record<Tab, number | null>>
        for (const mode of MODES) {
          out[mode] = {} as Record<Tab, number | null>
          for (const tab of TABS) out[mode][tab] = meanOverlap(base[mode][tab].map((list, i) => overlapAt10(list, result[mode][tab][i])))
        }
        return out
      }

      // ---- 통제: 아무것도 바꾸지 않은 변형은 기준과 같아야 한다(캐시 비우기와 반복 결과가 흔들리지 않는지) ----
      const control = await run('NORM_CA_FLOOR', { entry: null, direction: '통제', value: K.NORM_CA_FLOOR })
      for (const mode of MODES) for (const tab of TABS) expect(control[mode][tab] ?? 1, `통제 ${mode} ${TAB_LABEL[tab]}`).toBe(1)

      const measured: Measured[] = []
      const skipped: Array<{ name: string; reason: string }> = []
      const targets = LEDGER.filter((entry) => ONLY.length === 0 || ONLY.includes(entry.name))
      let done = 0
      for (const entry of targets) {
        done++
        if (DISPLAY_ONLY[entry.name]) {
          skipped.push({ name: entry.name, reason: DISPLAY_ONLY[entry.name] })
          continue
        }
        if (!reads.has(entry.name)) {
          skipped.push({ name: entry.name, reason: '이 검사의 후보 찾기가 읽지 않는다(대시보드·스쿼드 진단·직접 답변 전용이거나, 이 세이브가 지나지 않는 대체 경로)' })
          continue
        }
        const variants = variantsOf(entry)
        if (variants.length === 0) {
          skipped.push({ name: entry.name, reason: '바꿔도 값이 같다(범위로 잘림)' })
          continue
        }
        const worst: Record<Tab, number | null> = { starter: null, rotation: null, prospect: null, free: null, all: null }
        let best = { score: 2, tab: 'all' as Tab, mode: '기본' as Mode, direction: '', entry: null as string | null }
        let changed = false
        for (const variant of variants) {
          const got = await run(entry.name, variant)
          for (const mode of MODES) {
            for (const tab of TABS) {
              const value = got[mode][tab]
              if (value === null) continue
              if (value < 1) changed = true
              if (worst[tab] === null || value < worst[tab]!) worst[tab] = value
              // 같은 점수면 먼저 만난 조건(기본 → 넓힘)과 탭(즉시 전력 → 전체 순서)과 방향을 쓴다
              if (value < best.score) best = { score: value, tab, mode, direction: variant.direction, entry: variant.entry }
            }
          }
        }
        if (best.score === 2) {
          skipped.push({ name: entry.name, reason: '모든 탭의 기준 목록이 비어 견줄 것이 없다' })
          continue
        }
        measured.push({ name: entry.name, score: best.score, tab: best.tab, mode: best.mode, direction: best.direction, entry: best.entry, tabs: worst, changed })
        if (done % 10 === 0) console.log(`[민감도] ${done}/${targets.length} (${Math.round((performance.now() - started) / 1000)}초)`)
      }

      // ---- 출력 ----
      const label = (m: Measured): string => `${TAB_LABEL[m.tab]}${m.mode === '넓힘' ? '(넓힘)' : ''}, ${m.entry ? `${m.entry} ` : ''}${m.direction}`
      const sorted = [...measured].sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
      const lines = sorted.map(
        (m) =>
          `${m.name.padEnd(34)} ${m.score.toFixed(2)}  ${label(m).padEnd(24)} ${TABS.map((tab) => `${TAB_LABEL[tab]} ${m.tabs[tab] === null ? '-' : m.tabs[tab]!.toFixed(2)}`).join(' / ')}${m.changed ? '' : '  (변화 없음)'}`
      )
      const sensitive = sorted.filter((m) => m.score < THRESHOLD)
      const seconds = Math.round((performance.now() - started) / 1000)
      // 대장의 측정 표와 견준다: 다르면 알리기만 하고 실패하지 않는다
      const measureOf = (m: Measured): LedgerMeasure => toLedgerMeasure({ score: m.score, tab: m.tab, wide: m.mode === '넓힘', direction: m.direction, entry: m.entry, changed: m.changed })
      const differences = ledgerDisagreements(new Map(measured.map((m) => [m.name, measureOf(m)])), LEDGER, ONLY.length === 0)
      console.log(
        [
          '',
          `[민감도] 잰 상수 ${measured.length}개, 건너뜀 ${skipped.length}개, 걸린 시간 ${seconds}초`,
          '이름                               점수  가장 나쁜 탭, 방향          탭별 가장 나쁜 겹침',
          ...lines,
          '',
          `[민감도] ${THRESHOLD} 미만(민감) ${sensitive.length}개:`,
          ...sensitive.map((m) => `  ${m.name} ${m.score.toFixed(2)} (${label(m)})`),
          '',
          differences.length === 0
            ? '[민감도] 대장의 측정 표와 같다.'
            : `[민감도] 대장의 측정 표와 다른 상수 ${differences.length}개(검사는 실패하지 않는다. 표는 아래 붙일 줄로 고친다):`,
          ...differences.map((line) => `  ${line}`),
          '',
          '[민감도] 건너뛴 상수:',
          ...skipped.map((s) => `  ${s.name}: ${s.reason}`),
          '',
          ...(ONLY.length === 0 ? ['[민감도] 대장 표(src/shared/ledger.ts의 MEASURED)에 붙일 줄:', ...measured.map((m) => ledgerTableLine(m.name, measureOf(m))), ''] : [])
        ].join('\n')
      )

      if (OUT) {
        mkdirSync(dirname(OUT), { recursive: true })
        const report = {
          formation: FORMATION,
          threshold: THRESHOLD,
          seconds,
          constants: Object.fromEntries(
            sorted.map((m) => [m.name, { score: Number(m.score.toFixed(4)), tab: TAB_LABEL[m.tab], condition: m.mode, direction: m.direction, entry: m.entry, sensitive: m.score < THRESHOLD, tabs: m.tabs, changed: m.changed }])
          ),
          skipped: Object.fromEntries(skipped.map((s) => [s.name, s.reason]))
        }
        writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
        console.log(`[민감도] 보고서를 썼습니다: ${OUT}`)
      }

      // 실패시키는 것은 검사 자체가 고장 난 경우뿐이다. 민감한 상수가 있다고 실패하지 않는다
      expect(measured.length + skipped.length, '모든 대상이 잰 것이거나 건너뛴 것이어야 한다').toBe(targets.length)
      expect(measured.length, '잰 상수가 없다').toBeGreaterThan(0)
      if (ONLY.length === 0) expect(measured.some((m) => m.changed), '어떤 상수도 목록을 바꾸지 못했다: 상수 바꾸기가 반영되지 않는 것 같다').toBe(true)
    },
    2_400_000
  )
})
