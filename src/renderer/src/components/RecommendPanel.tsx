import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import type { RoleNorm } from '@shared/norms'
import {
  componentHelp,
  COMPONENT_LABEL,
  COMPONENT_ORDER,
  NEED_WEIGHT_HIGH,
  NEED_WEIGHT_LOW,
  REALISM_LABEL,
  REALISM_WAGE_RATIO,
  RECOMMEND_TIER_LABEL,
  RECOMMEND_WEIGHTS,
  TERM_HELP,
  TIER_CUMULATIVE_SHARE,
  TIER_MEANING,
  TIER_MIN_TOTAL,
  STATURE_CLUB_MARGIN,
  STATURE_SPAN_CA,
  type SquadMoney
} from '@shared/recommend'
import { formatPounds } from '@shared/playerView'
import { CATEGORY_LABEL, PROSPECT_MIN_GAIN_SIGMA, type CandidateCategory, type CandidateRow } from '@shared/world'

const percent = (share: number): number => Math.round(share * 100)

/** 유망주 탭 위에 한 줄로 알린다: 성장 예측이 한 시점의 세이브로 어림한 값이라는 것(5회차) */
export const PROSPECT_UNCERTAINTY_LINE = '성장 예측은 한 시점의 세이브로 어림한 값이라, 조금만 달라져도 이 탭 위쪽 순위가 크게 바뀔 수 있습니다.'

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
                <td>{componentHelp(id, category)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          점수 차이는 이 역할의 보통 점수 차이(표준편차)로 잽니다
          {norm
            ? `. 이 역할은 상위권 평균 ${norm.mu.toFixed(1)}점, 표준편차 ${norm.sigma.toFixed(1)}점입니다(현재 능력 ${norm.caRef} 이상 선수의 평균에 맞췄고, ${norm.poolCa !== undefined && norm.poolCa < norm.caRef ? `표본이 모자라 현재 능력 ${norm.poolCa} 이상 ${norm.n}명으로 구한 뒤 ${Math.abs(norm.shift ?? 0).toFixed(1)}점 ${(norm.shift ?? 0) >= 0 ? '올렸습니다' : '내렸습니다'}` : `${norm.n}명 기준입니다`})`
            : ''}.
          자리를 골라 찾을 때는 그 자리의 보강 필요도에 따라 즉시 전력의 비중이 {NEED_WEIGHT_LOW}배(필요도 0)에서 {NEED_WEIGHT_HIGH}배(필요도 100) 사이로
          바뀝니다{need !== null ? `. 지금 자리의 보강 필요도는 ${Math.round(need)}입니다` : ''}.
        </p>
        <p>
          등급은 점수의 절대값이 아니라, 같은 유형의 자격을 갖춘 선수 전체 안에서의 순위로 매깁니다: 상위 {percent(TIER_CUMULATIVE_SHARE[0])}%는 강력 추천, 다음{' '}
          {percent(TIER_CUMULATIVE_SHARE[1] - TIER_CUMULATIVE_SHARE[0])}%는 추천, 다음 {percent(TIER_CUMULATIVE_SHARE[2] - TIER_CUMULATIVE_SHARE[1])}%는 고려, 나머지는 보류입니다.
          후보 수가 적어도 모든 등급이 나오도록 인원은 올림해서 셉니다. 점수가 {TIER_MIN_TOTAL}점 미만이면 순위와 상관없이 보류입니다.
          {REALISM_LABEL} 선수는 순위 칸을 쓰지 않습니다. 등급의 경계는 영입이 현실적인 선수들로만 정하고, 낮은 선수는 그 안에서 같은 순위로 놓았다가 “고려”까지로 제한합니다.
        </p>
        {category === 'free' && (
          <p>
            자유 계약 선수는 세이브에 주급이 적혀 있지 않아, 같은 리그에서 현재 능력과 나이가 비슷한 선수의 기대 주급으로 어림해 비용 부담을 매깁니다(이적료는 없어 그 몫은 1).
            영입 난이도는 계약·입지는 가장 쉬운 것으로 보고, 내 약한 주전보다 현재 능력이 훨씬 높은 선수만 체급으로 깎습니다.
          </p>
        )}
        {category === 'prospect' && (
          <p>
            유망주는 나이가 어릴수록 점수가 높습니다(17세 이하 1, 26세 이상 0). 성숙 시 이득(잠재와 현재의 차이 × 나이별 성장 몫 × 역할의 기울기)이 {PROSPECT_MIN_GAIN_SIGMA} 표준편차보다
            작은 선수는 유망주로 보지 않습니다. 그런 선수도 즉시 전력·로테이션 탭에는 그대로 남습니다.
            역할의 기울기는 어린 선수가 실제로 지나가는 현재 능력 110~180 구간에서 잰 값을 쓰고, 골키퍼는 늦게 크는 별도 성장 몫 표를 씁니다.
            어릴수록 실제 성장의 편차가 큽니다(같은 잠재 능력이라도 다 컸을 때 현재 능력이 ±10쯤 달라집니다). 점수는 기대값만 쓰므로 어린 선수일수록 불확실합니다.
            {' '}{PROSPECT_UNCERTAINTY_LINE}
          </p>
        )}
        <p>
          {REALISM_LABEL}: 소속이 있는 선수가 내 팀 최고 주급의 {REALISM_WAGE_RATIO}배 이상을 받거나, 소속 팀의 핵심·중요 선수이면서 현재 능력이 내 주전보다 {STATURE_SPAN_CA} 이상 높거나,
          소속 구단의 주전 수준(그 팀 선수 11명의 중간 능력)이 우리와 비슷하거나({STATURE_CLUB_MARGIN} 이내로 낮은 것까지) 더 높은데 그 팀의 핵심·중요·주전 선수이면 붙는 표지입니다.
          소속이 없어도 다른 구단과 계약을 마친 선수에게도 붙습니다(그 선수는 자유 계약이 아니라 소속 칸에 “구단명(입단 예정)”으로 적습니다).
          이 이적 의사·평판·예산을 읽지 못하는 동안의 임시 장치로, 총점과 순서는 그대로 두고 등급만 “고려”까지로 제한합니다.
          임대 중인 선수는 원 소속 구단을 소속으로 보여 줍니다(이적료를 받는 쪽). 계약·주급은 세이브에 적힌 값 그대로입니다.
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
            {reco.realism.low && <span className="tag warn">{REALISM_LABEL}</span>}
            <span className="muted reco-toggle-hint">{open ? '풀이 접기' : '항목별 풀이 보기'}</span>
          </>
        ) : (
          <span className="muted">표에서 선수를 누른 뒤 여기를 열면 추천 점수가 어떻게 나왔는지 항목별로 보입니다.</span>
        )}
      </button>

      {category === 'prospect' && <p className="muted reco-note">{PROSPECT_UNCERTAINTY_LINE}</p>}

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
                {reco.realism.low && (
                  <>
                    <b>{REALISM_LABEL}</b>: {reco.realism.reasons.join('. ')}. 등급은 고려까지로 제한했습니다.{' '}
                  </>
                )}
                {row.loanedTo && `임대 중: 원 소속은 ${row.club}이고 지금은 ${row.loanedTo}에서 뜁니다. `}
                {row.tier === 'outside'
                  ? `이 선수는 “${CATEGORY_LABEL[category]}” 유형의 자격이 없어 이름으로 찾아 보여 드린 것입니다(등급 대신 유형 밖). 점수는 참고용입니다.`
                  : `${TIER_MEANING[category]}${ranked !== null ? ` 이 유형의 자격 후보는 ${ranked.toLocaleString()}명입니다.` : ''}`}
              </p>
              <ul className="reco-list">
                {reco.components.map((each) => (
                  <li key={each.id} className={each.counted ? '' : 'skipped'}>
                    <div className="reco-line">
                      <span className="reco-label" title={componentHelp(each.id, category)}>
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
