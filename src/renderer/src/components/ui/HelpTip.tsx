import { CircleQuestionMark } from 'lucide-react'
import '@/styles/ui.css'

/**
 * 한 문장 풀이를 풍선(data-tip)으로 보이는 물음표. 자리가 넉넉한 구역 제목, 맥락 줄, 점수 풀이 머리에만 단다
 * (표 머리에는 달지 않는다. 머리 칸 자체에 풍선을 단다). text는 낱말 사전의 short를 쓴다. label은 낭독 이름('적합도 풀이').
 */
export function HelpTip(props: { text: string; label: string }) {
  return (
    <button type="button" className="ui-help" data-tip={props.text} aria-label={props.label}>
      <CircleQuestionMark size={16} aria-hidden="true" />
    </button>
  )
}
