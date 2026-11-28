import { useId } from 'react'
import '@/styles/ui.css'

/**
 * 설정의 켬/끔 하나(C-68). role="switch"이고 켬과 끔을 글자로도 적는다(색이나 위치만으로 알리지 않는다).
 * hint는 이름 아래의 한 줄 설명이다(화면 낭독이 함께 읽는다).
 */
export function Toggle(props: { label: string; checked: boolean; onChange(next: boolean): void; hint?: string; disabled?: boolean }) {
  const { label, checked, onChange, hint, disabled } = props
  const hintId = useId()
  return (
    <div className="ui-toggle">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? hintId : undefined}
        className="ui-toggle-switch"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="ui-toggle-label">{label}</span>
        <span className="ui-toggle-track" aria-hidden="true" />
        <span className="ui-toggle-state" aria-hidden="true">
          {checked ? '켬' : '끔'}
        </span>
      </button>
      {hint && (
        <p id={hintId} className="ui-toggle-hint">
          {hint}
        </p>
      )}
    </div>
  )
}
