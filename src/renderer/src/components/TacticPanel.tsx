import { TERM_HELP } from '@shared/recommend'
import { MetaLine } from '@/components/MetaLine'
import { NEED_FACTOR_HELP, NEED_FACTOR_WEIGHTS, type LineId, type LineSummary, type SlotAnalysis, type TacticAnalysis } from '@shared/tactic'

/** 자리의 포지션이 어느 줄(골키퍼·수비·미드필드·공격)인지. shared/tactic.ts의 줄 나누기와 같다 */
const LINE_OF_POSITION: Record<string, LineId> = {
  GK: 'goalkeeper',
  DL: 'defence', DC: 'defence', DR: 'defence',
  WBL: 'midfield', WBR: 'midfield', DM: 'midfield', ML: 'midfield', MC: 'midfield', MR: 'midfield',
  AML: 'attack', AMC: 'attack', AMR: 'attack', ST: 'attack'
}

/** 줄의 주전들이 각자 역할의 상위권 평균보다 평균 몇 점 높은가(표준편차 대신 점수로 보여 주려는 값). 주전이 없으면 null */
function linePointsAbove(analysis: TacticAnalysis, id: LineId): number | null {
  const gaps = analysis.slots
    .filter((each) => LINE_OF_POSITION[each.slot.position] === id && each.starterEff !== null)
    .map((each) => each.starterEff! - each.norm.mu)
  return gaps.length === 0 ? null : gaps.reduce((a, b) => a + b, 0) / gaps.length
}

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
        <MetaLine
          items={[
            slot.starterScore !== null
              ? `주전 적합도 ${slot.starterScore}점${slot.starterEff !== null && slot.starterScore - slot.starterEff > 0.05 ? `(포지션 숙련 ${slot.starterRating}이라 ${Math.round((slot.starterScore - slot.starterEff) * 10) / 10}점 빼면 ${Math.round(slot.starterEff * 10) / 10}점)` : ''}, ${slot.normSource === 'world' ? '같은 역할 상위권 평균' : '팀 주전 평균'} ${Math.round(slot.norm.mu * 10) / 10}점`
              : '주전 없음',
            slot.backupScore !== null && `첫 후보 ${slot.backupScore}점`,
            `이 자리를 뛸 수 있는 선수 ${slot.eligible}명`
          ]}
        />
      </p>
      {slot.group.slots.length > 1 && (
        <p className="muted slot-facts">
          같은 포지션·역할의 자리가 {slot.group.slots.length}곳이라, 영입 후보는 그 가운데 가장 약한 주전을 기준으로 찾습니다.
        </p>
      )}

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
  const aboveText = (line: LineSummary): string => {
    const points = linePointsAbove(analysis, line.id)
    return points === null ? '' : `상위권 평균보다 ${Math.abs(points).toFixed(1)}점 ${points >= 0 ? '높음' : '낮음'}`
  }

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
              <span className="muted">{aboveText(line)}</span>
              <span className="muted">보강 필요도 평균 {Math.round(line.needAverage)}</span>
            </li>
          ))}
        </ul>
        {strongest && weakest && strongest.id !== weakest.id && (
          <>
            <p className="muted">
              가장 강한 줄은 {strongest.label}({aboveText(strongest)}), 가장 약한 줄은 {weakest.label}({aboveText(weakest)})입니다.
            </p>
            <details className="tactic-more">
              <summary>어떻게 계산했나</summary>
              <p className="muted">
                역할마다 점수 눈금이 달라, 줄끼리는 같은 역할 상위권 평균과 견준 표준편차(점수가 보통 흩어지는 폭)의 몇 배인지로 비교했습니다. {strongest.label}은 {strongest.zAverage! >= 0 ? '+' : ''}{strongest.zAverage!.toFixed(1)} 표준편차(적합도 평균 {strongest.fitAverage}점), {weakest.label}은 {weakest.zAverage!.toFixed(1)} 표준편차(적합도 평균 {weakest.fitAverage}점)입니다.
              </p>
            </details>
          </>
        )}
      </div>

      {focused && <SlotDetail slot={focused} onPick={onPick} onFindTargets={onFindTargets} />}

      <h3 className="need-title">보강이 급한 자리 순서</h3>
      <details className="tactic-more need-help">
        <summary>어떻게 계산했나</summary>
        <p className="muted">
          {TERM_HELP.need} 주전 전력 {NEED_FACTOR_WEIGHTS.quality}%, 후보 두께 {NEED_FACTOR_WEIGHTS.depth}%, 주전 나이 {NEED_FACTOR_WEIGHTS.age}%,
          주전 계약 {NEED_FACTOR_WEIGHTS.contract}%로 계산합니다.
        </p>
      </details>
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
