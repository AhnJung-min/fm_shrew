import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClubSnapshot, FacilityItem, FinanceItem, PlayerHealth } from '@shared/club'
import type { LinkStatus } from '@shared/game'
import { api } from '@/api'
import { PlayerFace } from '@/components/PlayerFace'
import '@/styles/gamecards.css'

/** 이 시간마다 게임에 다시 묻는다(앱 쪽에서도 몇 분 기억해 두므로 게임에 부담은 거의 없다) */
const REFRESH_MS = 3 * 60_000

const UNKNOWN = '게임에서 읽지 못함'

function clock(iso: string | null): string {
  if (!iso) return ''
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** 값 한 줄. 읽지 못한 값은 빈칸 대신 그렇다고 적는다 */
function Row(props: { label: string; value: string | null; hint?: string | null }) {
  const { label, value, hint } = props
  return (
    <div className="gc-row">
      <dt>{label}</dt>
      <dd className={value === null ? 'gc-unknown' : undefined}>
        {value ?? UNKNOWN}
        {value !== null && hint ? <small>{hint}</small> : null}
      </dd>
    </div>
  )
}

/** 숫자만 있는 글자에는 단위를 붙인다(게임이 이미 단위를 붙여 준 글자는 그대로) */
function withUnit(value: string | null, unit: string): string | null {
  return value !== null && /^[\d,.]+$/.test(value) ? `${value}${unit}` : value
}

function Source(props: { at: string | null }) {
  const time = clock(props.at)
  return <p className="gc-source">{time ? `게임 지금 값, ${time}` : '게임에서 읽은 값'}</p>
}

function Profile(props: { snapshot: ClubSnapshot }) {
  const profile = props.snapshot.profile
  if (!profile) return null
  const capacity = withUnit(profile.capacity, '석')
  const stadium = profile.stadium === null ? null : capacity ? `${profile.stadium} (${capacity})` : profile.stadium
  return (
    <section className="gc-block" aria-labelledby="gc-profile">
      <h3 id="gc-profile">구단 프로필</h3>
      <dl>
        <Row label="리그" value={profile.division} hint={withUnit(profile.leaguePosition, '위')} />
        <Row label="홈 경기장" value={stadium} />
        <Row label="평균 관중" value={profile.averageAttendance} />
        <Row label="시즌 티켓" value={withUnit(profile.seasonTickets, '명')} />
        <Row label="창단" value={profile.founded === null ? null : `${profile.founded}년`} />
      </dl>
      <Source at={props.snapshot.readAt} />
    </section>
  )
}

function Facility(props: { item: FacilityItem }) {
  const { item } = props
  const share = item.level ? Math.min(1, item.level.value / item.level.max) : 0
  const tone = share >= 0.7 ? 'high' : share >= 0.4 ? 'mid' : 'low'
  return (
    <div className="gc-facility">
      <span className="gc-facility-name">{item.label}</span>
      {item.level ? (
        <span
          className={`gc-bar gc-${tone}`}
          role="meter"
          aria-label={`${item.label} ${item.level.value} / ${item.level.max}`}
          aria-valuemin={0}
          aria-valuemax={item.level.max}
          aria-valuenow={item.level.value}
        >
          <i style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
      ) : (
        <span className="gc-bar gc-none" aria-hidden="true" />
      )}
      <span className={item.text === null ? 'gc-facility-text gc-unknown' : 'gc-facility-text'}>
        {item.text ?? UNKNOWN}
        {item.text !== null && item.level ? <small>{`${item.level.value} / ${item.level.max}`}</small> : null}
      </span>
    </div>
  )
}

function Facilities(props: { snapshot: ClubSnapshot }) {
  return (
    <section className="gc-block" aria-labelledby="gc-facilities">
      <h3 id="gc-facilities">시설</h3>
      <div className="gc-facilities">
        {props.snapshot.facilities.map((item) => (
          <Facility key={item.id} item={item} />
        ))}
      </div>
      <Source at={props.snapshot.readAt} />
    </section>
  )
}

function Finance(props: { item: FinanceItem }) {
  const { item } = props
  return (
    <Row
      label={item.label}
      value={item.text}
      hint={item.note}
    />
  )
}

function Finances(props: { snapshot: ClubSnapshot }) {
  return (
    <section className="gc-block" aria-labelledby="gc-finances">
      <h3 id="gc-finances">재정</h3>
      <dl>
        {props.snapshot.finances.map((item) => (
          <Finance key={item.id} item={item} />
        ))}
      </dl>
      {props.snapshot.finances.some((item) => item.converted) ? (
        <p className="gc-note">게임이 단위 없이 알려 준 금액은 게임의 기준 통화(파운드)로 보고 원화로 바꿔(1파운드 = 1,920원) 적었습니다. 게임 화면의 금액과 조금 다를 수 있습니다.</p>
      ) : null}
      <Source at={props.snapshot.readAt} />
    </section>
  )
}

/** 선수 한 줄: 얼굴, 이름, 포지션, 설명 */
function Person(props: { player: PlayerHealth; detail: string }) {
  const { player, detail } = props
  return (
    <li className="gc-person">
      <PlayerFace uid={player.uid} name={player.name} size={28} />
      <span className="gc-person-name">
        {player.name}
        <small>{player.position}</small>
      </span>
      <span className="gc-person-detail">{detail}</span>
    </li>
  )
}

function Group(props: { title: string; empty: string; players: PlayerHealth[]; detail: (player: PlayerHealth) => string; show: boolean }) {
  const { title, empty, players, detail, show } = props
  if (!show) return null
  return (
    <div className="gc-group">
      <h4>
        {title}
        <span>{players.length > 0 ? `${players.length}명` : ''}</span>
      </h4>
      {players.length === 0 ? (
        <p className="gc-empty">{empty}</p>
      ) : (
        <ul>
          {players.map((player) => (
            <Person key={player.uid} player={player} detail={detail(player)} />
          ))}
        </ul>
      )}
    </div>
  )
}

const injuryDetail = (player: PlayerHealth): string => {
  const name = player.injury ?? '부상(종류를 게임에서 읽지 못함)'
  return player.injuryReturn ? `${name}, 복귀까지 ${player.injuryReturn}` : `${name}, 복귀 시기를 게임에서 읽지 못함`
}

function Health(props: { snapshot: ClubSnapshot }) {
  const { snapshot } = props
  const report = snapshot.report
  if (!report) return null
  const known = report.answered > 0
  const rating = (player: PlayerHealth): string => {
    const average = player.rating === null ? UNKNOWN : `평균 평점 ${player.rating.toFixed(2)}`
    const games = player.appearances === null ? '' : `, ${player.appearances}경기`
    const last = player.lastRating === null ? '' : `, 최근 ${player.lastRating.toFixed(1)}`
    return `${average}${games}${last}`
  }
  return (
    <section className="gc-block gc-health" aria-labelledby="gc-health">
      <h3 id="gc-health">선수단 건강</h3>
      {!known ? (
        <p className="gc-empty">{`게임이 선수 ${snapshot.players.length}명의 상태를 알려 주지 않았습니다. 게임에서 이 세이브를 불러왔는지 확인해 주세요.`}</p>
      ) : (
        <>
          <p className="gc-count">{`1군 ${snapshot.players.length}명 중 ${report.answered}명의 상태를 읽었습니다.`}</p>
          <div className="gc-groups">
            <Group title="부상" empty="부상 선수가 없습니다." players={report.injured} detail={injuryDetail} show />
            <Group
              title="징계"
              empty="징계 중인 선수가 없습니다."
              players={report.suspended}
              detail={(player) => player.suspension ?? '징계 중'}
              show
            />
            <Group
              title="컨디션이 낮은 선수"
              empty="컨디션이 낮은 선수가 없습니다."
              players={report.lowCondition}
              detail={(player) => `컨디션 ${player.condition}%`}
              show
            />
            <Group
              title="경기 감각이 낮은 선수"
              empty="경기 감각이 낮은 선수가 없습니다."
              players={report.lowSharpness}
              detail={(player) => `경기 감각 ${player.sharpness}%`}
              show
            />
            <Group
              title="사기가 가장 낮은 선수"
              empty=""
              players={report.lowMorale}
              detail={(player) => `사기 ${player.moraleText ?? player.morale}`}
              show={report.lowMorale.length > 0}
            />
            <Group title="이번 시즌 평점이 높은 선수" empty="" players={report.bestForm} detail={rating} show={report.bestForm.length > 0} />
            <Group title="이번 시즌 평점이 낮은 선수" empty="" players={report.worstForm} detail={rating} show={report.worstForm.length > 0} />
          </div>
        </>
      )}
      <Source at={snapshot.readAt} />
    </section>
  )
}

/** 게임이 알려 준 항목과 그 경로(처음 켜 봤을 때 값이 맞는지 확인하는 용도) */
function Paths(props: { paths: Record<string, string> }) {
  const entries = Object.entries(props.paths)
  if (entries.length === 0) return null
  return (
    <details className="gc-paths">
      <summary>읽은 항목과 경로 확인</summary>
      <ul>
        {entries.map(([key, path]) => (
          <li key={key}>
            <code>{key}</code>
            <span>{path}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * 대시보드에서 켜져 있는 게임에 물어 채우는 카드들(구단 프로필·시설·재정, 선수단 건강).
 * 세이브에는 없거나 해독하지 못한 값이라 게임이 켜져 있을 때만 채워진다.
 */
export function GameCards(props: { link: LinkStatus }) {
  const { link } = props
  const [snapshot, setSnapshot] = useState<ClubSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const latest = useRef(0)
  const connected = link.game.connected

  const load = useCallback(async (force: boolean) => {
    const turn = ++latest.current
    setLoading(true)
    try {
      const next = await api.worldClub(force)
      if (turn === latest.current) setSnapshot(next)
    } catch {
      if (turn === latest.current) setSnapshot(null)
    } finally {
      if (turn === latest.current) setLoading(false)
    }
  }, [])

  // 게임에 들어가거나 세이브·플러그인 상태가 바뀌면 다시 읽고, 켜져 있는 동안은 주기적으로 읽는다
  const watch = `${connected}|${link.game.loaded}|${link.game.pluginVersion}|${link.game.team}|${link.data.save?.path ?? ''}|${link.data.hasTeam}`
  useEffect(() => {
    if (!connected) {
      latest.current++
      setSnapshot(null)
      setLoading(false)
      return
    }
    void load(false)
    const timer = window.setInterval(() => void load(false), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [watch, connected, load])

  if (!connected) {
    return (
      <p className="note-idle game-cards-off" aria-label="구단 현황">
        <span className="dot idle" aria-hidden="true" />
        구단 재정·시설과 선수단 건강은 FM을 켜고 세이브를 불러오면 여기에 채워집니다.
      </p>
    )
  }

  return (
    <section className="dash-card game-cards" aria-label="구단 현황" aria-busy={loading}>
      <header className="gc-head">
        <h2>구단 재정·시설과 선수단 건강</h2>
        <button type="button" className="gc-refresh" onClick={() => void load(true)} disabled={loading}>
          {loading ? '읽는 중' : '다시 읽기'}
        </button>
      </header>
      {snapshot === null ? (
        <p className="gc-off">{loading ? '게임에서 읽는 중입니다. 몇 초 걸릴 수 있습니다.' : '게임에서 값을 읽지 못했습니다. 잠시 뒤 “다시 읽기”를 눌러 주세요.'}</p>
      ) : !snapshot.ok ? (
        <p className="gc-off">{snapshot.message}</p>
      ) : (
        <>
          <div className="gc-grid">
            <Profile snapshot={snapshot} />
            <Facilities snapshot={snapshot} />
            <Finances snapshot={snapshot} />
          </div>
          <Health snapshot={snapshot} />
          <Paths paths={snapshot.paths} />
        </>
      )}
    </section>
  )
}
