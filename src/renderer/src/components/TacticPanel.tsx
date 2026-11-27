import { TERM_HELP } from '@shared/recommend'
import { NEED_FACTOR_HELP, NEED_FACTOR_WEIGHTS, type SlotAnalysis, type TacticAnalysis } from '@shared/tactic'

const ROLE_WORD: Record<SlotAnalysis['options'][number]['role'], string> = {
  starter: '이 자리 주전',
  elsewhere: '다른 자리 주전',
  bench: '주전 아님'
}

function NeedBadge(props: { slot: SlotAnalysis }) {
  const { slot } = props
  return (
    <span className={`need-badge ${slot.level}`} title={`${TERM_HELP.need} ${slot.reason}`}>
      보강 필요도 <b className="num">{Math.round(slot.need)}</b> <em>{slot.levelLabel}</em>
    </span>
  )
}

/** 한 자리의 필요도 풀이와, 내 선수 가운데 이 자리에 맞는 선수들 */
function SlotDetail(props: {
  slot: SlotAnalysis
  onPick: (idx: number) => void
  onFindTargets?: (index: number) => void
}) {
  const { slot, onPick, onFindTargets } = props
  return (
    <section className="slot-detail" aria-label={`${slot.label} 자리 분석`}>
      <header>
        <h3>
          {slot.label} <span className="muted">{slot.roleLabel}</span>
        </h3>
        <NeedBadge slot={slot} />
      </header>
      <p className="slot-reason">{slot.reason}</p>
      <p className="muted slot-facts">
        {slot.starterScore !== null
          ? `주전 적합도 ${slot.starterScore}점${slot.starterEff !== null && slot.starterScore - slot.starterEff > 0.05 ? `(포지션 숙련 ${slot.starterRating}이라 ${Math.round((slot.starterScore - slot.starterEff) * 10) / 10}점 빼면 ${Math.round(slot.starterEff * 10) / 10}점)` : ''}, ${slot.normSource === 'world' ? '같은 역할 상위권 평균' : '팀 주전 평균'} ${Math.round(slot.norm.mu * 10) / 10}점`
          : '주전 없음'}
        {slot.backupScore !== null ? ` · 첫 후보 ${slot.backupScore}점` : ''} · 이 자리를 뛸 수 있는 선수 {slot.eligible}명
        {slot.group.slots.length > 1 ? ` · 같은 포지션·역할의 자리 ${slot.group.slots.length}곳(영입 후보는 그 가운데 가장 약한 주전을 기준으로 찾습니다)` : ''}
      </p>

      <h4>보강 필요도는 이렇게 나왔습니다</h4>
      <ul className="factor-list">
        {slot.factors.map((factor) => (
          <li key={factor.id} className={factor.counted ? '' : 'skipped'}>
            <div className="factor-head">
              <span title={NEED_FACTOR_HELP[factor.id]}>{factor.label}</span>
              <span className="factor-track" aria-hidden="true">
                <span style={{ width: factor.max > 0 ? `${(factor.points / factor.max) * 100}%` : '0%' }} />
              </span>
              <span className="num factor-points">
                {factor.counted ? `${factor.points}/${factor.max}${factor.assumed ? ' (보통으로 계산)' : ''}` : '제외'}
              </span>
            </div>
            <p>{factor.note}</p>
          </li>
        ))}
      </ul>

      <h4>이 자리에 맞는 내 선수</h4>
      <ul className="option-list">
        {slot.options.map((option) => (
          <li key={option.idx}>
            <button
              className="option"
              onClick={() => onPick(option.idx)}
              aria-label={`${option.name}, 적합도 ${Math.round(option.score)}점. ${option.note} 선수 정보 열기`}
            >
              <span className="option-top">
                <span className="option-name">{option.name}</span>
                <span className="option-role">{ROLE_WORD[option.role]}</span>
                <span className="option-score num">
                  적합도 {option.uncertain ? '~' : ''}
                  {Math.round(option.score)}
                </span>
              </span>
              <span className="option-note">{option.note}</span>
            </button>
          </li>
        ))}
        {slot.options.length === 0 && <li className="muted">이 역할의 적합도를 계산할 수 있는 선수가 없습니다.</li>}
      </ul>

      {onFindTargets && (
        <button className="btn" onClick={() => onFindTargets(slot.slot.index)}>
          이 자리 영입 후보 보기
        </button>
      )}
    </section>
  )
}

/**
 * 전술 분석 패널: 팀 요약, 보강이 급한 자리 순서, 고른 자리의 풀이.
 * 숫자는 모두 shared/tactic.ts의 한 계산에서 나오고 영입 후보 화면도 같은 값을 쓴다.
 */
export function TacticPanel(props: {
  analysis: TacticAnalysis
  focusedSlot: number | null
  onFocusSlot: (index: number | null) => void
  onPick: (idx: number) => void
  onFindTargets?: (index: number) => void
}) {
  const { analysis, focusedSlot, onFocusSlot, onPick, onFindTargets } = props
  const focused = focusedSlot === null ? null : (analysis.slots[focusedSlot] ?? null)
  const { strongest, weakest } = analysis

  return (
    <section className="tactic-panel" aria-label="전술 분석">
      <h2 className="tactics-side-title">전술 분석 ({analysis.formation.label})</h2>

      <div className="tactic-summary">
        <p>
          주전 {analysis.slots.filter((each) => each.slot.starter).length}명의 적합도 평균은{' '}
          <b className="num">{analysis.fitAverage ?? '–'}</b>점, 자리들의 보강 필요도 평균은 <b className="num">{analysis.needAverage}</b>입니다.
        </p>
        <ul className="line-list" aria-label="줄별 적합도">
          {analysis.lines.map((line) => (
            <li key={line.id}>
              <span>{line.label}</span>
              <b className="num">{line.fitAverage ?? '–'}</b>
              <span className="muted">{line.zAverage === null ? '' : `상위권 평균 대비 ${line.zAverage >= 0 ? '+' : ''}${line.zAverage.toFixed(1)} 표준편차`}</span>
              <span className="muted">보강 필요도 평균 {Math.round(line.needAverage)}</span>
            </li>
          ))}
        </ul>
        {strongest && weakest && strongest.id !== weakest.id && (
          <p className="muted">
            역할마다 점수 눈금이 달라, 줄은 같은 역할 상위권 평균과 견준 표준편차로 비교했습니다. {analysis.slots[0]?.normSource === 'world' && `모든 역할을 현재 능력 ${analysis.slots[0].norm.caRef} 이상 선수의 평균에 맞췄습니다. `}가장 강한 줄은 {strongest.label}(상위권 평균 대비 {strongest.zAverage!.toFixed(1)} 표준편차, 적합도 평균 {strongest.fitAverage}점), 가장 약한 줄은 {weakest.label}({weakest.zAverage!.toFixed(1)} 표준편차, 적합도 평균 {weakest.fitAverage}점)입니다.
          </p>
        )}
      </div>

      {focused && <SlotDetail slot={focused} onPick={onPick} onFindTargets={onFindTargets} />}

      <h3 className="need-title">보강이 급한 자리 순서</h3>
      <p className="muted need-help">
        {TERM_HELP.need} 주전 전력 {NEED_FACTOR_WEIGHTS.quality}%, 후보 두께 {NEED_FACTOR_WEIGHTS.depth}%, 주전 나이 {NEED_FACTOR_WEIGHTS.age}%,
        주전 계약 {NEED_FACTOR_WEIGHTS.contract}%로 계산합니다.
      </p>
      <ol className="need-list">
        {analysis.byNeed.map((slot) => (
          <li key={slot.slot.index}>
            <button
              className={`need-row ${focusedSlot === slot.slot.index ? 'focused' : ''}`}
              aria-pressed={focusedSlot === slot.slot.index}
              onClick={() => onFocusSlot(focusedSlot === slot.slot.index ? null : slot.slot.index)}
            >
              <span className="need-row-top">
                <span className="need-row-name">{slot.label}</span>
                <span className="muted need-row-role">{slot.roleLabel}</span>
                <NeedBadge slot={slot} />
              </span>
              <span className="need-row-reason">{slot.reason}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
