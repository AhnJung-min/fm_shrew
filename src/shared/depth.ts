import { FORMATION_BY_ID, type Formation } from './formations'
import { K } from './ledger'
import { SHARE_SCALE } from './limits'
import { FALLBACK_NORM, normOf, zOf, type RoleNorms } from './norms'
import { parsePositions, ratingAt, RATING_UNKNOWN_ASSUMED } from './positions'
import { effectiveRoleWeights, LEGACY_CATALOG, profileWeights, type RoleCatalog, type RoleOverrides } from './roleCatalog'
import { attributesOf, DEFAULT_ROLE, ROLE_BY_ID, scoreRole, type AttributeValue, type PositionKey, type RoleScore } from './roles'
import { mixedPenaltySigma, type Phase, type PhaseSpot, type SlotProfile, type SlotRatings } from './slotProfile'
import { layoutRows, profileOf, type Tactic } from './tacticModel'
import type { ColumnInfo, PlayerRow } from './types'

// 포메이션 정의는 formations.ts로 옮겼다(전술 모델과 서로 불러오지 않으려고). 이름은 그대로 다시 내보낸다
export { FORMATION_BY_ID, FORMATIONS, type Formation } from './formations'

/**
 * 계산에 쓰는 맥락: 어느 역할 카탈로그를 쓰는지, 사용자가 고친 가중치, 기준 분포(자리 프로파일의 normKey로 찾는다).
 * 옛 14역할은 { catalog: LEGACY_CATALOG, overrides: 설정의 roleWeights, norms }다.
 */
export interface ScoringContext {
  catalog: RoleCatalog
  overrides: RoleOverrides
  norms?: RoleNorms
}

export interface DepthPlayer {
  idx: number
  name: string
  /** 화면에 보이는 적합도(0~100) */
  score: number
  /** 포지션 숙련 감점을 뺀 적합도. 주전 배정, 후보 순서, 보강 필요도, 영입 후보 비교는 모두 이 값으로 한다(숙련 20이면 score와 같다) */
  effScore: number
  /** 그 자리 점유 시 포지션의 숙련(1~20). 뛸 자격과 임시 주전이 이 값으로 정해진다. 숙련 숫자를 모르면 RATING_UNKNOWN_ASSUMED */
  rating: number
  /** 비점유 시 포지션의 숙련(1~20). 감점에만 쓴다. 두 국면의 포지션이 같으면 rating과 같다. 숫자를 모르면 RATING_UNKNOWN_ASSUMED */
  oopRating: number
  /** effScore에서 뺀 숙련 감점(그 역할 기준 분포의 표준편차의 배수). 두 숙련을 점유 시 비중으로 섞은 값이다(mixedPenaltySigma) */
  penaltySigma: number
  uncertain: boolean
  /** 숙련이 15 미만(10 이상)이라 임시로 세운 주전이다. 후보에는 오르지 않는다 */
  temporary: boolean
  /** 그 자리 역할의 기준에서 effScore가 평균보다 표준편차의 몇 배 위인가(z_eff. 기준 분포가 없으면 null) */
  z: number | null
}

export interface DepthSlot {
  /** 포메이션 안에서의 순번(역할 선택을 기억하는 열쇠) */
  index: number
  /** 화면 줄 번호(위 → 아래). 옛 전술은 옛 포메이션의 줄이고, 그 밖의 전술은 점유 시 칸 배치(layoutRows)의 줄이다 */
  row: number
  /** 점유 시 포지션: 자리의 이름이고, 뛸 자격과 임시 주전, 줄 요약, 후계자 자격은 이것으로 본다 */
  position: PositionKey
  /** 점유 시 역할 */
  roleId: string
  /** 비점유 시 포지션(숙련 감점에만 쓴다) */
  oopPosition: PositionKey
  /** 비점유 시 역할 */
  oopRoleId: string
  /** 이 자리의 프로파일(두 국면의 포지션·역할과 점유 시 비중) */
  profile: SlotProfile
  /** 기준 분포의 열쇠(카탈로그가 정한다. 옛 카탈로그는 점유 시 역할 id) */
  normKey: string
  starter: DepthPlayer | null
  /** 주전을 뺀 다음 순위들 */
  backups: DepthPlayer[]
  /** 주전이 다른 자리 주전들보다 뚜렷이 약하다(기준 분포가 있으면 z_eff가 평균보다 1.2 이상 낮고, 없으면 점수가 5점 이상 낮다) */
  weak: boolean
  /** 주전 말고 뛸 선수가 없다 */
  thin: boolean
}

// 약한 자리 기준(K.WEAK_GAP 점, 기준 분포가 있으면 K.WEAK_GAP_SIGMAS): 같은 5점이 σ 3점인 역할에서는 1.7σ, 4.7점인 역할에서는 1.1σ라서 σ로 잰다.
/**
 * 주전 배정에서 뛸 수 있는 쌍의 가중치에 더하는 상수. 뛸 수 있는 쌍은 이 값에 z(또는 점수)를 더해 언제나 양수이므로,
 * 최대 가중 매칭은 먼저 가능한 한 많은 자리를 채우고 그다음 z 합을 최대로 만든다.
 */
const PLAYABLE_BONUS = 1000
// 숙련 10~14 선수를 임시 주전으로 세울 때의 가중치(K.TEMPORARY_BONUS 700)는 숙련 15 이상(1000)보다 낮아 같은 자리를 다투면 늘 15 이상이 먼저이고, 빈 자리(0)보다는 먼저 채운다(4회차)
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

// ---------- 전술의 모양(화면 줄) ----------

/** 전술의 화면 모양: 포메이션 꼴(id, 이름, 줄마다 포지션)과 자리마다 속한 줄 번호 */
export interface TacticShape {
  formation: Formation
  /** 자리 순번 → 화면 줄 번호(위 → 아래) */
  rowOf: number[]
}

/**
 * 전술의 화면 줄. 옛 전술(source 'legacy')은 옛 포메이션(FORMATION_BY_ID[preset])의 줄 그대로다: 5개 가운데 3-4-3만 칸 배치(layoutRows)와 다르다
 * (옛 줄은 측면 공격 둘과 최전방이 같은 줄이고, 칸 배치는 공격 줄과 최전방 줄로 나뉜다). 옛 결과를 그대로 내려면 옛 줄을 써야 한다.
 * 그 밖의 전술(프리셋, 가져온 전술, 사용자 전술)은 점유 시 칸 배치의 줄이다. 칸이 올바르지 않은 자리(검사에서 걸러진다)는 첫 줄로 둔다.
 */
export function shapeOfTactic(tactic: Tactic): TacticShape {
  if (tactic.source === 'legacy' && tactic.preset !== null && Object.hasOwn(FORMATION_BY_ID, tactic.preset)) {
    const formation = FORMATION_BY_ID[tactic.preset]
    const rowOf = formation.rows.flatMap((line, row) => line.map(() => row))
    if (rowOf.length === tactic.slots.length) return { formation, rowOf }
  }
  const lines = layoutRows(tactic, 'ip')
  const rowOf = new Array<number>(tactic.slots.length).fill(0)
  lines.forEach((line, row) => line.forEach((index) => (rowOf[index] = row)))
  return {
    formation: { id: tactic.preset ?? tactic.id, label: tactic.name, rows: lines.map((line) => line.map((index) => profileOf(tactic, index).ip.position)) },
    rowOf
  }
}

// ---------- 주전 배정 ----------

/** 배정이 받는 자리 하나: 순번, 화면 줄, 프로파일 */
interface Spot {
  index: number
  row: number
  profile: SlotProfile
}

/**
 * 한 선수가 그 자리 프로파일에서 갖는 두 국면의 숙련. 숙련 숫자를 모르면(옛 기록, 미리보기) 두 국면 모두 RATING_UNKNOWN_ASSUMED다(모르는 값으로 선수를 깎지 않는다).
 * 두 국면의 포지션이 같으면 같은 숙련 하나다.
 */
export function slotRatingsOf(ratings: readonly number[] | undefined, profile: SlotProfile): SlotRatings {
  const ip = ratingAt(ratings, profile.ip.position) ?? RATING_UNKNOWN_ASSUMED
  const oop = profile.oop.position === profile.ip.position ? ip : (ratingAt(ratings, profile.oop.position) ?? RATING_UNKNOWN_ASSUMED)
  return { ip, oop, sharePct: profile.sharePct }
}

/**
 * 전술의 자리마다 주전과 후보를 정한다.
 * 주전은 "그 자리를 뛸 수 있는(점유 시 포지션 숙련 15 이상) 선수"끼리 짝지어, 자리별 z_eff(숙련 감점을 뺀 적합도가 그 자리 프로파일의 기준에서
 * 평균보다 표준편차의 몇 배 위인가)의 합이 가장 커지는 배정이다(헝가리안 방법). 한 선수는 한 자리다.
 * 기준 분포(ctx.norms)가 없으면 z 대신 숙련 감점을 뺀 점수 그대로 합한다.
 * 숙련 10~14 선수도 임시 주전은 될 수 있다(가중치 700 + z_eff. 15 이상이 있으면 그쪽이 먼저). 10 미만뿐인 자리는 비운다. 같은 입력이면 늘 같은 결과이고, 동점이면 선수 idx와 자리 순번이 작은 쪽이 먼저다.
 * 후보는 주전으로 뽑히지 않은 선수 가운데 그 자리에서 숙련 15 이상이고 숙련 감점을 뺀 점수가 높은 순이다.
 *
 * 자리마다: 자격과 임시 주전, 10 미만 곱셈 보정은 점유 시 포지션 숙련만 보고(측면 공격수의 절반이 비점유 시에는 측면 미드라 비점유 시로 가르면 자리가 빈다),
 * 적합도는 두 국면 역할의 가중치를 비중으로 섞은 표(profileWeights)로 내고, 숙련 감점은 두 숙련을 비중으로 섞은 값(mixedPenaltySigma)이며,
 * 기준 분포는 카탈로그의 normKey로 찾는다. 두 국면이 같고 비중이 100이면 옛 계산과 끝자리까지 같다.
 * 자리 수는 따지지 않는다(11자리 규칙은 저장할 때 validateTactic이 본다).
 */
export function buildDepthFor(rows: PlayerRow[], columns: ColumnInfo[], tactic: Tactic, ctx: ScoringContext, backupCount = 2): DepthSlot[] {
  const { rowOf } = shapeOfTactic(tactic)
  const spots = tactic.slots.map((_, index): Spot => ({ index, row: rowOf[index], profile: profileOf(tactic, index) }))
  return buildDepthCore(rows, columns, spots, ctx, backupCount)
}

/**
 * 옛 꼴 배정: 포메이션과 자리별 역할(slotRoles, 열쇠 `${포메이션 id}:${순번}`)로 부른다. 두 국면이 같은 자리 프로파일(비중 100)과 옛 14역할 카탈로그로
 * buildDepthFor와 같은 길을 간다. 직접 만든 포메이션(포메이션 목록에 없는 id)도 받는다. 그 포지션 역할이 아니거나 모르는 역할 id는 그 포지션의 기본 역할이다.
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
  const spots: Spot[] = []
  formation.rows.forEach((line, row) => {
    for (const position of line) {
      const index = spots.length
      const chosen = slotRoles?.[`${formation.id}:${index}`]
      const roleId = chosen && Object.hasOwn(ROLE_BY_ID, chosen) && ROLE_BY_ID[chosen].positions.includes(position) ? chosen : DEFAULT_ROLE[position]
      const ip: PhaseSpot = { position, roleId }
      spots.push({ index, row, profile: { ip, oop: { ...ip }, sharePct: SHARE_SCALE } })
    }
  })
  return buildDepthCore(rows, columns, spots, { catalog: LEGACY_CATALOG, overrides: weightOverrides, norms }, backupCount)
}

function buildDepthCore(rows: PlayerRow[], columns: ColumnInfo[], spots: Spot[], ctx: ScoringContext, backupCount: number): DepthSlot[] {
  const { catalog, overrides, norms } = ctx
  const positionHeader = columns.find((col) => col.field === 'position')?.header
  const players = rows
    .map((row) => ({
      row,
      positions: positionHeader ? parsePositions(row.cells[positionHeader]?.raw ?? '') : [],
      attrs: attributesOf(row, columns)
    }))
    .sort((a, b) => a.row.idx - b.row.idx)

  const slots: DepthSlot[] = spots.map(({ index, row, profile }) => ({
    index,
    row,
    position: profile.ip.position,
    roleId: profile.ip.roleId,
    oopPosition: profile.oop.position,
    oopRoleId: profile.oop.roleId,
    profile,
    normKey: catalog.normKey(profile),
    starter: null,
    backups: [],
    weak: false,
    thin: false
  }))

  // 자리별 후보와 점수. 포지션 숙련이 20보다 낮으면 그 자리 기준 분포의 표준편차의 배수만큼 적합도에서 뺀다(effScore)
  const candidates = slots.map((slot) => {
    const weights = profileWeights(catalog, slot.profile, overrides)
    const known = norms?.[slot.normKey] ? normOf(norms, slot.normKey) : null
    const sigma = (known ?? FALLBACK_NORM).sigma
    const list: Entry[] = []
    for (const player of players) {
      const natural = canPlay(player.positions, slot.position)
      const measured = ratingAt(player.row.ratings, slot.position)
      // 숙련 15 미만 10 이상이면 임시 주전감이다(숫자를 모르는 선수는 뛸 수 있다고 적힌 자리만). 자격은 점유 시 포지션 숙련만 본다
      if (!natural && (measured === null || measured < K.TEMPORARY_MIN_RATING)) continue
      const result = scoreRole(player.attrs, weights)
      if (!result) continue
      const rating = measured ?? RATING_UNKNOWN_ASSUMED
      const oopRating = slot.oopPosition === slot.position ? rating : (ratingAt(player.row.ratings, slot.oopPosition) ?? RATING_UNKNOWN_ASSUMED)
      const penaltySigma = mixedPenaltySigma(rating, oopRating, slot.profile.sharePct)
      const effScore = result.score - sigma * penaltySigma
      list.push({ player, result, rating, oopRating, penaltySigma, effScore, temporary: rating < K.PLAYABLE_RATING, z: known ? zOf(known, effScore) : null })
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
      weight[slotIndex][rank] = (entry.temporary ? K.TEMPORARY_BONUS : PLAYABLE_BONUS) + value - TIE_BREAK * (rank + 1) * (slots.length - slotIndex)
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
      .filter((entry) => !taken.has(entry.player.row.idx) && !entry.temporary)
      .slice(0, backupCount)
      .map(toDepthPlayer)
    slot.thin = slot.starter !== null && slot.backups.length === 0
  })

  const starters = slots.filter((slot) => slot.starter)
  if (starters.length >= 3) {
    const useZ = starters.every((slot) => slot.starter!.z !== null)
    const valueOf = (player: DepthPlayer): number => (useZ ? player.z! : player.effScore)
    const average = starters.reduce((sum, slot) => sum + valueOf(slot.starter!), 0) / starters.length
    const gap = useZ ? K.WEAK_GAP_SIGMAS : K.WEAK_GAP
    for (const slot of slots) slot.weak = slot.starter === null || valueOf(slot.starter) <= average - gap
  }
  return slots
}

interface Entry {
  player: { row: PlayerRow; positions: string[]; attrs: Record<string, AttributeValue> }
  result: RoleScore
  rating: number
  oopRating: number
  penaltySigma: number
  effScore: number
  temporary: boolean
  z: number | null
}

function toDepthPlayer(entry: Entry): DepthPlayer {
  return {
    idx: entry.player.row.idx,
    name: entry.player.row.name,
    score: entry.result.score,
    effScore: entry.effScore,
    rating: entry.rating,
    oopRating: entry.oopRating,
    penaltySigma: entry.penaltySigma,
    uncertain: entry.result.uncertain,
    temporary: entry.temporary,
    z: entry.z
  }
}

/**
 * 배정의 목적 값(전술 추천이 전술을 견주는 한 값): 배정이 주전마다 쓰는 가중치를 더한 합이다. 동점 처리용 작은 값(TIE_BREAK)은 넣지 않는다.
 * 자리마다 주전이 숙련 15 이상이면 1000, 임시 주전이면 700, 빈 자리면 0에 z_eff(기준 분포가 없으면 effScore)를 더한 합이다.
 * 그래서 자리를 많이 채운 전술이 먼저이고, 그다음 주전 전력 합(strength: z_eff의 합)이 가른다. 채운 자리 수와 임시 주전 수도 함께 돌려준다.
 */
export function depthObjective(slots: DepthSlot[]): { objective: number; strength: number; filled: number; temporary: number } {
  let objective = 0
  let strength = 0
  let filled = 0
  let temporary = 0
  for (const slot of slots) {
    const starter = slot.starter
    if (!starter) continue
    const value = starter.z ?? starter.effScore
    filled++
    if (starter.temporary) temporary++
    strength += value
    objective += (starter.temporary ? K.TEMPORARY_BONUS : PLAYABLE_BONUS) + value
  }
  return { objective, strength, filled, temporary }
}

// ---------- 최적 역할 ----------

export interface BestRole {
  roleId: string
  label: string
  score: number
  uncertain: boolean
}

/**
 * 선수가 뛸 수 있는 포지션에서 고를 수 있는 역할 가운데 적합도가 가장 높은 것을 국면마다 하나씩(같으면 카탈로그 순서가 앞인 역할).
 * 두 국면 모두 역할이 하나도 없으면 null이다. 국면이 없는 옛 14역할('both')은 두 국면에 모두 들어서 ip 쪽이 옛 bestRoleOf와 같다.
 */
export function bestRolesOf(row: PlayerRow, columns: ColumnInfo[], ctx: ScoringContext): { ip: BestRole | null; oop: BestRole | null } {
  const best: Record<Phase, BestRole | null> = { ip: null, oop: null }
  const positionHeader = columns.find((col) => col.field === 'position')?.header
  if (!positionHeader) return best
  const positions = parsePositions(row.cells[positionHeader]?.raw ?? '')
  const attrs = attributesOf(row, columns)
  for (const role of ctx.catalog.roles) {
    if (!role.selectable || !role.positions.some((position) => positions.includes(position))) continue
    const result = scoreRole(attrs, effectiveRoleWeights(ctx.catalog, role.id, ctx.overrides))
    if (!result) continue
    for (const phase of ['ip', 'oop'] as const) {
      if (role.phase !== 'both' && role.phase !== phase) continue
      const current = best[phase]
      if (!current || result.score > current.score) best[phase] = { roleId: role.id, label: role.label, score: result.score, uncertain: result.uncertain }
    }
  }
  return best
}

/** 선수가 뛸 수 있는 자리의 역할 가운데 점수가 가장 높은 것(옛 14역할). bestRolesOf의 ip 쪽이다 */
export function bestRoleOf(
  row: PlayerRow,
  columns: ColumnInfo[],
  weightOverrides: Record<string, Record<string, number>>
): BestRole | null {
  return bestRolesOf(row, columns, { catalog: LEGACY_CATALOG, overrides: weightOverrides }).ip
}
