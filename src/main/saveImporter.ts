import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { FIELDS, FIELD_BY_ID } from '@shared/fields'
import { deriveColumns } from '@shared/parse'
import { positionOrder, positionsLabel } from '@shared/positions'
import type { CellValue, ImportResult, PlayerRow } from '@shared/types'
import type { Store } from './db'
import { SAVE_ATTRIBUTE_ORDER, type GameDate, type SavePlayer } from './save/reader'
import { playersOfTeam, type SaveWorld } from './save/world'

/** 세이브에 들어 있지만 게임 화면에는 보이지 않는 값. 스쿼드 표에는 넣지 않는다(에디터에서만 다룬다). */
const HIDDEN_ATTRIBUTES = new Set(['dirtiness', 'consistency', 'importantMatches', 'injuryProneness', 'versatility'])

/** 표에 보여 줄 능력치: 기술 → 정신 → 신체 → 골키퍼 순 */
const VISIBLE_ATTRIBUTES = FIELDS.filter((field) => field.isAttr).map((field) => field.id)
const ATTRIBUTE_INDEX = new Map<string, number>(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))

const COLUMN_IDS = ['name', 'position', 'age', ...VISIBLE_ATTRIBUTES, 'leftFoot', 'rightFoot', 'dob']

/** 저장값(1~100)을 게임 표시값(1~20)으로 */
function shown(value: number): number {
  return Math.min(20, Math.max(1, Math.round(value / 5)))
}

function cell(value: string | number): CellValue {
  return typeof value === 'number' ? { raw: String(value), num: value } : { raw: value, num: null }
}

function birthDate(player: SavePlayer): Date {
  return new Date(Date.UTC(player.birthYear, 0, player.birthDay))
}

function ageOf(player: SavePlayer, today: GameDate | null): number | null {
  if (!today) return null
  return today.year - player.birthYear - (today.day < player.birthDay ? 1 : 0)
}

function toRow(player: SavePlayer, idx: number, today: GameDate | null): PlayerRow {
  const born = birthDate(player)
  const age = ageOf(player, today)
  const values: Record<string, CellValue> = {
    name: cell(player.name),
    position: cell(positionsLabel(player.positions)),
    age: age === null ? cell('') : cell(age),
    leftFoot: cell(shown(player.attributes[ATTRIBUTE_INDEX.get('leftFoot')!])),
    rightFoot: cell(shown(player.attributes[ATTRIBUTE_INDEX.get('rightFoot')!])),
    dob: cell(`${born.getUTCFullYear()}.${born.getUTCMonth() + 1}.${born.getUTCDate()}`)
  }
  for (const id of VISIBLE_ATTRIBUTES) {
    if (HIDDEN_ATTRIBUTES.has(id)) continue
    values[id] = cell(shown(player.attributes[ATTRIBUTE_INDEX.get(id)!]))
  }
  return {
    idx,
    name: player.name,
    cells: Object.fromEntries(COLUMN_IDS.map((id) => [FIELD_BY_ID[id].label, values[id]]))
  }
}

export interface SaveImportOutcome extends ImportResult {
  /** 팀을 찾지 못해 보류한 경우 */
  needsRoster?: boolean
}

/**
 * 세이브 파일에서 내 팀 선수를 읽어 스냅샷으로 저장한다.
 * read는 세이브를 통째로 읽어 주는 함수다(내 팀 번호와 게임의 오늘까지 정해서 돌려준다).
 */
export async function importSave(store: Store, path: string, read: (path: string) => SaveWorld): Promise<SaveImportOutcome> {
  try {
    const info = await stat(path)
    if (store.hasImported(path, info.mtimeMs, info.size)) {
      return { ok: true, skipped: true, file: path, message: '이미 읽은 세이브입니다.' }
    }
    const world = read(path)
    const teamId = world.teamId
    const players = teamId === undefined ? [] : playersOfTeam(world, teamId)
    if (teamId === undefined || players.length === 0) {
      return {
        ok: false,
        needsRoster: true,
        file: path,
        message:
          '세이브에서 내 팀을 찾지 못했습니다. 게임의 스쿼드 화면에서 선수를 모두 선택하고 F9로 한 번 내보내면, 그 명단으로 팀을 찾습니다.'
      }
    }

    const today = world.gameDate
    players.sort((a, b) => positionOrder(a.positions) - positionOrder(b.positions) || a.name.localeCompare(b.name, 'ko'))
    const rows = players.map((player, idx) => toRow(player, idx, today))
    const headers = COLUMN_IDS.map((id) => FIELD_BY_ID[id].label)
    const columns = deriveColumns(headers, (c) => rows.map((row) => row.cells[headers[c]]))

    const snapshot = store.insertSnapshot({
      kind: 'squad',
      sourceFile: path,
      fileName: basename(path),
      mtimeMs: info.mtimeMs,
      size: info.size,
      columns,
      rows
    })
    return { ok: true, file: path, snapshot }
  } catch (error) {
    return { ok: false, file: path, message: error instanceof Error ? error.message : String(error) }
  }
}
