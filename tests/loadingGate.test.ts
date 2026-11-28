import { describe, expect, it } from 'vitest'
import { GATE, gateStep, gateWait, type GateState } from '../src/renderer/src/lib/loadingGate'

const START: GateState = { shown: false, busySince: null, shownAt: null }

/** 시각마다 busy가 참인지 거짓인지 정해 주면 한 걸음씩 돌려 보이는 때를 모두 적는다 */
function run(busyAt: (time: number) => boolean, until: number, stepMs = 10): Array<{ time: number; shown: boolean }> {
  let state = START
  const seen: Array<{ time: number; shown: boolean }> = []
  for (let time = 0; time <= until; time += stepMs) {
    state = gateStep(state, busyAt(time), time)
    seen.push({ time, shown: state.shown })
  }
  return seen
}

describe('읽는 중 표시의 문(C-10)', () => {
  it('문턱은 0.2초와 0.4초다', () => {
    expect(GATE).toEqual({ delay: 200, minShow: 400 })
  })

  it('0.2초 안에 끝나면 한 번도 보이지 않는다', () => {
    const seen = run((time) => time < 190, 1_000)
    expect(seen.filter((each) => each.shown)).toEqual([])
  })

  it('일이 없으면 보이지 않는다', () => {
    expect(run(() => false, 1_000).every((each) => !each.shown)).toBe(true)
  })

  it('0.2초를 넘으면 보인다(0.2초 지난 첫 걸음에)', () => {
    const seen = run((time) => time < 1_000, 1_000)
    expect(seen.find((each) => each.time === 190)?.shown).toBe(false)
    expect(seen.find((each) => each.time === 200)?.shown).toBe(true)
    expect(seen.find((each) => each.time === 500)?.shown).toBe(true)
  })

  it('띄웠으면 일이 끝나도 띄운 지 0.4초가 지나기 전에는 사라지지 않는다', () => {
    // 0초에 시작해 0.25초에 끝난다. 표시는 0.2초에 떴으므로 0.6초까지 보이고, 0.6초에 사라진다
    const seen = run((time) => time < 250, 1_000)
    const shownTimes = seen.filter((each) => each.shown).map((each) => each.time)
    expect(shownTimes[0]).toBe(200)
    expect(Math.max(...shownTimes)).toBe(590)
    expect(seen.find((each) => each.time === 600)?.shown).toBe(false)
  })

  it('일이 오래 걸리면 끝난 뒤에 바로 사라지지 않고, 띄운 때부터 0.4초가 이미 지났으면 바로 사라진다', () => {
    let state = gateStep(START, true, 0)
    state = gateStep(state, true, 200)
    expect(state.shown).toBe(true)
    state = gateStep(state, true, 5_000)
    expect(state.shown).toBe(true)
    state = gateStep(state, false, 5_001)
    expect(state.shown).toBe(false)
  })

  it('보이는 동안 일이 다시 시작되면 그대로 보이고, 끝난 뒤에는 처음 띄운 때부터 0.4초를 센다', () => {
    let state = gateStep(START, true, 0)
    state = gateStep(state, true, 200) // 떴다(200)
    state = gateStep(state, false, 300)
    state = gateStep(state, true, 350)
    state = gateStep(state, false, 380)
    expect(state.shown).toBe(true)
    state = gateStep(state, false, 599)
    expect(state.shown).toBe(true)
    state = gateStep(state, false, 600)
    expect(state.shown).toBe(false)
  })

  it('사라진 뒤 새 일이 시작되면 다시 0.2초를 기다린다', () => {
    let state = gateStep(START, true, 0)
    state = gateStep(state, true, 200)
    state = gateStep(state, false, 700)
    expect(state).toEqual(START)
    state = gateStep(state, true, 1_000)
    expect(state.shown).toBe(false)
    state = gateStep(state, true, 1_199)
    expect(state.shown).toBe(false)
    state = gateStep(state, true, 1_200)
    expect(state.shown).toBe(true)
  })

  it('상태를 바꾸지 않는 걸음은 같은 객체를 돌려준다(되풀이해 불러도 다시 그리지 않는다)', () => {
    const waiting = gateStep(START, true, 0)
    expect(gateStep(waiting, true, 50)).toBe(waiting)
    expect(gateStep(START, false, 50)).toBe(START)
  })
})

describe('gateWait: 다음 걸음까지 기다릴 시간', () => {
  it('일이 도는 중이고 아직 안 떴으면 띄울 때까지', () => {
    const waiting = gateStep(START, true, 1_000)
    expect(gateWait(waiting, true, 1_000)).toBe(200)
    expect(gateWait(waiting, true, 1_150)).toBe(50)
    expect(gateWait(waiting, true, 1_300)).toBe(0)
  })

  it('끝났는데 떠 있으면 사라질 때까지, 그 밖에는 기다릴 것이 없다', () => {
    let state = gateStep(START, true, 0)
    state = gateStep(state, true, 200)
    expect(gateWait(state, true, 300)).toBeNull()
    state = gateStep(state, false, 300)
    expect(gateWait(state, false, 300)).toBe(300)
    expect(gateWait(state, false, 650)).toBe(0)
    expect(gateWait(START, false, 0)).toBeNull()
  })
})
