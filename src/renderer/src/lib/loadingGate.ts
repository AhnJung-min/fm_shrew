/**
 * 읽는 중 표시의 문(C-10, 순수): 0.2초 안에 끝나는 일에는 읽는 중을 띄우지 않고, 한 번 띄웠으면 0.4초는 둔다. 깜빡이지 않게 하려는 규칙이다.
 * 시간은 모두 밀리초이고, 지금 시각(now)은 부르는 쪽이 넣는다(시험에서 시계를 쥐고 돌릴 수 있게).
 */

export const GATE: { readonly delay: 200; readonly minShow: 400 } = { delay: 200, minShow: 400 }

export interface GateState {
  /** 지금 읽는 중 표시가 보이는가 */
  shown: boolean
  /** 일이 시작된 때. 일이 없으면 null */
  busySince: number | null
  /** 표시를 띄운 때. 보이지 않으면 null */
  shownAt: number | null
}

/**
 * 한 걸음. busy(일이 지금 돌고 있는가)와 지금 시각을 넣으면 다음 상태를 돌려준다. 처음 상태는 { shown: false, busySince: null, shownAt: null }이다.
 * - 일이 시작되면 시작한 때를 적고, GATE.delay가 지나도 끝나지 않으면 표시를 띄운다.
 * - 일이 끝났는데 표시가 아직 안 떴으면 끝이다(한 번도 보이지 않는다).
 * - 표시가 떴으면 일이 끝나도 띄운 지 GATE.minShow가 지나야 사라진다.
 */
export function gateStep(state: GateState, busy: boolean, now: number): GateState {
  if (busy) {
    const busySince = state.busySince ?? now
    if (!state.shown && now - busySince >= GATE.delay) return { shown: true, busySince, shownAt: now }
    return state.busySince === busySince ? state : { ...state, busySince }
  }
  if (!state.shown) return state.busySince === null ? state : { ...state, busySince: null }
  const shownAt = state.shownAt ?? now
  if (now - shownAt >= GATE.minShow) return { shown: false, busySince: null, shownAt: null }
  return { shown: true, busySince: null, shownAt }
}

/**
 * 다음 걸음까지 기다릴 시간(밀리초). 더 기다릴 것이 없으면 null.
 * 일이 도는 중인데 표시가 아직 안 떴으면 띄울 때까지, 일이 끝났는데 표시가 떠 있으면 사라질 때까지다.
 */
export function gateWait(state: GateState, busy: boolean, now: number): number | null {
  if (busy && !state.shown && state.busySince !== null) return Math.max(0, state.busySince + GATE.delay - now)
  if (!busy && state.shown && state.shownAt !== null) return Math.max(0, state.shownAt + GATE.minShow - now)
  return null
}
