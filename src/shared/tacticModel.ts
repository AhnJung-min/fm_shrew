import { FORMATION_BY_ID, FORMATIONS, type Formation } from './formations'
import { withJosa } from './korean'
import { SHARE_SCALE, TACTIC_NAME_MAX, TACTIC_SLOTS, TACTICS_PER_SAVE } from './limits'
import type { CatalogId, RoleCatalog, SlotKind } from './roleCatalog'
import { DEFAULT_ROLE, ROLE_BY_ID, type PositionKey } from './roles'
import { defaultSharePct, type Phase, type SlotProfile } from './slotProfile'
import type { Settings } from './types'

/**
 * 전술 모델(2단계): 게임 전술 화면의 격자(칸)에 놓은 자리 11개, 자리마다 점유 시·비점유 시의 칸과 역할, 점유 시 비중.
 * 전술 하나를 Tactic으로, 세이브마다 두는 전술 묶음(최대 3개와 주 전술)을 TacticSet으로 다룬다.
 * 이 모듈은 순수 계산이다: 칸과 칸 종류, 프리셋과 옛 설정에서 전술 만들기, 검사, 주 전술 고르기, 묶음을 고치는 순수 함수.
 * 고치는 함수는 입력을 바꾸지 않고 새 값을 돌려주며, 할 수 없는 일(없는 전술, 4개째 전술, 마지막 전술 지우기)은 입력을 그대로 돌려준다.
 */

/** 게임 전술 화면의 줄과 칸 */
export type Line = 'GK' | 'D' | 'DM' | 'M' | 'AM' | 'ST'
export type Lane = 'L' | 'CL' | 'C' | 'CR' | 'R'
export interface Cell {
  line: Line
  lane: Lane
}
export interface TacticSlot {
  ip: { cell: Cell; roleId: string }
  oop: { cell: Cell; roleId: string }
}
export interface Tactic {
  id: string
  name: string
  /** 처음 시작한 프리셋(포메이션) id. 프리셋에서 시작하지 않았으면 null */
  preset: string | null
  /** 순서 = 배정의 동점 처리 순서 */
  slots: TacticSlot[]
  /** 점유 시 비중(0~100 정수). null이면 대장의 IP_SHARE_DEFAULT를 그때그때 읽는다 */
  sharePct: number | null
  source: 'legacy' | 'preset' | 'game' | 'user'
  catalog: CatalogId
}
/** 세이브마다 두는 전술 묶음: 전술 1~3개와 그 가운데 주 전술 하나(대시보드와 영입 후보는 주 전술을 쓴다) */
export interface TacticSet {
  catalog: CatalogId
  tactics: Tactic[]
  mainId: string
}
/** 전술의 한 자리를 가리키는 참조(대시보드 카드에서 영입 후보로 넘어갈 때 쓴다) */
export interface TacticSlotRef {
  tacticId: string
  index: number
}
export interface TacticProblem {
  code: string
  message: string
  /** 문제가 있는 자리의 순번 */
  index?: number
  phase?: Phase
}

/** 프리셋 5개의 id: '4-2-3-1', '4-3-3', '4-4-2', '3-5-2', '3-4-3'. 자리 순서와 포지션은 옛 FORMATIONS 그대로다 */
export const PRESET_IDS: readonly string[] = FORMATIONS.map((formation) => formation.id)

const PHASES: readonly Phase[] = ['ip', 'oop']
const PHASE_LABEL: Record<Phase, string> = { ip: '점유 시', oop: '비점유 시' }
/** 줄의 차례: 위(공격)에서 아래(골키퍼)로 */
const LINE_ORDER: readonly Line[] = ['ST', 'AM', 'M', 'DM', 'D', 'GK']
/** 칸의 차례: 왼쪽에서 오른쪽으로 */
const LANE_ORDER: readonly Lane[] = ['L', 'CL', 'C', 'CR', 'R']
const CENTRE_LANES: ReadonlySet<string> = new Set(['CL', 'C', 'CR'])

// ---------- 칸과 포지션 ----------

/** 줄마다 왼쪽·가운데·오른쪽 칸의 포지션. 골키퍼 줄과 최전방 줄은 한쪽 칸이 없다 */
const POSITION_AT: Record<Line, { left: PositionKey | null; centre: PositionKey; right: PositionKey | null }> = {
  GK: { left: null, centre: 'GK', right: null },
  D: { left: 'DL', centre: 'DC', right: 'DR' },
  DM: { left: 'WBL', centre: 'DM', right: 'WBR' },
  M: { left: 'ML', centre: 'MC', right: 'MR' },
  AM: { left: 'AML', centre: 'AMC', right: 'AMR' },
  ST: { left: null, centre: 'ST', right: null }
}

/**
 * 칸의 포지션. 줄의 왼쪽(L)·오른쪽(R) 칸은 넓은 포지션(DL, DR, WBL, WBR, ML, MR, AML, AMR)이고, 가운데 칸(CL, C, CR)은 가운데 포지션(DC, DM, MC, AMC, ST)이다.
 * 골키퍼 줄은 C만 GK이고, 최전방 줄은 L·R 칸이 없다(null). 칸이 올바르지 않아도 null이다.
 */
export function cellPosition(cell: Cell): PositionKey | null {
  if (!cell || !LINE_ORDER.includes(cell.line)) return null
  const at = POSITION_AT[cell.line]
  if (cell.lane === 'L') return at.left
  if (cell.lane === 'R') return at.right
  if (cell.line === 'GK') return cell.lane === 'C' ? 'GK' : null
  return CENTRE_LANES.has(cell.lane) ? at.centre : null
}

const isCentre = (cell: Cell): boolean => CENTRE_LANES.has(cell.lane) && cell.line !== 'GK'

/**
 * 칸 종류. 넓은 포지션(GK, DL, DR, WBL, WBR, ML, MR, AML, AMR)은 포지션 그대로이고, 가운데 포지션(DC, DM, MC, AMC, ST)은
 * 그 국면에서 같은 줄의 가운데 칸 수로 `single`, `pair`, `trio.side`(양쪽 바깥), `trio.centre`(한가운데)를 붙인다(예: `MC.pair`).
 * 게임에서 고를 수 있는 역할이 칸 종류마다 다르다는 관찰(좌우가 붙은 중앙 미드 둘 자리에는 박스 투 박스가 없었다)을 담으려는 것이다.
 * 칸이 올바르지 않으면 빈 글자다.
 */
export function slotKindOf(tactic: Tactic, index: number, phase: Phase): SlotKind {
  const cell = tactic.slots[index]?.[phase]?.cell
  const position = cell ? cellPosition(cell) : null
  if (!cell || !position) return ''
  if (!isCentre(cell)) return position
  const count = tactic.slots.filter((slot) => {
    const other = slot?.[phase]?.cell
    return !!other && other.line === cell.line && isCentre(other) && cellPosition(other) !== null
  }).length
  if (count <= 1) return `${position}.single`
  if (count === 2) return `${position}.pair`
  return cell.lane === 'C' ? `${position}.trio.centre` : `${position}.trio.side`
}

/** 전술의 점유 시 비중. 적지 않았으면(null) 대장의 기본값 */
export function sharePctOf(tactic: Tactic): number {
  return tactic.sharePct ?? defaultSharePct()
}

/**
 * 자리 하나의 프로파일(두 국면의 포지션·역할과 전술의 비중). 칸이 올바르지 않으면 다른 국면의 포지션(둘 다 틀리면 DC)을 쓴다.
 * 그런 전술은 validateTactic에서 걸러지므로 이것은 죽지 않으려는 안전망이다.
 */
export function profileOf(tactic: Tactic, index: number): SlotProfile {
  const slot = tactic.slots[index]
  const ipPosition = cellPosition(slot.ip.cell)
  const oopPosition = cellPosition(slot.oop.cell)
  return {
    ip: { position: ipPosition ?? oopPosition ?? 'DC', roleId: slot.ip.roleId },
    oop: { position: oopPosition ?? ipPosition ?? 'DC', roleId: slot.oop.roleId },
    sharePct: sharePctOf(tactic)
  }
}

// ---------- 프리셋과 옛 전술 ----------

/** 포지션 → 줄과 쪽. 가운데 포지션은 같은 줄에 몇 개 있느냐에 따라 칸이 정해진다 */
const SPOT_OF: Record<PositionKey, { line: Line; side: 'L' | 'R' | 'centre' }> = {
  GK: { line: 'GK', side: 'centre' },
  DL: { line: 'D', side: 'L' },
  DC: { line: 'D', side: 'centre' },
  DR: { line: 'D', side: 'R' },
  WBL: { line: 'DM', side: 'L' },
  DM: { line: 'DM', side: 'centre' },
  WBR: { line: 'DM', side: 'R' },
  ML: { line: 'M', side: 'L' },
  MC: { line: 'M', side: 'centre' },
  MR: { line: 'M', side: 'R' },
  AML: { line: 'AM', side: 'L' },
  AMC: { line: 'AM', side: 'centre' },
  AMR: { line: 'AM', side: 'R' },
  ST: { line: 'ST', side: 'centre' }
}

/** 같은 줄의 가운데 칸이 n개일 때 왼쪽에서 오른쪽으로 놓는 칸 */
function centreLanes(count: number): Lane[] {
  return count <= 1 ? ['C'] : count === 2 ? ['CL', 'CR'] : ['CL', 'C', 'CR']
}

/** 포메이션의 자리마다(옛 FORMATIONS 순서 그대로) 칸을 정한다. 3-4-3은 측면 공격 둘(AM 줄)과 최전방 하나(ST 줄)가 다른 줄이 된다 */
function cellsOfFormation(formation: Formation): Cell[] {
  const positions = formation.rows.flat()
  const total = new Map<Line, number>()
  for (const position of positions) {
    const spot = SPOT_OF[position]
    if (spot.side === 'centre') total.set(spot.line, (total.get(spot.line) ?? 0) + 1)
  }
  const used = new Map<Line, number>()
  return positions.map((position): Cell => {
    const spot = SPOT_OF[position]
    if (spot.side !== 'centre') return { line: spot.line, lane: spot.side }
    const at = used.get(spot.line) ?? 0
    used.set(spot.line, at + 1)
    return { line: spot.line, lane: centreLanes(total.get(spot.line) ?? 1)[at] }
  })
}

/** 모르는 포메이션은 맨 앞(FORMATIONS[0])으로 본다(옛 분석과 같다) */
const formationOf = (id: string): Formation => (Object.hasOwn(FORMATION_BY_ID, id) ? FORMATION_BY_ID[id] : FORMATIONS[0])

/**
 * 옛 설정(포메이션 + 자리별 역할)을 전술로 바꾼다. 지금 분석 규칙 그대로다: 모르는 포메이션은 FORMATIONS[0],
 * 그 포지션의 역할이 아니거나 모르는 역할 id는 그 포지션의 기본 역할(DEFAULT_ROLE). 두 국면이 같은 칸·같은 역할이고 비중은 100이다
 * (대장의 비중 기본값을 읽지 않는다). 자리 순서는 옛 포메이션 그대로다.
 */
export function legacyTactic(formationId: string, slotRoles: Record<string, string>): Tactic {
  const formation = formationOf(formationId)
  const cells = cellsOfFormation(formation)
  const slots: TacticSlot[] = formation.rows.flat().map((position, index) => {
    const chosen = slotRoles?.[`${formation.id}:${index}`]
    const roleId = chosen && Object.hasOwn(ROLE_BY_ID, chosen) && ROLE_BY_ID[chosen].positions.includes(position) ? chosen : DEFAULT_ROLE[position]
    return { ip: { cell: { ...cells[index] }, roleId }, oop: { cell: { ...cells[index] }, roleId } }
  })
  return { id: `legacy:${formation.id}`, name: formation.label, preset: formation.id, slots, sharePct: SHARE_SCALE, source: 'legacy', catalog: 'legacy14' }
}

/**
 * 프리셋(포메이션)에서 전술을 만든다: 옛 FORMATIONS의 자리 순서 그대로, 두 국면이 같은 칸, 칸 종류의 기본 역할, 비중은 적지 않는다(null).
 * 모르는 프리셋은 FORMATIONS[0]. id를 주지 않으면 `preset:<프리셋 id>`.
 */
export function presetTactic(presetId: string, catalog: RoleCatalog, id?: string): Tactic {
  const formation = formationOf(presetId)
  const slots: TacticSlot[] = cellsOfFormation(formation).map((cell) => ({ ip: { cell: { ...cell }, roleId: '' }, oop: { cell: { ...cell }, roleId: '' } }))
  const tactic: Tactic = { id: id ?? `preset:${formation.id}`, name: formation.label, preset: formation.id, slots, sharePct: null, source: 'preset', catalog: catalog.id }
  // 칸 종류는 같은 줄의 가운데 칸 수에서 나오므로 칸을 모두 놓은 뒤에 기본 역할을 채운다
  formation.rows.flat().forEach((position, index) => {
    for (const phase of PHASES) slots[index][phase].roleId = catalog.defaultRole(position, phase, slotKindOf(tactic, index, phase))
  })
  return tactic
}

// ---------- 놓는 순서와 모양 ----------

const cellRank = (cell: Cell | undefined): number => (cell ? LINE_ORDER.indexOf(cell.line) * LANE_ORDER.length + LANE_ORDER.indexOf(cell.lane) : -1)

/**
 * 사용자 전술과 가져온 전술을 저장할 때 놓는 순서: 점유 시 칸의 줄 위(공격) → 아래(골키퍼), 줄 안은 왼쪽 → 오른쪽.
 * 같은 칸이면 비점유 시 칸, 그래도 같으면 원래 순서. 프리셋과 옛 전술은 옛 FORMATIONS 순서 그대로라서 이 함수를 거치지 않는다
 * (순서가 곧 배정의 동점 처리 순서이고, 기준 결과의 열쇠이기 때문이다).
 */
export function canonicalOrder(tactic: Tactic): Tactic {
  const order = tactic.slots.map((slot, at) => ({ slot, at }))
  order.sort((a, b) => cellRank(a.slot.ip.cell) - cellRank(b.slot.ip.cell) || cellRank(a.slot.oop.cell) - cellRank(b.slot.oop.cell) || a.at - b.at)
  return { ...tactic, slots: order.map((each) => each.slot) }
}

/** 한 국면의 화면 배치: 줄마다 자리 순번 목록. 줄은 위(공격) → 아래(골키퍼), 줄 안은 왼쪽 → 오른쪽. 자리가 없는 줄은 빼고, 같은 칸이면 순번 순 */
export function layoutRows(tactic: Tactic, phase: Phase): number[][] {
  const rows: number[][] = []
  for (const line of LINE_ORDER) {
    const inLine = tactic.slots
      .map((slot, index) => ({ index, cell: slot?.[phase]?.cell }))
      .filter((each): each is { index: number; cell: Cell } => !!each.cell && each.cell.line === line)
    if (inLine.length === 0) continue
    inLine.sort((a, b) => LANE_ORDER.indexOf(a.cell.lane) - LANE_ORDER.indexOf(b.cell.lane) || a.index - b.index)
    rows.push(inLine.map((each) => each.index))
  }
  return rows
}

// ---------- 검사 ----------

const SOURCES: ReadonlySet<string> = new Set(['legacy', 'preset', 'game', 'user'])
/** 이 문제가 있으면 분석을 돌릴 수 없는 코드(자리 모양, 칸, 골키퍼, 겹침, 모르는 역할). 나머지(역할 국면, 고를 수 없는 역할 등)는 점수를 계산할 수는 있다 */
const UNUSABLE_CODES: ReadonlySet<string> = new Set(['shape', 'slotCount', 'cell', 'overlap', 'goalkeeper', 'roleMissing'])

/**
 * 전술 하나를 검사한다. 문제가 없으면 빈 목록. 화면이 보낸 자료를 본체가 다시 검사할 때도 쓰므로 모양이 틀린 입력에도 죽지 않는다.
 * 거절하는 것: 자리 수가 11이 아님, 올바르지 않은 칸, 국면마다 골키퍼 칸이 정확히 하나가 아님, 골키퍼 칸에 놓인 자리가 두 국면에서 다름(한 자리는 한 선수라서),
 * 같은 칸에 자리 둘, 카탈로그에 없는 역할, 그 국면에 쓸 수 없는 역할, 골키퍼 역할과 골키퍼 칸이 어긋남, 그 칸 종류·국면에서 고를 수 없는 역할,
 * 비중이 0~100 정수가 아님, 이름이 비었거나 너무 김, 카탈로그가 다름.
 */
export function validateTactic(tactic: Tactic, catalog: RoleCatalog): TacticProblem[] {
  if (!tactic || typeof tactic !== 'object' || !Array.isArray(tactic.slots)) return [{ code: 'shape', message: '전술 자료가 올바르지 않습니다.' }]
  const problems: TacticProblem[] = []
  const add = (code: string, message: string, where: { index?: number; phase?: Phase } = {}): void => {
    problems.push({ code, message, ...where })
  }

  if (typeof tactic.id !== 'string' || tactic.id.length === 0) add('id', '전술 번호가 비어 있습니다.')
  const name = typeof tactic.name === 'string' ? tactic.name : ''
  if (name.trim().length === 0 || Array.from(name).length > TACTIC_NAME_MAX) add('name', `전술 이름은 1글자 이상 ${TACTIC_NAME_MAX}글자 이하여야 합니다.`)
  if (tactic.catalog !== catalog.id) add('catalog', '전술의 역할 목록이 지금 쓰는 역할 목록과 다릅니다.')
  if (!SOURCES.has(tactic.source)) add('source', '전술이 어디서 왔는지 알 수 없습니다.')
  if (tactic.preset !== null && typeof tactic.preset !== 'string') add('preset', '전술의 시작 프리셋이 올바르지 않습니다.')
  const share = tactic.sharePct
  if (share !== null && !(Number.isInteger(share) && share >= 0 && share <= SHARE_SCALE)) add('share', `점유 시 비중은 0에서 ${SHARE_SCALE} 사이의 정수여야 합니다.`)
  if (tactic.slots.length !== TACTIC_SLOTS) add('slotCount', `전술의 자리는 ${TACTIC_SLOTS}개여야 합니다. 지금은 ${tactic.slots.length}개입니다.`)

  for (const phase of PHASES) {
    const label = PHASE_LABEL[phase]
    const taken = new Set<string>()
    let keepers = 0
    tactic.slots.forEach((slot, index) => {
      const spot = slot?.[phase]
      const position = spot && spot.cell ? cellPosition(spot.cell) : null
      if (!spot || !position || typeof spot.roleId !== 'string') {
        add('cell', `${index + 1}번째 자리의 ${label} 칸이 올바르지 않습니다.`, { index, phase })
        return
      }
      if (position === 'GK') keepers++
      const key = `${spot.cell.line}/${spot.cell.lane}`
      if (taken.has(key)) add('overlap', `${index + 1}번째 자리가 ${label}에 다른 자리와 같은 칸에 있습니다.`, { index, phase })
      taken.add(key)

      const role = catalog.role(spot.roleId)
      if (!role) {
        add('roleMissing', `${index + 1}번째 자리의 ${label} 역할을 찾지 못했습니다.`, { index, phase })
        return
      }
      if (role.phase !== 'both' && role.phase !== phase) {
        add('rolePhase', `${withJosa(role.label, '은/는')} ${PHASE_LABEL[role.phase]} 역할이라 ${label}에는 쓸 수 없습니다.`, { index, phase })
        return
      }
      if (role.goalkeeper !== (position === 'GK')) {
        add('goalkeeperRole', position === 'GK' ? '골키퍼 칸에는 골키퍼 역할만 놓을 수 있습니다.' : '골키퍼 역할은 골키퍼 칸에만 놓을 수 있습니다.', { index, phase })
        return
      }
      if (!catalog.choicesAt(position, phase, slotKindOf(tactic, index, phase)).some((choice) => choice.roleId === spot.roleId)) {
        add('roleChoice', `이 칸에서는 ${label} 역할로 ${withJosa(role.label, '을/를')} 고를 수 없습니다.`, { index, phase })
      }
    })
    if (keepers !== 1) add('goalkeeper', `${label}에는 골키퍼 칸이 정확히 하나 있어야 합니다. 지금은 ${keepers}개입니다.`, { phase })
  }

  // 한 자리는 한 선수라서 골키퍼 자리는 두 국면 모두 골키퍼 칸이어야 한다. 국면마다 따로 보면 골키퍼 칸이 하나씩이어도 자리가 다를 수 있는데,
  // 그러면 한 자리의 프로파일이 골키퍼와 필드 플레이어의 가중치를 섞고 뛸 자격은 골키퍼 숙련으로 보게 된다
  tactic.slots.forEach((slot, index) => {
    const ip = slot?.ip?.cell ? cellPosition(slot.ip.cell) : null
    const oop = slot?.oop?.cell ? cellPosition(slot.oop.cell) : null
    if (ip !== null && oop !== null && (ip === 'GK') !== (oop === 'GK')) {
      add('goalkeeper', `${index + 1}번째 자리는 한쪽 국면에서만 골키퍼 칸입니다. 골키퍼 자리는 점유 시와 비점유 시 모두 골키퍼 칸이어야 합니다.`, { index })
    }
  })
  return problems
}

/** 전술 묶음을 검사한다: 전술 1~3개, 번호가 겹치지 않음, 주 전술이 묶음 안에 있음, 카탈로그가 같음, 전술마다 validateTactic. 모양이 틀린 입력에도 죽지 않는다 */
export function validateTacticSet(set: TacticSet, catalog: RoleCatalog): TacticProblem[] {
  if (!set || typeof set !== 'object' || !Array.isArray(set.tactics)) return [{ code: 'shape', message: '전술 묶음 자료가 올바르지 않습니다.' }]
  const problems: TacticProblem[] = []
  if (set.catalog !== catalog.id) problems.push({ code: 'catalog', message: '전술 묶음의 역할 목록이 지금 쓰는 역할 목록과 다릅니다.' })
  if (set.tactics.length < 1 || set.tactics.length > TACTICS_PER_SAVE) {
    problems.push({ code: 'tacticCount', message: `전술은 1개 이상 ${TACTICS_PER_SAVE}개 이하여야 합니다. 지금은 ${set.tactics.length}개입니다.` })
  }
  const ids = set.tactics.map((tactic) => tactic?.id)
  if (new Set(ids).size !== ids.length) problems.push({ code: 'duplicateId', message: '같은 번호의 전술이 둘 이상 있습니다.' })
  if (!ids.includes(set.mainId)) problems.push({ code: 'mainId', message: '주 전술이 전술 목록에 없습니다.' })
  for (const tactic of set.tactics) {
    const where = tactic && typeof tactic.name === 'string' && tactic.name.length > 0 ? `“${tactic.name}” ` : ''
    for (const problem of validateTactic(tactic, catalog)) problems.push({ ...problem, message: `${where}${problem.message}` })
  }
  return problems
}

// ---------- 저장 열쇠와 주 전술 ----------

/** 세이브 파일 이름(설정의 saveTeams와 같은 열쇠). 경로가 없으면 null */
export function saveKeyOf(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null
  const name = path.split(/[\\/]/).pop() ?? ''
  return name.length > 0 ? name : null
}

/** 저장해 둔 묶음을 믿고 쓸 수 있는가: 같은 카탈로그이고, 주 전술이 있고, 모든 전술이 분석을 돌릴 수 있는 모양이다 */
function usable(set: TacticSet | undefined, catalog: RoleCatalog): set is TacticSet {
  if (!set || set.catalog !== catalog.id || !Array.isArray(set.tactics) || set.tactics.length === 0) return false
  if (!set.tactics.some((tactic) => tactic?.id === set.mainId)) return false
  return set.tactics.every((tactic) => validateTactic(tactic, catalog).every((problem) => !UNUSABLE_CODES.has(problem.code)))
}

/**
 * 화면이 고치는 전술 묶음. 쓰는 카탈로그가 옛 것이면 옛 설정(formation, slotRoles)에서 만든 전술 하나뿐이다.
 * FM26이면 그 세이브의 묶음, 없으면 모든 세이브의 기본 묶음(tacticsDefault), 그것도 없으면 옛 포메이션의 프리셋 하나.
 * 저장한 묶음이 깨져 분석을 돌릴 수 없으면 쓰지 않는다(본체가 저장할 때 검사하므로 손으로 고친 설정에서만 일어난다).
 */
export function currentSet(settings: Settings, saveKey: string | null, catalog: RoleCatalog): TacticSet {
  if (catalog.id === 'legacy14') {
    const tactic = legacyTactic(settings.formation, settings.slotRoles ?? {})
    return { catalog: catalog.id, tactics: [tactic], mainId: tactic.id }
  }
  const stored = (saveKey !== null && Object.hasOwn(settings.tactics ?? {}, saveKey) ? settings.tactics?.[saveKey] : undefined) ?? settings.tacticsDefault
  if (usable(stored, catalog)) return stored
  const preset = presetTactic(settings.formation, catalog)
  return { catalog: catalog.id, tactics: [preset], mainId: preset.id }
}

/**
 * 주 전술 고르기. 화면, 본체, 시험이 이 함수 하나를 쓴다(같은 선수는 어느 화면에서나 같은 점수다).
 * 쓰는 카탈로그가 옛 것이면 legacyTactic(formation, slotRoles), FM26이면 그 세이브 묶음 → tacticsDefault → 옛 포메이션의 프리셋.
 */
export function resolveMainTactic(settings: Settings, saveKey: string | null, catalog: RoleCatalog): Tactic {
  const set = currentSet(settings, saveKey, catalog)
  return set.tactics.find((tactic) => tactic.id === set.mainId) ?? set.tactics[0]
}

// ---------- 묶음을 고치는 순수 함수(입력을 바꾸지 않는다) ----------

function changeTactic(set: TacticSet, tacticId: string, change: (tactic: Tactic) => Tactic): TacticSet {
  const at = set.tactics.findIndex((tactic) => tactic.id === tacticId)
  if (at < 0) return set
  const tactics = set.tactics.slice()
  tactics[at] = change(set.tactics[at])
  return { ...set, tactics }
}

/** 자리 하나의 한 국면 역할을 바꾼다. 역할이 그 칸에서 고를 수 있는지는 저장할 때 검사한다(validateTactic) */
export function withSlotRole(set: TacticSet, tacticId: string, index: number, phase: Phase, roleId: string): TacticSet {
  return changeTactic(set, tacticId, (tactic) => {
    const slot = tactic.slots[index]
    if (!slot || (phase !== 'ip' && phase !== 'oop')) return tactic
    const slots = tactic.slots.slice()
    slots[index] = phase === 'ip' ? { ...slot, ip: { ...slot.ip, roleId } } : { ...slot, oop: { ...slot.oop, roleId } }
    return { ...tactic, slots }
  })
}

/** 점유 시 비중을 바꾼다. null이면 대장의 기본값을 따른다 */
export function withShare(set: TacticSet, tacticId: string, sharePct: number | null): TacticSet {
  return changeTactic(set, tacticId, (tactic) => ({ ...tactic, sharePct }))
}

/**
 * 전술을 다른 프리셋(포메이션)으로 바꾼다: 자리와 역할은 그 프리셋의 기본으로 다시 놓고, 번호와 비중은 그대로 둔다.
 * 이름은 옛 프리셋의 이름 그대로였을 때만 새 프리셋 이름으로 바꾼다(사용자가 지은 이름은 지키려는 것이다). 모르는 프리셋이면 그대로 둔다.
 */
export function withPreset(set: TacticSet, tacticId: string, presetId: string, catalog: RoleCatalog): TacticSet {
  if (!PRESET_IDS.includes(presetId)) return set
  return changeTactic(set, tacticId, (tactic) => {
    const fresh = presetTactic(presetId, catalog, tactic.id)
    const oldName = tactic.preset === null ? null : formationOf(tactic.preset).label
    return { ...fresh, name: tactic.name === oldName ? fresh.name : tactic.name, sharePct: tactic.sharePct }
  })
}

/** 전술을 더한다. 이미 3개이거나 같은 번호가 있으면 더하지 않고 그대로 돌려준다 */
export function addTactic(set: TacticSet, tactic: Tactic): TacticSet {
  if (set.tactics.length >= TACTICS_PER_SAVE || set.tactics.some((each) => each.id === tactic.id)) return set
  return { ...set, tactics: [...set.tactics, tactic] }
}

/** 전술을 지운다. 마지막 하나는 지우지 않는다. 주 전술을 지우면 남은 첫 전술이 주 전술이 된다 */
export function removeTactic(set: TacticSet, tacticId: string): TacticSet {
  if (set.tactics.length <= 1 || !set.tactics.some((tactic) => tactic.id === tacticId)) return set
  const tactics = set.tactics.filter((tactic) => tactic.id !== tacticId)
  return { ...set, tactics, mainId: set.mainId === tacticId ? tactics[0].id : set.mainId }
}

/** 이름을 바꾼다(앞뒤 공백은 뗀다). 길이는 저장할 때 검사한다 */
export function renameTactic(set: TacticSet, tacticId: string, name: string): TacticSet {
  return changeTactic(set, tacticId, (tactic) => ({ ...tactic, name: name.trim() }))
}

/** 주 전술을 바꾼다. 묶음에 없는 전술이면 그대로 둔다 */
export function setMainTactic(set: TacticSet, tacticId: string): TacticSet {
  return set.tactics.some((tactic) => tactic.id === tacticId) ? { ...set, mainId: tacticId } : set
}

/** 전술을 복사해 새 번호와 이름으로 더한다(출처와 시작 프리셋은 그대로). 3개가 찼거나 번호가 겹치면 그대로 둔다 */
export function copyTactic(set: TacticSet, tacticId: string, newId: string, name: string): TacticSet {
  const original = set.tactics.find((tactic) => tactic.id === tacticId)
  if (!original) return set
  return addTactic(set, { ...structuredClone(original), id: newId, name: name.trim() })
}

/**
 * 옛 카탈로그를 쓰는 동안 자리의 역할을 바꾸는 설정 조각(옛 칸 slotRoles를 고친다). 옛 화면이 하던 것과 같다:
 * 열쇠는 `${포메이션 id}:${자리 순번}`이고, 역할이 그 포지션에서 고를 수 있는지는 분석이 알아서 가린다(맞지 않으면 기본 역할).
 * 모르는 포메이션이나 없는 자리 순번이면 아무것도 바꾸지 않는 빈 조각이다.
 */
export function legacySlotRolePatch(settings: Settings, formationId: string, index: number, roleId: string): Partial<Settings> {
  if (!Object.hasOwn(FORMATION_BY_ID, formationId) || !Number.isInteger(index) || index < 0 || index >= formationOf(formationId).rows.flat().length) return {}
  return { slotRoles: { ...settings.slotRoles, [`${formationId}:${index}`]: roleId } }
}
