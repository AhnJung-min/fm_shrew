import { K } from '@shared/ledger'
import { ROLE_WEIGHT_MAX, SHARE_SCALE } from '@shared/limits'
import { POSITION_KEYS } from '@shared/positions'
import { prepareWeights, savedRoleScore, toRoleScore, type PreparedRole } from '@shared/roles'
import { compositeWeights, type Weights } from '@shared/slotProfile'
import { SAVE_ATTRIBUTE_ORDER, shownValue } from '@shared/world'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from './save/reader'
import type { SaveWorld } from './save/world'

/**
 * 기준 분포를 빠르게 구하는 데 쓰는 파생 자료(2단계 U5). 한 세이브 세계 하나에 대해 다음 셋을 필요할 때 만들어 둔다.
 * - 풀 목록: 풀(포지션 묶음)마다 그 풀에 드는 선수 순번의 오름차순 목록. 지금과 같은 차례로 더하므로 값이 같다.
 * - "능력치가 다 있는 선수" 표지: 능력치 54개의 저장값이 모두 1 이상인 선수(세이브에서 읽은 선수는 모두 그렇다).
 * - 역할별 정수 합 열: 역할의 가중치가 0~ROLE_WEIGHT_MAX(5)의 정수이면, 선수마다 Σ 가중치 × 게임 표시 능력치(Uint16, 최대 5×20×54 = 5,400).
 *
 * 열 경로의 적합도는 직접 계산(roles.ts의 savedRoleScore)과 끝자리까지 같다. 분자와 분모가 정확한 정수라서(가중치가 정수이고 표시 능력치가 정수)
 * 같은 두 정수의 나눗셈은 같은 값이 나온다. 능력치가 다 있지 않은 선수와 정수가 아니거나 5를 넘는 가중치는 직접 길로 간다.
 * 이 파생 자료는 세이브 안의 값(능력치·숙련·이름·성별)이 바뀌면 낡는다: 부르는 쪽(WorldService)이 값 번호(revision)가 바뀔 때 새로 만든다.
 */

/** 열을 한꺼번에 이만큼까지만 쥐고 있는다(넘으면 비우고 다시 만든다). 역할 89개와 사용자 역할 50개를 다 담고도 남는 수 */
const MAX_COLUMNS = 160

const POSITION_AT: ReadonlyMap<string, number> = new Map(POSITION_KEYS.map((key, i) => [key, i]))
const ATTRIBUTE_KNOWN: ReadonlySet<string> = new Set(SAVE_ATTRIBUTE_ORDER)

/** 세이브의 저장값(0~255) → 게임 표시값(1~20). shownValue와 같은 식이고, 저장값이 1 이상일 때만 쓴다 */
const SHOWN = Uint8Array.from({ length: 256 }, (_, stored) => shownValue(stored))

/** 풀 포지션 묶음의 열쇠: 모르는 이름을 빼고 중복 없이 이름순으로 이은 글자. 같은 포지션 묶음이면 순서와 상관없이 같다 */
export function poolKeyOf(pool: readonly string[]): string {
  return [...new Set(pool)].filter((position) => POSITION_AT.has(position)).sort().join('+')
}

/** 가중치 표의 지문: 점수에 쓰이는 칸(능력치 순번과 가중치, 표에 놓인 차례 그대로)을 이은 글자. 같은 지문이면 어느 선수에게든 같은 점수가 나온다 */
export function weightsKeyOf(weights: Weights): string {
  return prepareWeights(weights)
    .pairs.map(([at, weight]) => `${at}:${weight}`)
    .join(',')
}

/**
 * 열로 셀 수 있는 가중치 표인가: 가중치가 걸린(0 초과) 칸이 모두 세이브에 있는 능력치이고 0~5의 정수이다. 그러면 준비한 꼴을 돌려주고, 아니면 null이다.
 * 0 이하 칸은 점수에 쓰이지 않으니 따지지 않는다.
 */
export function integerRole(weights: Weights): PreparedRole | null {
  for (const [id, weight] of Object.entries(weights)) {
    if (!(weight > 0)) continue
    if (!ATTRIBUTE_KNOWN.has(id) || !Number.isInteger(weight) || weight > ROLE_WEIGHT_MAX) return null
  }
  return prepareWeights(weights)
}

export class ProfileColumns {
  private completeMask: Uint8Array | null = null
  private readonly pools = new Map<string, Int32Array>()
  private readonly columns = new Map<string, Uint16Array>()

  /** female: 선수마다 1이면 여자(풀에서 뺀다) */
  constructor(
    readonly world: SaveWorld,
    private readonly female: Uint8Array
  ) {}

  /** 지금까지 만들어 쥐고 있는 역할별 합 열의 수(열을 썼는지 시험이 확인하는 데 쓴다) */
  get columnCount(): number {
    return this.columns.size
  }

  /** 능력치 54개가 모두 있는(저장값 1 이상) 선수는 1 */
  complete(): Uint8Array {
    if (this.completeMask) return this.completeMask
    const { attributes, count } = this.world
    const mask = new Uint8Array(count)
    for (let k = 0; k < count; k++) {
      const base = k * ATTRIBUTE_COUNT
      let ok = 1
      for (let at = 0; at < ATTRIBUTE_COUNT; at++) {
        if (!(attributes[base + at] >= 1)) {
          ok = 0
          break
        }
      }
      mask[k] = ok
    }
    this.completeMask = mask
    return mask
  }

  /**
   * 풀에 드는 선수 순번(오름차순): 이름이 있고 여자가 아니며, 풀의 포지션 가운데 하나라도 숙련이 NORM_MIN_RATING(15) 이상인 선수.
   * 점수를 낼 수 없는 선수(능력치가 모자란 선수)는 여기서 빼지 않는다. 그건 점수를 낼 때 가린다.
   */
  pool(positions: readonly string[]): Int32Array {
    const key = poolKeyOf(positions)
    const kept = this.pools.get(key)
    if (kept) return kept
    const slots = key === '' ? [] : key.split('+').map((position) => POSITION_AT.get(position)!)
    const { count, names, positions: ratings } = this.world
    const list: number[] = []
    for (let k = 0; k < count; k++) {
      if (this.female[k] || !names[k]) continue
      for (const slot of slots) {
        if (ratings[k * POSITION_COUNT + slot] >= K.NORM_MIN_RATING) {
          list.push(k)
          break
        }
      }
    }
    const found = Int32Array.from(list)
    this.pools.set(key, found)
    return found
  }

  /** 역할(정수 가중치)의 선수별 합 Σ 가중치 × 표시 능력치. 능력치가 다 있는 선수만 값이 있고, 나머지 칸은 쓰지 않는다 */
  sums(role: PreparedRole): Uint16Array {
    const key = role.pairs.map(([at, weight]) => `${at}:${weight}`).join(',')
    const kept = this.columns.get(key)
    if (kept) return kept
    if (this.columns.size >= MAX_COLUMNS) this.columns.clear()
    const complete = this.complete()
    const { attributes, count } = this.world
    const ats = Int32Array.from(role.pairs, ([at]) => at)
    const weights = Int32Array.from(role.pairs, ([, weight]) => weight)
    const column = new Uint16Array(count)
    for (let k = 0; k < count; k++) {
      if (!complete[k]) continue
      const base = k * ATTRIBUTE_COUNT
      let sum = 0
      for (let i = 0; i < ats.length; i++) sum += SHOWN[attributes[base + ats[i]]] * weights[i]
      column[k] = sum
    }
    this.columns.set(key, column)
    return column
  }
}

/** 두 국면의 역할을 섞기 전의 표와 점유 시 비중(0~100). 섞은 프로파일의 점수를 역할별 합 열로 셀 때 쓴다 */
export interface ProfileParts {
  ip: Weights
  oop: Weights
  sharePct: number
}

/** 선수 k의 적합도(0~100). 점수를 낼 수 없는 선수는 null */
export type Scorer = (k: number) => number | null

/**
 * 가중치 표 하나로 선수의 적합도를 내는 함수. 기본은 직접 계산(savedRoleScore)이다.
 * columns와 parts(섞기 전의 두 표와 비중)를 주면, 능력치가 다 있는 선수는 역할별 합 열로 센다:
 *   섞지 않는 경우(compositeWeights가 점유 시 표나 비점유 시 표를 그대로 돌려주는 경우): toRoleScore(S, 가중치 합)
 *   섞는 경우: toRoleScore(s · sOop · S_ip + (100 − s) · sIp · S_oop, 100 · sIp · sOop)   (s = 점유 시 비중)
 * 둘 다 직접 계산이 더하는 정수와 같은 정수로 나누므로 끝자리까지 같다. 열로 셀 수 없는 표(정수가 아니거나 5를 넘음, 모르는 능력치, 비중이 정수가 아님)와
 * 능력치가 다 있지 않은 선수는 직접 길로 간다.
 */
export function scorerOf(world: SaveWorld, weights: Weights, columns: ProfileColumns | null, parts?: ProfileParts): Scorer {
  const attributes = world.attributes
  const prepared = prepareWeights(weights)
  const direct: Scorer = (k) => savedRoleScore(attributes, k * ATTRIBUTE_COUNT, prepared)
  if (!columns || !parts) return direct
  const fast = columnScorer(columns, parts, direct)
  return fast ?? direct
}

function columnScorer(columns: ProfileColumns, parts: ProfileParts, direct: Scorer): Scorer | null {
  const { ip, oop, sharePct } = parts
  const mixed = compositeWeights(ip, oop, sharePct)
  const complete = columns.complete()
  if (mixed === ip || mixed === oop) {
    // 섞지 않는다: 그 역할 하나의 표
    const role = integerRole(mixed)
    if (!role || role.total <= 0) return null
    const sums = columns.sums(role)
    const total = role.total
    return (k) => (complete[k] ? toRoleScore(sums[k], total) : direct(k))
  }
  if (!Number.isInteger(sharePct)) return null
  const first = integerRole(ip)
  const second = integerRole(oop)
  if (!first || !second || first.total <= 0 || second.total <= 0) return null
  const sumsIp = columns.sums(first)
  const sumsOop = columns.sums(second)
  const ipFactor = sharePct * second.total
  const oopFactor = (SHARE_SCALE - sharePct) * first.total
  const total = SHARE_SCALE * first.total * second.total
  return (k) => (complete[k] ? toRoleScore(ipFactor * sumsIp[k] + oopFactor * sumsOop[k], total) : direct(k))
}
