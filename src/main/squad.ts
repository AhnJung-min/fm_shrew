import { FIELDS, FIELD_BY_ID } from '@shared/fields'
import { positionOrder, positionsLabel } from '@shared/positions'
import type { CellValue, ColumnInfo, PlayerRow } from '@shared/types'
import { SAVE_ATTRIBUTE_ORDER, shownValue } from '@shared/world'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from './save/reader'
import { ageAt, type SaveWorld } from './save/world'

/** 스쿼드 표에 넣는 능력치: 게임 화면에 보이는 것만. 기술 → 정신 → 신체 → 골키퍼 순 */
const VISIBLE_ATTRIBUTES = FIELDS.filter((field) => field.isAttr).map((field) => field.id)
const ATTRIBUTE_INDEX = new Map<string, number>(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))
const COLUMN_IDS = ['name', 'position', 'age', 'ability', 'potential', ...VISIBLE_ATTRIBUTES, 'leftFoot', 'rightFoot', 'dob']

const NUMERIC = new Set(['age', 'ability', 'potential', 'leftFoot', 'rightFoot'])

const COLUMNS: ColumnInfo[] = COLUMN_IDS.map((id) => {
  const field = FIELD_BY_ID[id]
  return {
    header: field.label,
    field: id,
    group: field.group,
    short: field.short,
    label: field.label,
    isAttr: field.isAttr,
    numeric: field.isAttr || NUMERIC.has(id)
  }
})

function cell(value: string | number): CellValue {
  return typeof value === 'number' ? { raw: String(value), num: value } : { raw: value, num: null }
}

export interface SquadTable {
  columns: ColumnInfo[]
  /** 줄의 idx는 선수 고유 번호다(값을 다시 받아도 같은 선수를 가리키게) */
  rows: PlayerRow[]
}

/** 내 팀 선수들을 표로 만든다. 내 팀을 모르면 빈 표. */
export function squadTable(world: SaveWorld): SquadTable {
  if (world.teamId === undefined) return { columns: COLUMNS, rows: [] }
  const mine: number[] = []
  for (let k = 0; k < world.count; k++) {
    if (world.teamIds[k] === world.teamId && world.names[k] && world.uids[k] !== 0) mine.push(k)
  }
  const positionsOf = (k: number): number[] => [...world.positions.subarray(k * POSITION_COUNT, (k + 1) * POSITION_COUNT)]
  mine.sort((a, b) => positionOrder(positionsOf(a)) - positionOrder(positionsOf(b)) || world.names[a].localeCompare(world.names[b], 'ko'))

  const rows = mine.map((k): PlayerRow => {
    const attribute = (id: string): number => shownValue(world.attributes[k * ATTRIBUTE_COUNT + ATTRIBUTE_INDEX.get(id)!])
    const age = ageAt(world, k)
    const born = new Date(Date.UTC(world.birthYear[k], 0, world.birthDay[k]))
    const values: Record<string, CellValue> = {
      name: cell(world.names[k]),
      position: cell(positionsLabel(positionsOf(k))),
      age: age === null ? cell('') : cell(age),
      ability: cell(world.ca[k]),
      potential: cell(world.pa[k]),
      leftFoot: cell(attribute('leftFoot')),
      rightFoot: cell(attribute('rightFoot')),
      dob: world.birthYear[k] === 0 ? cell('') : cell(`${born.getUTCFullYear()}.${born.getUTCMonth() + 1}.${born.getUTCDate()}`)
    }
    for (const id of VISIBLE_ATTRIBUTES) values[id] = cell(attribute(id))
    return {
      idx: world.uids[k],
      name: world.names[k],
      cells: Object.fromEntries(COLUMN_IDS.map((id) => [FIELD_BY_ID[id].label, values[id]]))
    }
  })
  return { columns: COLUMNS, rows }
}
