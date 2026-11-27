import { K } from './ledger'
import type { ColumnInfo, PlayerRow } from './types'
import { SAVE_ATTRIBUTE_ORDER, shownValue } from './world'

/** 포지션 한 자리. 세이브의 숙련도 순서(positions.ts)와 같은 이름을 쓴다. */
export type PositionKey =
  | 'GK' | 'DL' | 'DC' | 'DR' | 'WBL' | 'WBR' | 'DM' | 'ML' | 'MC' | 'MR' | 'AML' | 'AMC' | 'AMR' | 'ST'

export interface RoleDef {
  id: string
  label: string
  /** 이 역할을 맡을 수 있는 자리 */
  positions: PositionKey[]
  /** 능력치 id → 가중치(0~5). 4는 핵심, 2는 도움이 되는 능력치 */
  weights: Record<string, number>
}

const role = (id: string, label: string, positions: PositionKey[], key: string[], helpful: string[]): RoleDef => ({
  id,
  label,
  positions,
  weights: Object.fromEntries([...key.map((a) => [a, 4]), ...helpful.map((a) => [a, 2])])
})

/**
 * 기본 역할 프리셋.
 * 게임 내부 계산식이 아니라, 각 역할에 흔히 중요하다고 보는 능력치로 직접 짠 것이다.
 * 설정 화면에서 가중치를 고칠 수 있다.
 *
 * 검토 1회차에서 "도움(2)"으로 더한 능력치: 가속·민첩(거의 모든 역할), 속력(수비형 미드·딥라잉·플레이메이커·공격형 미드·타깃맨),
 * 결단력(풀백·윙백), 힘(풀백). 근거: 세이브 전체에서 현재 능력(CA)을 능력치로 회귀하면 이 능력치들이 크게 걸린다
 * (위치군별 R² 0.97~0.99). 게임의 역할 화면 표시와는 아직 대조하지 않았다. 이미 핵심(4)이거나 도움(2)으로 있던 것은 그대로 두었다.
 */
export const ROLES: RoleDef[] = [
  role('gk', '골키퍼', ['GK'],
    ['handling', 'reflexes', 'oneOnOnes', 'commandOfArea', 'aerialReach', 'positioning', 'concentration'],
    ['communication', 'kicking', 'agility', 'decisions', 'anticipation', 'throwing']),
  role('cb', '센터백', ['DC'],
    ['marking', 'tackling', 'heading', 'positioning', 'jumping', 'strength'],
    ['anticipation', 'concentration', 'bravery', 'composure', 'pace', 'decisions', 'acceleration', 'agility']),
  role('bpd', '볼 플레잉 센터백', ['DC'],
    ['marking', 'tackling', 'positioning', 'passing', 'composure', 'heading'],
    ['firstTouch', 'technique', 'vision', 'anticipation', 'jumping', 'strength', 'pace', 'decisions', 'acceleration', 'agility']),
  role('fb', '풀백', ['DL', 'DR'],
    ['tackling', 'marking', 'positioning', 'pace', 'stamina', 'workRate'],
    ['crossing', 'anticipation', 'concentration', 'acceleration', 'teamwork', 'passing', 'determination', 'agility', 'strength']),
  role('wb', '윙백', ['DL', 'DR', 'WBL', 'WBR'],
    ['crossing', 'stamina', 'workRate', 'pace', 'acceleration', 'tackling'],
    ['dribbling', 'offTheBall', 'teamwork', 'marking', 'positioning', 'technique', 'passing', 'determination', 'agility']),
  role('dm', '수비형 미드필더', ['DM'],
    ['tackling', 'positioning', 'anticipation', 'workRate', 'teamwork', 'concentration'],
    ['marking', 'passing', 'stamina', 'strength', 'decisions', 'composure', 'bravery', 'acceleration', 'agility', 'pace']),
  role('dlp', '딥라잉 플레이메이커', ['DM', 'MC'],
    ['passing', 'vision', 'firstTouch', 'technique', 'composure', 'decisions'],
    ['teamwork', 'anticipation', 'positioning', 'tackling', 'acceleration', 'agility', 'pace']),
  role('b2b', '박스 투 박스', ['MC'],
    ['stamina', 'workRate', 'passing', 'tackling', 'offTheBall', 'teamwork'],
    ['firstTouch', 'decisions', 'anticipation', 'strength', 'longShots', 'dribbling', 'positioning', 'pace', 'acceleration', 'agility']),
  role('ap', '플레이메이커', ['MC', 'AMC'],
    ['passing', 'vision', 'technique', 'firstTouch', 'decisions', 'flair'],
    ['composure', 'offTheBall', 'dribbling', 'anticipation', 'teamwork', 'agility', 'pace']),
  role('am', '공격형 미드필더', ['AMC'],
    ['offTheBall', 'firstTouch', 'technique', 'passing', 'anticipation', 'finishing'],
    ['dribbling', 'longShots', 'composure', 'vision', 'flair', 'decisions', 'acceleration', 'pace', 'agility']),
  role('winger', '윙어', ['ML', 'MR', 'AML', 'AMR'],
    ['crossing', 'dribbling', 'pace', 'acceleration', 'technique', 'agility'],
    ['offTheBall', 'firstTouch', 'flair', 'stamina', 'workRate', 'passing', 'balance']),
  role('if', '인사이드 포워드', ['AML', 'AMR'],
    ['dribbling', 'finishing', 'offTheBall', 'acceleration', 'technique', 'firstTouch'],
    ['pace', 'composure', 'agility', 'longShots', 'anticipation', 'flair', 'passing', 'balance']),
  role('st', '스트라이커', ['ST'],
    ['finishing', 'offTheBall', 'composure', 'anticipation', 'firstTouch', 'acceleration'],
    ['pace', 'heading', 'dribbling', 'technique', 'decisions', 'strength', 'balance']),
  role('tm', '타깃맨', ['ST'],
    ['heading', 'jumping', 'strength', 'finishing', 'firstTouch', 'bravery'],
    ['offTheBall', 'composure', 'teamwork', 'anticipation', 'balance', 'passing', 'aggression', 'acceleration', 'pace', 'agility'])
]

export const ROLE_BY_ID: Record<string, RoleDef> = Object.fromEntries(ROLES.map((r) => [r.id, r]))

/** 자리마다 처음에 고르는 역할 */
export const DEFAULT_ROLE: Record<PositionKey, string> = {
  GK: 'gk', DL: 'fb', DC: 'cb', DR: 'fb', WBL: 'wb', WBR: 'wb', DM: 'dm',
  ML: 'winger', MC: 'b2b', MR: 'winger', AML: 'if', AMC: 'am', AMR: 'if', ST: 'st'
}

export function rolesFor(position: PositionKey): RoleDef[] {
  return ROLES.filter((r) => r.positions.includes(position))
}

/** 사용자가 고친 가중치를 기본값 위에 덮어쓴다. */
export function effectiveWeights(roleId: string, overrides: Record<string, Record<string, number>>): Record<string, number> {
  return { ...(ROLE_BY_ID[roleId]?.weights ?? {}), ...(overrides[roleId] ?? {}) }
}

export interface AttributeValue {
  value: number
  /** 스카우트 정보가 부족해 범위로 나온 값인지 */
  ranged: boolean
}

/** 한 선수의 능력치를 항목 id로 꺼낸다. */
export function attributesOf(row: PlayerRow, columns: ColumnInfo[]): Record<string, AttributeValue> {
  const found: Record<string, AttributeValue> = {}
  for (const col of columns) {
    if (!col.isAttr || !col.field) continue
    const cell = row.cells[col.header]
    if (cell?.num !== null && cell?.num !== undefined) found[col.field] = { value: cell.num, ranged: Boolean(cell.range) }
  }
  return found
}

export interface RoleScore {
  /** 0~100. 능력치(1~20)의 가중 평균을 100점으로 환산한 값 */
  score: number
  /** 범위로 나온 능력치가 계산에 들어갔는지 */
  uncertain: boolean
}

/**
 * 값이 있는 능력치의 가중치 합(covered)이 전체(total)의 K.ROLE_COVERAGE_MIN(60%) 이상이어야 적합도를 판단한다.
 * 표 경로(scoreRole)와 세이브 경로(savedRoleScore)가 같은 규칙을 쓰도록 하나로 둔다(F-08).
 */
export function hasEnoughCoverage(covered: number, total: number): boolean {
  return total > 0 && covered / total >= K.ROLE_COVERAGE_MIN
}

/**
 * 역할 적합도. 가중치가 걸린 능력치 가운데 값이 있는 것만으로 계산하고,
 * 가진 값이 가중치 합의 60%에 못 미치면 판단하지 않는다(null).
 */
export function scoreRole(attrs: Record<string, AttributeValue>, weights: Record<string, number>): RoleScore | null {
  let total = 0
  let covered = 0
  let sum = 0
  let uncertain = false
  for (const [id, weight] of Object.entries(weights)) {
    if (weight <= 0) continue
    total += weight
    const attr = attrs[id]
    if (!attr) continue
    covered += weight
    sum += attr.value * weight
    if (attr.ranged) uncertain = true
  }
  if (!hasEnoughCoverage(covered, total)) return null
  return { score: toRoleScore(sum, covered), uncertain }
}

/**
 * 역할 적합도(0~100)를 만드는 식 하나. 능력치(1~20)에 가중치를 곱해 더한 값을 가중치 합으로 나눠 20으로 나누고
 * 100을 곱해 소수 첫째 자리까지. 스쿼드의 적합도, 뎁스 차트, 전술판, 영입 후보가 모두 이 식을 쓴다.
 */
export function toRoleScore(weightedSum: number, weightTotal: number): number {
  return Math.round((weightedSum / weightTotal / 20) * 1000) / 10
}

/** 세이브의 능력치 순서(SAVE_ATTRIBUTE_ORDER)로 바꿔 둔 역할 가중치. 선수 수만 번 계산할 때 쓴다 */
export interface PreparedRole {
  /** [능력치 순번, 가중치] */
  pairs: Array<[number, number]>
  total: number
}

const ATTRIBUTE_AT = new Map<string, number>(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))

export function prepareRole(roleId: string, overrides: Record<string, Record<string, number>>): PreparedRole {
  const pairs: Array<[number, number]> = []
  let total = 0
  for (const [id, weight] of Object.entries(effectiveWeights(roleId, overrides))) {
    const at = ATTRIBUTE_AT.get(id)
    if (at === undefined || weight <= 0) continue
    pairs.push([at, weight])
    total += weight
  }
  return { pairs, total }
}

/**
 * 세이브에 저장된 능력치(1~100, 선수마다 능력치 수만큼 이어짐)로 역할 적합도를 구한다.
 * 저장값을 게임 표시값(1~20)으로 바꿔 계산하므로 표(squadTable)의 값으로 scoreRole을 부른 것과 같은 수가 나온다.
 * 저장값이 1 미만이거나 없는 능력치는 값이 없는 것으로 보고, 표 경로와 같은 60% 규칙(hasEnoughCoverage)으로 가린다(null).
 * 세이브에는 능력치 54개가 다 있으므로 읽은 선수의 결과는 이 규칙이 생기기 전과 같다.
 */
export function savedRoleScore(attributes: ArrayLike<number>, offset: number, role: PreparedRole): number | null {
  let sum = 0
  let covered = 0
  for (const [at, weight] of role.pairs) {
    const stored = attributes[offset + at]
    if (!(stored >= 1)) continue
    sum += shownValue(stored) * weight
    covered += weight
  }
  if (!hasEnoughCoverage(covered, role.total)) return null
  return toRoleScore(sum, covered)
}
