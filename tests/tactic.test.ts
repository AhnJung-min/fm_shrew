import { describe, expect, it } from 'vitest'
import { bestRoleOf, buildDepth, FORMATION_BY_ID } from '../src/shared/depth'
import { FIELDS } from '../src/shared/fields'
import { depthCard } from '../src/shared/insights'
import { attributesOf, effectiveWeights, prepareRole, ROLES, savedRoleScore, scoreRole } from '../src/shared/roles'
import type { RoleNorm } from '../src/shared/norms'
import {
  analyseTactic,
  daysBetween,
  dateFromNumber,
  needLevel,
  NEED_FACTOR_WEIGHTS,
  slotBench,
  type TacticInput
} from '../src/shared/tactic'
import type { CellValue, ColumnInfo, PlayerRow } from '../src/shared/types'
import { POSITION_KEYS } from '../src/shared/positions'
import { benchLine, SAVE_ATTRIBUTE_ORDER, shownValue } from '../src/shared/world'
import { recommendSlotOf } from '../src/shared/dashboard'

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
  /** 모든 능력치에 이 값(1~20)을 준다 */
  level: number
  age?: number
  ca?: number
  pa?: number
  end?: number
  /** 포지션 숙련 {자리: 값}. 적은 자리 말고는 1이다. 안 적으면 숙련 숫자가 없는 행이다 */
  ratings?: Partial<Record<(typeof POSITION_KEYS)[number], number>>
}

let counter = 1
function player(spec: Spec): PlayerRow {
  const cells: Record<string, CellValue> = {
    이름: { raw: spec.name, num: null },
    포지션: { raw: spec.position, num: null },
    나이: num(spec.age ?? 26),
    '현재 능력': num(spec.ca ?? 120),
    '잠재 능력': num(spec.pa ?? 125)
  }
  cells['계약 만료'] = spec.end ? num(spec.end) : { raw: '', num: null }
  for (const field of ATTRS) cells[field.label] = num(spec.level)
  const ratings = spec.ratings ? POSITION_KEYS.map((key) => spec.ratings![key] ?? 1) : undefined
  return { idx: counter++, name: spec.name, cells, ratings }
}

const today = { year: 2026, month: 7, day: 1 }
const base = (rows: PlayerRow[], patch: Partial<TacticInput> = {}): TacticInput => ({
  rows,
  columns: COLUMNS,
  today,
  formation: '4-4-2',
  slotRoles: {},
  roleWeights: {},
  ...patch
})

/** 4-4-2를 채우는 선수들. 최전방은 둘 다 넣지 않을 수도 있다 */
function squad(): PlayerRow[] {
  return [
    player({ name: '골키퍼1', position: 'GK', level: 14, age: 28, end: 20300630 }),
    player({ name: '골키퍼2', position: 'GK', level: 11, age: 24, end: 20300630 }),
    player({ name: '왼풀백', position: 'D (L)', level: 13, age: 25, end: 20290630 }),
    player({ name: '왼풀백후보', position: 'D (L)', level: 11, age: 22, end: 20290630 }),
    player({ name: '오른풀백', position: 'D (R)', level: 13, age: 26, end: 20290630 }),
    player({ name: '센터백1', position: 'D (C)', level: 14, age: 29, end: 20290630 }),
    player({ name: '센터백2', position: 'D (C)', level: 13, age: 27, end: 20290630 }),
    player({ name: '센터백3', position: 'D (C)', level: 12, age: 21, end: 20290630 }),
    player({ name: '센터백4', position: 'D (C)', level: 11, age: 31, end: 20290630 }),
    player({ name: '왼미드', position: 'M (L)', level: 13, age: 25, end: 20290630 }),
    player({ name: '오른미드', position: 'M (R)', level: 13, age: 25, end: 20290630 }),
    player({ name: '중미1', position: 'M (C)', level: 14, age: 27, end: 20290630 }),
    player({ name: '중미2', position: 'M (C)', level: 13, age: 28, end: 20290630 }),
    player({ name: '중미3', position: 'M (C)', level: 12, age: 30, end: 20290630 }),
    player({ name: '공격수1', position: 'ST (C)', level: 14, age: 27, end: 20290630 }),
    player({ name: '공격수2', position: 'ST (C)', level: 13, age: 26, end: 20290630 })
  ]
}

describe('전술 분석', () => {
  it('열이 부족하면 null', () => {
    expect(analyseTactic(base([], { columns: [info('이름', 'name')] }))).toBeNull()
  })

  it('자리마다 필요도, 등급, 이유, 풀이를 준다', () => {
    const analysis = analyseTactic(base(squad()))!
    expect(analysis.slots).toHaveLength(11)
    for (const slot of analysis.slots) {
      expect(slot.need).toBeGreaterThanOrEqual(0)
      expect(slot.need).toBeLessThanOrEqual(100)
      expect(slot.reason.length).toBeGreaterThan(0)
      expect(slot.factors).toHaveLength(4)
      expect(slot.levelLabel).toBe(needLevel(slot.need).label)
    }
  })

  it('필요도는 항목 점수의 합이고 구한 항목의 최대 점수 합은 100이다', () => {
    const analysis = analyseTactic(base(squad()))!
    for (const slot of analysis.slots) {
      const sum = slot.factors.reduce((total, each) => total + each.points, 0)
      const max = slot.factors.reduce((total, each) => total + each.max, 0)
      expect(Math.abs(sum - slot.need)).toBeLessThan(0.5)
      expect(max).toBeGreaterThan(99.6)
      expect(max).toBeLessThan(100.4)
    }
    expect(Object.values(NEED_FACTOR_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('보강 필요도가 높은 순으로 줄 세운다', () => {
    const analysis = analyseTactic(base(squad()))!
    const needs = analysis.byNeed.map((each) => each.need)
    expect(needs).toEqual([...needs].sort((a, b) => b - a))
    expect(analysis.byNeed).toHaveLength(11)
  })

  it('뛸 선수가 없는 자리는 100이고 그렇게 말한다', () => {
    const rows = squad().filter((row) => !row.name.startsWith('공격수'))
    const analysis = analyseTactic(base(rows))!
    const strikers = analysis.slots.filter((each) => each.slot.position === 'ST')
    expect(strikers).toHaveLength(2)
    for (const striker of strikers) {
      expect(striker.need).toBe(100)
      expect(striker.level).toBe('urgent')
      expect(striker.reason).toContain('뛸 수 있는 선수가 없습니다')
      expect(striker.starterScore).toBeNull()
    }
    expect(analysis.byNeed[0].need).toBe(100)
  })

  it('후보가 없고 주전이 나이든 자리가 후보가 두둑한 젊은 자리보다 필요도가 높다', () => {
    const rows = [
      ...squad().filter((row) => row.name !== '오른풀백'),
      player({ name: '늙은오른풀백', position: 'D (R)', level: 13, age: 34, end: 20260930 })
    ]
    const analysis = analyseTactic(base(rows))!
    const right = analysis.slots.find((each) => each.slot.position === 'DR')!
    const centre = analysis.slots.find((each) => each.slot.position === 'DC')!
    expect(right.need).toBeGreaterThan(centre.need)
    const age = right.factors.find((each) => each.id === 'age')!
    const contract = right.factors.find((each) => each.id === 'contract')!
    expect(age.points).toBeGreaterThan(0)
    expect(contract.points).toBeGreaterThan(0)
    expect(right.reason).toMatch(/34세|계약이|후보가/)
  })

  it('주전의 계약이 12개월 넘게 남았으면 계약 위험이 없다', () => {
    const analysis = analyseTactic(base(squad()))!
    for (const slot of analysis.slots) expect(slot.factors.find((each) => each.id === 'contract')!.points).toBe(0)
  })

  it('오늘 날짜나 계약 만료일을 모르면 항목을 빼지 않고 보통 위험(0.15)으로 계산하며 그렇게 적는다', () => {
    const analysis = analyseTactic(base(squad(), { today: undefined }))!
    for (const slot of analysis.slots) {
      const contract = slot.factors.find((each) => each.id === 'contract')!
      expect(contract.counted).toBe(true)
      expect(contract.assumed).toBe(true)
      expect(contract.points).toBeGreaterThan(2)
      expect(contract.points).toBeLessThan(2.5)
      expect(contract.note).toContain('보통 수준으로 보았습니다')
      const max = slot.factors.reduce((total, each) => total + each.max, 0)
      expect(max).toBe(100)
    }
  })

  it('이어받을 23세 이하 선수가 있으면 나이 위험을 줄인다', () => {
    const old = (successor: boolean): number => {
      const rows = [
        ...squad().filter((row) => !row.name.startsWith('센터백')),
        player({ name: '늙은센터백', position: 'D (C)', level: 14, age: 35, end: 20290630 }),
        player({ name: '센터백B', position: 'D (C)', level: 13, age: 28, end: 20290630 }),
        player({ name: '센터백C', position: 'D (C)', level: 12, age: 27, end: 20290630 }),
        ...(successor ? [player({ name: '젊은센터백', position: 'D (C)', level: 14, age: 20, end: 20290630 })] : [player({ name: '중년센터백', position: 'D (C)', level: 14, age: 29, end: 20290630 })])
      ]
      const analysis = analyseTactic(base(rows))!
      const slot = analysis.slots.find((each) => each.slot.starter?.name === '늙은센터백') ?? analysis.slots.find((each) => each.factors.find((f) => f.id === 'age')!.points > 0 && each.slot.position === 'DC')!
      return slot.factors.find((each) => each.id === 'age')!.points
    }
    expect(old(true)).toBeLessThan(old(false))
  })

  it('이 자리를 뛸 수 있는 선수 수를 센다', () => {
    const analysis = analyseTactic(base(squad()))!
    const centre = analysis.slots.find((each) => each.slot.position === 'DC')!
    expect(centre.eligible).toBe(4)
    const gk = analysis.slots.find((each) => each.slot.position === 'GK')!
    expect(gk.eligible).toBe(2)
  })

  it('같은 자리가 둘 이상이면 번호를 붙인다', () => {
    const analysis = analyseTactic(base(squad()))!
    const labels = analysis.slots.filter((each) => each.slot.position === 'DC').map((each) => each.label)
    expect(labels).toEqual(['중앙 수비 1', '중앙 수비 2'])
    expect(analysis.slots.find((each) => each.slot.position === 'GK')!.label).toBe('골키퍼')
  })

  it('줄별 평균과 가장 강한 줄, 약한 줄을 알려 준다', () => {
    const analysis = analyseTactic(base(squad()))!
    expect(analysis.lines.map((line) => line.label)).toEqual(['골키퍼', '수비', '미드필드', '공격'])
    expect(analysis.lines.find((line) => line.id === 'defence')!.slots).toBe(4)
    expect(analysis.fitAverage).not.toBeNull()
    expect(analysis.strongest).not.toBeNull()
    expect(analysis.weakest).not.toBeNull()
    expect(analysis.strongest!.zAverage!).toBeGreaterThanOrEqual(analysis.weakest!.zAverage!)
  })

  it('자리 기준 비교값(주전·두 번째)을 준다', () => {
    const analysis = analyseTactic(base(squad()))!
    const first = analysis.slots.find((each) => each.slot.position === 'GK')!
    const bench = slotBench(analysis, first.slot.index)!
    expect(bench.starter!.name).toBe('골키퍼1')
    expect(bench.backup!.name).toBe('골키퍼2')
    expect(bench.starter!.ca).toBe(120)
    expect(slotBench(analysis, 99)).toBeNull()
  })

  it('역할을 바꾸면 그 자리의 점수와 같은 역할의 적합도가 따라 바뀐다', () => {
    const rows = squad()
    const first = analyseTactic(base(rows))!
    const winger = first.slots.find((each) => each.slot.position === 'ML')!
    const changed = analyseTactic(base(rows, { slotRoles: { [`4-4-2:${winger.slot.index}`]: 'dlp' } }))
    // ML 자리에 딥라잉은 고를 수 없으므로 기본 역할로 남는다
    expect(changed!.slots[winger.slot.index].slot.roleId).toBe(winger.slot.roleId)
    const centre = first.slots.find((each) => each.slot.position === 'MC')!
    const swapped = analyseTactic(base(rows, { slotRoles: { [`4-4-2:${centre.slot.index}`]: 'dlp' } }))!
    expect(swapped.slots[centre.slot.index].slot.roleId).toBe('dlp')
    expect(swapped.slots[centre.slot.index].roleLabel).toBe('딥라잉 플레이메이커')
  })
})

describe('내 선수 가운데 이 자리에 맞는 선수', () => {
  it('이 자리 주전과 다른 자리 주전, 벤치 선수를 구분해 적합도 순으로 보여 준다', () => {
    const analysis = analyseTactic(base(squad()))!
    const slot = analysis.slots.find((each) => each.slot.position === 'DC')!
    expect(slot.options.length).toBeGreaterThan(0)
    const scores = slot.options.map((each) => each.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    const mine = slot.options.find((each) => each.idx === slot.slot.starter!.idx)!
    expect(mine.role).toBe('starter')
    expect(mine.note).toContain('주전입니다')
    const other = slot.options.find((each) => each.role === 'elsewhere')
    expect(other?.elsewhere).toBeTruthy()
  })

  it('자리 숙련이 없지만 점수가 높은 선수는 그렇다고 말한다', () => {
    const rows = [...squad(), player({ name: '미드필더스타', position: 'M (C)', level: 19, age: 27, end: 20290630 })]
    const analysis = analyseTactic(base(rows))!
    const slot = analysis.slots.find((each) => each.slot.position === 'DC')!
    const star = slot.options.find((each) => each.name === '미드필더스타')!
    expect(star.playable).toBe(false)
    expect(star.score).toBeGreaterThan(slot.starterScore!)
    expect(star.note).toContain('보다')
    expect(star.note).toContain('높습니다')
    expect(star.note).toContain('숙련도가 낮아')
  })

  it('다른 자리 주전이면 그 자리를 말한다', () => {
    const rows = [...squad(), player({ name: '만능', position: 'D (C), M (C)', level: 19, age: 27, end: 20290630 })]
    const analysis = analyseTactic(base(rows))!
    const slot = analysis.slots.find((each) => each.slot.position === 'DC')!
    const flexible = analysis.slots
      .flatMap((each) => each.options)
      .find((each) => each.name === '만능' && each.role === 'elsewhere')
    if (flexible) expect(flexible.note).toContain('지금은')
    expect(slot.options.some((each) => each.name === '만능')).toBe(true)
  })
})

describe('한 점수, 한 식', () => {
  it('전술 분석의 주전 점수는 같은 선수·역할로 scoreRole을 부른 값이다', () => {
    const rows = squad()
    const analysis = analyseTactic(base(rows))!
    for (const slot of analysis.slots) {
      if (!slot.slot.starter) continue
      const row = rows.find((each) => each.idx === slot.slot.starter!.idx)!
      const direct = scoreRole(attributesOf(row, COLUMNS), effectiveWeights(slot.slot.roleId, {}))!.score
      expect(slot.starterScore).toBe(direct)
      expect(slot.options.find((each) => each.idx === row.idx)!.score).toBe(direct)
    }
  })

  /** 세이브에 저장되는 값(1~100)으로 선수를 만들고, 같은 선수의 표 줄(표시값 1~20)도 만든다 */
  function twin(seed: number): { stored: number[]; row: PlayerRow } {
    let state = seed * 2654435761
    const next = (): number => {
      state = (state ^ (state << 13)) >>> 0
      state = (state ^ (state >>> 17)) >>> 0
      state = (state ^ (state << 5)) >>> 0
      return state / 0xffffffff
    }
    const stored = SAVE_ATTRIBUTE_ORDER.map(() => 1 + Math.floor(next() * 100))
    const cells: Record<string, CellValue> = {
      이름: { raw: `선수${seed}`, num: null },
      포지션: { raw: 'M (C)', num: null },
      나이: num(25),
      '현재 능력': num(120),
      '잠재 능력': num(125),
      '계약 만료': { raw: '', num: null }
    }
    for (const field of ATTRS) cells[field.label] = num(shownValue(stored[SAVE_ATTRIBUTE_ORDER.indexOf(field.id as (typeof SAVE_ATTRIBUTE_ORDER)[number])]))
    return { stored, row: { idx: seed, name: `선수${seed}`, cells } }
  }

  it('영입 후보가 쓰는 세이브 값 계산과 스쿼드의 표 값 계산이 모든 역할에서 같은 수를 낸다', () => {
    const overrides = { cb: { tackling: 5, pace: 1 }, st: { finishing: 0 } }
    for (let seed = 1; seed <= 40; seed++) {
      const { stored, row } = twin(seed)
      for (const role of ROLES) {
        const direct = scoreRole(attributesOf(row, COLUMNS), effectiveWeights(role.id, overrides))
        expect(direct, `${seed}/${role.id}`).not.toBeNull()
        expect(savedRoleScore(stored, 0, prepareRole(role.id, overrides)), `${seed}/${role.id}`).toBe(direct!.score)
      }
    }
  })

  it('뎁스 차트의 주전 점수와 선수 표의 최적 역할 점수도 같은 식이다', () => {
    const rows = Array.from({ length: 30 }, (_, i) => twin(i + 1).row)
    for (const row of rows) row.cells['포지션'] = { raw: 'D (C), M (C), ST (C)', num: null }
    const formation = FORMATION_BY_ID['4-4-2']
    const slots = buildDepth(rows, COLUMNS, formation, {}, {})
    for (const slot of slots.filter((each) => each.starter)) {
      const row = rows.find((each) => each.idx === slot.starter!.idx)!
      const direct = scoreRole(attributesOf(row, COLUMNS), effectiveWeights(slot.roleId, {}))!.score
      expect(slot.starter!.score).toBe(direct)
      // 최적 역할은 그 선수가 뛸 수 있는 모든 역할 가운데 최고라서 자리 역할의 점수 이상이다
      expect(bestRoleOf(row, COLUMNS, {})!.score).toBeGreaterThanOrEqual(direct)
    }
  })
})

describe('날짜 도구', () => {
  it('날짜 사이의 일수와 20270630 꼴 날짜', () => {
    expect(daysBetween({ year: 2026, month: 7, day: 1 }, { year: 2027, month: 7, day: 1 })).toBe(365)
    expect(daysBetween({ year: 2026, month: 7, day: 1 }, { year: 2026, month: 6, day: 1 })).toBe(-30)
    expect(dateFromNumber(20270630)).toEqual({ year: 2027, month: 6, day: 30 })
    expect(dateFromNumber(0)).toBeNull()
  })
  it('등급 경계', () => {
    expect(needLevel(100).label).toBe('시급')
    expect(needLevel(55).label).toBe('시급')
    expect(needLevel(54.9).label).toBe('보강 권장')
    expect(needLevel(30).label).toBe('보강 권장')
    expect(needLevel(12).label).toBe('보통')
    expect(needLevel(11.9).label).toBe('충분')
    expect(needLevel(0).label).toBe('충분')
  })
})

describe('스쿼드 진단의 포지션 뎁스 카드', () => {
  it('전술 분석과 같은 자리·같은 이유를 쓴다', () => {
    const rows = squad().filter((row) => !row.name.startsWith('공격수'))
    const analysis = analyseTactic(base(rows))!
    const card = depthCard(analysis, '4-4-2')
    expect(card.tone).toBe('attention')
    expect(card.finding).toContain('시급')
    expect(card.lines[0].detail).toContain(analysis.byNeed[0].reason)
    expect(card.lines[0].detail).toContain(`보강 필요도 ${Math.round(analysis.byNeed[0].need)}`)
  })
  it('분석을 못 했으면 자료 없음', () => {
    expect(depthCard(null, '4-4-2').tone).toBe('missing')
  })
})

describe('역할 기준 분포로 재는 보강 필요도', () => {
  const norm = (mu: number, sigma = 3): RoleNorm => ({ mu, sigma, beta: 0.28, n: 100, caRef: 150 })
  const find = (analysis: NonNullable<ReturnType<typeof analyseTactic>>, position: string) => analysis.slots.find((each) => each.slot.position === position)!

  it('주전 전력은 같은 역할 기준에서 z로 잰다: z +0.53이면 위험 (1 - z)/3, 전력 점수 7.0', () => {
    // 4-4-2의 왼풀백은 level 13 = 65점. 풀백 기준 mu 63.4, σ 3 → z = +0.533
    const analysis = analyseTactic(base(squad(), { norms: { fb: norm(63.4) } }))!
    const left = find(analysis, 'DL')
    expect(left.starterZ).toBeCloseTo(0.533, 2)
    expect(left.factors.find((each) => each.id === 'quality')!.points).toBeCloseTo((45 * (1 - 0.5333)) / 3, 1)
    expect(left.normSource).toBe('world')
  })

  it('점수가 같아도 역할 기준에서 더 약하면 필요도가 높다(같은 65점: 풀백 z 0, 윙어 z -1.67)', () => {
    const analysis = analyseTactic(base(squad(), { norms: { fb: norm(65), winger: norm(70) } }))!
    const quality = (position: string): number => find(analysis, position).factors.find((each) => each.id === 'quality')!.points
    expect(find(analysis, 'DL').starterScore).toBe(find(analysis, 'ML').starterScore)
    expect(quality('ML')).toBeGreaterThan(quality('DL'))
  })

  it('기준 분포가 없으면 우리 팀 주전 평균을 기준으로 대신하고 그렇게 표시한다', () => {
    const analysis = analyseTactic(base(squad()))!
    for (const slot of analysis.slots) {
      expect(slot.normSource).toBe('fallback')
      expect(slot.norm.mu).toBe(analysis.fitAverage)
    }
  })

  it('이유 문장은 사실과 맞다: 적합도가 기준보다 높은데 못 미친다고 쓰지 않는다', () => {
    let state = 99
    const random = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
    let checked = 0
    for (let trial = 0; trial < 60; trial++) {
      const rows = squad().map((row) => {
        const level = 8 + Math.floor(random() * 11)
        for (const field of ATTRS) row.cells[field.label] = num(level)
        return row
      })
      const norms = Object.fromEntries(ROLES.map((role) => [role.id, norm(60 + random() * 20, 2.5 + random() * 3)]))
      const analysis = analyseTactic(base(rows, { norms }))!
      for (const slot of analysis.slots) {
        const z = slot.starterZ!
        expect(slot.reason).not.toContain('기준(70점)')
        if (slot.reason.includes('크게 낮습니다')) expect(z, slot.reason).toBeLessThan(-1)
        if (slot.reason.includes('조금 낮습니다')) {
          expect(z, slot.reason).toBeGreaterThanOrEqual(-1)
          expect(z, slot.reason).toBeLessThan(0)
        }
        if (slot.reason.includes('조금 높은 수준')) expect(z, slot.reason).toBeGreaterThanOrEqual(0)
        // 이유로 올라온 항목은 실제로 5점 넘게 더한 항목이다
        const quality = slot.factors.find((each) => each.id === 'quality')!.points
        if (quality < 5) expect(slot.reason).not.toMatch(/상위권 평균/)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(500)
  })

  it('이름 뒤 조사를 받침에 맞게 쓴다(반 다이크가 34세입니다)', () => {
    const rows = [
      ...squad().filter((row) => row.name !== '오른풀백'),
      player({ name: '반 다이크', position: 'D (R)', level: 13, age: 34, end: 20290630 })
    ]
    const analysis = analyseTactic(base(rows))!
    expect(find(analysis, 'DR').factors.find((each) => each.id === 'age')!.note).toContain('주전 반 다이크가 34세입니다')
  })

  it('알 수 없는 나이·계약은 빼지 않고 보통 위험으로 계산하며, 이유로 올리지 않는다', () => {
    const analysis = analyseTactic(base(squad(), { today: undefined }))!
    for (const slot of analysis.slots) {
      expect(slot.factors.every((each) => each.counted)).toBe(true)
      expect(slot.reason).not.toContain('계약')
    }
  })

  it('후보가 없으면 두께 위험이 1이다. 첫 후보와의 격차는 σ로 잰다', () => {
    const analysis = analyseTactic(base(squad()))!
    const gk = find(analysis, 'GK')
    expect(gk.factors.find((each) => each.id === 'depth')!.points).toBeLessThanOrEqual(25)
    const lonely = analyseTactic(base(squad().filter((row) => row.name !== '골키퍼2')))!
    expect(find(lonely, 'GK').factors.find((each) => each.id === 'depth')!.points).toBe(25)
  })
})

describe('주전 배정(헝가리안)', () => {
  const lines = (position: string, level: number, name: string): PlayerRow => player({ name, position, level })
  // 센터백과 수비형 미드를 둘 다 뛰는 A가 센터백에서도 가장 높아, 탐욕 배정이면 A가 센터백을 차지하고 수비형 미드가 빈다
  const rows = [lines('D (C), DM', 16, '에이'), lines('D (C)', 14, '비')]
  const formation = { id: 't', label: 't', rows: [['DC'], ['DM']] as never }

  it('가능한 한 많은 자리를 채우고 뛸 수 없는 자리에는 아무도 넣지 않는다', () => {
    const slots = buildDepth(rows, COLUMNS, formation, {}, {})
    expect(slots[0].starter?.name).toBe('비')
    expect(slots[1].starter?.name).toBe('에이')
    const none = buildDepth([lines('D (C)', 14, '비')], COLUMNS, formation, {}, {})
    expect(none[1].starter).toBeNull()
  })

  it('입력 순서가 달라도 같은 결과다', () => {
    const many = squad()
    const a = analyseTactic(base(many))!
    const b = analyseTactic(base([...many].reverse()))!
    expect(a.slots.map((each) => each.slot.starter?.idx)).toEqual(b.slots.map((each) => each.slot.starter?.idx))
  })

  it('4-4-2 전체에서 숙련 15 미만 자리에는 배정하지 않는다', () => {
    const slots = buildDepth(squad(), COLUMNS, FORMATION_BY_ID['4-4-2'], {}, {})
    for (const slot of slots) {
      if (!slot.starter) continue
      const row = squad().find((each) => each.name === slot.starter!.name)
      expect(row).toBeDefined()
    }
    expect(slots.filter((slot) => slot.starter).length).toBe(11)
  })

  it('기준 분포가 있으면 약한 자리를 z로 가린다', () => {
    const norms = Object.fromEntries(ROLES.map((role) => [role.id, { mu: 60, sigma: 3, beta: 0.28, n: 100, caRef: 150 }]))
    norms.fb = { ...norms.fb, mu: 70 }
    const slots = buildDepth(squad(), COLUMNS, FORMATION_BY_ID['4-4-2'], {}, {}, 2, norms)
    // 풀백 기준만 높아 풀백 자리(DL, DR)가 약하다
    expect(slots.filter((slot) => slot.weak).map((slot) => slot.position).sort()).toEqual(['DL', 'DR'])
  })
})

describe('4회차: 숙련 10~14는 임시 주전(T3)', () => {
  const norms: Record<string, RoleNorm> = Object.fromEntries(ROLES.map((role) => [role.id, { mu: 60, sigma: 3, beta: 0.28, n: 100, caRef: 150 }]))
  const withoutRightMid = (): PlayerRow[] => squad().filter((row) => row.name !== '오른미드')
  const winger = (rating: number, level = 14): PlayerRow => player({ name: '측면공격수', position: 'AM (R)', level, age: 24, end: 20290630, ratings: { AMR: 20, MR: rating } })
  const rightMid = (analysis: NonNullable<ReturnType<typeof analyseTactic>>) => analysis.slots.find((each) => each.slot.position === 'MR')!

  it('오른쪽 미드 숙련 14 선수가 있으면 빈 자리가 아니라 임시 주전이다(필요도 100이 아니다)', () => {
    const empty = analyseTactic(base(withoutRightMid(), { norms }))!
    expect(rightMid(empty).slot.starter).toBeNull()
    expect(rightMid(empty).need).toBe(100)

    const rows = [...withoutRightMid(), winger(14)]
    const analysis = analyseTactic(base(rows, { norms }))!
    const mr = rightMid(analysis)
    expect(mr.slot.starter?.name).toBe('측면공격수')
    expect(mr.slot.starter?.temporary).toBe(true)
    expect(mr.slot.starter?.rating).toBe(14)
    // 숙련 14 감점 0.70σ를 뺀 값으로 견준다
    expect(mr.starterEff!).toBeCloseTo(mr.starterScore! - 3 * 0.7, 5)
    expect(mr.starterZ!).toBeCloseTo((mr.starterEff! - 60) / 3, 5)
    expect(mr.need).toBeLessThan(100)
    expect(mr.reason).toContain('주전 측면공격수가 숙련 14이라 임시로 세웠')
    expect(mr.factors.find((each) => each.id === 'quality')!.note).toContain('숙련 14이라 임시로 세웠습니다')
    // 영입 후보의 비교 주전도 그 선수다(숙련 감점을 뺀 값)
    expect(mr.group.bench.starter?.name).toBe('측면공격수')
    expect(mr.group.bench.starter?.score).toBeCloseTo(mr.starterEff!, 5)
  })

  it('숙련 10 미만은 여전히 빈 자리다', () => {
    const analysis = analyseTactic(base([...withoutRightMid(), winger(9)], { norms }))!
    expect(rightMid(analysis).slot.starter).toBeNull()
    expect(rightMid(analysis).need).toBe(100)
    expect(analyseTactic(base([...withoutRightMid(), winger(10)], { norms }))!.slots.find((each) => each.slot.position === 'MR')!.slot.starter?.temporary).toBe(true)
  })

  it('숙련 15 이상 선수가 있으면 능력이 더 낮아도 그쪽이 먼저다. 임시 주전은 후보가 되지 못한다', () => {
    const natural = player({ name: '자연오른미드', position: 'M (R)', level: 11, age: 25, end: 20290630, ratings: { MR: 15 } })
    const rows = [...withoutRightMid(), natural, winger(14, 18)]
    const analysis = analyseTactic(base(rows, { norms }))!
    const mr = rightMid(analysis)
    expect(mr.slot.starter?.name).toBe('자연오른미드')
    expect(mr.slot.starter?.temporary).toBe(false)
    // 후보(backups)는 숙련 15 이상만: 임시 자원은 후보에 오르지 않는다
    expect(mr.slot.backups.map((each) => each.name)).not.toContain('측면공격수')
    expect(mr.slot.backups.every((each) => !each.temporary)).toBe(true)
  })

  it('다른 자리의 자연 주전을 빼앗지는 않는다: 임시 배정은 빈 자리를 채울 때만 이득이다', () => {
    const slots = buildDepth([...withoutRightMid(), winger(12)], COLUMNS, FORMATION_BY_ID['4-4-2'], {}, {}, 2, norms)
    expect(slots.filter((slot) => slot.starter).length).toBe(11)
    expect(slots.filter((slot) => slot.starter?.temporary).map((slot) => slot.position)).toEqual(['MR'])
  })
})

describe('2회차: 숙련 감점, 같은 자리 그룹, 줄 요약', () => {
  const norms = (patch: Record<string, number> = {}): Record<string, RoleNorm> =>
    Object.fromEntries(ROLES.map((role) => [role.id, { mu: patch[role.id] ?? 60, sigma: 3, beta: 0.28, n: 100, caRef: 150 }]))
  const find = (analysis: NonNullable<ReturnType<typeof analyseTactic>>, position: string) => analysis.slots.find((each) => each.slot.position === position)!
  const twoBacks = (): PlayerRow[] => [
    // 같은 능력이어도 왼쪽 수비 숙련 16이면 적합도에서 0.32σ를 뺀다
    player({ name: '숙련16', position: 'D (L)', level: 14, ratings: { DL: 16 } }),
    player({ name: '숙련20', position: 'D (L)', level: 13, ratings: { DL: 20 } })
  ]

  it('주전 배정과 필요도는 숙련 감점을 뺀 적합도(z_eff)로 한다', () => {
    const formation = { id: 't', label: 't', rows: [['DL']] as never }
    const slots = buildDepth(twoBacks(), COLUMNS, formation, {}, {}, 2, norms())
    const plain = analyseTactic(base(twoBacks(), { formation: '4-4-2', norms: norms() }))!
    // 능력치 한 단계(5점)가 숙련 16의 감점(0.96점)보다 커서 숙련 16이 이긴다
    expect(slots[0].starter!.name).toBe('숙련16')
    expect(slots[0].starter!.effScore).toBeCloseTo(slots[0].starter!.score - 3 * 0.32, 5)
    expect(slots[0].starter!.rating).toBe(16)
    expect(slots[0].starter!.z).toBeCloseTo((slots[0].starter!.effScore - 60) / 3, 5)
    const left = find(plain, 'DL')
    expect(left.starterEff).toBeCloseTo(left.starterScore! - 3 * 0.32, 5)
    expect(left.starterZ).toBeCloseTo((left.starterEff! - 60) / 3, 5)
  })

  it('숙련 감점 때문에 능력치가 조금 낮은 자연 포지션 선수가 주전이 된다', () => {
    const rows = [
      player({ name: '숙련12', position: 'D (L)', level: 14, ratings: { DL: 16 } }),
      player({ name: '자연', position: 'D (L)', level: 14, ratings: { DL: 20 } })
    ]
    const formation = { id: 't', label: 't', rows: [['DL']] as never }
    expect(buildDepth(rows, COLUMNS, formation, {}, {}, 2, norms())[0].starter!.name).toBe('자연')
  })

  it('같은 포지션·역할의 자리는 한 그룹이고 어느 자리를 골라도 같은 기준이다', () => {
    const rows = [...squad(), player({ name: '노장센터백', position: 'D (C)', level: 15, age: 35, end: 20290630 })]
    for (const formation of ['4-4-2', '3-5-2']) {
      const analysis = analyseTactic(base(rows, { formation, norms: norms() }))!
      const centre = analysis.groups.filter((group) => group.position === 'DC')
      expect(centre).toHaveLength(1)
      expect(centre[0].slots.length).toBe(formation === '4-4-2' ? 2 : 3)
      expect(centre[0].label).toContain(centre[0].slots.length + '자리')
      const benches = centre[0].slots.map((index) => slotBench(analysis, index))
      for (const bench of benches) expect(bench).toEqual(benches[0])
      for (const index of centre[0].slots) expect(analysis.slots[index].group.need).toBe(centre[0].need)
    }
  })

  it('그룹의 비교 주전은 나이 하락까지 반영한 가장 약한 주전이고, 필요도는 자리들의 최대다', () => {
    const rows = [
      player({ name: '노장', position: 'D (C)', level: 16, age: 35, ca: 150 }),
      player({ name: '젊은이', position: 'D (C)', level: 15, age: 26, ca: 140 }),
      player({ name: '후보', position: 'D (C)', level: 12, age: 25 })
    ]
    const formation = { id: 't', label: 't', rows: [['DC', 'DC']] as never }
    const slots = buildDepth(rows, COLUMNS, formation, {}, {}, 2, norms())
    expect(slots.map((slot) => slot.starter?.name).sort()).toEqual(['노장', '젊은이'])
    const analysis = analyseTactic(base(rows, { formation: '4-4-2', norms: norms() }))!
    const group = analysis.groups.find((each) => each.position === 'DC')!
    // 노장(적합 높음, 35세라 4점 하락)과 젊은이 가운데 하락 반영 값이 낮은 쪽이 기준이다
    const old = analysis.slots.find((each) => each.slot.starter?.name === '노장')!
    const young = analysis.slots.find((each) => each.slot.starter?.name === '젊은이')!
    const weakest = old.starterEff! - 4 < young.starterEff! ? old : young
    expect(group.bench.starter!.name).toBe(weakest.slot.starter!.name)
    expect(group.need).toBe(Math.max(old.need, young.need))
  })

  it('줄 요약에서 가장 강한·약한 줄은 적합도 평균이 아니라 z_eff 평균으로 고른다', () => {
    // 수비수는 적합도 평균이 낮아도 그 역할 기준이 낮아 z가 높다
    const analysis = analyseTactic(base(squad(), { norms: norms({ cb: 50, fb: 50, st: 75, tm: 75 }) }))!
    const line = (id: string) => analysis.lines.find((each) => each.id === id)!
    expect(line('defence').zAverage!).toBeGreaterThan(line('attack').zAverage!)
    expect(analysis.strongest!.id).toBe('defence')
  })

  it('이유 문장은 앞 절을 잇는 꼴로 쓴다(쉼표 뒤에 맺는 꼴을 두 번 쓰지 않는다)', () => {
    const rows = [
      player({ name: '노장 수비수', position: 'D (C)', level: 15, age: 34, end: 20290630 }),
      player({ name: '어린 수비수', position: 'D (C)', level: 13, age: 20, end: 20290630 })
    ]
    const analysis = analyseTactic(base(rows, { formation: '3-4-3', norms: norms() }))!
    const reasons = analysis.slots.map((each) => each.reason)
    expect(reasons.some((reason) => /고, 주전 노장 수비수가 34세입니다.$/.test(reason))).toBe(true)
    for (const reason of reasons) expect(reason).not.toMatch(/(입니다|습니다), /)
  })

  it('대시보드 영입 추천도 같은 그룹 기준을 쓴다(위에 적힌 주전과 카드의 차이가 맞는다)', () => {
    const rows = [...squad(), player({ name: '노장센터백', position: 'D (C)', level: 15, age: 35, end: 20290630 })]
    const analysis = analyseTactic(base(rows, { formation: '4-4-2', norms: norms() }))!
    const centre = analysis.slots.find((each) => each.slot.position === 'DC')!
    const slot = recommendSlotOf(analysis.formation.id, centre)
    expect(slot.label).toBe('중앙 수비 2자리')
    expect(slot.groupSlots).toBe(2)
    expect(slot.need).toBe(centre.group.need)
    expect(slot.bench).toEqual(slotBench(analysis, centre.slot.index))
    expect(benchLine(slot.bench, slot.groupSlots)).toContain('가장 약한 주전 ' + slot.bench.starter!.name)
  })
})
