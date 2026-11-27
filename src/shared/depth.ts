import { FALLBACK_NORM, normOf, zOf, type RoleNorms } from './norms'
import { parsePositions, posPenaltySigma, ratingAt, RATING_UNKNOWN_ASSUMED } from './positions'
import { attributesOf, DEFAULT_ROLE, effectiveWeights, ROLE_BY_ID, scoreRole, type AttributeValue, type PositionKey, type RoleScore } from './roles'
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
  /** 화면에 보이는 적합도(0~100) */
  score: number
  /** 포지션 숙련 감점을 뺀 적합도. 주전 배정, 후보 순서, 보강 필요도, 영입 후보 비교는 모두 이 값으로 한다(숙련 20이면 score와 같다) */
  effScore: number
  /** 그 자리의 포지션 숙련(1~20). 숙련 숫자를 모르면 RATING_UNKNOWN_ASSUMED */
  rating: number
  uncertain: boolean
  /** 그 자리 역할의 기준에서 effScore가 평균보다 표준편차의 몇 배 위인가(z_eff. 기준 분포가 없으면 null) */
  z: number | null
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
  /** 주전이 다른 자리 주전들보다 뚜렷이 약하다(기준 분포가 있으면 z_eff가 평균보다 1.2 이상 낮고, 없으면 점수가 5점 이상 낮다) */
  weak: boolean
  /** 주전 말고 뛸 선수가 없다 */
  thin: boolean
}

/** 약한 자리로 보는 기준(기준 분포가 없을 때): 주전 점수가 자리 평균보다 이만큼 낮을 때 */
const WEAK_GAP = 5
/**
 * 약한 자리로 보는 기준(기준 분포가 있을 때): 주전의 z가 주전들 z 평균보다 이만큼 낮을 때.
 * 같은 5점이 σ 3점인 역할에서는 1.7σ, 4.7점인 역할에서는 1.1σ라서 점수 대신 σ로 잰다.
 */
export const WEAK_GAP_SIGMAS = 1.2
/**
 * 주전 배정에서 뛸 수 있는 쌍의 가중치에 더하는 상수. 뛸 수 있는 쌍은 이 값에 z(또는 점수)를 더해 언제나 양수이므로,
 * 최대 가중 매칭은 먼저 가능한 한 많은 자리를 채우고 그다음 z 합을 최대로 만든다.
 */
const PLAYABLE_BONUS = 1000
/** 동점일 때 선수 idx가 작은 선수가 자리 순번이 작은 자리를 먼저 차지하도록 가중치에서 빼는 아주 작은 값 */
const TIE_BREAK = 1e-8

/** 자리의 왼쪽·오른쪽 구분 없이 같은 줄이면 뛸 수 있다고 보지 않는다. 표기 그대로 정확히 그 자리만 인정한다. */
function canPlay(positions: string[], slot: PositionKey): boolean {
  return positions.includes(slot)
}

/**
 * 최대 가중 이분 매칭(헝가리안 방법). weight[i][j]가 0이면 못 뛰는 쌍이고, 모든 칸은 0 이상이다.
 * 행(자리)마다 열(선수) 하나를 골라 가중치 합을 최대로 하는 짝을 돌려준다(못 뛰는 쌍은 짝에서 뺀다).
 */
export function assignMaximum(weight: number[][]): Array<number | null> {
  const rows = weight.length
  if (rows === 0) return []
  const cols = Math.max(rows, ...weight.map((row) => row.length))
  // 비용 최소화로 바꾼다: 비용 = -가중치. 모자라는 칸은 가중치 0
  const cost = (i: number, j: number): number => -(weight[i - 1]?.[j - 1] ?? 0)
  const u = new Array<number>(rows + 1).fill(0)
  const v = new Array<number>(cols + 1).fill(0)
  const owner = new Array<number>(cols + 1).fill(0)
  const way = new Array<number>(cols + 1).fill(0)
  for (let i = 1; i <= rows; i++) {
    owner[0] = i
    let j0 = 0
    const minv = new Array<number>(cols + 1).fill(Infinity)
    const used = new Array<boolean>(cols + 1).fill(false)
    do {
      used[j0] = true
      const i0 = owner[j0]
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= cols; j++) {
        if (used[j]) continue
        const current = cost(i0, j) - u[i0] - v[j]
        if (current < minv[j]) {
          minv[j] = current
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= cols; j++) {
        if (used[j]) {
          u[owner[j]] += delta
          v[j] -= delta
        } else minv[j] -= delta
      }
      j0 = j1
    } while (owner[j0] !== 0)
    do {
      const j1 = way[j0]
      owner[j0] = owner[j1]
      j0 = j1
    } while (j0 !== 0)
  }
  const picked = new Array<number | null>(rows).fill(null)
  for (let j = 1; j <= cols; j++) {
    const i = owner[j]
    if (i >= 1 && (weight[i - 1]?.[j - 1] ?? 0) > 0) picked[i - 1] = j - 1
  }
  return picked
}

/**
 * 포메이션의 자리마다 주전과 후보를 정한다.
 * 주전은 "그 자리를 뛸 수 있는(숙련 15 이상) 선수"끼리만 짝지어, 자리별 z_eff(숙련 감점을 뺀 적합도가 그 역할 기준에서
 * 평균보다 표준편차의 몇 배 위인가)의 합이 가장 커지는 배정이다(헝가리안 방법). 한 선수는 한 자리다.
 * 기준 분포(norms)가 없으면 z 대신 숙련 감점을 뺀 점수 그대로 합한다.
 * 뛸 선수가 없는 자리는 비운다. 같은 입력이면 늘 같은 결과이고, 동점이면 선수 idx와 자리 순번이 작은 쪽이 먼저다.
 * 후보는 주전으로 뽑히지 않은 선수 가운데 그 자리에서 숙련 감점을 뺀 점수가 높은 순이다.
 */
export function buildDepth(
  rows: PlayerRow[],
  columns: ColumnInfo[],
  formation: Formation,
  slotRoles: Record<string, string>,
  weightOverrides: Record<string, Record<string, number>>,
  backupCount = 2,
  norms?: RoleNorms
): DepthSlot[] {
  const positionHeader = columns.find((col) => col.field === 'position')?.header
  const players = rows
    .map((row) => ({
      row,
      positions: positionHeader ? parsePositions(row.cells[positionHeader]?.raw ?? '') : [],
      attrs: attributesOf(row, columns)
    }))
    .sort((a, b) => a.row.idx - b.row.idx)

  const slots: DepthSlot[] = []
  formation.rows.forEach((line, rowIndex) => {
    for (const position of line) {
      const index = slots.length
      const chosen = slotRoles[`${formation.id}:${index}`]
      const roleId = chosen && ROLE_BY_ID[chosen]?.positions.includes(position) ? chosen : DEFAULT_ROLE[position]
      slots.push({ index, row: rowIndex, position, roleId, starter: null, backups: [], weak: false, thin: false })
    }
  })

  // 자리별 후보와 점수. 포지션 숙련이 20보다 낮으면 그 역할 σ의 배수만큼 적합도에서 뺀다(effScore)
  const candidates = slots.map((slot) => {
    const weights = effectiveWeights(slot.roleId, weightOverrides)
    const known = norms?.[slot.roleId] ? normOf(norms, slot.roleId) : null
    const sigma = (known ?? FALLBACK_NORM).sigma
    const list: Entry[] = []
    for (const player of players) {
      if (!canPlay(player.positions, slot.position)) continue
      const result = scoreRole(player.attrs, weights)
      if (!result) continue
      const rating = ratingAt(player.row.ratings, slot.position) ?? RATING_UNKNOWN_ASSUMED
      const effScore = result.score - sigma * posPenaltySigma(rating)
      list.push({ player, result, rating, effScore, z: known ? zOf(known, effScore) : null })
    }
    return list.sort((a, b) => b.effScore - a.effScore || b.result.score - a.result.score || a.player.row.idx - b.player.row.idx)
  })

  // 주전 배정: 자리별 z(또는 점수)의 합이 최대가 되는 매칭
  const playerRank = new Map(players.map((player, rank) => [player.row.idx, rank]))
  const weight: number[][] = slots.map(() => new Array<number>(players.length).fill(0))
  candidates.forEach((list, slotIndex) => {
    for (const entry of list) {
      const rank = playerRank.get(entry.player.row.idx)!
      const value = entry.z ?? entry.effScore
      weight[slotIndex][rank] = PLAYABLE_BONUS + value - TIE_BREAK * (rank + 1) * (slots.length - slotIndex)
    }
  })
  const matched = assignMaximum(weight)
  const taken = new Set<number>()
  matched.forEach((rank, slotIndex) => {
    if (rank === null) return
    const entry = candidates[slotIndex].find((each) => each.player.row.idx === players[rank].row.idx)
    if (!entry) return
    slots[slotIndex].starter = toDepthPlayer(entry)
    taken.add(entry.player.row.idx)
  })

  slots.forEach((slot, slotIndex) => {
    slot.backups = candidates[slotIndex]
      .filter((entry) => !taken.has(entry.player.row.idx))
      .slice(0, backupCount)
      .map(toDepthPlayer)
    slot.thin = slot.starter !== null && slot.backups.length === 0
  })

  const starters = slots.filter((slot) => slot.starter)
  if (starters.length >= 3) {
    const useZ = starters.every((slot) => slot.starter!.z !== null)
    const valueOf = (player: DepthPlayer): number => (useZ ? player.z! : player.effScore)
    const average = starters.reduce((sum, slot) => sum + valueOf(slot.starter!), 0) / starters.length
    const gap = useZ ? WEAK_GAP_SIGMAS : WEAK_GAP
    for (const slot of slots) slot.weak = slot.starter === null || valueOf(slot.starter) <= average - gap
  }
  return slots
}

interface Entry {
  player: { row: PlayerRow; positions: string[]; attrs: Record<string, AttributeValue> }
  result: RoleScore
  rating: number
  effScore: number
  z: number | null
}

function toDepthPlayer(entry: Entry): DepthPlayer {
  return {
    idx: entry.player.row.idx,
    name: entry.player.row.name,
    score: entry.result.score,
    effScore: entry.effScore,
    rating: entry.rating,
    uncertain: entry.result.uncertain,
    z: entry.z
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
