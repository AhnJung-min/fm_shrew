import { normFromScores, referenceCa, type RoleNorm, type RoleNorms } from '@shared/norms'
import { LEGACY_CATALOG, referenceSpec, type NormSpec } from '@shared/roleCatalog'
import { hasEnoughCoverage, prepareWeights, type PreparedRole } from '@shared/roles'
import { ATTRIBUTE_COUNT } from './save/reader'
import type { SaveWorld } from './save/world'
import { poolKeyOf, ProfileColumns, scorerOf, type ProfileParts } from './profileColumns'

/**
 * 프로파일별 기준 분포를 세이브 전체에서 구한다(shared/norms.ts가 식이다. 이 파일은 선수를 돌며 점수를 모으기만 한다).
 *
 * 요청 하나(NormSpec: 열쇠, 풀 포지션, 합성 가중치)에 기준 분포 하나다.
 * 모집단 = 세이브의 선수 가운데 { 풀 포지션 가운데 하나라도 숙련 ≥ 15 } ∩ { 여자가 아님 } ∩ { 이름이 있음 } ∩ { 점수를 낼 수 있음(능력치 60% 이상) }.
 * 평균·표준편차는 그 가운데 현재 능력(CA) ≥ 표본용 기준(40명을 채울 때까지 낮춘 c_r)인 선수로, 기울기는 CA ≥ 60인 선수로 구한다.
 * 기준 능력 C* = max(100, 내 1군 상위 11명 CA의 중간값 - 10)는 모든 요청이 같다. 표본을 넓힌 요청은 평균을 C* 이상 선수의 평균에 맞춰 보정한다(4회차).
 * 성장 예측용 기울기 β_grow(5회차)도 같은 풀에서 현재 능력 110~180인 선수로 구해 `RoleNorm.betaGrow`에 싣는다(식은 norms.ts의 betaGrowFromScores).
 *
 * C̄*(보정에 쓰는 평균 현재 능력)는 "기준 목록(refs)의 풀 합집합에서 C* 이상인 선수의 평균 현재 능력"이다. 전술과 상관없이 세계마다 하나다.
 * 옛 14역할은 refs가 14역할이라 지금과 같은 계산이고, FM26은 점유 시 역할 40개라 합집합이 사실상 "어느 포지션이든 숙련 15 이상"이다.
 *
 * 풀 목록과 역할별 합 열은 ProfileColumns가 한 번 만들어 쥐고 있는다. 선수를 도는 차례(순번 오름차순)가 옛 계산과 같아 값이 끝자리까지 같다.
 */

/** 기준 분포 요청 하나. 두 국면의 역할을 섞은 프로파일이면 섞기 전의 두 표와 비중(parts)을 함께 주어, 역할별 합 열로 빠르게 셀 수 있게 한다 */
export interface ProfileNormSpec extends NormSpec {
  parts?: ProfileParts
}

/** 기준 능력의 시작값 C*: 내 1군 선수(이름이 있는 선수) 상위 11명 현재 능력의 중간값 - 10(최저 100) */
export function startCaOf(world: SaveWorld): number {
  const mineCa: number[] = []
  if (world.teamId !== undefined) {
    for (let k = 0; k < world.count; k++) if (world.teamIds[k] === world.teamId && world.names[k]) mineCa.push(world.ca[k])
  }
  return referenceCa(mineCa)
}

/** 이 선수가 이 역할의 적합도를 낼 수 있는가(값이 있는 능력치의 가중치 합이 60% 이상): savedRoleScore가 null이 아닌 것과 같다 */
function scorable(attributes: ArrayLike<number>, offset: number, role: PreparedRole): boolean {
  let covered = 0
  for (const [at, weight] of role.pairs) if (attributes[offset + at] >= 1) covered += weight
  return hasEnoughCoverage(covered, role.total)
}

/**
 * C̄*: 기준 목록(refs)의 풀 합집합(선수 중복 제거)에서 현재 능력이 startCa(C*) 이상인 선수의 평균 현재 능력. 그런 선수가 없으면 undefined.
 * 한 선수가 합집합에 드는 것은 어느 한 요청의 풀에 들고 그 요청의 가중치로 점수를 낼 수 있을 때다(옛 계산이 요청마다 풀을 만들 때와 같다).
 */
export function meanCaStarOf(world: SaveWorld, columns: ProfileColumns, refs: readonly NormSpec[], startCa: number): number | undefined {
  const groups = new Map<string, { pool: readonly string[]; roles: PreparedRole[] }>()
  for (const ref of refs) {
    const key = poolKeyOf(ref.pool)
    const group = groups.get(key) ?? { pool: ref.pool, roles: [] }
    group.roles.push(prepareWeights(ref.weights))
    groups.set(key, group)
  }
  const seen = new Uint8Array(world.count)
  let sum = 0
  let count = 0
  for (const { pool, roles } of groups.values()) {
    for (const k of columns.pool(pool)) {
      if (seen[k] || world.ca[k] < startCa) continue
      const offset = k * ATTRIBUTE_COUNT
      if (!roles.some((role) => scorable(world.attributes, offset, role))) continue
      seen[k] = 1
      sum += world.ca[k]
      count++
    }
  }
  return count === 0 ? undefined : sum / count
}

/**
 * 요청 하나의 기준 분포. fast가 참이고 요청에 parts가 있으면 능력치가 다 있는 선수의 점수를 역할별 합 열로 센다(직접 계산과 끝자리까지 같다).
 * 모집단의 점수와 현재 능력은 선수 순번 오름차순으로 모은다(옛 계산과 같은 차례).
 */
export function normOfSpec(world: SaveWorld, columns: ProfileColumns, spec: ProfileNormSpec, startCa: number, meanCaStar: number | undefined, fast: boolean): RoleNorm {
  const pool = columns.pool(spec.pool)
  const score = scorerOf(world, spec.weights, fast ? columns : null, spec.parts)
  const scores = new Float64Array(pool.length)
  const abilities = new Uint16Array(pool.length)
  let n = 0
  for (let i = 0; i < pool.length; i++) {
    const k = pool[i]
    // 능력치가 모자라 적합도를 못 구하는 선수(60% 규칙, 세이브에서는 일어나지 않는다)는 모집단에서 뺀다
    const value = score(k)
    if (value === null) continue
    scores[n] = value
    abilities[n] = world.ca[k]
    n++
  }
  return normFromScores(scores.subarray(0, n), abilities.subarray(0, n), startCa, meanCaStar)
}

/**
 * 요청마다 기준 분포(열쇠 = 요청의 key)를 세이브 전체에서 구한다. 캐시 없이 한 번 계산하는 순수한 함수다(캐시는 WorldService가 쥔다).
 *
 * @param specs 구할 요청들(열쇠, 풀 포지션, 합성 가중치)
 * @param female 선수마다 1이면 여자(모집단과 영입 후보에서 뺀다)
 * @param refs C̄*를 구할 기준 목록의 요청들(옛 14역할이면 specs와 같다)
 * @param columns 주면 풀 목록과 합 열을 이것으로 쥔다(능력치가 다 있는 선수는 열로 센다). 없으면 직접 계산한다
 */
export function computeProfileNorms(world: SaveWorld, specs: readonly NormSpec[], female: Uint8Array, refs: readonly NormSpec[], columns?: ProfileColumns): RoleNorms {
  const data = columns ?? new ProfileColumns(world, female)
  const startCa = startCaOf(world)
  const meanCaStar = meanCaStarOf(world, data, refs, startCa)
  const norms: RoleNorms = {}
  for (const spec of specs) norms[spec.key] = normOfSpec(world, data, spec, startCa, meanCaStar, columns !== undefined)
  return norms
}

/**
 * 옛 14역할의 기준 분포: 옛 참조 14개를 넘기는 껍데기다(열쇠는 역할 id, 풀은 역할이 놓이는 포지션, 가중치는 사용자가 고친 값을 덮은 역할 표).
 *
 * @param weights 사용자가 고친 역할 가중치
 */
export function computeRoleNorms(world: SaveWorld, weights: Record<string, Record<string, number>>, female: Uint8Array): RoleNorms {
  const specs = LEGACY_CATALOG.references('ip').map((ref) => referenceSpec(LEGACY_CATALOG, ref, weights))
  return computeProfileNorms(world, specs, female, specs)
}
