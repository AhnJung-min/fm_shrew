import { describe, expect, it } from 'vitest'
import { bestRoleOf, buildDepth, FORMATION_BY_ID } from '../src/shared/depth'
import { FIELDS } from '../src/shared/fields'
import { depthCard } from '../src/shared/insights'
import { attributesOf, effectiveWeights, prepareRole, ROLES, savedRoleScore, scoreRole } from '../src/shared/roles'
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
import { SAVE_ATTRIBUTE_ORDER, shownValue } from '../src/shared/world'

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
  return { idx: counter++, name: spec.name, cells }
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

  it('오늘 날짜나 계약 만료일을 모르면 계약 항목을 빼고 나머지를 다시 나눈다', () => {
    const analysis = analyseTactic(base(squad(), { today: undefined }))!
    for (const slot of analysis.slots) {
      const contract = slot.factors.find((each) => each.id === 'contract')!
      expect(contract.counted).toBe(false)
      expect(contract.note).toContain('반영하지 않았습니다')
      const max = slot.factors.reduce((total, each) => total + each.max, 0)
      expect(max).toBeGreaterThan(99.6)
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
    expect(analysis.strongest!.fitAverage!).toBeGreaterThanOrEqual(analysis.weakest!.fitAverage!)
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
