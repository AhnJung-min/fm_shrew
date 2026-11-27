import { CircleAlert, CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AGE_RISK_FROM,
  AGE_RISK_FULL,
  FIT_GAP_SIGMAS,
  GOALKEEPERS_KEPT,
  NO_DASHBOARD,
  NO_SLOT_PREMIUM,
  OVERPAID_Z,
  OVERPAID_Z_STRONG,
  SURPLUS_WEIGHTS,
  UNKNOWN_RISK,
  WAGE_Z_FULL,
  type DashboardData,
  type DashContract,
  type DashDate,
  type DashPlayer,
  type LoanEntry,
  type SurplusRow,
  type Tone
} from '@shared/dashboard'
import type { LinkStatus } from '@shared/game'
import { withJosa } from '@shared/korean'
import { formatPounds } from '@shared/playerView'
import { RECOMMEND_TIER_LABEL, REALISM_LABEL, TIER_MEANING } from '@shared/recommend'
import type { SeasonResult } from '@shared/season'
import type { Settings, SquadResult } from '@shared/types'
import { benchLine, PROSPECT_MAX_AGE, PROSPECT_MIN_GAIN_SIGMA, PROSPECT_MIN_ROOM } from '@shared/world'
import { api } from '@/api'
import { ClubLogo } from '@/components/ClubLogo'
import { GameCards } from '@/components/GameCards'
import { MetaLine } from '@/components/MetaLine'
import { PlayerDrawer } from '@/components/PlayerDrawer'
import { PlayerFace } from '@/components/PlayerFace'
import { SeasonCenter } from '@/components/SeasonCenter'
import { formatTime } from '@/lib/format'
import '@/styles/season.css'
import '@/styles/dashboard.css'

const TONE_WORD: Record<Tone, string> = { good: '좋음', warn: '주의', bad: '위험', info: '참고' }
/** 톤은 색만이 아니라 아이콘과 글자로도 알린다 */
const TONE_ICON: Record<Tone, LucideIcon> = { good: CircleCheck, warn: TriangleAlert, bad: OctagonAlert, info: Info }

const dateText = (date: DashDate): string => `${date.year}.${date.month}.${date.day}`
const isoDate = (date: DashDate): string => `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
const pounds = (value: number | null): string => (value ? formatPounds(value) || '확인 못 함' : '확인 못 함')

function monthsLeft(days: number): string {
  if (days < 0) return '이미 끝남'
  if (days < 31) return `${days}일 남음`
  return `${Math.round(days / 30.44)}개월 남음`
}

/** 카드 하나: 제목, 한 줄 설명, 내용, 그리고 값을 어디서 읽었는지 */
function Card(props: {
  id?: string
  title: string
  hint: string
  source: string
  wide?: boolean
  hero?: boolean
  action?: ReactNode
  children: ReactNode
}) {
  const { id, title, hint, source, wide, hero, action, children } = props
  return (
    <section
      className={['dash-card', wide ? 'wide' : '', hero ? 'hero' : ''].filter(Boolean).join(' ')}
      aria-labelledby={id ? `${id}-title` : undefined}
      id={id}
    >
      <header className="dash-card-head">
        <div>
          <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
          <p className="dash-hint">{hint}</p>
        </div>
        {action}
      </header>
      <div className="dash-card-body">{children}</div>
      <footer className="dash-source">출처: {source}</footer>
    </section>
  )
}

function Empty(props: { children: ReactNode }) {
  return <p className="dash-empty">{props.children}</p>
}

/** 선수 이름 단추: 누르면 선수 정보를 연다 */
function Who(props: { player: Pick<DashPlayer, 'uid' | 'name'>; onOpen: (uid: number) => void }) {
  const { player, onOpen } = props
  return (
    <button className="dash-name" onClick={() => onOpen(player.uid)} title="선수 정보 보기">
      {player.name}
    </button>
  )
}

/** 값마다 출처가 다르면 둘 다, 같으면 한 번만 적는다 */
function sourceOf(save: string, ability: string, saveWhat = '', abilityWhat = ''): string {
  if (save === ability) return save
  return `${save}${saveWhat ? `(${saveWhat})` : ''}, ${ability}${abilityWhat ? `(${abilityWhat})` : ''}`
}

/** 정리 후보 점수 구성의 적합도 항목 이름(어떻게 정했는가에 따라 다르다) */
const FIT_PART_LABEL: Record<SurplusRow['fit'], string> = {
  slot: '적합도 차이',
  noSlot: '자리 없음',
  keeper: '골키퍼 인원',
  unknown: '적합도'
}

const metaItems = (player: DashPlayer): string[] => [player.age !== null ? `${player.age}세` : '', player.position]

export function Dashboard(props: {
  dataKey: string
  link: LinkStatus
  settings: Settings
  onGoStart: () => void
  onGoSquad: () => void
  onFindTargets: (slot: { formation: string; index: number }) => void
}) {
  const { dataKey, link, settings, onGoStart, onGoSquad, onFindTargets } = props
  const [data, setData] = useState<DashboardData | null>(null)
  const [season, setSeason] = useState<SeasonResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [squad, setSquad] = useState<SquadResult | null>(null)
  const [opened, setOpened] = useState<number | null>(null)
  const seasonRef = useRef<HTMLDivElement>(null)
  const applied = link.data.save !== null

  useEffect(() => {
    if (!applied) {
      setData(null)
      setSeason(null)
      setLoading(false)
      return
    }
    if (link.busy) return
    let alive = true
    setLoading(true)
    const failed: DashboardData = { ...NO_DASHBOARD, message: '대시보드 자료를 만들지 못했습니다.' }
    void Promise.all([
      api.worldDashboard().catch(() => failed),
      api.worldSeason().catch((): SeasonResult => ({ ok: false, message: '경기 기록을 읽지 못했습니다.', recent: [], upcoming: [] })),
      api.worldSquad().catch(() => null)
    ]).then(([dash, seasonResult, squadResult]) => {
      if (!alive) return
      setData(dash)
      setSeason(seasonResult)
      setSquad(squadResult)
      setLoading(false)
    })
    return () => {
      alive = false
    }
    // 세이브·게임 값이 바뀌거나 전술 설정을 고치면 다시 받는다
  }, [dataKey, applied, link.busy, settings.formation, settings.slotRoles, settings.roleWeights])

  if (!applied) {
    return (
      <>
        <header className="page-head">
          <h1>대시보드</h1>
          <span className="page-sub">구단 현황과 할 일을 한눈에 봅니다.</span>
        </header>
        <div className="page-body">
          <div className="empty guide">
            <strong>세이브를 적용하면 대시보드가 채워집니다</strong>
            시작 화면에서 FM이 켜져 있는지 확인하고, 쓸 세이브를 골라 적용해 주세요.
            <p style={{ marginTop: 14, textAlign: 'center' }}>
              <button className="btn primary" onClick={onGoStart}>
                시작 화면으로
              </button>
            </p>
          </div>
        </div>
      </>
    )
  }

  const info = data?.meta
  const saveSource = info?.gameDate ? `세이브 기준 ${isoDate(info.gameDate)}` : '세이브 기준'
  const abilitySource = info?.abilitySource === 'game' && info.liveAt ? `게임 지금 값(${formatTime(info.liveAt)}에 받음)` : saveSource
  const selected = opened !== null && squad?.ok ? squad.rows.find((row) => row.idx === opened) : undefined

  let body: ReactNode
  if (!data) {
    body = <Empty>{loading || link.busy ? '세이브에서 구단 자료를 계산하는 중입니다.' : '대시보드 자료를 아직 읽지 않았습니다.'}</Empty>
  } else if (!data.ok) {
    body = (
      <p className="chat-caution" role="status">
        <CircleAlert size={15} />
        {data.message ?? '대시보드 자료를 만들지 못했습니다.'}
      </p>
    )
  } else {
    body = (
      <Cards
        data={data}
        link={link}
        season={season}
        saveSource={saveSource}
        abilitySource={abilitySource}
        loading={loading}
        onOpen={setOpened}
        onGoSquad={onGoSquad}
        onFindTargets={onFindTargets}
        seasonRef={seasonRef}
      />
    )
  }

  return (
    <>
      <header className="page-head">
        <h1>대시보드</h1>
        <span className="page-sub">구단 현황과 할 일을 한눈에 봅니다.</span>
        <div className="spacer" />
        {info && (
          <span className="faint num">
            <MetaLine items={[info.club, info.saveName, saveSource]} />
          </span>
        )}
      </header>
      <div className="page-body dash">{body}</div>
      {selected && squad?.ok && (
        <div className="dash-drawer">
          <PlayerDrawer columns={squad.columns} row={selected} onClose={() => setOpened(null)} />
        </div>
      )}
    </>
  )
}

function Cards(props: {
  data: DashboardData
  link: LinkStatus
  season: SeasonResult | null
  saveSource: string
  abilitySource: string
  loading: boolean
  onOpen: (uid: number) => void
  onGoSquad: () => void
  onFindTargets: (slot: { formation: string; index: number }) => void
  seasonRef: React.RefObject<HTMLDivElement | null>
}) {
  const { data, link, season, saveSource, abilitySource, loading, onOpen, onGoSquad, onFindTargets, seasonRef } = props
  const { squad, contracts, surplus, overpaid, recommend, brief } = data
  const loans = squad.loans

  const loanList = (title: string, list: LoanEntry[], empty: string): ReactNode => (
    <details className="dash-fold">
      <summary>
        <span>{title}</span>
        <strong className="num">{list.length}명</strong>
      </summary>
      {list.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="dash-list">
          {list.map((entry) => (
            <li key={`${entry.uid}-${entry.name}`}>
              <Who player={entry} onOpen={onOpen} />
              <span className="faint">
                <MetaLine items={metaItems(entry)} />
              </span>
              <span className="dash-grow" />
              <span className="dash-inline">
                <ClubLogo uid={entry.otherClubUid} size={18} />
                {entry.otherClub || '구단 확인 못 함'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  )

  const contractList = (title: string, list: DashContract[], empty: string): ReactNode => (
    <div className="dash-sub">
      <h3>
        {title} <span className="num">{list.length}명</span>
      </h3>
      {list.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="dash-list">
          {list.slice(0, 10).map((row) => (
            <li key={row.uid}>
              <Who player={row} onOpen={onOpen} />
              <span className="dash-grow" />
              <span className="num">{dateText(row.end)}</span>
              <span className="faint num dash-w">{monthsLeft(row.daysLeft)}</span>
              <span className="num dash-w">{row.wage ? `주급 ${pounds(row.wage)}` : '주급 확인 못 함'}</span>
            </li>
          ))}
          {list.length > 10 && <li className="faint">외 {list.length - 10}명</li>}
        </ul>
      )}
    </div>
  )

  return (
    <>
      <Card
        wide
        hero
        id="dash-brief"
        title="오늘의 브리핑"
        hint="세이브에서 확인된 사실만 짧게 요약합니다. 자료가 없는 항목은 건너뜁니다."
        source={saveSource}
        action={
          <button className="btn ghost" onClick={() => seasonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            현재 디비전 순위
          </button>
        }
      >
        {brief.length === 0 ? (
          <Empty>이 세이브에서 요약할 만한 경기·계약 자료를 찾지 못했습니다.</Empty>
        ) : (
          <ul className="brief">
            {brief.map((line) => {
              const ToneIcon = TONE_ICON[line.tone]
              return (
                <li key={line.id} className={`brief-${line.tone}`}>
                  <span className="brief-tone">
                    <ToneIcon size={15} aria-hidden="true" />
                    {TONE_WORD[line.tone]}
                  </span>
                  <span>{line.text}</span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <div className="dash-wide">
        <GameCards link={link} />
      </div>

      <Card
        id="dash-squad"
        title="선수단 현황"
        hint="1군과 산하 팀의 인원, 임대로 들어오고 나간 선수입니다."
        source={`${saveSource} (선수 소속·계약 기록)`}
      >
        <div className="dash-stats">
          <div>
            <span className="dash-stat-label">1군</span>
            <strong className="dash-big num">{squad.firstTeam}</strong>
            <span className="dash-unit">명</span>
          </div>
          <div>
            <span className="dash-stat-label">임대 영입</span>
            <strong className="dash-big num">{loans ? loans.in.length : '–'}</strong>
            <span className="dash-unit">{loans ? '명' : '확인 못 함'}</span>
          </div>
          <div>
            <span className="dash-stat-label">임대 방출</span>
            <strong className="dash-big num">{loans ? loans.out.length : '–'}</strong>
            <span className="dash-unit">{loans ? '명' : '확인 못 함'}</span>
          </div>
        </div>
        <ul className="dash-teams">
          {squad.teams.map((team) => (
            <li key={team.teamId}>
              <span>{team.first ? `${team.name || '1군'} (1군)` : team.name || '산하 팀 (이름 확인 못 함)'}</span>
              <span className="dash-grow" />
              <span className="num">{team.players}명</span>
              <span className="faint num dash-w">{team.averageAge !== null ? `평균 ${team.averageAge}세` : ''}</span>
            </li>
          ))}
        </ul>
        {squad.teams.some((team) => !team.first && !team.name) && (
          <p className="dash-note">산하 팀 이름은 게임이 켜져 있을 때 한 번 받아 두면 채워집니다. 지금은 평균 나이로 짐작해 보세요.</p>
        )}
        {loans ? (
          <>
            {loanList('임대 영입 선수', loans.in, '다른 구단에서 빌려 온 선수가 없습니다.')}
            {loanList('임대 방출 선수', loans.out, '다른 구단에 빌려 준 선수가 없습니다.')}
            <p className="dash-note">
              임대는 계약 기록에서 읽었습니다: 원 소속과 맺은 계약과, 임대받은 팀과 맺은 기간 없는 기록이 함께 있는 선수입니다.
            </p>
          </>
        ) : (
          <p className="dash-note">{squad.loanNote ?? '임대 선수는 확인 못 함'}</p>
        )}
      </Card>

      <Card
        id="dash-age"
        title="연령 구조"
        hint="1군 선수를 네 구간으로 나눈 인원과 비율입니다. 구간을 누르면 선수가 보입니다."
        source={saveSource}
      >
        {squad.ages.known === 0 ? (
          <Empty>선수 나이를 확인 못 함</Empty>
        ) : (
          <>
            <div className="bands">
              {squad.ages.bands.map((band) => (
                <details key={band.id} className="band">
                  <summary>
                    <span className="band-label">{band.label}</span>
                    <span className="band-bar" aria-hidden="true">
                      <span style={{ width: `${Math.round(band.share * 100)}%` }} />
                    </span>
                    <strong className="num band-count">{band.count}명</strong>
                    <span className="faint num band-share">{Math.round(band.share * 100)}%</span>
                  </summary>
                  {band.players.length === 0 ? (
                    <Empty>이 구간에 선수가 없습니다.</Empty>
                  ) : (
                    <ul className="dash-list">
                      {band.players.map((player) => (
                        <li key={player.uid}>
                          <Who player={player} onOpen={onOpen} />
                          <span className="faint">{player.position}</span>
                          <span className="dash-grow" />
                          <span className="num">{player.age}세</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              ))}
            </div>
            <p className="dash-note num">
              <MetaLine items={[`평균 ${squad.ages.average}세`, `나이를 아는 선수 ${squad.ages.known}명 기준`]} />
            </p>
          </>
        )}
      </Card>

      <Card
        wide
        id="dash-contracts"
        title="계약 만료 예정"
        hint={`오늘부터 1년 안, 그 뒤 1년 안에 계약이 끝나는 1군 선수입니다.${contracts.wageWithin1y ? ` 1년 안에 끝나는 계약의 주급 합계는 ${pounds(contracts.wageWithin1y)}입니다.` : ''}`}
        source={saveSource}
      >
        {contracts.known === 0 ? (
          <Empty>계약 만료일을 확인 못 함</Empty>
        ) : (
          <div className="dash-two">
            {contractList('1년 이내', contracts.within1y, '1년 안에 끝나는 계약이 없습니다.')}
            {contractList('1~2년', contracts.within2y, '1~2년 사이에 끝나는 계약이 없습니다.')}
          </div>
        )}
      </Card>

      <div className="dash-season" ref={seasonRef}>
        <SeasonCenter season={season} applied loading={loading} />
      </div>

      <Card
        id="dash-surplus"
        title="정리 후보 TOP 5"
        hint="지금 전술에서 선발도 첫 후보도 아닌 1군 선수 가운데 정리를 생각해 볼 만한 순서입니다."
        source={sourceOf(saveSource, abilitySource)}
        action={
          <button className="btn ghost" onClick={onGoSquad}>
            목록 열기
          </button>
        }
      >
        {!surplus.ok ? (
          <Empty>{surplus.message}</Empty>
        ) : surplus.rows.length === 0 ? (
          <Empty>정리 후보로 볼 선수가 없습니다.</Empty>
        ) : (
          <ol className="rank">
            {surplus.rows.map((row) => (
              <li key={row.uid}>
                <div className="rank-head">
                  <Who player={row} onOpen={onOpen} />
                  <span className="faint">
                    <MetaLine items={metaItems(row)} />
                  </span>
                  <span className="dash-grow" />
                  <span className="rank-score num" title="정리 후보 점수(0~100). 높을수록 정리할 만합니다">
                    {Math.round(row.score)}
                    <small>점</small>
                  </span>
                </div>
                <p>{row.reason}</p>
                <p className="faint num">
                  <MetaLine
                    items={[
                      '점수 구성',
                      `${FIT_PART_LABEL[row.fit]} ${row.parts.fit}점${row.unknown.includes('fit') ? '(확인 못 함, 보통으로 봄)' : ''}`,
                      `주급 ${row.parts.wage}점${row.unknown.includes('wage') ? '(확인 못 함, 보통으로 봄)' : ''}`,
                      `나이와 정체 ${row.parts.age}점${row.unknown.includes('age') ? '(확인 못 함, 보통으로 봄)' : ''}`
                    ]}
                  />
                </p>
              </li>
            ))}
          </ol>
        )}
        {surplus.ok && surplus.prospects.length > 0 && (
          <div className="dash-sub">
            <h3>임대 보내 키울 선수</h3>
            <ul className="rank">
              {surplus.prospects.map((row) => (
                <li key={row.uid}>
                  <div className="rank-head">
                    <Who player={row} onOpen={onOpen} />
                    <span className="faint">
                      <MetaLine items={metaItems(row)} />
                    </span>
                    <span className="dash-grow" />
                    <span className="num">
                      현재 {row.ca} → 잠재 {row.pa}
                    </span>
                  </div>
                  <p>{row.reason}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        <details className="dash-fold how">
          <summary>
            <span>점수를 어떻게 매겼나</span>
          </summary>
          <p>
            적합도 차이 {SURPLUS_WEIGHTS.fit}% + 주급 부담 {SURPLUS_WEIGHTS.wage}% + 나이·정체 {SURPLUS_WEIGHTS.age}%를 0~100점으로
            합칩니다(주급이나 나이를 모르면 보통 {UNKNOWN_RISK}으로 봅니다).
          </p>
          <ul>
            <li>
              적합도: 자리가 있으면, 뛸 수 있는 자리 가운데 첫 후보와 가장 가까운 자리의 점수 차이를 그 자리 역할의 표준편차(σ)로 잰 뒤 {FIT_GAP_SIGMAS}σ로 나눕니다.
              포지션 숙련이 20보다 낮으면 스쿼드·영입 후보와 같게 그만큼 뺀 점수로 견줍니다.
            </li>
            <li>
              자리가 없으면: 현재 전술에 뛸 자리가 없는 선수는 가장 잘 맞는 역할로 본 점수가 지금 주전 가운데 가장 약한 선수보다 얼마나 낮은지에 {NO_SLOT_PREMIUM}σ를 더해 같은 식으로
              잽니다. 실력이 주전급이면 자리가 없어도 낮게 나옵니다.
            </li>
            <li>골키퍼: 능력이 높은 {GOALKEEPERS_KEPT}명은 빼고, 4번째 이후는 인원이 많아서 최대입니다.</li>
            <li>
              주급 부담: 같은 리그에서 현재 능력과 나이가 비슷한 선수의 기대 주급보다 표준편차(σ) 몇 배 높은가입니다. 기대 이하면 0, +{WAGE_Z_FULL}σ 이상이면 최대입니다.
              아래 주급 과다 의심과 같은 기준입니다.
            </li>
            <li>
              나이·정체: {AGE_RISK_FROM}세 이하 0에서 {AGE_RISK_FULL}세 이상 최대까지의 나이, 잠재가 현재보다 20 이상 높으면 0인 성장 여지를 6 대 4로 섞습니다.
            </li>
            <li>
              뺀 선수: 선발과 첫 후보, 능력이 높은 골키퍼 {GOALKEEPERS_KEPT}명, 임대로 들어온 선수(이 구단이 정리할 수 없음), 그리고 클 여지가 있는 어린 선수(따로 보여 줍니다).
            </li>
            <li>
              클 여지: {PROSPECT_MAX_AGE}세 이하이고 잠재가 현재보다 {PROSPECT_MIN_ROOM} 이상 높으며, 다 컸을 때 적합도가 {PROSPECT_MIN_GAIN_SIGMA}σ 이상 오르는 선수입니다. 영입 후보의
              유망주 유형과 같은 기준입니다.
            </li>
            <li>전술은 스쿼드 전술판과 같은 포메이션({surplus.formation})과 역할 설정을 씁니다.</li>
          </ul>
        </details>
      </Card>

      <Card
        id="dash-overpaid"
        title="주급 과다 의심 TOP 5"
        hint="같은 리그 선수들의 주급을 현재 능력과 나이로 맞춘 식에서 1 표준편차 넘게 높은 1군 선수입니다. 임대로 들어온 선수는 뺍니다. 기대보다 얼마나 높은지(σ) 순서입니다."
        source={sourceOf(saveSource, abilitySource, '주급', '현재 능력')}
        action={
          <button className="btn ghost" onClick={onGoSquad}>
            목록 열기
          </button>
        }
      >
        {!overpaid.ok ? (
          <Empty>{overpaid.message}</Empty>
        ) : overpaid.rows.length === 0 ? (
          <Empty>기준(기대보다 {OVERPAID_Z}σ 높음)을 넘게 받는 선수가 없습니다.</Empty>
        ) : (
          <ol className="rank">
            {overpaid.rows.map((row) => (
              <li key={row.uid}>
                <div className="rank-head">
                  <Who player={row} onOpen={onOpen} />
                  <span className="faint">
                    <MetaLine items={metaItems(row)} />
                  </span>
                  <span className="dash-grow" />
                  <span className="rank-score num" title="기대 주급보다 표준편차의 몇 배 높은가(z)">
                    +{row.z.toFixed(1)}
                    <small>σ</small>
                  </span>
                </div>
                <p className="num">
                  {withJosa(`주급 ${pounds(row.wage)}`, '은/는')} 같은 리그에서 현재 능력 {row.ca}
                  {row.age !== null ? `, ${row.age}세` : ''}인 선수의 기대 주급 {pounds(row.expected)}의 {row.ratio.toFixed(2)}배(+{row.z.toFixed(1)}σ)입니다
                  {row.strong ? `(강한 의심: ${OVERPAID_Z_STRONG}σ 이상)` : ''}. 기대보다 {pounds(row.excess)} 많습니다.
                </p>
              </li>
            ))}
          </ol>
        )}
        {overpaid.model && (
          <p className="dash-note num">
            기준선: 주급의 로그 = {overpaid.model.a.toFixed(2)} + {overpaid.model.b.toFixed(3)} × 현재 능력 {overpaid.model.c1 < 0 ? '−' : '+'}{' '}
            {Math.abs(overpaid.model.c1).toFixed(2)} × [21세 미만] {overpaid.model.c2 < 0 ? '−' : '+'} {Math.abs(overpaid.model.c2).toFixed(2)} × [30세 이상] (설명력 R²{' '}
            {overpaid.model.r2.toFixed(2)}, 잔차 표준편차 {overpaid.model.s.toFixed(2)}).
            {overpaid.model.scope === 'league'
              ? ` 내 리그 ${overpaid.model.teams}개 팀의 선수 ${overpaid.model.n.toLocaleString()}명 기준.`
              : ` 순위표를 읽지 못해 구단이 있는 모든 남자 선수 ${overpaid.model.n.toLocaleString()}명 기준.`}
            {` 의심: 기대 주급의 ${Math.exp(overpaid.model.s * OVERPAID_Z).toFixed(2)}배(+${OVERPAID_Z}σ) 이상, 강한 의심: ${Math.exp(overpaid.model.s * OVERPAID_Z_STRONG).toFixed(2)}배(+${OVERPAID_Z_STRONG}σ) 이상.`}
            {overpaid.total > overpaid.rows.length && ` 기준을 넘는 선수는 모두 ${overpaid.total}명입니다.`}
          </p>
        )}
      </Card>

      <Card
        wide
        id="dash-recommend"
        title="영입 추천"
        hint="지금 전술에서 보강이 가장 급한 자리의 즉시 전력 후보 3명입니다. 추천 점수는 능력, 나이, 비용 부담, 영입 난이도를 합친 값입니다."
        source={sourceOf(saveSource, abilitySource, '계약·몸값', '능력')}
        action={
          recommend.slot && (
            <button className="btn" onClick={() => onFindTargets({ formation: recommend.slot!.formation, index: recommend.slot!.index })}>
              목록 열기
            </button>
          )
        }
      >
        {recommend.slot && (
          <p className="rec-slot">
            <MetaLine
              items={[
                <strong key="slot">
                  {recommend.slot.label} ({recommend.slot.roleLabel})
                </strong>,
                <span key="need">
                  보강 필요도 <span className="num">{recommend.slot.need}</span>점({recommend.slot.levelLabel})
                </span>,
                <span key="tier" className="faint">
                  등급: {TIER_MEANING.starter}
                </span>,
                <span key="now" className="faint num">
                  {benchLine(recommend.slot.bench, recommend.slot.groupSlots)}
                </span>
              ]}
            />
          </p>
        )}
        {!recommend.ok || recommend.rows.length === 0 ? (
          <Empty>{recommend.message ?? '추천할 선수를 찾지 못했습니다.'}</Empty>
        ) : (
          <ul className="rec-cards">
            {recommend.rows.map((row) => {
              return (
                <li key={row.uid} className="rec-card">
                  <div className="rec-top">
                    <PlayerFace uid={row.uid} name={row.name} size={44} />
                    <div className="rec-who">
                      <strong>{row.name}</strong>
                      <span className="faint">
                        <MetaLine items={[row.age !== null ? `${row.age}세` : '', row.position]} />
                      </span>
                    </div>
                    <div className="rec-total">
                      <strong className="num">{Math.round(row.total)}</strong>
                      <span className={`rec-tier tier-${row.tier}`}>{RECOMMEND_TIER_LABEL[row.tier]}</span>
                    </div>
                  </div>
                  <div className="rec-club">
                    <ClubLogo uid={row.clubUid} size={20} />
                    <span>{row.club || '소속 확인 못 함'}</span>
                    {row.loanedTo && <span className="faint">임대 중: {row.loanedTo}</span>}
                    {row.realism.low && (
                      <span className="tag warn" title={row.realism.reasons.join(' / ')}>
                        {REALISM_LABEL}
                      </span>
                    )}
                  </div>
                  {row.realism.low && <p className="faint">{row.realism.reasons.join('. ')}. 등급은 고려까지로 제한했습니다.</p>}
                  <p className="faint num">
                    <MetaLine
                      items={[
                        `현재 능력 ${row.ca}`,
                        `잠재 ${row.pa}`,
                        row.gap !== null && `주전과 적합도 ${row.gap > 0 ? '+' : ''}${row.gap.toFixed(1)}`
                      ]}
                    />
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
