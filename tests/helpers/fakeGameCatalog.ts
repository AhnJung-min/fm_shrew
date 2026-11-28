/**
 * 게임 읽기 시험용 가짜 FM26 카탈로그. 실제 카탈로그(src/shared/catalogFm26.ts, 자료는 U4가 채운다)와 상관없이
 * 견본(tests/fixtures/plugin/tactic.json)이 풀리는지를 본다: 견본의 "자리마다 고를 수 있는 역할 목록"에서 역할과 포지션을 모아 만든다.
 * 역할 번호는 'ip.<게임 번호>' 또는 'oop.<게임 번호>', 이름은 견본이 준 지어낸 이름이다.
 */
import type { CatalogRole, RoleCatalog, RoleChoice } from '../../src/shared/roleCatalog'
import type { PositionKey } from '../../src/shared/roles'
import type { Phase } from '../../src/shared/slotProfile'

/** 견본의 포지션 비트(왼쪽·오른쪽 비트를 뗀 것) → 포지션. 시험이 풀이 코드를 거치지 않고 직접 아는 표다 */
const POSITION_OF_BIT: Record<string, PositionKey> = {
  '1': 'GK',
  '4': 'DR',
  '8': 'DL',
  '16': 'DC',
  '32': 'WBR',
  '64': 'WBL',
  '128': 'DM',
  '256': 'MR',
  '512': 'ML',
  '1024': 'MC',
  '2048': 'AMR',
  '4096': 'AML',
  '8192': 'AMC',
  '16384': 'ST'
}

export const positionOfBits = (text: string): PositionKey => {
  const bare = (BigInt(text) & ~(1048576n | 2097152n)).toString()
  const position = POSITION_OF_BIT[bare]
  if (!position) throw new Error(`견본의 포지션 비트를 모른다: ${text}`)
  return position
}

interface Probe {
  fields: Record<string, string>
  items?: Array<Record<string, string>>
}
interface TacticFixture {
  roles: Array<{ index: number; phase: Phase; probe: Probe }>
}

/**
 * 견본의 역할 목록에서 가짜 카탈로그를 만든다. extra는 게임 번호마다 더 고를 수 있게 할 포지션(견본에 없는 칸을 시험할 때).
 * 고를 수 있는 역할은 그 국면의 역할 가운데 포지션이 맞는 것이다(칸 종류는 보지 않는다).
 */
export function fakeCatalogFromTactic(fixture: TacticFixture, extra: Record<string, PositionKey[]> = {}): RoleCatalog {
  const byId = new Map<string, CatalogRole & { positionSet: Set<PositionKey> }>()
  for (const list of fixture.roles) {
    const position = positionOfBits(list.probe.fields['Team.Tactic.PositionValue'])
    for (const item of list.probe.items ?? []) {
      const gameId = item['RowData.DisplayValue.Role']
      const id = `${list.phase}.${gameId}`
      const known = byId.get(id)
      if (known) {
        known.positionSet.add(position)
        continue
      }
      byId.set(id, {
        id,
        phase: list.phase,
        label: item['RowData.DisplayValue.TacticsRoleName'],
        gameId,
        positions: [],
        selectable: true,
        goalkeeper: position === 'GK',
        positionSet: new Set<PositionKey>([position, ...(extra[gameId] ?? [])])
      })
    }
  }
  const roles: CatalogRole[] = [...byId.values()].map(({ positionSet, ...role }) => ({ ...role, positions: [...positionSet] }))
  const roleById = new Map(roles.map((role) => [role.id, role]))
  const choicesAt = (position: PositionKey, phase: Phase): RoleChoice[] =>
    roles.filter((role) => role.phase === phase && role.positions.includes(position)).map((role) => ({ roleId: role.id, evidence: 'game' }))
  return {
    id: 'fm26',
    dataVersion: '26.3.2',
    roles,
    role: (id) => roleById.get(id),
    roleByGameId: (phase, gameId) => roleById.get(`${phase}.${gameId}`),
    baseWeights: () => ({}),
    baseTags: () => ({}),
    choicesAt,
    defaultRole: (position, phase) => choicesAt(position, phase)[0]?.roleId ?? '',
    poolOf: (profile) => [profile.ip.position],
    normKey: (profile) => `${profile.ip.position}|${profile.ip.roleId}|${profile.oop.roleId}|${profile.sharePct}`,
    references: () => [],
    referenceOf: () => undefined,
    legacyMap: () => ({})
  }
}
