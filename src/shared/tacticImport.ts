import { z } from 'zod'
import { roleGameId, type SupportedVersion } from './compat'
import { TACTIC_NAME_MAX, TACTIC_SLOTS } from './limits'
import type { RoleCatalog } from './roleCatalog'
import type { PositionKey } from './roles'
import type { Phase } from './slotProfile'
import { canonicalOrder, cellPosition, slotKindOf, validateTactic, type Cell, type Line, type Tactic, type TacticSlot } from './tacticModel'

/**
 * 게임 전술 가져오기(A-01)의 앱 쪽 해독. 플러그인 /tactic의 답(점유 시와 비점유 시의 자리 11개, 포지션·역할 비트)을 앱의 전술 초안으로 바꾼다.
 * 이 모듈은 순수 계산이다. 가져온 전술은 초안이고, 사용자가 편집기에서 확인하고 저장할 때만 설정에 쓴다.
 *
 * 게임의 값은 모두 글자로 온다(플러그인이 그렇게 준다). 포지션과 역할 비트는 64비트 값(역할은 2^57까지)이라 숫자로 바꾸지 않고 BigInt로만 다룬다.
 * 숫자로 온 값은 정밀도를 잃었을 수 있어 받지 않는다(응답 전체를 읽을 수 없는 것으로 본다).
 */

// ---------- 응답 읽기 ----------

/** 게임에 물어 얻은 한 줄(자리 하나). 글자 그대로, 오지 않은 항목은 null */
export interface GameSlotRow {
  /** 포지션 비트(10진 글자. 가운데 포지션은 왼쪽·오른쪽 비트가 더해져 온다) */
  position: string | null
  /** 역할 비트(10진 글자. 임무 비트가 더해져 올 수 있다) */
  role: string | null
  /** 자리 순번(10진 글자). 점유 시와 비점유 시의 같은 자리를 짝짓는 열쇠 */
  index: string | null
  /** "True" 또는 "False" */
  goalkeeper: string | null
}

export interface GamePhaseAnswer {
  /** 게임 전술 이름. 오지 않았으면 빈 글자 */
  name: string
  formation: string
  rows: GameSlotRow[]
  /** 게임에 읽기 조건을 전달하지 못한 것의 이름 */
  failedConditions: string[]
}

/** 자리마다 게임이 주는 "고를 수 있는 역할" 한 줄(roles=1로 읽었을 때) */
export interface GameRoleOption {
  id: string | null
  name: string
  selected: boolean
}

export interface GameRoleList {
  /** 자리 순번 */
  index: number
  phase: Phase
  /** 그 자리의 포지션 비트와 역할 비트(글자) */
  position: string | null
  role: string | null
  options: GameRoleOption[]
}

export interface GameTacticAnswer {
  ip: GamePhaseAnswer
  oop: GamePhaseAnswer
  /** roles=1로 읽었을 때만 있다. 22개가 다 오지 않을 수 있다 */
  roleLists: GameRoleList[]
}

/** 값은 모두 글자다. 숫자가 섞여 오면 읽지 않는다 */
const Strings = z.record(z.string(), z.string())

/** PersonInfo.Probe의 답: {"id","notes","fields","list","count","items"} */
const Probe = z.object({
  notes: Strings.optional(),
  fields: Strings,
  items: z.array(Strings).optional()
})

const Answer = z.object({ ip: Probe, oop: Probe, roles: z.array(z.unknown()).optional() })
const RoleEntry = z.object({ index: z.number().int().min(0), phase: z.enum(['ip', 'oop']), probe: Probe })

type ProbeData = z.infer<typeof Probe>

const NAME = 'Team.Tactic.Name'
const FORMATION = 'Team.Tactic.FormationName'

function phaseOf(probe: ProbeData): GamePhaseAnswer {
  return {
    name: probe.fields[NAME] ?? '',
    formation: probe.fields[FORMATION] ?? '',
    rows: (probe.items ?? []).map((item) => ({
      position: item.Position ?? null,
      role: item.PositionRole ?? null,
      index: item.Index ?? null,
      goalkeeper: item.IsGoalkeeper ?? null
    })),
    failedConditions: Object.entries(probe.notes ?? {})
      .filter(([, state]) => state !== 'ok')
      .map(([name]) => name)
  }
}

/**
 * 플러그인 /tactic의 답을 읽는다. 모양이 틀리거나(자리 줄이 객체가 아님, 값이 글자가 아님 등) 숫자로 온 값이 있으면 null이다.
 * 자리의 뜻(포지션·역할을 풀 수 있는지, 11자리인지)은 여기서 보지 않고 tacticFromGame이 본다.
 */
export function parseTacticAnswer(json: unknown): GameTacticAnswer | null {
  const parsed = Answer.safeParse(json)
  if (!parsed.success) return null
  const roleLists: GameRoleList[] = []
  for (const entry of parsed.data.roles ?? []) {
    const each = RoleEntry.safeParse(entry)
    if (!each.success) continue
    const { index, phase, probe } = each.data
    roleLists.push({
      index,
      phase,
      position: probe.fields['Team.Tactic.PositionValue'] ?? null,
      role: probe.fields['Team.Tactic.PositionRole'] ?? null,
      options: (probe.items ?? []).map((item) => ({
        id: item['RowData.DisplayValue.Role'] ?? null,
        name: item['RowData.DisplayValue.TacticsRoleName'] ?? '',
        selected: item['RowData.DisplayValue.Selected'] === 'True'
      }))
    })
  }
  return { ip: phaseOf(parsed.data.ip), oop: phaseOf(parsed.data.oop), roleLists }
}

// ---------- 포지션 비트 → 칸 ----------

const PHASES: readonly Phase[] = ['ip', 'oop']
const PHASE_LABEL: Record<Phase, string> = { ip: '점유 시', oop: '비점유 시' }
const DECIMAL = /^\d{1,20}$/
/** 앱이 받지 않는 스위퍼 칸의 값(게임 열거형의 SweeperCentreNotInUse) */
const SWEEPER = '2'

/** 포지션 → 줄과 쪽(L, R은 넓은 포지션, C는 가운데 포지션과 골키퍼) */
const SPOT: Record<PositionKey, { line: Line; side: 'L' | 'R' | 'C' }> = {
  GK: { line: 'GK', side: 'C' },
  DL: { line: 'D', side: 'L' },
  DC: { line: 'D', side: 'C' },
  DR: { line: 'D', side: 'R' },
  WBL: { line: 'DM', side: 'L' },
  DM: { line: 'DM', side: 'C' },
  WBR: { line: 'DM', side: 'R' },
  ML: { line: 'M', side: 'L' },
  MC: { line: 'M', side: 'C' },
  MR: { line: 'M', side: 'R' },
  AML: { line: 'AM', side: 'L' },
  AMC: { line: 'AM', side: 'C' },
  AMR: { line: 'AM', side: 'R' },
  ST: { line: 'ST', side: 'C' }
}

/** 포지션 비트를 푼 결과: 칸(확인하지 못한 값을 가정해 읽었으면 note), 또는 풀지 못한 까닭(앱이 모르는 값이면 unknown) */
export type CellRead = { cell: Cell; note?: string } | { problem: string; unknown?: string }

/**
 * 포지션 비트 하나를 칸으로 푼다(부록 D). 왼쪽·오른쪽 비트(가운데 포지션에 붙는다)를 먼저 떼고, 남은 것이 포지션 표의 한 값과 같아야 한다.
 * 가운데 포지션은 왼쪽 비트가 있으면 CL, 오른쪽이면 CR, 없으면 C다. 넓은 포지션에 같은 쪽 비트가 붙어 와도 같은 칸이다.
 * 최전방 왼쪽·오른쪽 비트(옛 방식)는 확인하지 못한 값이라 가운데 CL·CR로 읽고 알린다. 그 밖의 값은 모르는 값이다.
 */
export function cellOfPosition(text: string | null, row: SupportedVersion): CellRead {
  if (text === null || !DECIMAL.test(text)) return { problem: '포지션 값이 오지 않았거나 읽을 수 없는 글자입니다.' }
  const notRead = (reason: string): CellRead => ({ problem: `${reason}(값 ${text})`, unknown: `포지션 ${text}` })
  let bits = BigInt(text)
  const left = BigInt(row.sideBits.left)
  const right = BigInt(row.sideBits.right)
  const leftFlag = (bits & left) !== 0n
  const rightFlag = (bits & right) !== 0n
  bits &= ~(left | right)
  if (bits.toString() === SWEEPER) return notRead('앱이 받지 않는 스위퍼 칸입니다')
  if (leftFlag && rightFlag) return notRead('왼쪽과 오른쪽이 함께 붙어 있습니다')

  if (bits === BigInt(row.attackerSideBits.left)) {
    return { cell: { line: 'ST', lane: 'CL' }, note: `최전방 왼쪽(값 ${text})은 확인하지 못한 값이라 최전방 왼쪽 칸으로 읽었습니다.` }
  }
  if (bits === BigInt(row.attackerSideBits.right)) {
    return { cell: { line: 'ST', lane: 'CR' }, note: `최전방 오른쪽(값 ${text})은 확인하지 못한 값이라 최전방 오른쪽 칸으로 읽었습니다.` }
  }

  const position = (Object.keys(row.positionBits) as PositionKey[]).find((key) => BigInt(row.positionBits[key]) === bits)
  if (!position) return notRead('앱이 모르는 포지션입니다')
  const spot = SPOT[position]
  if (spot.side === 'C') {
    if (spot.line === 'GK') return leftFlag || rightFlag ? notRead('골키퍼 칸에 왼쪽·오른쪽이 붙어 있습니다') : { cell: { line: 'GK', lane: 'C' } }
    return { cell: { line: spot.line, lane: leftFlag ? 'CL' : rightFlag ? 'CR' : 'C' } }
  }
  if ((spot.side === 'L' && rightFlag) || (spot.side === 'R' && leftFlag)) return notRead('포지션과 왼쪽·오른쪽이 어긋납니다')
  return { cell: { line: spot.line, lane: spot.side } }
}

// ---------- 전술 초안 만들기 ----------

export interface TacticFromGame {
  /** 문제가 하나도 없으면 참 */
  ok: boolean
  /** 자리 11개를 모두 풀었을 때만 있다(문제가 있어도 있을 수 있다. 저장하려면 편집기의 검사를 통과해야 한다) */
  tactic?: Tactic
  /** 사용자에게 보여 줄 문제들(쉬운 한국어 한 줄씩) */
  problems: string[]
  /** 앱이 모르는 게임 값(포지션·역할 비트). 값을 글로 적는다 */
  unknownBits: string[]
}

/** 자리 순번 → 줄. 순번이 없거나 겹치면 문제로 적는다 */
function rowsByIndex(rows: GameSlotRow[], phase: Phase, problems: string[]): Map<number, GameSlotRow> {
  const label = PHASE_LABEL[phase]
  const byIndex = new Map<number, GameSlotRow>()
  let unreadable = 0
  for (const row of rows) {
    if (row.index === null || !/^\d{1,3}$/.test(row.index)) {
      unreadable++
      continue
    }
    const index = Number(row.index)
    if (byIndex.has(index)) problems.push(`${label}: 자리 번호 ${index}이(가) 두 번 왔습니다.`)
    else byIndex.set(index, row)
  }
  if (unreadable > 0) problems.push(`${label}: 자리 번호를 읽지 못한 줄이 ${unreadable}개 있습니다.`)
  if (rows.length !== TACTIC_SLOTS) problems.push(`${label}: 자리는 ${TACTIC_SLOTS}개여야 하는데 ${rows.length}개가 왔습니다.`)
  return byIndex
}

/**
 * 게임 전술 응답을 쓰는 카탈로그의 전술 초안으로 바꾼다. 점유 시와 비점유 시의 줄은 자리 순번(Index)으로 짝짓고(순서가 섞여 와도 된다),
 * 포지션 비트는 칸으로, 역할 비트는 임무 비트를 지운 뒤 (국면, 역할 번호)로 카탈로그의 역할로 푼다. 자리는 저장할 때의 놓는 순서(canonicalOrder)로 놓는다.
 * 짝이 안 맞거나 풀 수 없는 값(모르는 포지션·역할 비트)이 있으면 그 자리를 문제로 적고 ok를 거짓으로 둔다(전술은 만들지 않는다).
 * 다 풀었으면 마지막에 validateTactic을 돌려 그 문제도 모은다(그 경우에는 전술도 함께 준다).
 */
export function tacticFromGame(answer: GameTacticAnswer, catalog: RoleCatalog, row: SupportedVersion, id: string): TacticFromGame {
  const problems: string[] = []
  const unknownBits: string[] = []
  const markUnknown = (text: string): void => {
    if (!unknownBits.includes(text)) unknownBits.push(text)
  }
  if (catalog.id !== row.catalog.id || catalog.dataVersion !== row.catalog.version) {
    return { ok: false, problems: ['지금 쓰는 역할 목록으로는 이 게임 판의 역할 값을 풀 수 없습니다.'], unknownBits }
  }
  for (const phase of PHASES) {
    if (answer[phase].failedConditions.length > 0) problems.push(`${PHASE_LABEL[phase]}: 게임에 읽기 조건을 전달하지 못했습니다.`)
  }

  const byPhase = { ip: rowsByIndex(answer.ip.rows, 'ip', problems), oop: rowsByIndex(answer.oop.rows, 'oop', problems) }
  const indexes = [...byPhase.ip.keys()].sort((a, b) => a - b)
  const sameSet = indexes.length === byPhase.oop.size && indexes.every((index) => byPhase.oop.has(index))
  if (!sameSet) problems.push('점유 시와 비점유 시의 자리 번호가 서로 맞지 않습니다.')
  if (problems.length > 0) return { ok: false, problems, unknownBits }

  const slots: TacticSlot[] = []
  indexes.forEach((index, at) => {
    const where = `${at + 1}번째 자리`
    const spots = PHASES.map((phase) => {
      const given = byPhase[phase].get(index)!
      const label = `${where}의 ${PHASE_LABEL[phase]}`
      const read = cellOfPosition(given.position, row)
      let cell: Cell | null = null
      if ('cell' in read) {
        cell = read.cell
        if (read.note) problems.push(`${where}: ${read.note}`)
      } else {
        problems.push(`${label} 포지션: ${read.problem}`)
        if (read.unknown) markUnknown(read.unknown)
      }
      let roleId: string | null = null
      const gameId = given.role === null ? null : roleGameId(given.role, row)
      if (gameId === null) {
        problems.push(`${label} 역할 값이 오지 않았거나 읽을 수 없는 글자입니다.`)
      } else {
        const role = catalog.roleByGameId(phase, gameId)
        if (role) roleId = role.id
        else {
          problems.push(`${label} 역할(값 ${gameId})을 앱이 모릅니다.`)
          markUnknown(`${PHASE_LABEL[phase]} 역할 ${gameId}`)
        }
      }
      // 게임이 골키퍼 여부를 알려 주면 포지션이 그것과 맞아야 한다
      const keeper = given.goalkeeper
      if (cell && (keeper === 'True' || keeper === 'False') && (keeper === 'True') !== (cell.line === 'GK')) {
        problems.push(`${label} 포지션이 게임이 알려 준 골키퍼 여부와 맞지 않습니다.`)
      }
      return { cell, roleId }
    })
    const [ip, oop] = spots
    if (ip.cell && ip.roleId && oop.cell && oop.roleId) slots.push({ ip: { cell: ip.cell, roleId: ip.roleId }, oop: { cell: oop.cell, roleId: oop.roleId } })
  })
  // 풀지 못한 자리가 있으면 전술을 만들지 않는다(없는 값을 지어내 채우지 않는다)
  if (slots.length !== indexes.length) return { ok: false, problems, unknownBits }

  const given = answer.ip.name || answer.oop.name || answer.ip.formation || answer.oop.formation
  const name = Array.from(given.trim()).slice(0, TACTIC_NAME_MAX).join('') || '게임에서 가져온 전술'
  const tactic = canonicalOrder({ id, name, preset: null, slots, sharePct: null, source: 'game', catalog: catalog.id })
  for (const found of validateTactic(tactic, catalog)) problems.push(found.message)
  return { ok: problems.length === 0, tactic, problems, unknownBits }
}

// ---------- 자리별 역할 목록 견주기(roles=1로 읽었을 때) ----------

const sameCell = (a: Cell, b: Cell): boolean => a.line === b.line && a.lane === b.lane
/** 게임이 준 이름은 글자 수를 줄여 보인다 */
const shortText = (text: string): string => Array.from(text.trim()).slice(0, TACTIC_NAME_MAX).join('')

export interface RoleListReport {
  /** 견준 목록 수(자리 × 국면) */
  compared: number
  /** 앱의 목록과 다른 곳의 수 */
  different: number
  /** 다른 곳마다 한 줄: 게임에만 있는 역할, 앱에만 있는 역할 */
  lines: string[]
}

/**
 * 게임이 자리마다 주는 "고를 수 있는 역할" 목록을 앱의 목록(그 칸 종류·국면)과 견준다. 점수와 저장에는 쓰지 않는 관측용이다:
 * 앱 자료의 "확인 전" 칸을 게임에서 확인하는 데 쓴다. 사용자 역할은 앱에만 있는 것으로 세지 않는다.
 * 자리는 목록이 알려 준 포지션 비트로 전술의 칸에서 찾는다(찾지 못한 목록은 건너뛴다).
 */
export function roleListReport(answer: GameTacticAnswer, catalog: RoleCatalog, row: SupportedVersion, tactic: Tactic): RoleListReport {
  const report: RoleListReport = { compared: 0, different: 0, lines: [] }
  for (const list of answer.roleLists) {
    const read = cellOfPosition(list.position, row)
    if (!('cell' in read)) continue
    const at = tactic.slots.findIndex((slot) => sameCell(slot[list.phase].cell, read.cell))
    const position = cellPosition(read.cell)
    if (at < 0 || !position) continue
    report.compared++
    const kind = slotKindOf(tactic, at, list.phase)
    const appIds = new Set(catalog.choicesAt(position, list.phase, kind).filter((choice) => choice.evidence !== 'user').map((choice) => choice.roleId))
    const matched = new Set<string>()
    const gameOnly: string[] = []
    for (const option of list.options) {
      const gameId = option.id === null ? null : roleGameId(option.id, row)
      const role = gameId === null ? undefined : catalog.roleByGameId(list.phase, gameId)
      if (role && appIds.has(role.id)) matched.add(role.id)
      else gameOnly.push(`${shortText(option.name || role?.label || '이름 없음')}(값 ${gameId ?? '?'})`)
    }
    const appOnly = [...appIds].filter((roleId) => !matched.has(roleId)).map((roleId) => catalog.role(roleId)?.label ?? roleId)
    if (gameOnly.length === 0 && appOnly.length === 0) continue
    report.different++
    report.lines.push(
      `${at + 1}번째 자리 ${PHASE_LABEL[list.phase]}(${kind}) 역할 목록: 게임에만 있음 [${gameOnly.join(', ') || '없음'}], 앱에만 있음 [${appOnly.join(', ') || '없음'}]`
    )
  }
  return report
}
