/**
 * 민감도 검사(F-11)의 순수한 부분: 상수를 어떻게 바꾸는지, 겹침을 어떻게 세는지.
 * 세이브를 읽지 않으므로 늘 시험한다(tests/sensitivity.test.ts). 바꾸는 규칙은 그 파일의 머리 설명에 있다.
 */
import type { LedgerEntry, LedgerMeasure } from '../../src/shared/ledger'
import { formatSensitivity } from '../../src/shared/ledgerDoc'

export const TAB_LABEL = { starter: '즉시 전력', rotation: '로테이션', prospect: '유망주', free: '자유 계약', all: '전체' } as const
export type Tab = keyof typeof TAB_LABEL
export const TABS = Object.keys(TAB_LABEL) as Tab[]

/** 숙련 감점 계수: ±20%가 아니라 절반과 두 배로 바꾼다(요구사항 F-11) */
export const HALF_DOUBLE: ReadonlySet<string> = new Set([
  'PENALTY_ACCOMPLISHED_PER_POINT',
  'PENALTY_AWKWARD_BASE',
  'PENALTY_AWKWARD_PER_POINT',
  'PENALTY_POOR_BASE',
  'PENALTY_POOR_PER_POINT'
])

/** 정수로 읽는 단위: 바꾼 값을 반올림하고, 그래도 같으면 한 칸 움직인다 */
const INTEGER_UNITS: ReadonlySet<string> = new Set(['세', '일', '명', '경기', '숙련', '현재 능력', '능력', '%', '년'])
/** 0~1 안에 있어야 하는 단위 */
const UNIT_INTERVAL: ReadonlySet<string> = new Set(['비율', '충족도', '위험(0~1)', '확신도', '누적 비율'])
/** 이 이름들의 값(표의 둘째 칸)은 0~1이다. 첫째 칸은 축(나이·일수)이라 건드리지 않는다 */
const PAIR_TABLES: ReadonlySet<string> = new Set(['GROWTH_SHARE_TABLE', 'GROWTH_SHARE_TABLE_GOALKEEPER', 'CONTRACT_EASE'])
/** 합이 정해져 있거나 상대 비중이라, 전부 함께 곱하면 결과가 같거나 뜻이 바뀐다: 항목을 하나씩 바꾼다 */
const PER_ENTRY: ReadonlySet<string> = new Set(['RECOMMEND_WEIGHTS', 'TRAIT_WEIGHTS', 'NEED_FACTOR_WEIGHTS', 'SURPLUS_WEIGHTS'])

export interface Variant {
  /** 표의 항목 하나만 바꾼 경우 그 이름. 값 전체를 바꾼 경우 null */
  entry: string | null
  /** '-20%', '+20%', '×0.5', '×2' */
  direction: string
  value: unknown
}

const tidy = (x: number): number => Number(x.toPrecision(12))

function clampFor(unit: string, value: number): number {
  if (UNIT_INTERVAL.has(unit)) return Math.min(1, Math.max(0, value))
  if (unit === '숙련') return Math.min(20, Math.max(1, value))
  if (unit === '현재 능력' || unit === '능력') return Math.min(200, Math.max(0, value))
  if (unit === '%') return Math.min(100, Math.max(0, value))
  return value
}

/** 숫자 하나를 factor배로. 정수 단위는 반올림하고, 같으면 한 칸 움직인다. 단위의 범위로 자른다 */
export function scaleNumber(base: number, factor: number, unit: string): number {
  let value = base * factor
  if (INTEGER_UNITS.has(unit)) {
    value = Math.round(value)
    if (value === base) value = base + (factor > 1 ? 1 : -1)
  }
  return tidy(clampFor(unit, value))
}

type Scalar = (value: number) => number

/** 값의 모양에 맞게 숫자를 모두 바꾼다(배열·표·묶음). pair 표는 둘째 칸만 */
function mapNumbers(value: unknown, scale: Scalar, name: string): unknown {
  if (typeof value === 'number') return scale(value)
  if (Array.isArray(value)) {
    if (PAIR_TABLES.has(name)) return value.map(([x, y]: [number, number]) => [x, tidy(Math.min(1, Math.max(0, scale(y))))])
    return value.map((each) => mapNumbers(each, scale, name))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, mapNumbers(each, scale, name)]))
  }
  return value
}

/** 표의 값(STATUS_EASE 같은 쉬움, 몫)은 0~1이다 */
const UNIT_INTERVAL_RECORDS: ReadonlySet<string> = new Set(['STATUS_EASE', 'STARTER_SHARE'])

function variantsFor(entry: LedgerEntry, factors: [number, number], labels: [string, string]): Variant[] {
  const { name, unit, value } = entry
  const out: Variant[] = []
  const interval = UNIT_INTERVAL.has(unit) || UNIT_INTERVAL_RECORDS.has(name)
  factors.forEach((factor, i) => {
    const scale: Scalar = (x) => scaleNumber(x, factor, interval ? '비율' : unit)
    if (PER_ENTRY.has(name)) {
      // 한 항목씩. RECOMMEND_WEIGHTS는 유형 5개에 걸쳐 같은 항목(예: 성숙)을 함께 바꾼다
      const rows = value as Record<string, unknown>
      const first = Object.values(rows)[0]
      const nested = first !== null && typeof first === 'object'
      const keys = nested ? Object.keys(first as object) : Object.keys(rows)
      for (const key of keys) {
        const changed = nested
          ? Object.fromEntries(Object.entries(rows).map(([row, each]) => [row, { ...(each as object), [key]: scale((each as Record<string, number>)[key]) }]))
          : { ...rows, [key]: scale(rows[key] as number) }
        out.push({ entry: key, direction: labels[i], value: changed })
      }
    } else {
      out.push({ entry: null, direction: labels[i], value: mapNumbers(value, scale, name) })
    }
  })
  return out
}

/** 상수 하나의 변형 목록. 값이 바뀌지 않는 변형(범위로 잘려 같아진 경우)은 뺀다 */
export function variantsOf(entry: LedgerEntry): Variant[] {
  const halfDouble = HALF_DOUBLE.has(entry.name)
  const all = variantsFor(entry, halfDouble ? [0.5, 2] : [0.8, 1.2], halfDouble ? ['×0.5', '×2'] : ['-20%', '+20%'])
  return all.filter((variant) => JSON.stringify(variant.value) !== JSON.stringify(entry.value))
}

/** 두 상위 목록의 겹침: |기준 ∩ 변형| / |기준|. 기준이 비면 null(견줄 것이 없다) */
export function overlapAt10(base: readonly number[], variant: readonly number[]): number | null {
  const head = base.slice(0, 10)
  if (head.length === 0) return null
  const other = new Set(variant.slice(0, 10))
  return head.filter((uid) => other.has(uid)).length / head.length
}

/** 탭마다 자리 묶음 겹침의 평균. 견줄 묶음이 하나도 없는 탭은 null */
export function meanOverlap(values: ReadonlyArray<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null)
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0) / known.length
}

/** 검사가 잰 상수 하나에서 대장 표에 필요한 것 */
export interface Found {
  score: number
  tab: Tab
  /** 가장 낮은 값이 영입 후보 화면의 "이 자리를 뛸 수 있는 선수만"을 끈 조건(넓힘)에서 나왔는가 */
  wide: boolean
  direction: string
  /** 표의 항목 하나만 바꾼 경우 그 이름 */
  entry: string | null
  /** 어느 변형에서든 상위 10명이 하나라도 바뀌었는가 */
  changed: boolean
}

/** 잰 결과를 대장 표(ledger.ts의 MEASURED)의 모양으로. 값을 바꿔도 어느 목록도 안 바뀐 상수는 overlap 1만 둔다 */
export function toLedgerMeasure(found: Found): LedgerMeasure {
  if (!found.changed) return { overlap: 1 }
  const direction = `${found.entry ? `${found.entry} ` : ''}${found.direction}`
  const overlap = Number(found.score.toFixed(2))
  return found.wide ? { overlap, tab: TAB_LABEL[found.tab], wide: true, direction } : { overlap, tab: TAB_LABEL[found.tab], direction }
}

/** 대장 표에 붙일 한 줄 */
export function ledgerTableLine(name: string, measure: LedgerMeasure): string {
  if (measure.tab === undefined) return `  ${name}: { overlap: ${measure.overlap} },`
  return `  ${name}: { overlap: ${measure.overlap}, tab: '${measure.tab}',${measure.wide ? ' wide: true,' : ''} direction: '${measure.direction}' },`
}

const sameMeasure = (a: LedgerMeasure | undefined, b: LedgerMeasure | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && a.overlap === b.overlap && a.tab === b.tab && !!a.wide === !!b.wide && a.direction === b.direction)

/**
 * 새로 잰 표와 대장의 표를 견줘 다른 곳을 글로 돌려준다. 비어 있으면 대장이 새로 잰 값과 같다.
 * 민감한 상수가 있다는 것은 다름이 아니다. 대장이 적은 것과 새로 잰 값이 다를 때만 적는다.
 * complete가 거짓이면(일부만 쟀을 때) 새로 재지 않은 상수는 따지지 않는다.
 */
export function ledgerDisagreements(fresh: ReadonlyMap<string, LedgerMeasure>, ledger: ReadonlyArray<LedgerEntry>, complete: boolean): string[] {
  const lines: string[] = []
  for (const entry of ledger) {
    const now = fresh.get(entry.name)
    if (now === undefined && !complete) continue
    if (!sameMeasure(now, entry.measured)) lines.push(`${entry.name}: 대장 ${formatSensitivity(entry.measured)} / 새로 잰 값 ${formatSensitivity(now)}`)
  }
  return lines
}
