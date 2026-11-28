import { K } from './ledger'
import type { CatalogRole, Evidence, ReferenceProfile, RoleCatalog, RoleChoice } from './roleCatalog'
import { DEFAULT_ROLE, type PositionKey } from './roles'
import type { Phase, SlotProfile, Weights } from './slotProfile'
import { SAVE_ATTRIBUTE_ORDER } from './world'
import raw from './data/fm26-roles.json'

/**
 * FM26 역할 카탈로그: 켜진 게임에서 읽은 역할 89개(점유 시 50, 비점유 시 39)와, 칸 종류마다 고를 수 있는 역할, 칸 종류별 기본 역할,
 * 옛 14역할이 가는 역할을 담은 자료(data/fm26-roles.json)로 RoleCatalog를 만든다. 자료는 tests/catalogBuild.test.ts의 생성기가
 * 원본(게임에서 읽은 파일)에서 만든다. 손으로 고치지 않는다(`npm run catalog:build`).
 * 기본 카탈로그는 아직 옛 14역할(DEFAULT_CATALOG = 'legacy14')이라 이 카탈로그는 설정이 고를 때와 시험에서만 쓰인다.
 *
 * 규칙
 * - 역할의 기본 가중치 값은 자료에 두지 않는다. 자료에는 능력치 목록(핵심 key, 앱이 더한 app)만 있고, 값은 대장의
 *   ROLE_KEY_WEIGHT·ROLE_APP_WEIGHT를 그때그때 읽는다(값을 바꿔도 자료는 그대로다). 이 파일에 숫자 상수를 두지 않는다.
 * - 게임의 긴 설명 글은 옮기지 않는다. 자료에는 역할 이름, 짧은 이름, 능력치 목록만 있다.
 * - 역할 id는 'ip.<열거형 이름>'(점유 시), 'oop.<열거형 이름>'(비점유 시)이다. 게임 역할 비트(gameId)는 64비트 값이라 10진 글자로만 다룬다.
 *
 * 칸에서 고를 수 있는 역할과 근거(Evidence)
 * - game: 켜진 게임의 역할 목록에서 읽은 칸 종류(GK, DL, DR, DC.pair, DM.single, MC.pair, AML, AMR, ST.single).
 * - inferred: 읽지는 못했지만 1군 선수의 역할 별점 표와 공개 역할 목록에서 그 포지션에 있는 것을 확인하고 칸 종류에 놓은 것.
 * - unknown: 칸 종류까지 이름으로 짠 초안, 그리고 아래 물러서기로 나온 목록.
 * game이 아닌 것은 화면에서 "게임에서 확인 전"으로 보인다. 자료에 목록이 없는 칸 종류(모르는 칸 종류, 다른 포지션의 칸 종류, 빈 목록)는
 * 그 포지션의 칸 종류 전부에 든 역할의 합집합(게임 번호 순)으로 물러서고 근거는 unknown이다. 한 칸 종류의 목록만 주면 다른 칸 종류에서만 고르는 역할
 * (와이드 센터백, 박스 투 박스 등)이 빠져 게임의 전술이 거절될 수 있어서다. 포지션에 든 역할이 하나도 없으면 빈 목록이다.
 * 역할이 고를 수 있는 포지션(positions)은 그 역할이 든 칸 종류의 포지션 합집합이다.
 */

/** 자료 파일에 적힌 역할 하나 */
export interface Fm26Role {
  /** 'ip.<열거형 이름>' 또는 'oop.<열거형 이름>' */
  id: string
  phase: Phase
  /** 게임 역할 비트(10진 글자) */
  gameId: string
  /** 게임의 열거형 이름 */
  enumName: string
  /** 게임이 보여 주는 이름. 이름을 주지 않은 옛 방식 역할 10개는 관례 표기다 */
  name: string
  /** 게임의 짧은 이름. 없으면 빈 글자 */
  short: string
  /** 고를 수 있는 역할인가(이름을 주지 않은 옛 방식 역할 10개는 false) */
  selectable: boolean
  /** 게임 역할 화면이 핵심으로 보여 주는 능력치 id(세이브 순서) */
  key: readonly string[]
  /** 앱이 더한 능력치 id(세이브 순서) */
  app: readonly string[]
}

/** 자료 파일의 모양 */
export interface Fm26Data {
  /** 자료를 읽은 게임 판 */
  game: string
  /** 자료를 읽은 날(YYYY-MM-DD) */
  readAt: string
  /** 앱 추가 능력치를 정한 규칙: none(없음), default(골키퍼가 아닌 역할에 가속도·민첩성), legacy(옛 도움 능력치를 대응 역할에만) */
  appRule: string
  /** 게임 능력치 이름 → 앱 능력치 id(37개) */
  attributeNames: Record<string, string>
  roles: ReadonlyArray<Fm26Role>
  /** 칸 종류 → 고를 수 있는 역할과 근거(점유 시 역할이 먼저, 각 국면 안은 게임 번호 오름차순) */
  slotKinds: Record<string, Array<{ roleId: string; evidence: Evidence }>>
  /** 칸 종류 → 그 목록의 짧은 출처 메모 */
  slotNotes: Record<string, string>
  /** 칸 종류 → 국면별 기본 역할 */
  defaultRoles: Record<string, Partial<Record<Phase, string>>>
  /** 옛 14역할 id → 대응 역할 */
  legacyMap: Record<string, { to: string; oneToOne: boolean }>
}

const NO_WEIGHTS: Weights = Object.freeze({})
const NO_TAGS: Readonly<Record<string, 'game' | 'app'>> = Object.freeze({})
/** 포지션 14개의 차례(roles.ts의 DEFAULT_ROLE 차례) */
const POSITIONS = Object.keys(DEFAULT_ROLE) as PositionKey[]
/** 기준 분포의 풀이 좌우 짝을 함께 묶는 포지션 */
const SIDE_PAIR: Readonly<Partial<Record<PositionKey, readonly PositionKey[]>>> = {
  DL: ['DL', 'DR'],
  DR: ['DL', 'DR'],
  WBL: ['WBL', 'WBR'],
  WBR: ['WBL', 'WBR'],
  ML: ['ML', 'MR'],
  MR: ['ML', 'MR'],
  AML: ['AML', 'AMR'],
  AMR: ['AML', 'AMR']
}
const SAVE_AT: ReadonlyMap<string, number> = new Map(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))

/** 칸 종류의 포지션: 'DC.pair' → 'DC', 'GK' → 'GK' */
const kindPosition = (kind: string): PositionKey => kind.split('.')[0] as PositionKey

const byGameId = (a: { gameId?: string }, b: { gameId?: string }): number => {
  const x = BigInt(a.gameId ?? '0')
  const y = BigInt(b.gameId ?? '0')
  return x < y ? -1 : x > y ? 1 : 0
}

/** 자료로 카탈로그를 만든다. 자료가 어긋나 있어도 던지지 않고, 모르는 역할을 부르는 목록 항목은 건너뛴다(어긋남은 시험이 잡는다) */
export function createFm26Catalog(data: Fm26Data): RoleCatalog {
  const source = new Map(data.roles.map((role) => [role.id, role]))

  // 칸 종류별 목록(고를 수 있는 역할만, 한 역할은 한 번만)과, 역할이 든 포지션
  const lists = new Map<string, Record<Phase, RoleChoice[]>>()
  const kinds: string[] = []
  const where = new Map<string, Set<PositionKey>>()
  for (const [kind, entries] of Object.entries(data.slotKinds)) {
    const position = kindPosition(kind)
    if (!POSITIONS.includes(position)) continue
    const own: Record<Phase, RoleChoice[]> = { ip: [], oop: [] }
    for (const entry of entries) {
      const role = source.get(entry.roleId)
      if (!role || !role.selectable || own[role.phase].some((choice) => choice.roleId === role.id)) continue
      own[role.phase].push({ roleId: role.id, evidence: entry.evidence })
      where.set(role.id, (where.get(role.id) ?? new Set<PositionKey>()).add(position))
    }
    lists.set(kind, own)
    kinds.push(kind)
  }
  const kindsAt = (position: PositionKey): string[] => kinds.filter((kind) => kindPosition(kind) === position)

  const roles: CatalogRole[] = data.roles.map((role) => {
    const positions = POSITIONS.filter((position) => where.get(role.id)?.has(position))
    return {
      id: role.id,
      phase: role.phase,
      label: role.name,
      ...(role.short ? { short: role.short } : {}),
      gameId: role.gameId,
      positions,
      selectable: role.selectable,
      goalkeeper: positions.length === 1 && positions[0] === 'GK'
    }
  })
  const byId = new Map(roles.map((role) => [role.id, role]))
  const byBit = new Map(roles.map((role) => [`${role.phase}:${role.gameId}`, role] as const))

  // 가중치: 능력치 목록은 자료에서, 값은 대장에서 그때그때 읽는다(핵심 ROLE_KEY_WEIGHT, 앱 추가 ROLE_APP_WEIGHT)
  const parts = new Map<string, ReadonlyArray<readonly [string, 'game' | 'app']>>()
  const tags = new Map<string, Readonly<Record<string, 'game' | 'app'>>>()
  for (const role of data.roles) {
    const list = [
      ...role.key.map((attribute) => [attribute, 'game'] as const),
      ...role.app.filter((attribute) => !role.key.includes(attribute)).map((attribute) => [attribute, 'app'] as const)
    ].sort((a, b) => (SAVE_AT.get(a[0]) ?? 0) - (SAVE_AT.get(b[0]) ?? 0))
    parts.set(role.id, list)
    tags.set(role.id, Object.freeze(Object.fromEntries(list)))
  }

  // 참조 프로파일: 고를 수 있는 역할마다 하나(역할 하나, 비중 100, 풀 = 그 역할을 고를 수 있는 포지션 전부).
  // references()에 국면을 주지 않으면 두 국면 전부(79개)다. 점유 시 40개만 필요하면 'ip'를 준다(사용자 역할을 얹는 withCustomRoles도 같은 뜻이다).
  const references: readonly ReferenceProfile[] = roles
    .filter((role) => role.selectable)
    .map((role) => ({ key: `ref:${role.id}`, roleId: role.id, phase: role.phase, label: role.label, positions: role.positions, goalkeeper: role.goalkeeper }))
  const referenceBy = new Map(references.map((ref) => [ref.roleId, ref]))
  const referencesOf: Record<Phase, readonly ReferenceProfile[]> = {
    ip: references.filter((ref) => ref.phase === 'ip'),
    oop: references.filter((ref) => ref.phase === 'oop')
  }

  /**
   * 그 칸 종류·국면에서 고를 수 있는 역할. 자료에 그 칸 종류의 목록이 있으면 그것(근거도 자료 그대로)이다.
   * 없으면(모르는 칸 종류, 다른 포지션의 칸 종류, 빈 목록) 그 포지션의 칸 종류 전부에 든 역할의 합집합을 게임 번호 순으로 주고 근거를 unknown으로 낮춘다.
   * 역할의 positions가 칸 종류 목록에서만 만들어지므로 그 합집합이 곧 "그 포지션에서 고를 수 있는 역할 전부"이고, 든 역할이 하나도 없으면 빈 목록이다.
   */
  const choicesAt = (position: PositionKey, phase: Phase, kind: string): RoleChoice[] => {
    const exact = kindPosition(kind) === position ? lists.get(kind)?.[phase] : undefined
    if (exact && exact.length > 0) return exact.map((choice) => ({ ...choice }))
    return roles
      .filter((role) => role.selectable && role.phase === phase && role.positions.includes(position))
      .sort(byGameId)
      .map((role): RoleChoice => ({ roleId: role.id, evidence: 'unknown' }))
  }

  const defaultRole = (position: PositionKey, phase: Phase, kind: string): string => {
    const choices = choicesAt(position, phase, kind)
    const offered = (roleId: string | undefined): roleId is string => !!roleId && choices.some((choice) => choice.roleId === roleId)
    const wanted = (name: string): string | undefined => (Object.hasOwn(data.defaultRoles, name) ? data.defaultRoles[name][phase] : undefined)
    const own = wanted(kind)
    if (offered(own)) return own
    for (const other of kindsAt(position)) {
      const candidate = wanted(other)
      if (offered(candidate)) return candidate
    }
    return choices[0]?.roleId ?? ''
  }

  const poolOf = (profile: SlotProfile): readonly PositionKey[] => (Object.hasOwn(SIDE_PAIR, profile.ip.position) ? SIDE_PAIR[profile.ip.position]! : [profile.ip.position])

  return {
    id: 'fm26',
    dataVersion: data.game,
    roles,
    role: (id) => byId.get(id),
    roleByGameId: (phase, gameId) => byBit.get(`${phase}:${gameId}`),
    baseWeights: (roleId) => {
      const list = parts.get(roleId)
      if (!list) return NO_WEIGHTS
      const weights: Record<string, number> = {}
      for (const [attribute, tag] of list) weights[attribute] = tag === 'game' ? K.ROLE_KEY_WEIGHT : K.ROLE_APP_WEIGHT
      return weights
    },
    baseTags: (roleId) => tags.get(roleId) ?? NO_TAGS,
    choicesAt,
    defaultRole,
    poolOf,
    normKey: (profile) => `${poolOf(profile).join('+')}|${profile.ip.roleId}|${profile.oop.roleId}|${profile.sharePct}`,
    references: (phase) => (phase === 'ip' || phase === 'oop' ? referencesOf[phase] : references),
    referenceOf: (roleId) => referenceBy.get(roleId),
    legacyMap: () => data.legacyMap
  }
}

export const FM26_CATALOG: RoleCatalog = createFm26Catalog(raw as unknown as Fm26Data)
