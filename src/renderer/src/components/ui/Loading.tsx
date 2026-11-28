import { useEffect, useRef, useState } from 'react'
import { gateStep, gateWait, type GateState } from '@/lib/loadingGate'
import '@/styles/ui.css'

/**
 * 일이 도는 동안 켜지는 표시(C-10). 0.2초 안에 끝나는 일에는 켜지지 않고, 켜졌으면 일이 끝나도 0.4초는 유지한다(깜빡이지 않게).
 * 단추 글자를 바꿀 때도 이 값을 쓴다: `{shown ? '읽는 중…' : '적용'}`.
 */
export function useDelayedFlag(busy: boolean): boolean {
  const [shown, setShown] = useState(false)
  const gate = useRef<GateState>({ shown: false, busySince: null, shownAt: null })
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const step = (): void => {
      const now = Date.now()
      gate.current = gateStep(gate.current, busy, now)
      setShown(gate.current.shown)
      const wait = gateWait(gate.current, busy, now)
      if (wait !== null) timer = setTimeout(step, wait)
    }
    step()
    return () => clearTimeout(timer)
  }, [busy])
  return shown
}

/**
 * "○○ 읽는 중입니다" 한 꼴의 읽는 중 표시. what은 읽는 것의 이름('세이브', '선수 목록').
 * compact는 단추나 표 머리 안에 들어가는 짧은 꼴("읽는 중…")이다. 문에 걸려 보일 때가 아니면 아무것도 그리지 않는다.
 */
export function Loading(props: { busy: boolean; what: string; compact?: boolean }) {
  const { busy, what, compact } = props
  const shown = useDelayedFlag(busy)
  if (!shown) return null
  const full = `${what} 읽는 중입니다`
  return compact ? (
    <span className="ui-loading ui-loading-compact" role="status" aria-label={full}>
      읽는 중…
    </span>
  ) : (
    <span className="ui-loading" role="status">
      {full}
    </span>
  )
}
