import { Check, CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import '@/styles/ui.css'

/** 비어 있는 까닭: first 처음 씀, filtered 조건에 걸러짐, done 할 일을 다 함, problem 오류나 연결 문제, needsGame 게임이 있어야 채워짐 */
export type EmptyReason = 'first' | 'filtered' | 'done' | 'problem' | 'needsGame'

export interface EmptyAction {
  /** 누르면 일어날 일을 쓴다('세이브 고르기', '조건 모두 풀기', '다시 읽기') */
  label: string
  onClick(): void
  /** 화면 머리에 주 단추가 없을 때만 주 단추 모양으로 한다 */
  primary?: boolean
}

/**
 * 빈 화면 하나: 왜 비었는지 한 줄(title)과, 다음 할 일 단추 하나(action).
 * 주황은 진짜 문제(problem)에만, 게임이 꺼진 것이나 걸러져서 빈 것은 중립색이다. 단추 이름은 '세이브 고르기' 하나로 맞춘다.
 */
export function EmptyState(props: { reason: EmptyReason; title: string; body?: ReactNode; action?: EmptyAction; compact?: boolean }) {
  const { reason, title, body, action, compact } = props
  const classes = ['ui-empty', `ui-empty-${reason}`, compact ? 'ui-empty-compact' : ''].filter(Boolean).join(' ')
  return (
    <div className={classes} role={reason === 'problem' ? 'alert' : 'status'}>
      <p className="ui-empty-title">
        {reason === 'done' && <Check size={16} className="ui-empty-icon" aria-hidden="true" />}
        {reason === 'problem' && <CircleAlert size={16} className="ui-empty-icon" aria-hidden="true" />}
        {title}
      </p>
      {body && <div className="ui-empty-body">{body}</div>}
      {action && (
        <div className="ui-empty-actions">
          <button type="button" className={action.primary ? 'btn primary' : 'btn'} onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      )}
    </div>
  )
}
