import type { SaveCheck } from '@shared/connect'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from './save/reader'
import { NO_TEAM, type SaveWorld } from './save/world'

/**
 * 세이브 형식 자가 점검(A-16). 게임이 업데이트되어 세이브의 구조가 바뀌면 파서는 오류 없이 엉뚱한 값을 뽑아 올 수 있다.
 * 그 값으로 점수를 매기면 틀린 점수가 화면에 나오므로, 읽은 직후 싼 불변식 몇 개를 확인하고 어긋나면 점수 화면을 막는다.
 *
 * 아래 값은 점수 상수가 아니라 "이 세이브 형식이 맞는가"를 가르는 경계값(guard)이다. 고정 시험 세이브(26.3.2, 선수 99,892명)의
 * 실제 값에 여유를 넉넉히 두고 정했다. 기준 값은 각 줄의 주석에 적었다. 정상 세이브가 걸리지 않게 하는 것이 먼저라 경계가 느슨하다.
 */
export const SAVE_GUARDS = {
  /** 선수 수 범위. 실제 99,892명. 작은 데이터베이스도 있어 아래를 넓게 잡았다 */
  playersMin: 5_000,
  playersMax: 500_000,
  /** 이름을 읽지 못한 선수의 몫. 실제 0.002%(2명) */
  namelessMaxShare: 0.05,
  /** 임대 선수의 몫 상한. 실제 6.4%(6,365명) */
  loansMaxShare: 0.25,
  /** 선수가 이만큼 이상인 세이브인데 임대가 이 수 미만이면 임대 읽기가 깨진 것이다(실제 6,365명) */
  loansCheckFromPlayers: 20_000,
  /** 현재·잠재 능력이 1~200을 벗어난 선수의 몫 상한. 실제 0.002%(2명) */
  abilityOutOfRangeMaxShare: 0.01,
  /** 현재 능력이 잠재 능력보다 이만큼(점)보다 큰 선수를 어긋난 것으로 센다. 게임이 두 값을 맞춰 두므로 0이 정상이고, 반올림 여유로 5를 둔다 */
  caOverPaTolerance: 5,
  /** 위 선수의 몫 상한. 실제 0.002%(2명) */
  caOverPaMaxShare: 0.02,
  /** 능력치(1~100)나 포지션 숙련(1~20)이 범위를 벗어난 값을 가진 선수의 몫 상한. 실제 0명 */
  rangeMaxShare: 0.005,
  /** 숙련 15 이상인 포지션이 하나도 없는 선수의 몫 상한. 실제 0명 */
  noMainPositionMaxShare: 0.05,
  /** 현재 능력 평균 범위. 실제 87.1 */
  meanCaMin: 50,
  meanCaMax: 130,
  /** 현재 능력과 능력치 평균의 상관 하한. 실제 0.92. 두 값이 어긋나게 읽히면 0에 가까워진다 */
  caAttributeCorrelationMin: 0.6,
  /** 나이가 14~50세로 읽히는 선수의 몫 하한(게임의 오늘을 알 때만). 실제 99.99% */
  plausibleAgeMinShare: 0.9
} as const

const MAX_ATTRIBUTE = 100
const MAX_RATING = 20
const MAIN_POSITION = 15

const percent = (share: number): string => `${(share * 100).toFixed(share < 0.001 ? 3 : 1)}%`
const count = (n: number): string => `${n.toLocaleString('ko-KR')}명`

/** 읽은 세이브가 기대한 모양인지 본다. 읽어 둔 값은 바꾸지 않는다. */
export function checkSaveWorld(world: SaveWorld, options: { minLoans?: number } = {}): SaveCheck {
  const g = SAVE_GUARDS
  const problems: string[] = []
  const n = world.count

  if (n < g.playersMin || n > g.playersMax) {
    problems.push(`선수 수가 ${count(n)}입니다. 보통은 ${g.playersMin.toLocaleString('ko-KR')}~${g.playersMax.toLocaleString('ko-KR')}명입니다.`)
  }
  if (n === 0) return { ok: false, problems }

  let nameless = 0
  let loans = 0
  let abilityOut = 0
  let caOverPa = 0
  let attributeOut = 0
  let ratingOut = 0
  let noMain = 0
  let ageKnown = 0
  let ageOk = 0
  // 평균과 상관은 범위 안의 선수만으로 구한다(범위 밖 값 몇 개가 상관을 무너뜨린다)
  let used = 0
  let sumCa = 0
  let sumMean = 0
  let sumCaCa = 0
  let sumMeanMean = 0
  let sumCaMean = 0
  const today = world.gameDate

  for (let k = 0; k < n; k++) {
    if (!world.names[k]) nameless++
    if (world.loanFrom[k] !== NO_TEAM) loans++
    const ca = world.ca[k]
    const pa = world.pa[k]
    const inRange = ca >= 1 && ca <= 200 && pa >= 1 && pa <= 200
    if (!inRange) abilityOut++
    else if (ca > pa + g.caOverPaTolerance) caOverPa++

    let attributeSum = 0
    let bad = false
    for (let a = k * ATTRIBUTE_COUNT, end = a + ATTRIBUTE_COUNT; a < end; a++) {
      const value = world.attributes[a]
      if (value < 1 || value > MAX_ATTRIBUTE) bad = true
      attributeSum += value
    }
    if (bad) attributeOut++
    let best = 0
    bad = false
    for (let p = k * POSITION_COUNT, end = p + POSITION_COUNT; p < end; p++) {
      const value = world.positions[p]
      if (value < 1 || value > MAX_RATING) bad = true
      if (value > best) best = value
    }
    if (bad) ratingOut++
    if (best < MAIN_POSITION) noMain++

    if (inRange) {
      const mean = attributeSum / ATTRIBUTE_COUNT
      used++
      sumCa += ca
      sumMean += mean
      sumCaCa += ca * ca
      sumMeanMean += mean * mean
      sumCaMean += ca * mean
    }
    if (today && world.birthYear[k] > 0) {
      ageKnown++
      const age = today.year - world.birthYear[k]
      if (age >= 14 && age <= 50) ageOk++
    }
  }

  if (nameless / n > g.namelessMaxShare) {
    problems.push(`이름을 읽지 못한 선수가 ${count(nameless)}(${percent(nameless / n)})입니다. 보통은 0.1% 미만입니다.`)
  }
  if (loans / n > g.loansMaxShare) {
    problems.push(`임대 선수가 ${count(loans)}(${percent(loans / n)})입니다. 보통은 10% 안팎입니다.`)
  } else if (n >= g.loansCheckFromPlayers && loans < (options.minLoans ?? 100)) {
    problems.push(`임대 선수가 ${count(loans)}뿐입니다. 선수가 이렇게 많은 세이브에서는 수천 명이 보통입니다.`)
  }
  if (abilityOut / n > g.abilityOutOfRangeMaxShare) {
    problems.push(`현재·잠재 능력이 1~200을 벗어난 선수가 ${count(abilityOut)}(${percent(abilityOut / n)})입니다.`)
  }
  if (caOverPa / n > g.caOverPaMaxShare) {
    problems.push(`현재 능력이 잠재 능력보다 ${g.caOverPaTolerance}점 넘게 높은 선수가 ${count(caOverPa)}(${percent(caOverPa / n)})입니다.`)
  }
  if (attributeOut / n > g.rangeMaxShare) {
    problems.push(`능력치가 1~100을 벗어난 선수가 ${count(attributeOut)}(${percent(attributeOut / n)})입니다.`)
  }
  if (ratingOut / n > g.rangeMaxShare) {
    problems.push(`포지션 숙련이 1~20을 벗어난 선수가 ${count(ratingOut)}(${percent(ratingOut / n)})입니다.`)
  }
  if (noMain / n > g.noMainPositionMaxShare) {
    problems.push(`뛸 수 있는 포지션(숙련 15 이상)이 하나도 없는 선수가 ${count(noMain)}(${percent(noMain / n)})입니다.`)
  }
  if (used > 1) {
    const meanCa = sumCa / used
    if (meanCa < g.meanCaMin || meanCa > g.meanCaMax) {
      problems.push(`현재 능력 평균이 ${meanCa.toFixed(1)}입니다. 보통은 ${g.meanCaMin}~${g.meanCaMax}입니다.`)
    }
    const meanOfMean = sumMean / used
    const covariance = sumCaMean / used - meanCa * meanOfMean
    const spreadCa = Math.sqrt(Math.max(0, sumCaCa / used - meanCa * meanCa))
    const spreadMean = Math.sqrt(Math.max(0, sumMeanMean / used - meanOfMean * meanOfMean))
    // 편차가 0이면 모든 선수가 같은 값이라 읽은 값이 아니다
    const correlation = spreadCa > 0 && spreadMean > 0 ? covariance / (spreadCa * spreadMean) : 0
    if (correlation < g.caAttributeCorrelationMin) {
      problems.push(`현재 능력과 능력치 평균의 관계가 약합니다(상관 ${correlation.toFixed(2)}, 보통 0.9 안팎). 두 값이 어긋나게 읽혔을 수 있습니다.`)
    }
  }
  if (ageKnown >= 1000 && ageOk / ageKnown < g.plausibleAgeMinShare) {
    problems.push(`나이가 14~50세로 읽히는 선수가 ${percent(ageOk / ageKnown)}뿐입니다. 보통은 거의 모두입니다.`)
  }
  return { ok: problems.length === 0, problems }
}
