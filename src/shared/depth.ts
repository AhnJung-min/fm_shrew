import { parsePositions } from './positions'
import { attributesOf, DEFAULT_ROLE, effectiveWeights, ROLE_BY_ID, scoreRole, type PositionKey, type RoleScore } from './roles'
import type { ColumnInfo, PlayerRow } from './types'

export interface Formation {
  id: string
  label: string
  /** 위(공격)에서 아래(골키퍼)로, 각 줄은 왼쪽에서 오른쪽으로 */
  rows: PositionKey[][]
}

export const FORMATIONS: Formation[] = [
  { id: '4-2-3-1', label: '4-2-3-1', rows: [['ST'], ['AML', 'AMC', 'AMR'], ['DM', 'DM'], ['DL', 'DC', 'DC', 'DR'], ['GK']] },
  { id: '4-3-3', label: '4-3-3', rows: [['ST'], ['AML', 'AMR'], ['MC', 'MC'], ['DM'], ['DL', 'DC', 'DC', 'DR'], ['GK']] },
  { id: '4-4-2', label: '4-4-2', rows: [['ST', 'ST'], ['ML', 'MC', 'MC', 'MR'], ['DL', 'DC', 'DC', 'DR'], ['GK']] },
  { id: '3-5-2', label: '3-5-2', rows: [['ST', 'ST'], ['MC', 'MC'], ['WBL', 'DM', 'WBR'], ['DC', 'DC', 'DC'], ['GK']] },
  { id: '3-4-3', label: '3-4-3', rows: [['AML', 'ST', 'AMR'], ['MC', 'MC'], ['WBL', 'WBR'], ['DC', 'DC', 'DC'], ['GK']] }
]

export const FORMATION_BY_ID: Record<string, Formation> = Object.fromEntries(FORMATIONS.map((f) => [f.id, f]))

export interface DepthPlayer {
  idx: number
  name: string
  score: number
  uncertain: boolean
}

export interface DepthSlot {
  /** 포메이션 안에서의 순번(역할 선택을 기억하는 열쇠) */
  index: number
  row: number
  position: PositionKey
  roleId: string
  starter: DepthPlayer | null
  /** 주전을 뺀 다음 순위들 */
  backups: DepthPlayer[]
  /** 주전 점수가 다른 자리들보다 뚜렷이 낮다 */
  weak: boolean
  /** 주전 말고 뛸 선수가 없다 */
  thin: boolean
}

/** 약한 자리로 보는 기준: 주전 점수가 자리 평균보다 이만큼 낮을 때 */
const WEAK_GAP = 5

/** 자리의 왼쪽·오른쪽 구분 없이 같은 줄이면 뛸 수 있다고 보지 않는다. 표기 그대로 정확히 그 자리만 인정한다. */
function canPlay(positions: string[], slot: PositionKey): boolean {
  return positions.includes(slot)
}

/**
 * 포메이션의 자리마다 주전과 후보를 정한다.
 * 주전은 (자리, 선수) 조합 가운데 점수가 높은 것부터 한 명씩 배정해 겹치지 않게 하고,
 * 후보는 주전으로 뽑히지 않은 선수 가운데 그 자리에서 점수가 높은 순이다.
 */
export function buildDepth(
  rows: PlayerRow[],
  columns: ColumnInfo[],
  formation: Formation,
  slotRoles: Record<string, string>,
  weightOverrides: Record<string, Record<string, number>>,
  backupCount = 2
): DepthSlot[] {
  const positionHeader = columns.find((col) => col.field === 'position')?.header
  const players = rows.map((row) => ({
    row,
    positions: positionHeader ? parsePositions(row.cells[positionHeader]?.raw ?? '') : [],
    attrs: attributesOf(row, columns)
  }))

  const slots: DepthSlot[] = []
  formation.rows.forEach((line, rowIndex) => {
    for (const position of line) {
      const index = slots.length
      const chosen = slotRoles[`${formation.id}:${index}`]
      const roleId = chosen && ROLE_BY_ID[chosen]?.positions.includes(position) ? chosen : DEFAULT_ROLE[position]
      slots.push({ index, row: rowIndex, position, roleId, starter: null, backups: [], weak: false, thin: false })
    }
  })

  // 자리별 후보와 점수
  const candidates = slots.map((slot) => {
    const weights = effectiveWeights(slot.roleId, weightOverrides)
    const list: Array<{ player: (typeof players)[number]; result: RoleScore }> = []
    for (const player of players) {
      if (!canPlay(player.positions, slot.position)) continue
      const result = scoreRole(player.attrs, weights)
      if (result) list.push({ player, result })
    }
    return list.sort((a, b) => b.result.score - a.result.score)
  })

  // 주전 배정: 점수가 높은 조합부터
  const pairs = candidates.flatMap((list, slotIndex) => list.map((entry) => ({ slotIndex, entry })))
  pairs.sort((a, b) => b.entry.result.score - a.entry.result.score)
  const taken = new Set<number>()
  for (const { slotIndex, entry } of pairs) {
    const slot = slots[slotIndex]
    if (slot.starter || taken.has(entry.player.row.idx)) continue
    slot.starter = toDepthPlayer(entry)
    taken.add(entry.player.row.idx)
  }

  slots.forEach((slot, slotIndex) => {
    slot.backups = candidates[slotIndex]
      .filter((entry) => !taken.has(entry.player.row.idx))
      .slice(0, backupCount)
      .map(toDepthPlayer)
    slot.thin = slot.starter !== null && slot.backups.length === 0
  })

  const starterScores = slots.filter((slot) => slot.starter).map((slot) => slot.starter!.score)
  if (starterScores.length >= 3) {
    const average = starterScores.reduce((sum, score) => sum + score, 0) / starterScores.length
    for (const slot of slots) slot.weak = slot.starter === null || slot.starter.score <= average - WEAK_GAP
  }
  return slots
}

function toDepthPlayer(entry: { player: { row: PlayerRow }; result: RoleScore }): DepthPlayer {
  return {
    idx: entry.player.row.idx,
    name: entry.player.row.name,
    score: entry.result.score,
    uncertain: entry.result.uncertain
  }
}

export interface BestRole {
  roleId: string
  label: string
  score: number
  uncertain: boolean
}

/** 선수가 뛸 수 있는 자리의 역할 가운데 점수가 가장 높은 것 */
export function bestRoleOf(
  row: PlayerRow,
  columns: ColumnInfo[],
  weightOverrides: Record<string, Record<string, number>>
): BestRole | null {
  const positionHeader = columns.find((col) => col.field === 'position')?.header
  if (!positionHeader) return null
  const positions = parsePositions(row.cells[positionHeader]?.raw ?? '')
  const attrs = attributesOf(row, columns)
  let best: BestRole | null = null
  for (const role of Object.values(ROLE_BY_ID)) {
    if (!role.positions.some((position) => positions.includes(position))) continue
    const result = scoreRole(attrs, effectiveWeights(role.id, weightOverrides))
    if (result && (!best || result.score > best.score)) {
      best = { roleId: role.id, label: role.label, score: result.score, uncertain: result.uncertain }
    }
  }
  return best
}
