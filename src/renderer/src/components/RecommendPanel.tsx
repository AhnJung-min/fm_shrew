import {
  COMPONENT_HELP,
  COMPONENT_LABEL,
  COMPONENT_ORDER,
  NEED_WEIGHT_HIGH,
  NEED_WEIGHT_LOW,
  RECOMMEND_WEIGHTS,
  recommendTier,
  TERM_HELP,
  type SquadMoney
} from '@shared/recommend'
import { formatPounds } from '@shared/playerView'
import { CATEGORY_LABEL, type CandidateCategory, type CandidateRow } from '@shared/world'

/** 점수가 어떻게 계산되는지(유형별 가중치 표) */
function Explainer(props: { category: CandidateCategory; baseline: SquadMoney | null; need: number | null }) {
  const { category, baseline, need } = props
  const weights = RECOMMEND_WEIGHTS[category]
  return (
    <details className="reco-explain">
      <summary>점수는 이렇게 계산합니다</summary>
      <div className="reco-explain-body">
        <p>{TERM_HELP.recommend}</p>
        <p>
          지금 고른 유형은 “{CATEGORY_LABEL[category]}”이고, 항목별 최고 점수(가중치)는 아래와 같습니다. 합하면 100점입니다.
          값을 알 수 없는 항목은 점수에서 빼고 나머지로 다시 100점을 나눕니다.
        </p>
        <table className="reco-weights">
          <thead>
            <tr>
              <th>항목</th>
              <th className="num">가중치</th>
              <th>무엇을 보나</th>
            </tr>
          </thead>
          <tbody>
            {COMPONENT_ORDER.map((id) => (
              <tr key={id} className={weights[id] === 0 ? 'off' : ''}>
                <th scope="row">{COMPONENT_LABEL[id]}</th>
                <td className="num">{weights[id] === 0 ? '반영 안 함' : weights[id]}</td>
                <td>{COMPONENT_HELP[id]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          자리를 골라 찾을 때는 그 자리의 보강 필요도에 따라 즉시 전력의 비중이 {NEED_WEIGHT_LOW}배(필요도 0)에서 {NEED_WEIGHT_HIGH}배(필요도 100) 사이로
          바뀝니다{need !== null ? `. 지금 자리의 보강 필요도는 ${Math.round(need)}입니다` : ''}.
        </p>
        <p className="muted">
          {baseline
            ? `비용은 내 팀 1군과 견줍니다: 주급은 중간 ${formatPounds(baseline.medianWage)}, 최고 ${formatPounds(baseline.topWage)}` +
              (baseline.medianValue !== null && baseline.topValue !== null
                ? `, 몸값은 중간 ${formatPounds(baseline.medianValue)}, 최고 ${formatPounds(baseline.topValue)}(세이브에 적힌 기준값)입니다.`
                : '입니다.')
            : '내 팀 1군의 주급·몸값을 충분히 알 수 없어 비용 부담은 점수에 넣지 못합니다.'}{' '}
          이적 예산, 선수의 성격, 게임 안 이적 가능 표시는 세이브에서 읽지 못해 쓰지 않습니다. 이 점수는 게임의 계산이 아니라 이 앱이 정한 어림 기준입니다.
        </p>
      </div>
    </details>
  )
}

/** 고른 선수의 추천 점수 풀이와, 점수 계산 방법 설명 */
export function RecommendPanel(props: {
  row: CandidateRow | null
  category: CandidateCategory
  baseline: SquadMoney | null
  need: number | null
}) {
  const { row, category, baseline, need } = props
  const tier = row ? recommendTier(row.recommend.total) : null
  return (
    <section className="reco" aria-label="추천 점수 풀이">
      {row && tier ? (
        <>
          <header className="reco-head">
            <h2>
              {row.name}의 추천 점수 <b className={`num reco-total ${tier.id}`}>{row.recommend.total}</b>
            </h2>
            <span className={`reco-tier ${tier.id}`}>{tier.label}</span>
            <span className="muted">항목별로 더해진 점수입니다. 막대는 그 항목에서 받을 수 있는 최고 점수 대비 비율입니다.</span>
          </header>
          <ul className="reco-list">
            {row.recommend.components.map((each) => (
              <li key={each.id} className={each.counted ? '' : 'skipped'}>
                <div className="reco-line">
                  <span className="reco-label" title={COMPONENT_HELP[each.id]}>
                    {each.label}
                  </span>
                  <span className="reco-track" aria-hidden="true">
                    <span style={{ width: each.max > 0 ? `${Math.min(100, (each.points / each.max) * 100)}%` : '0%' }} />
                  </span>
                  <span className="reco-points num">{each.counted ? `${each.points} / ${each.max}` : '제외'}</span>
                </div>
                <p>{each.note}</p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted reco-hint">표에서 선수를 누르면 추천 점수가 어떻게 나왔는지 항목별로 보입니다.</p>
      )}
      <Explainer category={category} baseline={baseline} need={need} />
    </section>
  )
}
