/**
 * 민감도 검사(F-11)의 순수한 부분: 상수를 어떻게 바꾸는지, 겹침을 어떻게 세는지.
 * 세이브를 읽지 않으므로 늘 시험한다(tests/sensitivity.test.ts). 바꾸는 규칙은 그 파일의 머리 설명에 있다.
 */
import type { LedgerEntry } from '../../src/shared/ledger'

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
