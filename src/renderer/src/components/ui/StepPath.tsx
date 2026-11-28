import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import '@/styles/ui.css'

export interface PathStep {
  id: string
  title: string
  /** 끝난 걸음: 색과 함께 체크 아이콘을 쓴다(색만으로 알리지 않는다) */
  done: boolean
  /** 지금 할 걸음(낭독에서 '현재 단계'로 읽힌다) */
  current?: boolean
  /** 걸음 아래에 보일 것(세이브 목록, 믿음 문장, 단추 등) */
  children?: ReactNode
}

/**
 * 점선으로 이어진 번호 붙은 걸음들(지금 시작 화면의 점선 길을 부품으로). 대시보드 길잡이와 연결 화면이 같이 쓴다(C-20).
 * 걸음마다 제목과 아래 내용(children)을 둔다. 번호는 실제로 순서가 있는 곳에만 쓴다.
 */
export function StepPath(props: { label: string; steps: PathStep[] }) {
  return (
    <ol className="ui-steps" aria-label={props.label}>
      {props.steps.map((step, index) => (
        <li
          key={step.id}
          className={['ui-step', step.done ? 'ui-step-done' : '', step.current ? 'ui-step-current' : ''].filter(Boolean).join(' ')}
          aria-current={step.current ? 'step' : undefined}
        >
          <span className="ui-step-mark" aria-hidden="true">
            {step.done ? <Check size={18} strokeWidth={3} /> : index + 1}
          </span>
          <div className="ui-step-body">
            <p className="ui-step-title">
              {step.title}
              {step.done && <span className="ui-sr">, 끝남</span>}
            </p>
            {step.children}
          </div>
        </li>
      ))}
    </ol>
  )
}
