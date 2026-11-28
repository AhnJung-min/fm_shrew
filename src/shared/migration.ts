import { FORMATION_BY_ID, FORMATIONS, type Formation } from './formations'
import { hasBatchim, withJosa } from './korean'
import { TACTICS_PER_SAVE } from './limits'
import { withCustomRoles, type CatalogId, type RoleCatalog } from './roleCatalog'
import { DEFAULT_ROLE, type PositionKey } from './roles'
import { defaultSharePct, shareLabel } from './slotProfile'
import { POSITION_LABEL } from './tactic'
import type { MigrationNote, MigrationRecord } from './tacticApi'
import { cellPosition, legacyTactic, presetTactic, slotKindOf, validateTacticSet, type Tactic, type TacticSet } from './tacticModel'
import type { Settings } from './types'
import { SAVE_ATTRIBUTE_ORDER } from './world'

/**
 * 설정 이전(2단계, 설정 판 2): 옛 14역할 설정(포메이션, 자리마다 고른 역할, 고친 가중치)을 FM26 역할 체계의 설정으로 옮기는 순수 함수.
 * 쓰는 카탈로그가 FM26이고 설정 판(settingsVersion)이 낮을 때 설정을 읽으면서 한 번 돈다(언제 돌릴지는 부르는 쪽, 본체의 settings.ts가 정한다).
 *
 * 규칙
 * - 옛 칸(formation, slotRoles, roleWeights의 옛 역할 항목)은 하나도 지우지 않는다. 새 칸만 더한다. 그래서 앞 판 앱도 설정을 읽고,
 *   settings.catalog를 'legacy14'로 두면 이전 전과 정밀하게 같은 옛 계산이 돈다.
 * - 전술: 옛 포메이션이 주 전술이다. 자리 역할을 고친 적이 있는 다른 포메이션은 FORMATIONS 순서로 최대 (TACTICS_PER_SAVE - 1)개까지 더 전술로 옮기고,
 *   넘치는 것은 알림에 적는다. 옮긴 묶음은 모든 세이브가 쓰는 tacticsDefault에 둔다(옛 설정이 세이브마다 다르지 않았다).
 *   이미 FM26에서 쓸 수 있는 tacticsDefault가 있으면(판 표시만 잃은 설정) 그것은 덮어쓰지 않는다. 쓸 수 없는 값(옛 14역할 때 저장한 묶음, 손으로 고쳐 깨진 값)이면
 *   없는 것으로 보고 옛 포메이션과 자리 역할에서 새로 만들며, 바뀐 것을 알림에 적는다.
 * - 자리 역할: 옛 역할의 대응 역할을 그 칸 종류에서 고를 수 있으면 쓰고, 아니면 그 칸의 기본 역할로 바꾼다. 바꾼 자리는 알림에 자리마다가 아니라 한 줄로 묶어 적는다
 *   (옛 박스 투 박스와 딥라잉 플레이메이커를 중앙 미드 자리에 둔 것이 그렇다: FM26에서 둘은 수비형 미드 줄의 역할이다).
 *   공 미소유 시 역할은 칸의 기본 역할이고, 공 소유 시 비중은 적지 않는다(null, 대장의 기본값). 비중은 알림에 한 번 적는다.
 * - 고친 가중치: 1:1로 이어지는 옛 역할(카탈로그 대응 표의 oneToOne)만 그 공 소유 시 역할 id로 복사한다. 새 id에 이미 있는 능력치 값은 건드리지 않고,
 *   옛 id의 값은 지우지 않는다. 값은 절대값이라 그 능력치의 실효 가중치가 옛 것과 같다. 옮긴 것과 초기화한 것을 알림에 적는다.
 * - 두 번 돌려도 결과가 같다(판이 이미 높으면 아무것도 바꾸지 않는다). 입력은 바꾸지 않고, 깨진 입력(빈 설정, 모르는 포메이션·역할,
 *   자리 순번이 틀린 열쇠, 소수 가중치, 모르는 능력치, 모양이 틀린 칸)에도 멈추지 않는다.
 *
 * 이 모듈은 파일을 읽거나 쓰지 않는다. 쓰기 전의 사본(settings.v1.json)과 원자적 쓰기는 본체의 settings.ts가 한다.
 */

/** 이전이 만드는 설정의 판(settingsVersion). 판 1은 2단계 앞(옛 14역할)의 설정이다 */
export function migrationVersion(): number {
  return 2
}

const versionOf = (settings: Partial<Settings>): number => (typeof settings.settingsVersion === 'number' && Number.isFinite(settings.settingsVersion) ? settings.settingsVersion : 1)

/** 이 설정을 이전해야 하는가: 쓰는 카탈로그가 FM26이고 판이 낮다. 옛 카탈로그를 쓰는 동안(전환 전, 되돌림 스위치)은 아무것도 하지 않는다 */
export function needsMigration(settings: Partial<Settings>, activeCatalogId: CatalogId): boolean {
  return activeCatalogId === 'fm26' && versionOf(settings) < migrationVersion()
}

export interface MigrationContext {
  /** 옮겨 갈 FM26 카탈로그(대응 표와 칸 종류의 역할 목록을 여기서 읽는다) */
  fm26: RoleCatalog
  /** 옛 14역할 카탈로그(알림에 옛 역할 이름을 쓴다) */
  legacy: RoleCatalog
  /** 이전한 시각 */
  now: Date | string
}

export interface MigrationResult {
  settings: Settings
  /** 이번에 만든 이전 기록. 이전하지 않았으면 null */
  record: MigrationRecord | null
  changed: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 저장해 둔 전술 묶음을 FM26에서 그대로 쓸 수 있는가: 객체이고, 역할 목록이 FM26이고, 저장할 때 거는 검사(validateTacticSet)를 통과한다.
 * 사용자 역할은 설정에 있는 것을 얹어 본다(저장 검사도 사용자 역할을 얹은 카탈로그로 한다). 값이 객체가 아니어도(손으로 고친 설정) 멈추지 않는다.
 */
function isUsableSet(value: unknown, fm26: RoleCatalog, customRoles: Settings['customRoles']): boolean {
  return isRecord(value) && value.catalog === fm26.id && validateTacticSet(value as unknown as TacticSet, withCustomRoles(fm26, customRoles ?? [])).length === 0
}

/** 모르는 포메이션은 맨 앞(FORMATIONS[0])으로 본다(옛 분석과 같다) */
const formationOf = (id: unknown): Formation => (typeof id === 'string' && Object.hasOwn(FORMATION_BY_ID, id) ? FORMATION_BY_ID[id] : FORMATIONS[0])

/** 그 포메이션에 자리 역할을 고친 적이 있는가: 옛 분석이 쓰는 역할이 옛 기본 역할과 다른 자리가 있다(맞지 않는 값과 기본 역할을 다시 고른 것은 고친 것이 아니다) */
function isEdited(formation: Formation, slotRoles: Record<string, string>): boolean {
  const old = legacyTactic(formation.id, slotRoles)
  return formation.rows.flat().some((position, index) => old.slots[index].ip.roleId !== DEFAULT_ROLE[position])
}

// ---------- 전술 ----------

/** 대응 역할을 그 칸에서 고를 수 없어 칸의 기본 역할로 바꾼 자리 */
interface Replaced {
  position: PositionKey
  oldRoleId: string
  toRoleId: string
}

/**
 * 옛 포메이션과 자리 역할에서 FM26 전술 하나를 만든다. 칸과 자리 순서는 프리셋 그대로(옛 FORMATIONS 순서)이고, 두 국면 모두 칸 종류의 기본 역할에서 시작해
 * 공 소유 시 역할만 옛 역할의 대응 역할로 바꾼다(그 칸 종류에서 고를 수 있을 때). 자리 역할을 고친 적이 있으면 출처는 user, 아니면 preset이다.
 */
function migratedTactic(formation: Formation, slotRoles: Record<string, string>, fm26: RoleCatalog): { tactic: Tactic; replaced: Replaced[] } {
  const base = presetTactic(formation.id, fm26, `migrated:${formation.id}`)
  const old = legacyTactic(formation.id, slotRoles)
  const map = fm26.legacyMap()
  const replaced: Replaced[] = []
  const slots = base.slots.map((slot, index) => {
    const oldRoleId = old.slots[index].ip.roleId
    const position = cellPosition(slot.ip.cell)
    const target = Object.hasOwn(map, oldRoleId) ? map[oldRoleId].to : null
    if (position && target && fm26.choicesAt(position, 'ip', slotKindOf(base, index, 'ip')).some((choice) => choice.roleId === target)) {
      return { ...slot, ip: { ...slot.ip, roleId: target } }
    }
    if (position) replaced.push({ position, oldRoleId, toRoleId: slot.ip.roleId })
    return slot
  })
  return { tactic: { ...base, slots, source: isEdited(formation, slotRoles) ? 'user' : 'preset' }, replaced }
}

/** "~로/으로": 받침이 없거나 ㄹ이면 "로", 그 밖의 받침은 "으로", 한글이 아니면 "(으)로" */
function euro(word: string): string {
  const batchim = hasBatchim(word)
  if (batchim === null) return '(으)로'
  if (!batchim) return '로'
  const last = word.trimEnd()
  // 한글 음절의 받침 번호(종성)는 (글자 − 가) % 28이고, ㄹ은 8번이다
  return (last.charCodeAt(last.length - 1) - '가'.charCodeAt(0)) % 28 === 8 ? '로' : '으로'
}

/** 낱말 둘이면 "A와 B", 셋 이상이면 "A, B, C" */
function joinLabels(labels: readonly string[]): string {
  if (labels.length === 2) return `${withJosa(labels[0], '과/와')} ${labels[1]}`
  return labels.join(', ')
}

/** 옛 박스 투 박스와 딥라잉 플레이메이커: FM26에서 둘은 수비형 미드 줄의 역할이라 중앙 미드 자리에서 고를 수 없다 */
const DEFENSIVE_LINE_ROLES: ReadonlySet<string> = new Set(['b2b', 'dlp'])

/**
 * 기본 역할로 바꾼 자리를 알림으로 쓴다. 자리마다 한 줄이 아니라 같은 포지션에서 같은 역할로 바뀐 자리를 한 줄로 묶는다.
 * 중앙 미드 자리의 박스 투 박스·딥라잉은 "중앙 미드 자리 N곳: 박스 투 박스와 딥라잉 플레이메이커는 FM26에서 수비형 미드 줄의 역할이라 중앙 미드필더로 바꿨습니다"다.
 */
function replacedNotes(replaced: readonly Replaced[], fm26: RoleCatalog, legacy: RoleCatalog): MigrationNote[] {
  const nameOf = (roleId: string): string => legacy.role(roleId)?.label ?? roleId
  const groups = new Map<string, { position: PositionKey; toRoleId: string; defensiveLine: boolean; olds: string[]; count: number }>()
  for (const each of replaced) {
    const defensiveLine = each.position === 'MC' && DEFENSIVE_LINE_ROLES.has(each.oldRoleId)
    const key = `${each.position}|${each.toRoleId}|${defensiveLine}`
    const group = groups.get(key) ?? { position: each.position, toRoleId: each.toRoleId, defensiveLine, olds: [], count: 0 }
    if (!group.olds.includes(each.oldRoleId)) group.olds.push(each.oldRoleId)
    group.count++
    groups.set(key, group)
  }
  return [...groups.values()].map((group): MigrationNote => {
    const to = fm26.role(group.toRoleId)?.label ?? group.toRoleId
    const where = `${POSITION_LABEL[group.position] ?? group.position} 자리 ${group.count}곳`
    const swapped = `${to}${euro(to)} 바꿨습니다`
    if (group.defensiveLine) {
      const both = joinLabels([...DEFENSIVE_LINE_ROLES].map(nameOf))
      return { kind: 'slot', text: `${where}: ${withJosa(both, '은/는')} FM26에서 수비형 미드 줄의 역할이라 ${swapped}` }
    }
    return { kind: 'slot', text: `${where}: ${withJosa(joinLabels(group.olds.map(nameOf)), '은/는')} FM26에서 이 칸의 역할 목록에 없어 ${swapped}` }
  })
}

// ---------- 고친 가중치 ----------

const ATTRIBUTE_IDS: ReadonlySet<string> = new Set(SAVE_ATTRIBUTE_ORDER)

/** 한 역할의 고친 가중치 가운데 읽을 수 있는 것: 아는 능력치 id이고 값이 유한한 수(소수와 범위 밖의 값도 그대로 옮긴다. 옛 계산이 쓰던 값 그대로여야 실효 가중치가 같다) */
function editedEntries(value: unknown): Array<[string, number]> {
  if (!isRecord(value)) return []
  return Object.entries(value).filter((entry): entry is [string, number] => ATTRIBUTE_IDS.has(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1]))
}

interface WeightsCarry {
  /** 새 id를 더한 roleWeights. 옮길 것이 없으면 null(입력 그대로) */
  roleWeights: Record<string, unknown> | null
  carried: Array<{ from: string; to: string; count: number }>
  /** 고친 가중치가 있었지만 1:1로 이어지지 않아 옮기지 않은 옛 역할 */
  reset: string[]
}

/** 옛 역할마다 고친 가중치를 대응 역할 id로 복사한다(1:1만). 새 id에 이미 있는 능력치는 건드리지 않고, 옛 id의 값은 그대로 둔다 */
function carryWeights(raw: unknown, fm26: RoleCatalog, legacy: RoleCatalog): WeightsCarry {
  const result: WeightsCarry = { roleWeights: null, carried: [], reset: [] }
  if (!isRecord(raw)) return result
  const map = fm26.legacyMap()
  const added: Record<string, Record<string, unknown>> = {}
  for (const role of legacy.roles) {
    const edited = editedEntries(raw[role.id])
    if (edited.length === 0) continue
    const entry = Object.hasOwn(map, role.id) ? map[role.id] : undefined
    if (!entry || !entry.oneToOne) {
      result.reset.push(role.id)
      continue
    }
    const present = added[entry.to] ?? (isRecord(raw[entry.to]) ? raw[entry.to] : {})
    const fresh = edited.filter(([attribute]) => !Object.hasOwn(present, attribute))
    if (fresh.length === 0) continue
    added[entry.to] = { ...present, ...Object.fromEntries(fresh) }
    result.carried.push({ from: role.id, to: entry.to, count: fresh.length })
  }
  if (result.carried.length > 0) result.roleWeights = { ...raw, ...added }
  return result
}

// ---------- 이전 ----------

/**
 * 옛 설정을 FM26 역할 체계의 설정으로 옮긴다. 판(settingsVersion)이 이미 이전 판 이상이면 아무것도 바꾸지 않고 입력을 그대로 돌려준다(changed가 거짓).
 * 결과 설정은 옛 칸을 그대로 두고, 전술 묶음(tacticsDefault), 판(settingsVersion), 이전 기록(migration)을 더하며, 옮길 가중치가 있으면 roleWeights에 새 id 항목을 더한다.
 * FM26에서 쓸 수 있는 tacticsDefault가 이미 있으면(판 표시만 잃은 설정) 그 전술은 덮어쓰지 않는다. 있지만 쓸 수 없으면(옛 카탈로그 묶음, 깨진 값) 옛 설정에서 새로 만들고 알린다.
 * 부르는 쪽은 쓰는 카탈로그가 FM26일 때만 부른다(needsMigration). 사본과 쓰기는 부르는 쪽이 한다.
 */
export function migrateSettings(saved: Settings, context: MigrationContext): MigrationResult {
  if (versionOf(saved) >= migrationVersion()) return { settings: saved, record: null, changed: false }
  const { fm26, legacy } = context
  const at = typeof context.now === 'string' ? context.now : context.now.toISOString()
  const slotRoles = (isRecord(saved.slotRoles) ? saved.slotRoles : {}) as Record<string, string>
  const notes: MigrationNote[] = []
  let tacticsDefault: TacticSet | undefined

  if (isUsableSet(saved.tacticsDefault, fm26, saved.customRoles)) {
    notes.push({ kind: 'slot', text: '이미 저장해 둔 전술이 있어 옛 포메이션과 자리 역할은 옮기지 않았습니다' })
  } else {
    const main = formationOf(saved.formation)
    const edited = FORMATIONS.filter((formation) => formation.id !== main.id && isEdited(formation, slotRoles))
    const room = TACTICS_PER_SAVE - 1
    const extras = edited.slice(0, room)
    const dropped = edited.slice(room)
    const built = [main, ...extras].map((formation) => migratedTactic(formation, slotRoles, fm26))
    const set: TacticSet = { catalog: fm26.id, tactics: built.map((each) => each.tactic), mainId: built[0].tactic.id }
    const problems = validateTacticSet(set, fm26)
    if (problems.length > 0) {
      // 만든 전술이 저장할 수 없는 모양이면(자료가 어긋났을 때만 일어난다) 쓰지 않는다. 쓰는 쪽은 옛 포메이션의 프리셋으로 물러선다
      notes.push({ kind: 'problem', text: `옮긴 전술이 올바르지 않아 전술은 옮기지 못했습니다: ${problems[0].message}` })
    } else {
      tacticsDefault = set
      // 값이 바뀌는 열쇠는 알림에 적는다: 있던 묶음을 쓸 수 없어 새로 만든 것이다(없던 것을 만든 것은 아래 줄이 말한다)
      if (saved.tacticsDefault !== undefined && saved.tacticsDefault !== null) {
        notes.push({ kind: 'slot', text: '저장해 둔 전술 묶음을 FM26에서 쓸 수 없어 옛 포메이션과 자리 역할로 새로 만들었습니다' })
      }
      notes.push({ kind: 'slot', text: `옛 설정의 포메이션(${main.label})과 자리 역할을 FM26 역할로 옮겨 주 전술로 두었습니다` })
      if (extras.length > 0) notes.push({ kind: 'slot', text: `자리 역할을 고친 적이 있는 포메이션(${extras.map((formation) => formation.label).join(', ')})도 전술로 옮겼습니다` })
      if (dropped.length > 0) {
        notes.push({
          kind: 'tacticsDropped',
          text: `전술은 세이브마다 ${TACTICS_PER_SAVE}개까지 둘 수 있어 옮기지 못한 포메이션: ${dropped.map((formation) => formation.label).join(', ')}(옛 설정에는 그대로 남아 있습니다)`
        })
      }
      notes.push(...replacedNotes(built.flatMap((each) => each.replaced), fm26, legacy))
      notes.push({ kind: 'slot', text: '공 미소유 시 역할은 모든 자리에서 그 칸의 기본 역할로 두었습니다' })
      notes.push({ kind: 'share', text: `공 소유 시 비중은 정하지 않고 기본값(${shareLabel(defaultSharePct())}, 추정)을 따릅니다` })
    }
  }

  const carry = carryWeights(saved.roleWeights, fm26, legacy)
  const nameOf = (roleId: string): string => legacy.role(roleId)?.label ?? roleId
  if (carry.carried.length > 0) {
    const parts = carry.carried.map((each) => `${withJosa(nameOf(each.from), '은/는')} ${fm26.role(each.to)?.label ?? each.to}(능력치 ${each.count}개)`)
    notes.push({ kind: 'weightsCarried', text: `고친 가중치를 공 소유 시 역할로 옮겼습니다: ${parts.join(', ')}` })
  }
  if (carry.reset.length > 0) {
    notes.push({ kind: 'weightsReset', text: `고친 가중치를 옮기지 못해 초기화한 역할: ${carry.reset.map(nameOf).join(', ')}(FM26의 같은 역할로 이을 수 없습니다. 옛 설정에는 그대로 남아 있습니다)` })
  }

  const record: MigrationRecord = { version: migrationVersion(), at, notes, acknowledged: false }
  const settings: Settings = {
    ...saved,
    ...(carry.roleWeights ? { roleWeights: carry.roleWeights as Settings['roleWeights'] } : {}),
    ...(tacticsDefault ? { tacticsDefault } : {}),
    settingsVersion: migrationVersion(),
    migration: record
  }
  return { settings, record, changed: true }
}

/** 쓰기 전에 사본을 남겼다는 알림을 이전 기록에 더한다(사본은 쓰는 쪽이 남기므로 이전 함수가 아니라 쓰는 쪽이 부른다). 이전 기록이 없으면 그대로 돌려준다 */
export function withBackupNote(settings: Settings, file: string): Settings {
  const record = settings.migration
  if (!record) return settings
  const note: MigrationNote = { kind: 'backup', text: `이전하기 전의 설정은 따로 남겨 두었습니다: ${file}` }
  return { ...settings, migration: { ...record, backupFile: file, notes: [...record.notes, note] } }
}
