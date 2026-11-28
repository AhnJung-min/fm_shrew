import { Tag, type Tone } from '@/components/ui/Tag'
import '@/styles/ui.css'

/**
 * 표의 점수 칸(C-21): 오른쪽 맞춘 굵은 숫자(.score-num)와 낱말 하나(등급 태그 또는 역할 이름). 막대는 없다(막대는 점수 풀이 안에서만 쓴다).
 * 숫자에는 색을 입히지 않고, 뜻 색은 태그에만 쓴다. 값을 모르면 줄표다(칸마다 '정보 없음'과 '없음'을 가르는 것은 그 화면의 몫이다).
 * estimate: 범위에서 나온 값이면 숫자에 점선 밑줄을 긋는다(앞에 물결표를 붙이지 않는다, C-15).
 */
export function ScoreCell(props: { value: number | null; digits?: number; estimate?: boolean; tag?: { text: string; tone: Tone }; word?: string; tip?: string }) {
  const { value, digits = 0, estimate, tag, word, tip } = props
  const valueClasses = ['score-cell-value', 'score-num', digits > 0 ? 'score-cell-wide' : '', estimate ? 'score-cell-estimate' : ''].filter(Boolean).join(' ')
  return (
    <span className="score-cell" data-tip={tip}>
      <span className={valueClasses}>{value === null ? '–' : value.toFixed(digits)}</span>
      {tag ? <Tag tone={tag.tone}>{tag.text}</Tag> : word ? <span className="score-cell-word">{word}</span> : null}
    </span>
  )
}
