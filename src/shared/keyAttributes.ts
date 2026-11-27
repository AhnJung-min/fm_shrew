import { FIELDS } from './fields'
import { parsePositions } from './positions'
import { effectiveWeights, ROLES } from './roles'

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

/** 역할 하나에서 가중치가 걸린 능력치. 무거운 것부터, 같으면 게임 화면 순서 */
export function keyAttributesOf(roleId: string, overrides: Record<string, Record<string, number>>): KeyAttribute[] {
  return Object.entries(effectiveWeights(roleId, overrides))
    .filter(([id, weight]) => weight > 0 && SCREEN_ORDER.has(id))
    .sort(([a, x], [b, y]) => y - x || atScreen(a) - atScreen(b))
    .map(([id, weight]) => ({ id, weight, core: weight >= KEY_WEIGHT_MIN }))
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
 * 포지션 묶음의 주요 능력치. 그 묶음의 자리를 맡는 역할들의 가중치를 평균해(안 쓰는 역할은 0),
 * 평균이 GROUP_WEIGHT_MIN 이상인 능력치만 무거운 것부터 놓는다. 평균이 KEY_WEIGHT_MIN 이상이면 핵심이다.
 * 역할마다 다 합치면(한 역할이라도 쓰는 능력치) 20개 가까이 되어 다시 길어지므로 평균으로 고른다.
 */
export function groupKeyAttributes(group: PositionGroup, overrides: Record<string, Record<string, number>>): KeyAttribute[] {
  const roles = ROLES.filter((role) => role.positions.some((position) => group.positions.includes(position)))
  if (roles.length === 0) return []
  const total = new Map<string, number>()
  for (const role of roles) {
    for (const [id, weight] of Object.entries(effectiveWeights(role.id, overrides))) {
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
