const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(value)))

/**
 * 고칠 수 있는 숫자 칸 하나. 위·아래 화살표 키로 1씩 바뀌고, 바뀐 값은 노란 테두리와
 * "원래 값" 풍선 도움말로 드러낸다. 능력치 단계 색(a1~a4)은 band로 넘긴다.
 */
export function EditNumber(props: {
  label: string
  value: number
  original: number
  min: number
  max: number
  /** 단계 색(a1~a4). 없으면 색을 입히지 않는다 */
  band?: string
  big?: boolean
  id?: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const { label, value, original, min, max, band, big, id, disabled, onChange } = props
  const changed = value !== original
  const classes = ['pl-input', band ?? '', big ? 'big' : '', changed ? 'changed' : ''].filter(Boolean).join(' ')
  return (
    <input
      id={id}
      className={classes}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={value}
      disabled={disabled}
      aria-label={label}
      title={changed ? `${label}: 원래 값 ${original}` : label}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          onChange(clamp(value + (event.key === 'ArrowUp' ? 1 : -1), min, max))
        }
      }}
      onChange={(event) => {
        const next = Number(event.target.value)
        if (event.target.value !== '' && Number.isFinite(next)) onChange(clamp(next, min, max))
      }}
    />
  )
}
