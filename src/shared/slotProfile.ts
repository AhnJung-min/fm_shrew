import { K } from './ledger'
import { SHARE_SCALE } from './limits'
import { posPenaltySigma } from './positions'
import type { PositionKey } from './roles'

/**
 * 자리 프로파일(2단계): 한 자리가 점유 시와 비점유 시에 각각 어떤 포지션·역할이고, 둘을 어떤 비율로 섞어 보는가.
 * 오늘의 계산은 "두 국면의 포지션·역할이 같고 점유 시 비중이 100인 자리 프로파일"이라는 특별한 경우다.
 *
 * 이 모듈은 순수 계산이다(점유 시·비점유 시 가중치 섞기, 포지션 숙련 감점 섞기, 묶음 id, 비중 글).
 *
 * 합성 가중치(정수 산술)
 *   sIp, sOop = 각 역할의 양수 가중치 합,  s = 점유 시 비중(0~SHARE_SCALE 정수)
 *   w_i = s · wIp_i · sOop + (SHARE_SCALE − s) · wOop_i · sIp
 * 요구서의 식(두 역할의 가중치를 합 1로 맞춘 뒤 비중으로 섞는다)에 SHARE_SCALE · sIp · sOop를 곱한 것이다. 적합도는 가중치의 비율만 보므로 값이 같다.
 * 가중치(0~5 정수)와 능력치(1~20)가 정수이면 분자와 분모가 정확한 정수라서(크기는 2^31 안), 정확한 몫이 같은 두 나눗셈은 끝자리까지 같다.
 * 그래도 증명에만 기대지 않고 짧은 길을 둔다: 비중이 가득이거나 두 표가 같으면 섞지 않고 점유 시 표를 그대로 돌려준다.
 */

export type Phase = 'ip' | 'oop'
/** 능력치 id → 가중치 */
export type Weights = Readonly<Record<string, number>>
export interface PhaseSpot {
  position: PositionKey
  roleId: string
}
/** 자리 프로파일. sharePct는 점유 시 몫(0~100 정수). 60 = "공 소유 시 60 : 공 미소유 시 40" */
export interface SlotProfile {
  ip: PhaseSpot
  oop: PhaseSpot
  sharePct: number
}
/** 한 선수의 두 국면 숙련(모르면 둘 다 RATING_UNKNOWN_ASSUMED) */
export interface SlotRatings {
  ip: number
  oop: number
  sharePct: number
}
/** 숫자를 주면 지금 뜻 그대로(한 국면의 숙련)이고, SlotRatings를 주면 두 국면을 섞는다 */
export type RatingInput = number | SlotRatings

const positiveSum = (weights: Weights): number => {
  let total = 0
  for (const value of Object.values(weights)) if (value > 0) total += value
  return total
}

/** 양수 항목이 모두 같은 두 표인가(0 이하 항목은 없는 것으로 본다) */
function sameWeights(a: Weights, b: Weights): boolean {
  if (a === b) return true
  const keys = Object.keys(a).filter((key) => a[key] > 0)
  return keys.length === Object.keys(b).filter((key) => b[key] > 0).length && keys.every((key) => b[key] === a[key])
}

/**
 * 점유 시 표와 비점유 시 표를 비중으로 섞은 가중치.
 * 짧은 길(섞지 않고 그 표 객체를 그대로 돌려준다)을 이 차례로 본다: 비중이 가득(SHARE_SCALE 이상)이면 점유 시 표, 두 표가 같으면 점유 시 표,
 * 비중이 0 이하이면 비점유 시 표, 한쪽 합이 0이면 다른 쪽 표. 음수 가중치는 0으로 본다.
 * 끝값은 이 차례를 따른다(표의 합이 0인지보다 비중을 먼저 본다): 비중이 가득이면 점유 시 표의 합이 0이어도 그 표를 돌려주고(그 자리는 적합도가 나오지 않는다),
 * 비중 99면 점유 시 합이 0이라 비점유 시 표를 돌려준다. 비중 0과 비점유 시 표, 비중 1도 같은 식이다. 두 표의 합이 모두 0이면 두 표가 같은 것으로 보아 점유 시 표를 돌려준다.
 */
export function compositeWeights(ip: Weights, oop: Weights, sharePct: number): Weights {
  if (!(sharePct < SHARE_SCALE)) return ip
  if (sameWeights(ip, oop)) return ip
  if (!(sharePct > 0)) return oop
  const sumIp = positiveSum(ip)
  const sumOop = positiveSum(oop)
  if (sumIp <= 0) return oop
  if (sumOop <= 0) return ip
  const mixed: Record<string, number> = {}
  for (const [attribute, weight] of Object.entries(ip)) if (weight > 0) mixed[attribute] = sharePct * weight * sumOop
  for (const [attribute, weight] of Object.entries(oop)) if (weight > 0) mixed[attribute] = (mixed[attribute] ?? 0) + (SHARE_SCALE - sharePct) * weight * sumIp
  return mixed
}

/**
 * 두 국면의 포지션 숙련을 비중으로 섞은 감점(그 프로파일 기준 분포의 표준편차의 배수).
 *   비중이 가득이거나 두 숙련이 같으면 점유 시 숙련의 감점 그대로(지금 값과 끝자리까지 같다), 비중이 0 이하이면 비점유 시 숙련의 감점,
 *   그 밖에는 (s · p(rIp) + (SHARE_SCALE − s) · p(rOop)) / SHARE_SCALE.
 * 0.6p + 0.4p가 p와 끝자리가 다를 수 있어서 같은 숙련이면 섞지 않는다.
 */
export function mixedPenaltySigma(rIp: number, rOop: number, sharePct: number): number {
  if (!(sharePct < SHARE_SCALE) || rIp === rOop) return posPenaltySigma(rIp)
  if (!(sharePct > 0)) return posPenaltySigma(rOop)
  return (sharePct * posPenaltySigma(rIp) + (SHARE_SCALE - sharePct) * posPenaltySigma(rOop)) / SHARE_SCALE
}

/** 숙련 입력에서 감점(표준편차의 배수)을 꺼낸다. 숫자는 지금 뜻 그대로, 두 국면 숙련은 섞는다 */
export function penaltySigmaOf(rating: RatingInput): number {
  return typeof rating === 'number' ? posPenaltySigma(rating) : mixedPenaltySigma(rating.ip, rating.oop, rating.sharePct)
}

/** 뛸 자격과 10 미만 곱셈 보정에 쓰는 숙련. 점유 시 숙련만 본다(측면 공격수의 절반이 비점유 시에는 측면 미드라 비점유 시로 가르면 자리가 빈다) */
export function gateRatingOf(rating: RatingInput): number {
  return typeof rating === 'number' ? rating : rating.ip
}

/** 두 국면의 포지션·역할이 같은 프로파일인가(오늘의 계산이 다루는 모양. 비중은 보지 않는다) */
export function isSinglePhase(profile: SlotProfile): boolean {
  return profile.ip.position === profile.oop.position && profile.ip.roleId === profile.oop.roleId
}

/**
 * 같은 프로파일(점유 시 포지션·역할, 비점유 시 포지션·역할)의 자리를 한 묶음으로 보는 id. 두 국면이 같으면 지금 꼴 `${포지션}:${역할}`,
 * 다르면 `${점유 시 포지션}:${점유 시 역할}~${비점유 시 포지션}:${비점유 시 역할}`. 같은 전술 안에서는 비중이 하나라 id에 넣지 않는다.
 */
export function groupIdOf(profile: SlotProfile): string {
  const ip = `${profile.ip.position}:${profile.ip.roleId}`
  return isSinglePhase(profile) ? ip : `${ip}~${profile.oop.position}:${profile.oop.roleId}`
}

/** 전술에 비중을 적지 않았을 때 쓰는 점유 시 비중(대장의 IP_SHARE_DEFAULT를 그때그때 읽는다) */
export function defaultSharePct(): number {
  return Math.round(K.IP_SHARE_DEFAULT * SHARE_SCALE)
}

/** "공 소유 시 60 : 공 미소유 시 40"(게임 한국어판의 국면 이름). 화면 글은 이 한 함수로 만든다 */
export function shareLabel(sharePct: number): string {
  return `공 소유 시 ${sharePct} : 공 미소유 시 ${SHARE_SCALE - sharePct}`
}
