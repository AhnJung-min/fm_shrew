import type { InsightCard } from '@shared/insights'

const TONE_WORD: Record<InsightCard['tone'], string> = {
  normal: '',
  attention: '살펴볼 것',
  missing: '자료 없음'
}

function Card(props: { card: InsightCard; onPick: (idx: number) => void }) {
  const { card, onPick } = props
  const biggest = Math.max(1, ...(card.bars ?? []).map((bar) => bar.count))
  // 알릴 것이 없는 카드는 한 줄로 접는다(카드 틀과 빈 칸을 아낀다)
  if (card.lines.length === 0 && !card.bars) {
    return (
      <article className={`insight quiet ${card.tone}`} aria-labelledby={`insight-${card.id}`} title={card.note}>
        <h3 id={`insight-${card.id}`}>{card.title}</h3>
        <p className="insight-finding">{card.finding}</p>
      </article>
    )
  }
  return (
    <article className={`insight ${card.tone}`} aria-labelledby={`insight-${card.id}`}>
      <header>
        <h3 id={`insight-${card.id}`}>{card.title}</h3>
        {card.tone !== 'normal' && <span className="insight-tone">{TONE_WORD[card.tone]}</span>}
      </header>
      <p className="insight-finding">{card.finding}</p>

      {card.bars && (
        <ul className="insight-bars" aria-label="나이대별 선수 수">
          {card.bars.map((bar) => (
            <li key={bar.label}>
              <span className="insight-bar-label">{bar.label}</span>
              <span className="insight-bar-track" aria-hidden="true">
                <span style={{ width: `${(bar.count / biggest) * 100}%` }} />
              </span>
              <span className="insight-bar-count num">{bar.count}명</span>
            </li>
          ))}
        </ul>
      )}

      {card.lines.length > 0 && (
        <>
          {card.linesTitle && <p className="insight-lines-title">{card.linesTitle}</p>}
          <ul className="insight-lines">
            {card.lines.map((line, i) => (
              <li key={`${line.idx ?? 'x'}-${i}`}>
                {line.idx === null ? (
                  <span className="insight-line">
                    <span className="insight-name">{line.name}</span>
                    <span className="insight-detail">{line.detail}</span>
                  </span>
                ) : (
                  <button
                    className="insight-line"
                    onClick={() => onPick(line.idx!)}
                    aria-label={`${line.name}, ${line.detail}. 선수 정보 열기`}
                    title={`${line.name}: ${line.detail}`}
                  >
                    <span className="insight-name">{line.name}</span>
                    <span className="insight-detail">{line.detail}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {card.more > 0 && <p className="insight-more">외 {card.more}명</p>}
        </>
      )}
      {card.note && <p className="insight-note">{card.note}</p>}
    </article>
  )
}

/** 선수단 진단 카드들. strip은 표 위에 가로로, side는 전술판 옆에 세로로 놓는다. */
export function SquadInsights(props: {
  cards: InsightCard[]
  layout: 'strip' | 'side'
  onPick: (idx: number) => void
}) {
  const { cards, layout, onPick } = props
  return (
    <section className={`insights ${layout}`} aria-label="선수단 진단">
      {cards.map((card) => (
        <Card key={card.id} card={card} onPick={onPick} />
      ))}
    </section>
  )
}
