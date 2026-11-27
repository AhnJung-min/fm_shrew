import type { ReactNode } from 'react'

/** 한 줄 요약(나이, 포지션, 구단 같은)을 가운뎃점 대신 간격으로 나눠 보여 준다. 빈 칸은 건너뛴다. */
export function MetaLine(props: { items: Array<ReactNode | false | null | undefined> }) {
  const shown = props.items.filter((item) => item !== false && item !== null && item !== undefined && item !== '')
  return (
    <span className="meta">
      {shown.map((item, i) => (
        <span key={i}>{item}</span>
      ))}
    </span>
  )
}
