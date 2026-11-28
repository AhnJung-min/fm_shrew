import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { RecommendTierId } from '@shared/recommend'
import type { NeedLevelId } from '@shared/tactic'
import { GLOSSARY } from '@/lib/glossary'
import '@/styles/ui.css'

/**
 * 표지의 뜻 색. 한 색은 글자, 옅은 바탕, 테두리 한 짝이다.
 * neutral 평소(모르는 값 포함), gold 최고 구간, good 좋음, warn 주의, bad 위험, mine 내 팀·적용됨(흰색), edited 고친 값(노랑)
 */
export type Tone = 'neutral' | 'gold' | 'good' | 'warn' | 'bad' | 'mine' | 'edited'

/**
 * 누르지 않는 표지(12.5px, 둥글기 4px). 색만으로 뜻을 전하지 않도록 늘 글자를 넣고, 필요하면 아이콘을 곁들인다.
 * tip은 풍선(data-tip)으로 뜬다. label을 주면 화면 낭독이 보이는 글자 대신 그 이름을 읽는다.
 */
export function Tag(props: { tone?: Tone; children: ReactNode; icon?: LucideIcon; tip?: string; label?: string; className?: string }) {
  const { tone = 'neutral', children, icon: Icon, tip, label, className } = props
  return (
    <span
      className={['ui-tag', `ui-tag-${tone}`, className].filter(Boolean).join(' ')}
      data-tip={tip}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {Icon && <Icon size={13} aria-hidden="true" />}
      {children}
    </span>
  )
}

/** 추천 등급의 색: 최고 등급(강력 추천)만 노랑, 추천은 초록, 나머지는 중립 */
export const TIER_TONE: Record<RecommendTierId, Tone> = { top: 'gold', good: 'good', maybe: 'neutral', low: 'neutral', outside: 'neutral' }

/** 보강 필요도 등급의 색: 시급은 빨강, 보강 권장은 주황, 나머지는 중립 */
export const NEED_TONE: Record<NeedLevelId, Tone> = { urgent: 'bad', recommended: 'warn', normal: 'neutral', fine: 'neutral' }

/** 모르는 값의 표지는 세 낱말만 쓰고 중립색이다: 추정, 정보 없음, 없음. 풍선은 낱말 사전의 한 문장이 기본이다 */
export function UnknownTag(props: { kind: 'estimate' | 'unknown' | 'none'; tip?: string }) {
  const term = GLOSSARY[props.kind]
  return (
    <Tag tone="neutral" tip={props.tip ?? term.short}>
      {term.word}
    </Tag>
  )
}
