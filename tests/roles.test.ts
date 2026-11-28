import { describe, expect, it } from 'vitest'
import { buildDepth, FORMATION_BY_ID } from '../src/shared/depth'
import { FIELDS } from '../src/shared/fields'
import { parsePositions } from '../src/shared/positions'
import { K, withLedger } from '../src/shared/ledger'
import { hasEnoughCoverage, prepareRole, ROLES, savedRoleScore, scoreRole } from '../src/shared/roles'
import { SAVE_ATTRIBUTE_ORDER } from '../src/shared/world'
import type { ColumnInfo, PlayerRow } from '../src/shared/types'

describe('parsePositions', () => {
  it('게임 표기를 자리 목록으로 되돌린다', () => {
    expect(parsePositions('GK')).toEqual(['GK'])
    expect(parsePositions('D (RC), WB (R)').sort()).toEqual(['DC', 'DR', 'WBR'])
    expect(parsePositions('DM, M/AM (C)').sort()).toEqual(['AMC', 'DM', 'MC'])
    expect(parsePositions('D/WB/M (L)').sort()).toEqual(['DL', 'ML', 'WBL'])
    expect(parsePositions('AM (RLC), ST (C)').sort()).toEqual(['AMC', 'AML', 'AMR', 'ST'])
  })
})

describe('scoreRole', () => {
  const attr = (value: number, ranged = false) => ({ value, ranged })

  it('가중 평균을 100점으로 환산한다', () => {
    expect(scoreRole({ a: attr(20), b: attr(10) }, { a: 4, b: 4 })?.score).toBe(75)
    expect(scoreRole({ a: attr(20), b: attr(10) }, { a: 4, b: 0 })?.score).toBe(100)
  })
  it('가중치를 올린 능력치가 점수를 더 많이 움직인다', () => {
    const attrs = { a: attr(18), b: attr(8) }
    expect(scoreRole(attrs, { a: 5, b: 1 })!.score).toBeGreaterThan(scoreRole(attrs, { a: 1, b: 5 })!.score)
  })
  it('필요한 능력치가 대부분 없으면 판단하지 않는다', () => {
    expect(scoreRole({ a: attr(15) }, { a: 2, b: 4, c: 4 })).toBeNull()
  })
  it('범위로 나온 값이 들어가면 불확실로 표시한다', () => {
    expect(scoreRole({ a: attr(13.5, true), b: attr(10) }, { a: 4, b: 4 })?.uncertain).toBe(true)
  })
})

describe('buildDepth', () => {
  const csv = [
    '이름;포지션;골 결정력;오프 더 볼;침착성;예측력;퍼스트 터치;가속도;태클;일대일 마크;헤더;수비 위치 선정;점프 거리;몸싸움',
    '공격수 갑;ST (C);18;17;16;16;15;16;5;5;12;8;12;13',
    '공격수 을;ST (C);13;13;12;12;12;13;5;5;11;8;11;12',
    '수비수 갑;D (C);5;8;13;15;11;12;17;17;17;17;16;17',
    '수비수 을;D (C);5;8;12;14;10;11;15;15;15;15;15;15',
    '수비수 병;D (C);5;8;11;12;10;10;12;12;12;12;12;12'
  ].join('\n')
  // 첫 줄은 열 이름, 나머지는 선수 한 줄씩
  const [head, ...lines] = csv.split('\n').map((line) => line.split(';'))
  const columns: ColumnInfo[] = head.map((header) => {
    const field = FIELDS.find((each) => each.label === header)!
    return { header, field: field.id, group: field.group, short: field.short, label: field.label, isAttr: field.isAttr, numeric: field.isAttr }
  })
  const rows: PlayerRow[] = lines.map((cells, idx) => ({
    idx,
    name: cells[0],
    cells: Object.fromEntries(head.map((header, c) => [header, { raw: cells[c], num: columns[c].isAttr ? Number(cells[c]) : null }]))
  }))
  const formation = { ...FORMATION_BY_ID['4-4-2'], id: 'test', rows: [['ST'], ['DC', 'DC']] as never }

  it('주전은 겹치지 않게 배정하고 후보는 남은 선수 가운데 점수순이다', () => {
    const slots = buildDepth(rows, columns, formation, {}, {})
    expect(slots.map((slot) => slot.starter?.name)).toEqual(['공격수 갑', '수비수 갑', '수비수 을'])
    expect(slots[0].backups.map((p) => p.name)).toEqual(['공격수 을'])
    expect(slots[1].backups.map((p) => p.name)).toEqual(['수비수 병'])
  })

  it('가중치를 바꾸면 순위가 바뀐다', () => {
    // 센터백 역할에서 수비 능력치를 모두 끄고 침착성만 남기면, 침착성이 같은 순서로 다시 줄을 선다
    const off = Object.fromEntries(
      ['marking', 'tackling', 'heading', 'positioning', 'jumping', 'strength', 'anticipation', 'concentration', 'bravery', 'pace', 'decisions', 'acceleration', 'agility'].map((a) => [a, 0])
    )
    const slots = buildDepth(rows, columns, formation, {}, { cb: { ...off, composure: 5 } })
    expect(slots[1].starter?.score).toBe(65)
  })
})

describe('F-08 가중치 60% 가림은 두 경로에 똑같이 있다(scoreRole, savedRoleScore)', () => {
  /** 저장값 한 사람분(54개). 능력치 id → 저장값(1~100). 없는 것은 0(읽지 못함) */
  const stored = (values: Record<string, number>): number[] => SAVE_ATTRIBUTE_ORDER.map((id) => values[id] ?? 0)
  const shown = (value: number): number => Math.min(20, Math.max(1, Math.round(value / 5)))
  const indexOf = (id: string): number => (SAVE_ATTRIBUTE_ORDER as readonly string[]).indexOf(id)

  it('경계: 가중치 합의 60% 이상은 계산하고 60% 미만은 null이다(두 경로 모두)', () => {
    // 가중치 5, 3, 2(합 10): 셋 다 100%, 5+3 80%, 5+2 70%, 5만 50%, 3+2 50%
    const weights = { acceleration: 5, pace: 3, strength: 2 }
    const role = { pairs: Object.entries(weights).map(([id, weight]): [number, number] => [indexOf(id), weight]), total: 10 }
    const cases: Array<[string[], boolean]> = [
      [['acceleration', 'pace', 'strength'], true],
      [['acceleration', 'pace'], true],
      [['acceleration', 'strength'], true],
      [['acceleration'], false],
      [['pace', 'strength'], false]
    ]
    for (const [known, expected] of cases) {
      const values = Object.fromEntries(known.map((id) => [id, 60]))
      const table = scoreRole(Object.fromEntries(known.map((id) => [id, { value: shown(60), ranged: false }])), weights)
      const saved = savedRoleScore(stored(values), 0, role)
      expect(table !== null, `표 ${known.join(',')}`).toBe(expected)
      expect(saved !== null, `세이브 ${known.join(',')}`).toBe(expected)
      if (table && saved !== null) expect(saved).toBe(table.score)
    }
  })

  it('모든 역할에서 능력치를 무작위로 빠뜨려도 두 경로의 null 여부와 점수가 같다', () => {
    let state = 20260
    const random = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
    let nulls = 0
    let values = 0
    for (const role of ROLES) {
      for (let trial = 0; trial < 40; trial++) {
        const saved: Record<string, number> = {}
        const table: Record<string, { value: number; ranged: boolean }> = {}
        for (const id of SAVE_ATTRIBUTE_ORDER) {
          if (random() < trial / 50) continue // 이 능력치는 읽지 못했다
          const value = 1 + Math.floor(random() * 100)
          saved[id] = value
          table[id] = { value: shown(value), ranged: false }
        }
        const fromTable = scoreRole(table, role.weights)
        const fromSave = savedRoleScore(stored(saved), 0, prepareRole(role.id, {}))
        expect(fromSave === null, `${role.id}/${trial}`).toBe(fromTable === null)
        if (fromTable && fromSave !== null) {
          expect(fromSave, `${role.id}/${trial}`).toBe(fromTable.score)
          values++
        } else nulls++
      }
    }
    expect(nulls).toBeGreaterThan(50)
    expect(values).toBeGreaterThan(50)
  })

  it('능력치 54개를 다 읽은 선수는 가림 없이 예전 식과 같은 값이다(세이브의 실제 경우)', () => {
    const saved = Object.fromEntries(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, 1 + ((i * 37) % 100)]))
    for (const role of ROLES) {
      const prepared = prepareRole(role.id, {})
      let sum = 0
      for (const [at, weight] of prepared.pairs) sum += shown(saved[SAVE_ATTRIBUTE_ORDER[at]]) * weight
      expect(savedRoleScore(stored(saved), 0, prepared), role.id).toBe(Math.round((sum / prepared.total / 20) * 1000) / 10)
    }
  })

  it('기준은 상수 하나(ROLE_COVERAGE_MIN)이고 두 경로가 함께 따른다', () => {
    expect(K.ROLE_COVERAGE_MIN).toBe(0.6)
    expect(hasEnoughCoverage(6, 10)).toBe(true)
    expect(hasEnoughCoverage(5.9, 10)).toBe(false)
    expect(hasEnoughCoverage(0, 0)).toBe(false)
    const weights = { acceleration: 5, pace: 3, strength: 2 }
    const role = { pairs: Object.entries(weights).map(([id, weight]): [number, number] => [indexOf(id), weight]), total: 10 }
    const halfKnown = stored({ acceleration: 60 })
    const attrs = { acceleration: { value: 12, ranged: false } }
    expect([scoreRole(attrs, weights), savedRoleScore(halfKnown, 0, role)]).toEqual([null, null])
    withLedger({ ROLE_COVERAGE_MIN: 0.5 }, () => {
      expect(scoreRole(attrs, weights)?.score).toBe(60)
      expect(savedRoleScore(halfKnown, 0, role)).toBe(60)
    })
  })
})
