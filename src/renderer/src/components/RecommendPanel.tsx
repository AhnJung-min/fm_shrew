import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import type { RoleNorm } from '@shared/norms'
import {
  COMPONENT_HELP,
  COMPONENT_LABEL,
  COMPONENT_ORDER,
  NEED_WEIGHT_HIGH,
  NEED_WEIGHT_LOW,
  RECOMMEND_TIER_LABEL,
  RECOMMEND_WEIGHTS,
  TERM_HELP,
  TIER_CUMULATIVE_SHARE,
  TIER_MEANING,
  TIER_MIN_TOTAL,
  type SquadMoney
} from '@shared/recommend'
import { formatPounds } from '@shared/playerView'
import { CATEGORY_LABEL, type CandidateCategory, type CandidateRow } from '@shared/world'

const percent = (share: number): number => Math.round(share * 100)

/** 점수가 어떻게 계산되는지(유형별 가중치 표) */
function Explainer(props: { category: CandidateCategory; baseline: SquadMoney | null; need: number | null; norm: RoleNorm | null }) {
  const { category, baseline, need, norm } = props
  const weights = RECOMMEND_WEIGHTS[category]
  return (
    <details className="reco-explain">
      <summary>점수는 이렇게 계산합니다</summary>
      <div className="reco-explain-body">
        <p>{TERM_HELP.recommend}</p>
        <p>
          지금 고른 유형은 “{CATEGORY_LABEL[category]}”이고, 항목별 최고 점수(가중치)는 아래와 같습니다. 합하면 100점이 추천 점수입니다. 포지션 숙련이 20보다 낮거나 31세를 넘는
          선수는 항목을 매기기 전에 적합도에서 그만큼 빼고(숙련이 10 미만이면 총점에도 한 번 더 곱합니다), 값을 알 수 없는 항목은 빼지 않고 보통(0.5)으로 보며 설명에 그렇게 적습니다.
          “전체”와 “즉시 전력” 탭의 순위는 대부분 즉시 전력이 가르고, 나머지 항목은 비슷한 선수끼리 순서를 정합니다.
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
          점수 차이는 이 역할의 보통 점수 차이(표준편차)로 잽니다
          {norm ? `. 이 역할은 상위권 평균 ${norm.mu.toFixed(1)}점, 표준편차 ${norm.sigma.toFixed(1)}점입니다(현재 능력 ${norm.caRef} 이상 ${norm.n}명 기준)` : ''}.
          자리를 골라 찾을 때는 그 자리의 보강 필요도에 따라 즉시 전력의 비중이 {NEED_WEIGHT_LOW}배(필요도 0)에서 {NEED_WEIGHT_HIGH}배(필요도 100) 사이로
          바뀝니다{need !== null ? `. 지금 자리의 보강 필요도는 ${Math.round(need)}입니다` : ''}.
        </p>
        <p>
          등급은 점수의 절대값이 아니라, 같은 유형의 자격을 갖춘 선수 전체 안에서의 순위로 매깁니다: 상위 {percent(TIER_CUMULATIVE_SHARE[0])}%는 강력 추천, 다음{' '}
          {percent(TIER_CUMULATIVE_SHARE[1] - TIER_CUMULATIVE_SHARE[0])}%는 추천, 다음 {percent(TIER_CUMULATIVE_SHARE[2] - TIER_CUMULATIVE_SHARE[1])}%는 고려, 나머지는 보류입니다.
          후보 수가 적어도 모든 등급이 나오도록 인원은 올림해서 셉니다. 점수가 {TIER_MIN_TOTAL}점 미만이면 순위와 상관없이 보류입니다.
        </p>
        <p className="muted">
          {baseline
            ? `비용은 내 팀 1군과 견줍니다: 주급은 중간 ${formatPounds(baseline.medianWage)}, 최고 ${formatPounds(baseline.topWage)}` +
              (baseline.medianValue !== null && baseline.topValue !== null
                ? `, 몸값은 중간 ${formatPounds(baseline.medianValue)}, 최고 ${formatPounds(baseline.topValue)}(세이브에 적힌 기준값)입니다.`
                : '입니다.')
            : '내 팀 1군의 주급·몸값을 충분히 알 수 없어 비용 부담은 보통(0.5)으로 봅니다.'}{' '}
          이적 예산, 선수의 성격, 게임 안 이적 가능 표시는 세이브에서 읽지 못해 쓰지 않습니다. 이 점수는 게임의 계산이 아니라 이 앱이 정한 어림 기준입니다.
        </p>
      </div>
    </details>
  )
}

/**
 * 고른 선수의 추천 점수 풀이. 접어 둔 한 줄로 시작해, 펼치면 항목별 점수와 포지션 보정, 경고를 보여 준다.
 * (표를 가리지 않도록 처음에는 접혀 있고, 펼쳐도 높이를 제한한다.)
 */
export function RecommendPanel(props: {
  row: CandidateRow | null
  category: CandidateCategory
  baseline: SquadMoney | null
  need: number | null
  /** 이 유형의 자격 후보 전체 수(등급을 매긴 모집단) */
  ranked: number | null
  norm: RoleNorm | null
}) {
  const { row, category, baseline, need, ranked, norm } = props
  const [open, setOpen] = useState(false)
  const reco = row?.recommend ?? null
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <section className="reco" aria-label="추천 점수 풀이">
      <button className="reco-toggle" aria-expanded={open} aria-controls="reco-body" onClick={() => setOpen(!open)}>
        <Chevron size={16} aria-hidden="true" />
        {row && reco ? (
          <>
            <span className="reco-toggle-name">{row.name}의 추천 점수</span>
            <b className={`num reco-total ${row.tier}`}>{reco.total}</b>
            <span className={`reco-tier ${row.tier}`}>{RECOMMEND_TIER_LABEL[row.tier]}</span>
            <span className="muted reco-toggle-hint">{open ? '풀이 접기' : '항목별 풀이 보기'}</span>
          </>
        ) : (
          <span className="muted">표에서 선수를 누른 뒤 여기를 열면 추천 점수가 어떻게 나왔는지 항목별로 보입니다.</span>
        )}
      </button>

      {open && (
        <div className="reco-body" id="reco-body">
          {row && reco && (
            <>
              <p className="reco-sum">
                항목 점수의 합 <b className="num">{reco.base}</b>
                {reco.gate < 1 && (
                  <>
                    {' '}
                    × 숙련 낮은 자리 보정 <b className="num">{Math.round(reco.gate * 100) / 100}</b>
                  </>
                )}{' '}
                = 추천 점수 <b className="num">{reco.total}</b>
              </p>
              <p className="muted reco-tier-line">
                {reco.fitNote} {reco.gateNote}
              </p>
              <p className="muted reco-tier-line">
                {row.tier === 'outside'
                  ? `이 선수는 “${CATEGORY_LABEL[category]}” 유형의 자격이 없어 이름으로 찾아 보여 드린 것입니다(등급 대신 유형 밖). 점수는 참고용입니다.`
                  : `${TIER_MEANING[category]}${ranked !== null ? ` 이 유형의 자격 후보는 ${ranked.toLocaleString()}명입니다.` : ''}`}
              </p>
              <ul className="reco-list">
                {reco.components.map((each) => (
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
              {reco.warnings.length > 0 && (
                <ul className="reco-warnings" aria-label="영입이 어려울 수 있는 이유(점수에는 넣지 않음)">
                  {reco.warnings.map((warning) => (
                    <li key={warning}>
                      <AlertTriangle size={14} aria-hidden="true" />
                      <span>주의: {warning}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <Explainer category={category} baseline={baseline} need={need} norm={norm} />
        </div>
      )}
    </section>
  )
}
