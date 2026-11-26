import { CircleAlert } from 'lucide-react'
import { ClubLogo } from '@/components/ClubLogo'
import type { SeasonDate, SeasonMatch, SeasonResult } from '@shared/season'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
const RESULT_LABEL = { win: '승', draw: '무', loss: '패' } as const
const RESULT_WORD = { win: '이겼습니다', draw: '비겼습니다', loss: '졌습니다' } as const

function weekday(date: SeasonDate): string {
  return WEEKDAY[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()]
}

/** "12월 30일 (화)". 올해가 아니면 연도도 붙인다 */
function dateText(date: SeasonDate, today?: SeasonDate): string {
  const year = today && today.year === date.year ? '' : `${date.year}년 `
  return `${year}${date.month}월 ${date.day}일 (${weekday(date)})`
}

function competition(match: SeasonMatch): string {
  if (match.league) return match.round ? `리그 ${match.round}라운드` : '리그'
  return match.round ? `다른 대회 ${match.round}라운드` : '다른 대회'
}

const opponentName = (match: SeasonMatch): string => match.opponent || '이름을 모르는 팀'

function ResultBadge(props: { match: SeasonMatch }) {
  const { result } = props.match
  if (!result) return <span className="form-badge none" title="점수를 읽지 못한 경기">-</span>
  return (
    <span className={`form-badge ${result}`} title={RESULT_WORD[result]}>
      {RESULT_LABEL[result]}
    </span>
  )
}

function scoreText(match: SeasonMatch): string {
  return match.goalsFor === null || match.goalsAgainst === null ? '점수 없음' : `${match.goalsFor} - ${match.goalsAgainst}`
}

function Venue(props: { home: boolean }) {
  return <span className={props.home ? 'venue home' : 'venue away'}>{props.home ? '홈' : '원정'}</span>
}

function NextMatch(props: { match: SeasonMatch; today?: SeasonDate }) {
  const { match, today } = props
  return (
    <div className="next-match">
      <span className="next-label">다음 경기</span>
      <div className="next-main">
        <Venue home={match.home} />
        <ClubLogo uid={match.clubUid} size={32} />
        <strong className="next-opponent">{opponentName(match)}</strong>
      </div>
      <div className="next-when num">
        {dateText(match.date, today)}
        {match.time ? ` ${match.time}` : ''} · {competition(match)}
      </div>
    </div>
  )
}

/** 홈 화면의 경기 센터: 다음 경기, 최근 5경기, 앞으로의 경기, 그리고 리그 순위 */
export function SeasonCenter(props: { season: SeasonResult | null; applied: boolean; loading: boolean }) {
  const { season, applied, loading } = props

  let body
  if (!applied) {
    body = <p className="muted">세이브를 적용하면 내 팀의 경기 일정과 리그 순위가 여기에 나옵니다.</p>
  } else if (season === null) {
    body = <p className="muted">{loading ? '세이브에서 경기 기록을 읽는 중입니다.' : '경기 기록을 아직 읽지 않았습니다.'}</p>
  } else if (!season.ok) {
    body = (
      <p className="chat-caution" role="status">
        <CircleAlert size={15} />
        {season.message ?? '경기 기록을 읽지 못했습니다.'}
      </p>
    )
  } else {
    const { recent, upcoming, today } = season
    const [next, ...later] = upcoming
    const form = [...recent].reverse()
    body = (
      <>
        {season.message && <p className="muted">{season.message}</p>}
        {next ? (
          <NextMatch match={next} today={today} />
        ) : (
          <p className="muted">남은 경기를 찾지 못했습니다. 시즌이 끝났거나 일정이 아직 만들어지지 않았을 수 있습니다.</p>
        )}

        <div className="match-block">
          <h3>
            최근 {recent.length || 5}경기
            {form.length > 0 && (
              <span className="form-row" aria-label={`오래된 경기부터 ${form.map((m) => (m.result ? RESULT_LABEL[m.result] : '점수 없음')).join(', ')}`}>
                {form.map((match, i) => (
                  <ResultBadge key={i} match={match} />
                ))}
              </span>
            )}
          </h3>
          {recent.length === 0 ? (
            <p className="muted">끝난 경기가 아직 없습니다.</p>
          ) : (
            <>
              <ul className="match-list">
                {recent.map((match, i) => (
                  <li key={i} className="match-row">
                    <ResultBadge match={match} />
                    <span className="match-date num">{dateText(match.date, today)}</span>
                    <Venue home={match.home} />
                    <span className="match-opponent">
                      <ClubLogo uid={match.clubUid} size={20} />
                      {opponentName(match)}
                    </span>
                    <strong className="match-score num">{scoreText(match)}</strong>
                    <span className="match-comp">{competition(match)}</span>
                  </li>
                ))}
              </ul>
              <p className="faint match-note">점수는 내 팀 득점이 먼저입니다. 배지는 오래된 경기부터 왼쪽에서 오른쪽으로 놓았습니다.</p>
            </>
          )}
        </div>

        {later.length > 0 && (
          <div className="match-block">
            <h3>이어서 치를 경기</h3>
            <ul className="match-list">
              {later.map((match, i) => (
                <li key={i} className="match-row upcoming">
                  <span className="match-date num">{dateText(match.date, today)}</span>
                  <span className="match-time num">{match.time ?? ''}</span>
                  <Venue home={match.home} />
                  <span className="match-opponent">
                      <ClubLogo uid={match.clubUid} size={20} />
                      {opponentName(match)}
                    </span>
                  <span className="match-comp">{competition(match)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    )
  }

  const table = applied && season?.ok ? season.table : undefined
  return (
    <>
      <section className="panel season-panel" aria-labelledby="season-title">
        <div className="panel-head">
          <h2 id="season-title">경기 센터</h2>
          <div className="spacer" />
          {applied && season?.ok && season.today && (
            <span className="faint num">세이브 기준 {dateText(season.today)}</span>
          )}
        </div>
        <div className="panel-body">{body}</div>
      </section>

      {applied && season?.ok && (
        <section className="panel season-panel" aria-labelledby="table-title">
          <div className="panel-head">
            <h2 id="table-title">리그 순위</h2>
          </div>
          <div className="panel-body">
            {table ? (
              <div className="table-scroll">
                <table className="league-table">
                  <thead>
                    <tr>
                      <th scope="col" className="pos">순위</th>
                      <th scope="col" className="team">팀</th>
                      <th scope="col" title="치른 경기">경기</th>
                      <th scope="col">승</th>
                      <th scope="col">무</th>
                      <th scope="col">패</th>
                      <th scope="col" title="득점">득점</th>
                      <th scope="col" title="실점">실점</th>
                      <th scope="col" title="득점에서 실점을 뺀 값">득실</th>
                      <th scope="col" className="points">승점</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.map((row) => (
                      <tr key={row.teamId} className={row.mine ? 'mine' : undefined} aria-current={row.mine ? 'true' : undefined}>
                        <td className="pos num">{row.position}</td>
                        <th scope="row" className="team">
                          <ClubLogo uid={row.clubUid} size={20} className="table-logo" />
                          {row.name || '이름을 모르는 팀'}
                          {row.mine && <span className="tag squad">내 팀</span>}
                        </th>
                        <td className="num">{row.played}</td>
                        <td className="num">{row.won}</td>
                        <td className="num">{row.drawn}</td>
                        <td className="num">{row.lost}</td>
                        <td className="num">{row.goalsFor}</td>
                        <td className="num">{row.goalsAgainst}</td>
                        <td className="num">{row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
                        <td className="points num">{row.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">{season.tableMessage ?? '리그 순위를 읽지 못했습니다.'}</p>
            )}
            <p className="faint match-note">세이브에 저장된 시점의 순위입니다. 게임에서 저장하면 새로 읽습니다.</p>
          </div>
        </section>
      )}
    </>
  )
}
