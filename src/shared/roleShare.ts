import { z } from 'zod'
import { FIELD_BY_ID, FIELDS } from './fields'
import { CUSTOM_ROLES_MAX, ROLE_BUNDLE_MAX_BYTES, ROLE_NAME_MAX, ROLE_WEIGHT_MAX } from './limits'
import { withJosa } from './korean'
import { effectiveRoleWeights, type CatalogId, type CatalogRole, type CustomRole, type RoleCatalog, type RoleOverrides } from './roleCatalog'
import { DEFAULT_ROLE } from './roles'
import type { Weights } from './slotProfile'
import type { Settings } from './types'
import { SAVE_ATTRIBUTE_ORDER } from './world'

/**
 * 역할 가중치 묶음 파일(A-45, 백업 용도): 내 역할 가중치를 파일 하나로 내보내고, 다른 PC나 다음 판의 앱에서 가져온다. 순수 계산이다(파일을 읽고 쓰는 것은 본체가 한다).
 *
 * 형식 v1: { format: 'fmb-role-weights', version: 1, catalog, catalogVersion, weights, customRoles }
 *   weights는 역할 id → (능력치 id → 0~5 정수)이고, 그 역할의 실효 가중치 전체(카탈로그의 원래 값 위에 내가 고친 값을 덮은 것)에서 0을 뺀 것이다.
 *   원래 값이 아니라 실효 값을 담는 까닭: 판마다 원래 값이 달라도 가져온 쪽의 적합도가 보낸 쪽과 같게 하려는 것이다(A-45).
 *   가져오는 쪽은 자기 원래 값과 다른 칸만 "고친 값"으로 남긴다. 그래서 원래 값이 같은 칸은 고친 값이 없고, 화면의 근거 표시(게임 표시, 앱 추가, 사용자 수정)도 정확하다.
 *   사용자 역할(customRoles)은 형식에 자리를 두었지만 이 판의 앱은 아직 가져오지 않는다(가져오기 미리 보기가 건너뛴다고 알린다).
 *
 * 가져오는 파일은 믿지 않는다: 크기(ROLE_BUNDLE_MAX_BYTES), JSON 모양, 판, 사용자 역할 개수(CUSTOM_ROLES_MAX), 알 수 없는 능력치, 정수가 아니거나 0~ROLE_WEIGHT_MAX를 벗어난 가중치,
 * `__proto__` 열쇠를 모두 검사하고, 하나라도 걸리면 파일 전체를 이유와 함께 거절한다. 카탈로그에 없는 역할 id는 거절하지 않고 건너뛴다(게임 판마다 역할 목록이 다를 수 있다).
 */

export interface RoleBundle {
  format: 'fmb-role-weights'
  version: 1
  /** 내보낸 앱이 쓰던 카탈로그 */
  catalog: CatalogId
  /** 그 카탈로그의 게임 판('26.3.2'. 옛 14역할은 'app') */
  catalogVersion: string
  /** 역할 id → (능력치 id → 0~ROLE_WEIGHT_MAX 정수). 실효 가중치이고 0인 칸은 적지 않는다 */
  weights: Record<string, Record<string, number>>
  customRoles: CustomRole[]
}

export type BundleParse = { ok: true; bundle: RoleBundle } | { ok: false; reason: string }

const FORMAT = 'fmb-role-weights'

/** 가중치를 줄 수 있는 능력치(화면의 역할 가중치 칸과 같은 것), 세이브의 능력치 순서 */
const ATTRIBUTE_IDS: readonly string[] = (() => {
  const shown = new Set(FIELDS.filter((field) => field.isAttr).map((field) => field.id))
  return SAVE_ATTRIBUTE_ORDER.filter((id) => shown.has(id))
})()
const KNOWN_ATTRIBUTES: ReadonlySet<string> = new Set(ATTRIBUTE_IDS)
const POSITION_NAMES: ReadonlySet<string> = new Set(Object.keys(DEFAULT_ROLE))

const PHASE_NAME = { ip: '공 소유 시', oop: '공 미소유 시' } as const
const CATALOG_NAME: Record<CatalogId, string> = { legacy14: '옛 14역할', fm26: 'FM26 역할' }

/** 파일에서 온 글을 메시지에 쓸 때: 제어 문자를 빼고 길면 자른다 */
function clip(text: string): string {
  const letters = Array.from(text.replace(/[\u0000-\u001f\u007f]/g, ''))
  return letters.length > 30 ? `${letters.slice(0, 30).join('')}…` : letters.join('')
}

// ---------- 내보내기 ----------

/**
 * 지금 설정의 역할 가중치를 묶음으로 만든다. 카탈로그의 모든 역할(사용자 역할은 customRoles 안에 따로)의 실효 가중치 전체를 담는다.
 * 설정에 0~5 정수가 아닌 값이 손으로 들어가 있으면 그대로 담기므로, 파일로 쓰기 전에 parseBundle로 다시 읽어 본다(본체의 내보내기가 한다).
 */
export function exportBundle(settings: Settings, catalog: RoleCatalog): RoleBundle {
  const overrides: RoleOverrides = settings.roleWeights ?? {}
  const customs = Array.isArray(settings.customRoles) ? settings.customRoles : []
  const customIds = new Set(customs.map((role) => role.id))
  const positive = (weights: Weights): Record<string, number> => {
    const table: Record<string, number> = {}
    for (const attribute of ATTRIBUTE_IDS) {
      const weight = weights[attribute]
      if (typeof weight === 'number' && weight > 0) table[attribute] = weight
    }
    return table
  }
  const weights: Record<string, Record<string, number>> = {}
  for (const role of catalog.roles) {
    if (customIds.has(role.id)) continue
    weights[role.id] = positive(effectiveRoleWeights(catalog, role.id, overrides))
  }
  // 사용자 역할의 원래 값은 그 역할이 가진 가중치다(카탈로그가 사용자 역할을 얹은 것이 아니어도 같다)
  const customRoles = customs.map((role): CustomRole => ({
    id: role.id,
    phase: role.phase,
    name: role.name,
    positions: [...role.positions],
    weights: positive({ ...role.weights, ...(overrides[role.id] ?? {}) }),
    ...(role.base === undefined ? {} : { base: role.base })
  }))
  return { format: FORMAT, version: 1, catalog: catalog.id, catalogVersion: catalog.dataVersion, weights, customRoles }
}

/** 파일에 쓰는 글(읽기 쉽게 들여쓴 JSON) */
export function bundleToText(bundle: RoleBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`
}

// ---------- 읽기 ----------

const CustomRoleShape = z.object({
  id: z.string(),
  phase: z.enum(['ip', 'oop']),
  name: z.string(),
  positions: z.array(z.string()),
  weights: z.record(z.string(), z.number()),
  base: z.string().optional()
})

const BundleShape = z.object({
  format: z.string(),
  version: z.number(),
  catalog: z.enum(['legacy14', 'fm26']),
  catalogVersion: z.string(),
  weights: z.record(z.string(), z.record(z.string(), z.number())),
  customRoles: z.array(CustomRoleShape).optional()
})

/** 어디에든 `__proto__` 열쇠가 있는가(객체에 그 이름으로 넣으면 객체의 원형이 바뀌는 열쇠라서 파일 전체를 거절한다) */
function hasProtoKey(root: unknown): boolean {
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const value = stack.pop()
    if (value === null || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item)
      continue
    }
    if (Object.hasOwn(value, '__proto__')) return true
    for (const item of Object.values(value)) stack.push(item)
  }
  return false
}

/** 가중치 한 칸이 올바른가. 올바르지 않으면 이유 글 */
function weightProblem(where: string, attribute: string, value: number): string | null {
  if (!KNOWN_ATTRIBUTES.has(attribute)) return `알 수 없는 능력치 이름이 있습니다(${clip(where)}: ${clip(attribute)}).`
  if (!Number.isInteger(value)) return `가중치는 정수여야 합니다(${clip(where)}: ${clip(attribute)} = ${value}).`
  if (value < 0 || value > ROLE_WEIGHT_MAX) return `가중치는 0에서 ${ROLE_WEIGHT_MAX} 사이여야 합니다(${clip(where)}: ${clip(attribute)} = ${value}).`
  return null
}

/** 사용자 역할 하나가 올바른가(id 꼴, 이름 길이, 국면, 포지션, 가중치). 올바르지 않으면 이유 글 */
function customRoleProblem(role: z.infer<typeof CustomRoleShape>): string | null {
  const where = `사용자 역할 ${clip(role.id)}`
  if (!/^user\.\S{1,40}$/u.test(role.id)) return `${where}: 번호는 user.로 시작하는 한 단어여야 합니다.`
  const length = Array.from(role.name.trim()).length
  if (length < 1 || length > ROLE_NAME_MAX) return `${where}: 이름은 1글자 이상 ${ROLE_NAME_MAX}글자 이하여야 합니다.`
  if (role.positions.length < 1 || new Set(role.positions).size !== role.positions.length || !role.positions.every((position) => POSITION_NAMES.has(position))) {
    return `${where}: 포지션이 올바르지 않습니다.`
  }
  for (const [attribute, value] of Object.entries(role.weights)) {
    const problem = weightProblem(role.id, attribute, value)
    if (problem) return problem
  }
  return null
}

/**
 * 묶음 파일의 글을 읽는다. 올바르면 묶음을, 아니면 이유를 돌려준다(파일 전체를 거절하고 일부만 받지 않는다).
 * 크기 한도는 본체가 파일을 읽기 전에도 본다. 여기서는 받은 글의 크기를 다시 본다.
 */
export function parseBundle(text: string): BundleParse {
  const reject = (reason: string): BundleParse => ({ ok: false, reason })
  if (typeof text !== 'string') return reject('파일을 글로 읽지 못했습니다.')
  const tooBig = `파일이 너무 큽니다(${ROLE_BUNDLE_MAX_BYTES / 1024}KB까지 가져올 수 있습니다).`
  // 글자 수는 바이트 수 이하라서, 글자 수가 한도를 넘으면 바이트 수도 넘는다(큰 글을 바이트로 바꾸어 재지 않는다)
  if (text.length > ROLE_BUNDLE_MAX_BYTES || new TextEncoder().encode(text).length > ROLE_BUNDLE_MAX_BYTES) return reject(tooBig)

  let json: unknown
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return reject('JSON 형식이 아니라 읽을 수 없는 파일입니다.')
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return reject('역할 가중치 묶음의 모양이 아닙니다(맨 위가 항목이 있는 객체여야 합니다).')
  if (hasProtoKey(json)) return reject('허용하지 않는 이름(__proto__)이 들어 있어 가져올 수 없습니다.')
  const head = json as { format?: unknown; version?: unknown; customRoles?: unknown }
  if (head.format !== FORMAT) return reject('이 앱이 만든 역할 가중치 묶음 파일이 아닙니다.')
  if (head.version !== 1) return reject(`묶음 형식의 판(version ${clip(String(head.version))})이 이 앱이 아는 판(1)과 다릅니다. 더 새로운 앱이 만든 파일일 수 있습니다.`)
  if (Array.isArray(head.customRoles) && head.customRoles.length > CUSTOM_ROLES_MAX) return reject(`사용자 역할이 너무 많습니다(${CUSTOM_ROLES_MAX}개까지 가져올 수 있습니다).`)

  const shaped = BundleShape.safeParse(json)
  if (!shaped.success) {
    const at = shaped.error.issues[0]?.path.map(String).map(clip).join('.') ?? ''
    return reject(`역할 가중치 묶음의 모양과 다릅니다${at ? `(${at})` : ''}.`)
  }
  const data = shaped.data
  if (data.catalogVersion.length < 1 || data.catalogVersion.length > 40) return reject('게임 판(catalogVersion)이 올바르지 않습니다.')

  const weights: Record<string, Record<string, number>> = {}
  for (const [roleId, table] of Object.entries(data.weights)) {
    const row: Record<string, number> = {}
    for (const [attribute, value] of Object.entries(table)) {
      const problem = weightProblem(roleId, attribute, value)
      if (problem) return reject(problem)
      // -0은 0으로 적는다(적합도에는 영향이 없지만 값이 둘로 갈리지 않게)
      row[attribute] = value === 0 ? 0 : value
    }
    weights[roleId] = row
  }
  const customRoles: CustomRole[] = []
  const seen = new Set<string>()
  for (const role of data.customRoles ?? []) {
    const problem = customRoleProblem(role)
    if (problem) return reject(problem)
    if (seen.has(role.id)) return reject(`같은 번호의 사용자 역할이 둘 이상 있습니다(${clip(role.id)}).`)
    seen.add(role.id)
    customRoles.push({
      id: role.id,
      phase: role.phase,
      name: role.name,
      positions: role.positions as CustomRole['positions'],
      weights: Object.fromEntries(Object.entries(role.weights).map(([attribute, value]) => [attribute, value === 0 ? 0 : value])),
      ...(role.base === undefined ? {} : { base: role.base })
    })
  }
  return { ok: true, bundle: { format: FORMAT, version: 1, catalog: data.catalog, catalogVersion: data.catalogVersion, weights, customRoles } }
}

// ---------- 가져오기 미리 보기 ----------

/** 미리 보기 결과의 첫 글(본체의 서비스와 미리보기 목업이 같이 쓴다). changeCount는 바뀌는 역할 수 */
export function bundlePreviewMessage(changeCount: number): string {
  return changeCount > 0 ? `역할 ${changeCount}개의 가중치가 바뀝니다. 아래를 확인한 뒤 합치기나 바꾸기를 골라 주세요.` : '이 파일로 바뀌는 가중치가 없습니다.'
}

/** 적용한 뒤의 글 */
export function bundleAppliedMessage(changeCount: number, mode: 'merge' | 'replace'): string {
  return changeCount > 0 ? `역할 ${changeCount}개의 가중치를 ${mode === 'replace' ? '바꾸었' : '합쳤'}습니다.` : '바뀐 가중치가 없습니다.'
}

const roleName =(role: CatalogRole): string => (role.phase === 'both' ? role.label : `${role.label}(${PHASE_NAME[role.phase]})`)

/** 묶음의 실효 가중치 표를 가져오는 쪽의 원래 값과 견주어, 다른 칸만 고친 값으로 남긴다(0으로 끄는 칸도 고친 값이다) */
function overridesFrom(table: Record<string, number>, base: Weights): Record<string, number> {
  const out: Record<string, number> = {}
  for (const attribute of new Set([...Object.keys(base), ...Object.keys(table)])) {
    const want = table[attribute] ?? 0
    const have = Math.max(0, base[attribute] ?? 0)
    if (want !== have) out[attribute] = want
  }
  return out
}

/** 역할 하나의 가중치가 바뀐 곳을 한 줄로: "센터백(공 소유 시): 헤더 4 → 5, 태클 4 → 3 외 2개". 바뀐 곳이 없으면 null */
function changeLine(role: CatalogRole, before: Weights, after: Weights): string | null {
  const parts: string[] = []
  for (const attribute of ATTRIBUTE_IDS) {
    const from = Math.max(0, before[attribute] ?? 0)
    const to = Math.max(0, after[attribute] ?? 0)
    if (from !== to) parts.push(`${FIELD_BY_ID[attribute]?.label ?? attribute} ${from} → ${to}`)
  }
  if (parts.length === 0) return null
  const shown = parts.slice(0, 4)
  return `${roleName(role)}: ${shown.join(', ')}${parts.length > shown.length ? ` 외 ${parts.length - shown.length}개` : ''}`
}

/**
 * 가져오기 미리 보기: 묶음을 지금 설정에 적용하면 무엇이 바뀌는지(changes), 알아 둘 것(warnings), 적용할 설정 조각(patch)을 돌려준다.
 * 설정은 바꾸지 않는다. patch는 지금 설정 위에 얹으면 되는 roleWeights 전체이고, 사용자 역할(customRoles)은 이 판에서 가져오지 않아 담지 않는다.
 *
 * 묶음에 든 역할은 묶음의 실효 가중치가 이긴다(두 방식 모두): 가져오는 쪽의 원래 값과 다른 칸만 고친 값으로 남기고, 같아진 칸의 옛 고친 값은 지운다.
 * 묶음에 없는 역할은 합치기(merge)면 그대로 두고, 바꾸기(replace)면 고친 값을 지워 원래 값으로 돌린다. 지금 카탈로그에 없는 역할(옛 14역할 id 포함)의 고친 값은 어느 쪽도 건드리지 않는다.
 * 카탈로그에 없는 묶음의 역할 id는 건너뛰고 알린다. 묶음의 카탈로그나 게임 판이 지금과 다르면 경고한다.
 */
export function previewImport(
  bundle: RoleBundle,
  settings: Settings,
  catalog: RoleCatalog,
  mode: 'merge' | 'replace'
): { changes: string[]; warnings: string[]; patch: Pick<Settings, 'roleWeights' | 'customRoles'> } {
  const replace = mode === 'replace'
  const before: RoleOverrides = settings.roleWeights ?? {}
  const next: RoleOverrides = {}
  for (const [roleId, table] of Object.entries(before)) if (roleId !== '__proto__') next[roleId] = { ...table }

  const warnings: string[] = []
  if (bundle.catalog !== catalog.id) {
    warnings.push(`이 묶음은 ${CATALOG_NAME[bundle.catalog]}로 만든 것이고 지금은 ${withJosa(CATALOG_NAME[catalog.id], '을/를')} 쓰고 있어서, 지금 목록에 없는 역할은 건너뜁니다.`)
  } else if (bundle.catalogVersion !== catalog.dataVersion) {
    warnings.push(`이 묶음은 게임 판 ${clip(bundle.catalogVersion)}의 역할 목록으로 만든 것이고 지금은 ${catalog.dataVersion}입니다. 판이 다르면 같은 역할도 가중치가 다를 수 있습니다.`)
  }

  // 묶음에 있는 역할: 묶음의 값이 이긴다
  const skipped: string[] = []
  for (const roleId of Object.keys(bundle.weights)) {
    if (!catalog.role(roleId)) {
      skipped.push(roleId)
      continue
    }
    const fixed = overridesFrom(bundle.weights[roleId], catalog.baseWeights(roleId))
    if (Object.keys(fixed).length > 0) next[roleId] = fixed
    else delete next[roleId]
  }
  if (skipped.length > 0) {
    const names = skipped.slice(0, 3).map(clip).join(', ')
    warnings.push(`건너뛴 역할 ${skipped.length}개: 지금 쓰는 역할 목록에 없습니다(${names}${skipped.length > 3 ? ' 외' : ''}).`)
  }
  if (bundle.customRoles.length > 0) warnings.push(`묶음에 든 사용자 역할 ${bundle.customRoles.length}개는 이 판의 앱이 아직 가져오지 못해 건너뜁니다.`)

  // 묶음에 없는 역할: 합치기는 그대로, 바꾸기는 원래 값으로
  const absent = catalog.roles.filter((role) => !Object.hasOwn(bundle.weights, role.id) && Object.keys(before[role.id] ?? {}).length > 0)
  if (absent.length > 0) {
    if (replace) {
      for (const role of absent) delete next[role.id]
      warnings.push(`이 묶음에 없는 역할 ${absent.length}개에 고쳐 둔 가중치는 원래 값으로 돌아갑니다.`)
    } else {
      warnings.push(`이 묶음에 없는 역할 ${absent.length}개에는 고쳐 둔 가중치가 있습니다. 합치기는 그대로 두고, 바꾸기는 원래 값으로 되돌립니다.`)
    }
  }

  const changes: string[] = []
  for (const role of catalog.roles) {
    const line = changeLine(role, effectiveRoleWeights(catalog, role.id, before), effectiveRoleWeights(catalog, role.id, next))
    if (line) changes.push(line)
  }
  return { changes, warnings, patch: { roleWeights: next } }
}
