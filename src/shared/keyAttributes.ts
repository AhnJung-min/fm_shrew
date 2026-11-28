import { FIELDS } from './fields'
import { SHARE_SCALE } from './limits'
import { parsePositions } from './positions'
import { effectiveRoleWeights, LEGACY_CATALOG, type RoleCatalog, type RoleOverrides } from './roleCatalog'
import { effectiveWeights } from './roles'
import { compositeWeights, type SlotProfile } from './slotProfile'

/**
 * 표에서 "주요 능력치만" 볼 때 쓰는 능력치 목록.
 * 역할의 가중치(기본은 핵심 4, 도움 2. 설정에서 고친 값을 따른다)가 걸린 능력치만, 무거운 것부터 놓는다.
 * 보여 줄 열을 고르는 데만 쓰고 점수 계산에는 쓰지 않는다.
 */

export interface KeyAttribute {
  /** 능력치 id(FIELDS의 id) */
  id: string
  weight: number
  /** 핵심 능력치인지(아니면 도움) */
  core: boolean
}

/** 이 가중치부터 "핵심"으로 묶어 보여 준다(기본 역할은 핵심 4, 도움 2의 가운데). 화면 묶음의 경계일 뿐 점수에는 영향이 없다 */
export const KEY_WEIGHT_MIN = 3

/** 게임 화면 순서(기술 → 정신 → 신체 → 골키퍼)에서 능력치의 자리 */
const SCREEN_ORDER = new Map(FIELDS.filter((field) => field.isAttr).map((field, index) => [field.id, index]))

const atScreen = (id: string): number => SCREEN_ORDER.get(id) ?? Number.MAX_SAFE_INTEGER

/** 가중치 표에서 가중치가 걸린 능력치. 무거운 것부터, 같으면 게임 화면 순서 */
function keyAttributesFrom(weights: Readonly<Record<string, number>>): KeyAttribute[] {
  return Object.entries(weights)
    .filter(([id, weight]) => weight > 0 && SCREEN_ORDER.has(id))
    .sort(([a, x], [b, y]) => y - x || atScreen(a) - atScreen(b))
    .map(([id, weight]) => ({ id, weight, core: weight >= KEY_WEIGHT_MIN }))
}

/** 역할 하나에서 가중치가 걸린 능력치(옛 14역할). 무거운 것부터, 같으면 게임 화면 순서 */
export function keyAttributesOf(roleId: string, overrides: Record<string, Record<string, number>>): KeyAttribute[] {
  return keyAttributesFrom(effectiveWeights(roleId, overrides))
}

/** 양수 가중치의 합 */
const positiveSum = (weights: Readonly<Record<string, number>>): number => Object.values(weights).reduce((sum, weight) => (weight > 0 ? sum + weight : sum), 0)

/**
 * 자리 프로파일에서 가중치가 걸린 능력치: 두 국면 역할의 가중치를 비중으로 섞은 표(compositeWeights)에서 무거운 것부터, 같으면 게임 화면 순서.
 * 섞지 않는 경우(두 국면의 역할이 같거나, 두 표가 같거나, 비중이 100 또는 0)는 그 역할의 가중치 그대로라 keyAttributesOf와 같다.
 * 정말 섞였을 때는 합성 가중치가 눈금이 크므로(정수 산술로 합이 수천이다) 역할의 눈금(0~5)으로 되돌려 적는다: 두 역할의 가중치를 각자의 합으로 나눠
 * 비중대로 섞은 몫에, 두 역할의 가중치 합을 같은 비중으로 섞은 값을 곱한다(한 자리까지). 그래서 핵심(KEY_WEIGHT_MIN 이상) 구분과 "가중치 ○" 설명이 역할 화면과 같은 눈금이다.
 * 순서는 합성 가중치 그대로다.
 */
export function profileKeyAttributes(catalog: RoleCatalog, profile: SlotProfile, overrides: RoleOverrides): KeyAttribute[] {
  const ip = effectiveRoleWeights(catalog, profile.ip.roleId, overrides)
  const oop = effectiveRoleWeights(catalog, profile.oop.roleId, overrides)
  const mixed = profile.oop.roleId === profile.ip.roleId ? ip : compositeWeights(ip, oop, profile.sharePct)
  const ranked = keyAttributesFrom(mixed)
  if (mixed === ip || mixed === oop) return ranked
  const sumIp = positiveSum(ip)
  const sumOop = positiveSum(oop)
  const unit = (profile.sharePct * sumIp + (SHARE_SCALE - profile.sharePct) * sumOop) / SHARE_SCALE / (SHARE_SCALE * sumIp * sumOop)
  return ranked.map((key) => {
    const weight = Math.round(key.weight * unit * 10) / 10
    return { id: key.id, weight, core: weight >= KEY_WEIGHT_MIN }
  })
}

/** 스쿼드 표에서 고르는 포지션 묶음 */
export interface PositionGroup {
  id: 'gk' | 'def' | 'mid' | 'att'
  label: string
  /** 이 묶음에 드는 자리(positions.ts의 POSITION_KEYS) */
  positions: string[]
}

export const POSITION_GROUPS: PositionGroup[] = [
  { id: 'gk', label: '골키퍼', positions: ['GK'] },
  { id: 'def', label: '수비', positions: ['SW', 'DL', 'DC', 'DR', 'WBL', 'WBR'] },
  { id: 'mid', label: '미드필더', positions: ['DM', 'ML', 'MC', 'MR'] },
  { id: 'att', label: '공격', positions: ['AML', 'AMC', 'AMR', 'ST'] }
]

/** 포지션 묶음에서 이 평균 가중치(그 묶음 역할들의 평균, 안 쓰는 역할은 0)부터 보여 준다. 기본 역할의 "도움" 가중치와 같다 */
export const GROUP_WEIGHT_MIN = 2

/**
 * 포지션 묶음의 주요 능력치. 그 묶음의 자리를 맡을 수 있는 역할들의 가중치를 평균해(안 쓰는 역할은 0),
 * 평균이 GROUP_WEIGHT_MIN 이상인 능력치만 무거운 것부터 놓는다. 평균이 KEY_WEIGHT_MIN 이상이면 핵심이다.
 * 역할마다 다 합치면(한 역할이라도 쓰는 능력치) 20개 가까이 되어 다시 길어지므로 평균으로 고른다.
 * 카탈로그가 점유 시·비점유 시 역할을 따로 두면 점유 시 역할(국면이 없는 옛 역할 포함)만 센다: 표의 포지션 묶음 보기는 점유 시 자리로 본다.
 * 카탈로그를 주지 않으면 옛 14역할이다.
 */
export function groupKeyAttributes(group: PositionGroup, overrides: Record<string, Record<string, number>>, catalog: RoleCatalog = LEGACY_CATALOG): KeyAttribute[] {
  const roles = catalog.roles.filter((role) => role.selectable && role.phase !== 'oop' && role.positions.some((position) => group.positions.includes(position)))
  if (roles.length === 0) return []
  const total = new Map<string, number>()
  for (const role of roles) {
    for (const [id, weight] of Object.entries(effectiveRoleWeights(catalog, role.id, overrides))) {
      if (weight > 0 && SCREEN_ORDER.has(id)) total.set(id, (total.get(id) ?? 0) + weight)
    }
  }
  return [...total.entries()]
    .map(([id, sum]) => ({ id, weight: Math.round((sum / roles.length) * 10) / 10 }))
    .filter((each) => each.weight >= GROUP_WEIGHT_MIN)
    .sort((a, b) => b.weight - a.weight || atScreen(a.id) - atScreen(b.id))
    .map((each) => ({ ...each, core: each.weight >= KEY_WEIGHT_MIN }))
}

/** 포지션 표기("D (RC), WB (R)")에 이 묶음의 자리가 하나라도 있는지 */
export function playsInGroup(positionLabel: string, group: PositionGroup): boolean {
  return parsePositions(positionLabel).some((position) => group.positions.includes(position))
}
