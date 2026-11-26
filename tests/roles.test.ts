import { describe, expect, it } from 'vitest'
import { buildDepth, FORMATION_BY_ID } from '../src/shared/depth'
import { FIELDS } from '../src/shared/fields'
import { parsePositions } from '../src/shared/positions'
import { scoreRole } from '../src/shared/roles'
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
    '이름;포지션;골 결정력;오프 더 볼;침착성;예측력;퍼스트 터치;가속도;태클;대인 방어;헤더;위치 선정;점프 거리;몸싸움',
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
