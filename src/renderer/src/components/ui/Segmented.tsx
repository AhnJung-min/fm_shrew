export interface SegmentOption<T extends string | number> {
  value: T
  label: string
  /** 풍선(data-tip). 이름만으로 뜻이 모자랄 때 */
  tip?: string
}

/**
 * '어떻게 볼지' 하나를 고르는 붙은 단추(C-68). 지금 .segmented 꼴(role="group" + aria-pressed)을 그대로 쓴다.
 * 고른 것을 누르면 그대로다(고르기를 풀지 않는다). 켬/끔은 Toggle, 조건 칩은 .chip이다.
 */
export function Segmented<T extends string | number>(props: { label: string; options: readonly SegmentOption<T>[]; value: T; onChange(value: T): void }) {
  const { label, options, value, onChange } = props
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          data-tip={option.tip}
          onClick={() => {
            if (option.value !== value) onChange(option.value)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
