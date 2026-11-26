import { FIELDS, FIELD_BY_ID } from '@shared/fields'
import { formatPounds as pounds } from '@shared/playerView'
import { positionOrder, positionsLabel } from '@shared/positions'
import type { CellValue, ColumnInfo, PlayerRow, SquadResult } from '@shared/types'
import { SAVE_ATTRIBUTE_ORDER, shownValue, SQUAD_STATUS_LABEL } from '@shared/world'
import { calendar } from './save/contracts'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from './save/reader'
import { ageAt, type SaveWorld } from './save/world'

/** 스쿼드 표에 넣는 능력치: 게임 화면에 보이는 것만. 기술 → 정신 → 신체 → 골키퍼 순 */
const VISIBLE_ATTRIBUTES = FIELDS.filter((field) => field.isAttr).map((field) => field.id)
const ATTRIBUTE_INDEX = new Map<string, number>(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))
/** 몸값·주급·계약은 세이브에 적힌 값이다. 표에서는 "계약" 묶음으로 접어 두고, 스쿼드 진단이 쓴다 */
const CONTRACT_IDS = ['value', 'wage', 'contractEnd', 'squadStatus']
const COLUMN_IDS = ['name', 'position', 'age', 'ability', 'potential', ...VISIBLE_ATTRIBUTES, 'leftFoot', 'rightFoot', 'dob', ...CONTRACT_IDS]

const NUMERIC = new Set(['age', 'ability', 'potential', 'leftFoot', 'rightFoot', 'value', 'wage', 'contractEnd'])

const COLUMNS: ColumnInfo[] = COLUMN_IDS.map((id) => {
  const field = FIELD_BY_ID[id]
  return {
    header: field.label,
    field: id,
    group: field.group,
    short: field.short,
    label: id === 'value' ? '몸값 (세이브에 적힌 기준값)' : id === 'squadStatus' ? '계약상 입지 (구단이 약속한 역할)' : field.label,
    isAttr: field.isAttr,
    numeric: field.isAttr || NUMERIC.has(id)
  }
})

function cell(value: string | number): CellValue {
  return typeof value === 'number' ? { raw: String(value), num: value } : { raw: value, num: null }
}

/** 돈 칸: 세이브에 값이 없으면(0) 빈 칸 */
const money = (value: number): CellValue => (value > 0 ? { raw: pounds(value), num: value } : cell(''))

export type SquadTable = Pick<SquadResult, 'columns' | 'rows' | 'today' | 'clubUid'>

/** 내 팀 선수들을 표로 만든다. 내 팀을 모르면 빈 표. */
export function squadTable(world: SaveWorld): SquadTable {
  if (world.teamId === undefined) return { columns: COLUMNS, rows: [] }
  const today = world.gameDate ? calendar(world.gameDate) : undefined
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
    const end = world.contractEnd[k] ? calendar({ year: Math.floor(world.contractEnd[k] / 1000), day: world.contractEnd[k] % 1000 }) : null
    const values: Record<string, CellValue> = {
      name: cell(world.names[k]),
      position: cell(positionsLabel(positionsOf(k))),
      age: age === null ? cell('') : cell(age),
      ability: cell(world.ca[k]),
      potential: cell(world.pa[k]),
      leftFoot: cell(attribute('leftFoot')),
      rightFoot: cell(attribute('rightFoot')),
      dob: world.birthYear[k] === 0 ? cell('') : cell(`${born.getUTCFullYear()}.${born.getUTCMonth() + 1}.${born.getUTCDate()}`),
      value: money(world.value[k]),
      wage: money(world.wage[k]),
      // 정렬은 연월일 순서가 되도록 20270630 꼴의 수로 한다
      contractEnd: end ? { raw: `${end.year}.${end.month}.${end.day}`, num: end.year * 10000 + end.month * 100 + end.day } : cell(''),
      squadStatus: cell(SQUAD_STATUS_LABEL[world.squadStatus[k]] ?? '')
    }
    for (const id of VISIBLE_ATTRIBUTES) values[id] = cell(attribute(id))
    return {
      idx: world.uids[k],
      name: world.names[k],
      cells: Object.fromEntries(COLUMN_IDS.map((id) => [FIELD_BY_ID[id].label, values[id]]))
    }
  })
  const first = mine.find((k) => world.club[k] >= 0)
  const clubUid = first === undefined ? undefined : world.clubs[world.club[first]].uid
  return { columns: COLUMNS, rows, today, clubUid }
}
