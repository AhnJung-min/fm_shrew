import { CircleAlert, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ClubChoice } from '@shared/connect'
import { api } from '@/api'
import { ClubLogo } from '@/components/ClubLogo'
import { MetaLine } from '@/components/MetaLine'

/** 검색하지 않았을 때 보여 주는 구단 수(나머지는 이름으로 찾는다) */
const SHOWN = 40

/**
 * 내 구단 고르기(A-14). 게임이 꺼져 있어도 적용한 세이브의 구단 목록에서 내 구단을 골라 시작할 수 있다.
 * 세이브 요약에 감독이 맡은 구단으로 적힌 곳이 맨 앞에 나온다. 고르면 그 세이브의 내 구단으로 기억한다.
 */
export function ClubPicker(props: { busy: boolean; savePath: string; onChosen: () => void }) {
  const { busy, savePath, onChosen } = props
  const [clubs, setClubs] = useState<ClubChoice[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setClubs(null)
    void api.worldClubs().then((result) => {
      if (cancelled) return
      setClubs(result.clubs)
      setProblem(result.ok ? null : (result.message ?? '구단 목록을 읽지 못했습니다.'))
      // 감독이 맡았던 구단이 하나뿐이면 미리 골라 둔다(누르기만 하면 되게)
      const humans = result.clubs.filter((club) => club.human)
      setPicked(humans.length === 1 ? humans[0].teamId : null)
    })
    return () => {
      cancelled = true
    }
  }, [savePath])

  const shown = useMemo(() => {
    if (!clubs) return []
    const wanted = query.trim().toLowerCase()
    if (!wanted) return clubs.slice(0, SHOWN)
    return clubs.filter((club) => `${club.name} ${club.short} ${club.nation}`.toLowerCase().includes(wanted)).slice(0, SHOWN)
  }, [clubs, query])

  const choose = async (): Promise<void> => {
    if (picked === null) return
    setError(null)
    const result = await api.chooseTeam(picked)
    if (result.ok) onChosen()
    else setError(result.message)
  }

  if (problem) return <p className="muted">{problem}</p>
  return (
    <div className="club-picker">
      <p className="muted">
        내 구단을 아직 모릅니다. 게임을 켜지 않아도 아래에서 고르면 대시보드를 볼 수 있습니다. 게임에서 다른 구단으로 들어가 있으면 게임이 알려 준 구단을 따릅니다.
      </p>
      <label className="search-box">
        <Search size={15} />
        <input
          className="field"
          placeholder="구단 이름이나 나라로 찾기"
          aria-label="구단 찾기"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {clubs === null ? (
        <p className="muted">구단 목록을 만드는 중입니다.</p>
      ) : shown.length === 0 ? (
        <p className="muted">그런 구단이 없습니다.</p>
      ) : (
        <ul className="save-list club-list" role="radiogroup" aria-label="구단">
          {shown.map((club) => (
            <li key={club.teamId}>
              <label className={picked === club.teamId ? 'save-row on' : 'save-row'}>
                <input type="radio" name="club" checked={picked === club.teamId} disabled={busy} onChange={() => setPicked(club.teamId)} />
                <ClubLogo uid={club.uid} size={22} />
                <span className="save-name">{club.name}</span>
                {club.human && <span className="tag squad">게임에서 맡았던 구단</span>}
                {club.women && <span className="tag">여자 팀</span>}
                <span className="spacer" />
                <span className="muted num">
                  <MetaLine items={[club.nation, `선수 ${club.players}명`, `체급 ${club.strength}`]} />
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {clubs !== null && !query.trim() && clubs.length > SHOWN && <p className="faint">체급이 높은 순 {SHOWN}곳만 보입니다. 나머지는 이름으로 찾으세요.</p>}
      <div className="start-actions">
        <button className="btn primary" disabled={busy || picked === null} onClick={() => void choose()}>
          {busy ? '읽는 중…' : '이 구단으로 시작'}
        </button>
      </div>
      {error && (
        <p className="chat-caution" role="alert">
          <CircleAlert size={15} />
          {error}
        </p>
      )}
    </div>
  )
}
