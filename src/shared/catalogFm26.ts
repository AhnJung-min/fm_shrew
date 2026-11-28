import type { PositionKey } from './roles'
import type { CatalogRole, Evidence, ReferenceProfile, RoleCatalog, RoleChoice } from './roleCatalog'
import type { Phase, SlotProfile } from './slotProfile'
import raw from './data/fm26-roles.json'

/**
 * FM26 역할 카탈로그(빈 틀). 지금은 자료(data/fm26-roles.json)가 비어 있어 역할이 하나도 없는 카탈로그다.
 * 2단계의 U4가 이 파일의 자료 모양(Fm26Data)과 만드는 함수(createFm26Catalog)를 채운다: 역할 89개(점유 시 50, 비점유 시 39),
 * 칸 종류별 고를 수 있는 역할과 근거, 칸 종류별 기본 역할, 옛 14역할 대응 표, 능력치 이름 표.
 * 기본 카탈로그는 아직 옛 14역할(DEFAULT_CATALOG = 'legacy14')이라 이 카탈로그는 어디서도 쓰이지 않는다.
 *
 * 규칙(U4가 지킨다): 역할의 기본 가중치 값은 자료에 두지 않고 대장의 ROLE_KEY_WEIGHT·ROLE_APP_WEIGHT를 그때그때 읽는다.
 * 이 파일에 숫자 상수를 두지 않는다. 게임의 긴 설명 글은 옮기지 않는다.
 */

/** 자료 파일의 모양(U4가 넓힌다) */
export interface Fm26Data {
  /** 자료를 읽은 게임 판 */
  game: string
  readAt: string
  roles: ReadonlyArray<{ id: string; phase: Phase; gameId: string; name: string }>
  /** 칸 종류 → 고를 수 있는 역할과 근거 */
  slotKinds: Record<string, Array<{ roleId: string; evidence: Evidence }>>
  /** 칸 종류 → 국면별 기본 역할 */
  defaultRoles: Record<string, Partial<Record<Phase, string>>>
  /** 옛 14역할 id → 대응 역할 */
  legacyMap: Record<string, { to: string; oneToOne: boolean }>
  attributeNames: Record<string, string>
}

const NO_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({})

/** 자료로 카탈로그를 만든다. 빈 틀이라 역할이 없고, 목록을 묻는 함수는 빈 목록을 돌려준다 */
export function createFm26Catalog(data: Fm26Data): RoleCatalog {
  const roles: readonly CatalogRole[] = []
  const references: readonly ReferenceProfile[] = []
  return {
    id: 'fm26',
    dataVersion: data.game,
    roles,
    role: () => undefined,
    roleByGameId: () => undefined,
    baseWeights: () => NO_WEIGHTS,
    baseTags: () => ({}),
    choicesAt: (): RoleChoice[] => [],
    defaultRole: (_position: PositionKey, phase: Phase, kind: string) => data.defaultRoles[kind]?.[phase] ?? '',
    poolOf: (profile: SlotProfile) => [profile.ip.position],
    normKey: (profile: SlotProfile) => `${profile.ip.position}|${profile.ip.roleId}|${profile.oop.roleId}|${profile.sharePct}`,
    references: () => references,
    referenceOf: () => undefined,
    legacyMap: () => data.legacyMap
  }
}

export const FM26_CATALOG: RoleCatalog = createFm26Catalog(raw as unknown as Fm26Data)
