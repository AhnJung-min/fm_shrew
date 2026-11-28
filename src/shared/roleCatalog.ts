import { compositeWeights, type Phase, type SlotProfile, type Weights } from './slotProfile'
import { DEFAULT_ROLE, prepareWeights, ROLE_BY_ID, ROLES, rolesFor, type PositionKey, type PreparedRole } from './roles'
import { SAVE_ATTRIBUTE_ORDER } from './world'

/**
 * 역할 카탈로그(2단계): 어떤 역할이 있고, 역할마다 어떤 능력치에 얼마의 가중치를 주고, 어느 칸에서 고를 수 있는가.
 * 점수 계산은 카탈로그 하나를 받아 이 틀로만 역할을 읽는다. 오늘의 14역할은 어댑터(LEGACY_CATALOG)로 끼우고,
 * FM26 역할 89개는 같은 틀의 다른 카탈로그(catalogFm26.ts)가 된다. 어느 카탈로그를 쓰는지는 catalogs.ts 한 곳에서 정한다.
 *
 * 이 모듈은 순수 계산이다. 역할 가중치의 "원래 값"은 카탈로그가 주고, 사용자가 고친 값(RoleOverrides)이 그 위를 덮는다.
 */

export type CatalogId = 'legacy14' | 'fm26'
/** 가중치 칸의 출처: 게임 역할 화면에 표시된 것, 앱이 더한 것, 사용자가 고친 것(F-04) */
export type WeightTag = 'game' | 'app' | 'user'
/** 역할 목록(칸에서 고를 수 있는 역할)의 근거: 게임에서 본 것, 본 것에서 짐작한 것, 모르는 것(초안), 앱이 정한 것, 사용자가 만든 것 */
export type Evidence = 'game' | 'inferred' | 'unknown' | 'app' | 'user'
/** 칸 종류: 'GK', 'DL', 'DC.pair', 'MC.single', 'DC.trio.side' ... (tacticModel.ts의 slotKindOf) */
export type SlotKind = string
/** Settings.roleWeights 그대로: 역할 id → (능력치 id → 가중치). 옛 id와 새 id가 섞여 있어도 된다 */
export type RoleOverrides = Record<string, Record<string, number>>

export interface CatalogRole {
  /** 옛 'cb' | FM26 'ip.CentralDefender', 'oop.OPCentreBack' | 사용자 'user.<글자>' */
  id: string
  /** 옛 14역할은 'both' */
  phase: Phase | 'both'
  label: string
  short?: string
  /** 게임 역할 비트(10진 글자). 64비트 값이라 숫자로 바꾸지 않는다 */
  gameId?: string
  /** 이 역할을 고를 수 있는 포지션 전부 */
  positions: readonly PositionKey[]
  /** 고를 수 있는 역할인가(FM24식 역할처럼 목록에는 있어도 고르지 못하게 둔 것은 false) */
  selectable: boolean
  goalkeeper: boolean
}

export interface RoleChoice {
  roleId: string
  evidence: Evidence
}

/** 역할만 고른 찾기, 전술에 자리가 없는 선수의 "가장 맞는 역할", 별점 대조에 쓰는 프로파일: 역할 하나, 비중 100, 풀 = 그 역할을 고를 수 있는 포지션 전부 */
export interface ReferenceProfile {
  /** 기준 분포의 열쇠. 옛 카탈로그는 역할 id, FM26은 `ref:<역할 id>` */
  key: string
  roleId: string
  phase: Phase | 'both'
  label: string
  positions: readonly PositionKey[]
  goalkeeper: boolean
}

/** 기준 분포를 구하는 요청 하나: 열쇠, 풀 포지션(이 가운데 하나라도 숙련 15 이상인 선수가 풀), 합성 가중치 */
export interface NormSpec {
  key: string
  pool: readonly PositionKey[]
  weights: Weights
}

export interface CustomRole {
  /** 'user.<글자>' */
  id: string
  phase: Phase
  name: string
  positions: PositionKey[]
  weights: Record<string, number>
  /** 바탕으로 복사한 역할 id */
  base?: string
}

export interface RoleCatalog {
  id: CatalogId
  /** 게임 판('26.3.2'). 옛 카탈로그는 'app' */
  dataVersion: string
  roles: readonly CatalogRole[]
  role(id: string): CatalogRole | undefined
  roleByGameId(phase: Phase, gameId: string): CatalogRole | undefined
  /** 역할의 원래 가중치. FM26은 대장의 ROLE_KEY_WEIGHT·ROLE_APP_WEIGHT를 그때그때 읽는다 */
  baseWeights(roleId: string): Weights
  /** 원래 가중치 칸마다 출처(게임 표시 또는 앱 추가) */
  baseTags(roleId: string): Readonly<Record<string, 'game' | 'app'>>
  /** 그 칸 종류·국면에서 고를 수 있는 역할 */
  choicesAt(position: PositionKey, phase: Phase, kind: SlotKind): RoleChoice[]
  defaultRole(position: PositionKey, phase: Phase, kind: SlotKind): string
  /** 기준 분포의 풀 포지션. 옛: 역할의 positions, FM26: 점유 시 포지션 + 좌우 짝 */
  poolOf(profile: SlotProfile): readonly PositionKey[]
  /** 화면과 본체가 같이 쓰는 기준 분포의 열쇠. 옛: 역할 id, FM26: `${풀}|${점유 시 역할}|${비점유 시 역할}|${비중}` */
  normKey(profile: SlotProfile): string
  references(phase?: Phase): readonly ReferenceProfile[]
  referenceOf(roleId: string): ReferenceProfile | undefined
  /** 옛 14역할 id → 이 카탈로그의 대응 역할. oneToOne이 참인 것만 고친 가중치를 옮긴다 */
  legacyMap(): Readonly<Record<string, { to: string; oneToOne: boolean }>>
}

const NO_WEIGHTS: Weights = Object.freeze({})
const NO_TAGS: Readonly<Record<string, 'game' | 'app'>> = Object.freeze({})
/** 14개 포지션 이름(검사용) */
const POSITION_NAMES: ReadonlySet<string> = new Set(Object.keys(DEFAULT_ROLE))

// ---------- 옛 14역할 어댑터 ----------

const LEGACY_ROLES: readonly CatalogRole[] = ROLES.map((role) => ({
  id: role.id,
  phase: 'both',
  label: role.label,
  positions: role.positions,
  selectable: true,
  goalkeeper: role.positions.includes('GK')
}))
const LEGACY_BY_ID: ReadonlyMap<string, CatalogRole> = new Map(LEGACY_ROLES.map((role) => [role.id, role]))
const LEGACY_REFERENCES: readonly ReferenceProfile[] = LEGACY_ROLES.map((role) => ({
  key: role.id,
  roleId: role.id,
  phase: role.phase,
  label: role.label,
  positions: role.positions,
  goalkeeper: role.goalkeeper
}))
const LEGACY_REFERENCE_BY_ID: ReadonlyMap<string, ReferenceProfile> = new Map(LEGACY_REFERENCES.map((ref) => [ref.roleId, ref]))
const LEGACY_TAGS: ReadonlyMap<string, Readonly<Record<string, 'app'>>> = new Map(
  ROLES.map((role) => [role.id, Object.fromEntries(Object.keys(role.weights).map((attribute) => [attribute, 'app' as const]))])
)
const LEGACY_MAP: Readonly<Record<string, { to: string; oneToOne: boolean }>> = Object.fromEntries(ROLES.map((role) => [role.id, { to: role.id, oneToOne: true }]))

/**
 * 오늘의 14역할을 카탈로그 틀에 끼운 어댑터. 국면이 없어(phase 'both') 두 국면이 같은 역할을 쓰고,
 * 고를 수 있는 역할은 rolesFor 순서(근거는 모두 'app'), 기본 역할은 DEFAULT_ROLE, 풀은 역할의 positions, 기준 분포 열쇠는 역할 id,
 * 참조 목록은 ROLES 순서(열쇠 = 역할 id), 가중치 출처는 모두 'app'(앱이 직접 정한 값)이다. 점수 계산이 오늘과 끝자리까지 같다는 것의 기준이라 영구히 남긴다.
 */
export const LEGACY_CATALOG: RoleCatalog = {
  id: 'legacy14',
  dataVersion: 'app',
  roles: LEGACY_ROLES,
  role: (id) => LEGACY_BY_ID.get(id),
  roleByGameId: () => undefined,
  baseWeights: (roleId) => (Object.hasOwn(ROLE_BY_ID, roleId) ? ROLE_BY_ID[roleId].weights : NO_WEIGHTS),
  baseTags: (roleId) => LEGACY_TAGS.get(roleId) ?? NO_TAGS,
  choicesAt: (position) => rolesFor(position).map((role): RoleChoice => ({ roleId: role.id, evidence: 'app' })),
  defaultRole: (position) => DEFAULT_ROLE[position],
  poolOf: (profile) => (Object.hasOwn(ROLE_BY_ID, profile.ip.roleId) ? ROLE_BY_ID[profile.ip.roleId].positions : [profile.ip.position]),
  normKey: (profile) => profile.ip.roleId,
  references: () => LEGACY_REFERENCES,
  referenceOf: (roleId) => LEGACY_REFERENCE_BY_ID.get(roleId),
  legacyMap: () => LEGACY_MAP
}

// ---------- 가중치와 준비 ----------

/** 역할의 실효 가중치: 카탈로그의 원래 값 위에 사용자가 고친 값을 덮는다(옛 effectiveWeights와 같다) */
export function effectiveRoleWeights(catalog: RoleCatalog, roleId: string, overrides: RoleOverrides): Weights {
  return { ...catalog.baseWeights(roleId), ...(overrides[roleId] ?? {}) }
}

/**
 * 한 자리 프로파일의 가중치: 두 국면 역할의 실효 가중치를 비중으로 섞는다(slotProfile.ts의 compositeWeights).
 * 두 국면의 역할이 같으면 섞을 것이 없어 그 역할의 실효 가중치다.
 */
export function profileWeights(catalog: RoleCatalog, profile: SlotProfile, overrides: RoleOverrides): Weights {
  const ip = effectiveRoleWeights(catalog, profile.ip.roleId, overrides)
  if (profile.oop.roleId === profile.ip.roleId) return ip
  return compositeWeights(ip, effectiveRoleWeights(catalog, profile.oop.roleId, overrides), profile.sharePct)
}

/** 선수 수만 번 계산할 때 쓰는 꼴(세이브의 능력치 순서)로 바꾼 프로파일 가중치 */
export function prepareProfile(catalog: RoleCatalog, profile: SlotProfile, overrides: RoleOverrides): PreparedRole {
  return prepareWeights(profileWeights(catalog, profile, overrides))
}

/** 자리 프로파일의 기준 분포 요청: 열쇠, 풀, 합성 가중치 */
export function profileSpec(catalog: RoleCatalog, profile: SlotProfile, overrides: RoleOverrides): NormSpec {
  return { key: catalog.normKey(profile), pool: catalog.poolOf(profile), weights: profileWeights(catalog, profile, overrides) }
}

/** 참조 프로파일(역할 하나, 비중 100)의 기준 분포 요청 */
export function referenceSpec(catalog: RoleCatalog, ref: ReferenceProfile, overrides: RoleOverrides): NormSpec {
  return { key: ref.key, pool: ref.positions, weights: effectiveRoleWeights(catalog, ref.roleId, overrides) }
}

/**
 * 역할 가중치 화면(F-04)의 한 줄 목록: 능력치마다 실효 가중치, 출처 태그, 원래 값. 세이브의 능력치 순서로 돌려준다.
 * 사용자가 원래 값과 다르게 고친 칸은 'user', 그 밖은 카탈로그의 태그(옛 14역할은 'app', FM26은 'game' 또는 'app')다.
 * 사용자 역할처럼 원래 값 전체를 사용자가 정한 역할은 태그가 없어 모두 'user'다. 원래도 실효도 0인 능력치는 싣지 않는다.
 */
export function weightEntries(
  catalog: RoleCatalog,
  roleId: string,
  overrides: RoleOverrides
): Array<{ attr: string; weight: number; tag: WeightTag; base: number }> {
  const base = catalog.baseWeights(roleId)
  const tags = catalog.baseTags(roleId)
  const weights = effectiveRoleWeights(catalog, roleId, overrides)
  const entries: Array<{ attr: string; weight: number; tag: WeightTag; base: number }> = []
  for (const attr of SAVE_ATTRIBUTE_ORDER) {
    const original = Math.max(0, base[attr] ?? 0)
    const weight = Math.max(0, weights[attr] ?? 0)
    if (original === 0 && weight === 0) continue
    entries.push({ attr, weight, tag: weight !== original ? 'user' : (tags[attr] ?? 'user'), base: original })
  }
  return entries
}

// ---------- 사용자 역할 ----------

/**
 * 카탈로그에 사용자 역할을 얹는다. 사용자 역할은 그 국면과 포지션의 "고를 수 있는 역할" 끝에 근거 'user'로 더해지고,
 * 다른 역할과 모든 나머지 규칙(기본 역할, 풀, 기준 분포 열쇠, 대응 표)은 바탕 카탈로그 그대로다. 사용자 역할이 없으면 바탕 카탈로그를 그대로 돌려준다.
 * 이미 있는 역할 id와 겹치거나 앞의 사용자 역할과 id가 같은 것은 건너뛴다(먼저 온 것이 이긴다).
 * 설정은 손으로 고칠 수 있어서 배열이 아닌 값(객체, 숫자 등)이 오면 사용자 역할이 없는 것으로 본다.
 */
export function withCustomRoles(catalog: RoleCatalog, roles: readonly CustomRole[]): RoleCatalog {
  const taken = new Set(catalog.roles.map((role) => role.id))
  const custom: CatalogRole[] = []
  const weightsOf = new Map<string, Weights>()
  const references: ReferenceProfile[] = []
  const list: readonly CustomRole[] = Array.isArray(roles) ? (roles as readonly CustomRole[]) : []
  for (const role of list) {
    if (!role || typeof role.id !== 'string' || taken.has(role.id)) continue
    taken.add(role.id)
    const positions = (Array.isArray(role.positions) ? role.positions : []).filter((position) => POSITION_NAMES.has(position))
    const phase: Phase = role.phase === 'oop' ? 'oop' : 'ip'
    const label = typeof role.name === 'string' ? role.name : role.id
    const goalkeeper = positions.includes('GK')
    custom.push({ id: role.id, phase, label, positions, selectable: true, goalkeeper })
    weightsOf.set(role.id, Object.fromEntries(Object.entries(role.weights ?? {}).filter(([, weight]) => typeof weight === 'number' && Number.isFinite(weight))))
    references.push({ key: `ref:${role.id}`, roleId: role.id, phase, label, positions, goalkeeper })
  }
  if (custom.length === 0) return catalog
  const customById = new Map(custom.map((role) => [role.id, role]))
  const referenceById = new Map(references.map((ref) => [ref.roleId, ref]))
  return {
    ...catalog,
    roles: [...catalog.roles, ...custom],
    role: (id) => customById.get(id) ?? catalog.role(id),
    baseWeights: (roleId) => weightsOf.get(roleId) ?? catalog.baseWeights(roleId),
    baseTags: (roleId) => (weightsOf.has(roleId) ? NO_TAGS : catalog.baseTags(roleId)),
    choicesAt: (position, phase, kind) => {
      const own = catalog.choicesAt(position, phase, kind)
      const added = custom.filter((role) => role.phase === phase && role.positions.includes(position)).map((role): RoleChoice => ({ roleId: role.id, evidence: 'user' }))
      return [...own, ...added]
    },
    references: (phase) => [...catalog.references(phase), ...references.filter((ref) => phase === undefined || ref.phase === phase)],
    referenceOf: (roleId) => referenceById.get(roleId) ?? catalog.referenceOf(roleId)
  }
}
