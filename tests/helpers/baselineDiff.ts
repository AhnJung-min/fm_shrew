/**
 * 기준 결과 파일(고정 세이브에서 뽑은 JSON)을 견주는 함수들. 세이브나 게임 자료를 읽지 않는 순수한 함수라 늘 시험한다(tests/baseline.test.ts).
 * 기준 결과는 선수 고유 번호(uid)로만 적고 이름은 적지 않는다.
 */

/** 1자리까지 반올림(기준 결과의 점수 표기) */
export const r1 = (x: number | null | undefined): number | null => (x === null || x === undefined ? null : Math.round(x * 10) / 10)

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export interface DiffLine {
  kind: 'added' | 'removed' | 'changed'
  path: string
  before?: Json
  after?: Json
}

const isObject = (value: Json | undefined): value is { [key: string]: Json } => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 두 JSON의 차이를 경로별로 모은다. 배열은 통째로 값으로 견준다(기준 결과는 순서가 필요한 곳도 uid를 열쇠로 둔 객체로 적는다) */
export function diffJson(before: Json | undefined, after: Json | undefined, path = ''): DiffLine[] {
  if (isObject(before) && isObject(after)) {
    const lines: DiffLine[] = []
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const next = path ? `${path}.${key}` : key
      if (!(key in before)) lines.push({ kind: 'added', path: next, after: after[key] })
      else if (!(key in after)) lines.push({ kind: 'removed', path: next, before: before[key] })
      else lines.push(...diffJson(before[key], after[key], next))
    }
    return lines
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ kind: 'changed', path, before, after }]
}

const show = (value: Json | undefined): string => {
  const text = JSON.stringify(value)
  return text.length > 90 ? `${text.slice(0, 87)}...` : text
}

/** 읽기 쉬운 차이 글. 구역(점으로 나눈 앞 두 칸)마다 센 뒤, 줄을 최대 limit개까지 적는다 */
export function formatDiff(lines: DiffLine[], limit = 120): string {
  if (lines.length === 0) return '기준 결과와 같습니다.'
  const sections = new Map<string, { added: number; removed: number; changed: number }>()
  for (const line of lines) {
    const key = line.path.split('.').slice(0, 2).join('.')
    const entry = sections.get(key) ?? { added: 0, removed: 0, changed: 0 }
    entry[line.kind]++
    sections.set(key, entry)
  }
  const out = [`기준 결과와 ${lines.length}곳이 다릅니다.`]
  for (const [key, count] of sections) out.push(`  ${key}: 바뀜 ${count.changed}, 늘어남 ${count.added}, 없어짐 ${count.removed}`)
  out.push('')
  for (const line of lines.slice(0, limit)) {
    if (line.kind === 'changed') out.push(`  바뀜 ${line.path}: ${show(line.before)} -> ${show(line.after)}`)
    else if (line.kind === 'added') out.push(`  늘어남 ${line.path} = ${show(line.after)}`)
    else out.push(`  없어짐 ${line.path} (이전 ${show(line.before)})`)
  }
  if (lines.length > limit) out.push(`  ... 외 ${lines.length - limit}줄`)
  return out.join('\n')
}

/** 시간 재기: fn을 times번 돌려 걸린 ms의 중앙값과 모든 값을 준다(첫 번째는 데우기라 값에 넣지 않는다) */
export function timeIt(fn: () => unknown, times = 7): { median: number; all: number[] } {
  fn()
  const all: number[] = []
  for (let i = 0; i < times; i++) {
    const start = performance.now()
    fn()
    all.push(performance.now() - start)
  }
  const sorted = [...all].sort((a, b) => a - b)
  return { median: sorted[sorted.length >> 1], all }
}

/** 시간 예산(ms). 후보 찾기는 일반 조건 50, 가장 넓은 조건 100, 기준 분포는 500 */
export const BUDGET_MS = { searchOrdinary: 50, searchWidest: 100, norms: 500 } as const
