import { useEffect, useState } from 'react'
import { parseNumber, stepNumber } from '@/lib/numberInput'
import '@/styles/ui.css'

const shown = (value: number | null): string => (value === null ? '' : String(value))

/**
 * 숫자만 받는 글자 칸(C-67). type="number"가 아니라서 칸 위에서 휠을 굴려도 값이 바뀌지 않고 화면이 내려간다.
 * 위·아래 화살표로 1씩 바뀌고(끝에서 멈춤), 전각 숫자('１２')도 받는다.
 * 적는 동안에는 범위 안의 값만 바로 알리고, 범위 밖이거나 빈 칸이면 칸을 나갈 때(또는 Enter) 끝값으로 맞춘다. 알아볼 수 없는 글은 이전 값으로 되돌린다.
 * allowEmpty이면 빈 칸이 null(값 없음)이다.
 */
export function NumberInput(props: {
  label: string
  value: number | null
  min: number
  max: number
  onChange(value: number | null): void
  allowEmpty?: boolean
  placeholder?: string
  width?: number
  className?: string
  id?: string
}) {
  const { label, value, min, max, onChange, allowEmpty = false, placeholder, width, className, id } = props
  const [text, setText] = useState(shown(value))

  // 밖에서 값이 바뀌면(화살표, 되돌리기) 칸의 글자도 따라간다. 적는 중인 글이 같은 값이면 그대로 둔다
  useEffect(() => {
    setText((current) => (parseNumber(current, min, max) === value ? current : shown(value)))
  }, [value, min, max])

  const commit = (next: number | null): void => {
    if (next !== value) onChange(next)
  }

  /** 칸을 나갈 때나 Enter에서: 끝값으로 맞춰 알리고 칸의 글자를 고친다 */
  const settle = (): void => {
    const parsed = parseNumber(text, min, max)
    if (parsed === 'invalid' || (parsed === null && !allowEmpty)) {
      setText(shown(value))
      return
    }
    commit(parsed)
    setText(shown(parsed))
  }

  return (
    <input
      id={id}
      className={['field', 'num', 'ui-number', className].filter(Boolean).join(' ')}
      style={width ? { width } : undefined}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      role="spinbutton"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value ?? undefined}
      placeholder={placeholder}
      value={text}
      onFocus={(event) => event.target.select()}
      onChange={(event) => {
        setText(event.target.value)
        // 적는 동안에는 범위 안의 값만 바로 알린다(범위 밖은 나갈 때 맞춘다)
        const typed = parseNumber(event.target.value, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)
        if (typeof typed === 'number' && typed >= min && typed <= max) commit(typed)
      }}
      onBlur={settle}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          const current = parseNumber(text, min, max)
          const next = stepNumber(typeof current === 'number' ? current : value, event.key, min, max)
          commit(next)
          setText(String(next))
        } else if (event.key === 'Enter') {
          settle()
        }
      }}
    />
  )
}
