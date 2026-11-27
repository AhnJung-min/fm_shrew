import { meanCaAbove, normFromScores, referenceCa, NORM_MIN_RATING, type RoleNorms } from '@shared/norms'
import { POSITION_KEYS } from '@shared/positions'
import { prepareRole, ROLES, savedRoleScore } from '@shared/roles'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from './save/reader'
import type { SaveWorld } from './save/world'

/**
 * 역할별 기준 분포를 세이브 전체에서 구한다(shared/norms.ts가 식이다. 이 파일은 선수를 돌며 점수를 모으기만 한다).
 *
 * 모집단(역할 r) = 세이브의 선수 가운데 { r의 자리 가운데 하나라도 숙련 ≥ 15 } ∩ { 여자가 아님 } 이고,
 * 평균·표준편차는 그 가운데 현재 능력(CA) ≥ 표본용 기준(40명을 채울 때까지 낮춘 c_r)인 선수로, 기울기는 CA ≥ 60인 선수로 구한다.
 * 기준 능력 C* = max(100, 내 1군 상위 11명 CA의 중간값 - 10)는 모든 역할이 같다. 표본을 넓힌 역할은 평균을 C* 이상 선수의 평균에 맞춰 보정한다(4회차).
 *
 * @param female 선수마다 1이면 여자(영입 후보와 모집단에서 뺀다)
 * @param weights 사용자가 고친 역할 가중치
 */
export function computeRoleNorms(world: SaveWorld, weights: Record<string, Record<string, number>>, female: Uint8Array): RoleNorms {
  const mineCa: number[] = []
  if (world.teamId !== undefined) {
    for (let k = 0; k < world.count; k++) if (world.teamIds[k] === world.teamId && world.names[k]) mineCa.push(world.ca[k])
  }
  const startCa = referenceCa(mineCa)
  const positionIndex = new Map<string, number>(POSITION_KEYS.map((key, i) => [key, i]))

  const pools: Array<{ id: string; scores: number[]; abilities: number[]; ids: number[] }> = []
  for (const role of ROLES) {
    const prepared = prepareRole(role.id, weights)
    const slots = role.positions.map((key) => positionIndex.get(key)).filter((index): index is number => index !== undefined)
    const scores: number[] = []
    const abilities: number[] = []
    const ids: number[] = []
    for (let k = 0; k < world.count; k++) {
      if (female[k] || !world.names[k]) continue
      let plays = false
      for (const slot of slots) {
        if (world.positions[k * POSITION_COUNT + slot] >= NORM_MIN_RATING) {
          plays = true
          break
        }
      }
      if (!plays) continue
      scores.push(savedRoleScore(world.attributes, k * ATTRIBUTE_COUNT, prepared))
      abilities.push(world.ca[k])
      ids.push(k)
    }
    pools.push({ id: role.id, scores, abilities, ids })
  }
  // 모든 역할의 풀을 합쳐 C* 이상인 선수의 평균 현재 능력(C̄*). 역할마다 이 값에 맞춰 평균을 보정한다
  const meanCaStar = meanCaAbove(pools, startCa)
  const norms: RoleNorms = {}
  for (const pool of pools) norms[pool.id] = normFromScores(pool.scores, pool.abilities, startCa, meanCaStar)
  return norms
}
