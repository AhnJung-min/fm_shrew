import { CircleAlert, FolderOpen, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { NEEDED_PLUGIN, type LinkStatus, type SaveFileInfo } from '@shared/game'
import type { SeasonResult } from '@shared/season'
import type { AppStatus } from '@shared/types'
import { api } from '@/api'
import { SeasonCenter } from '@/components/SeasonCenter'
import type { Route } from '@/components/Sidebar'
import { formatBytes, formatTime } from '@/lib/format'
import '@/styles/season.css'

/**
 * 시작 화면. 순서대로: 게임이 켜져 있는지 보고, 쓸 세이브를 골라 적용하고, 그 자료로 다른 화면을 쓴다.
 */
export function Home(props: { status: AppStatus | null; link: LinkStatus; onNavigate: (route: Route) => void }) {
  const { status, link, onNavigate } = props
  const { game, data, busy } = link
  const [saves, setSaves] = useState<SaveFileInfo[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [season, setSeason] = useState<SeasonResult | null>(null)
  const [seasonLoading, setSeasonLoading] = useState(false)

  const loadSaves = useCallback(async (): Promise<void> => setSaves(await api.listSaves()), [])

  // 게임이 저장하면 목록의 저장 시각이 바뀐다
  useEffect(() => {
    void loadSaves()
  }, [loadSaves, data.save?.savedAt])

  const applied = data.save?.path ?? null

  // 세이브를 (다시) 읽어 적용했거나 게임이 다시 저장했을 때 경기 기록을 새로 받는다
  useEffect(() => {
    if (!data.save) {
      setSeason(null)
      return
    }
    if (busy) return
    let current = true
    setSeasonLoading(true)
    api
      .worldSeason()
      .then((result) => current && setSeason(result))
      .catch(() => current && setSeason({ ok: false, message: '경기 기록을 읽지 못했습니다.', recent: [], upcoming: [] }))
      .finally(() => current && setSeasonLoading(false))
    return () => {
      current = false
    }
  }, [data.save?.path, data.save?.savedAt, data.hasTeam, busy])
  const chosen = picked ?? applied ?? saves?.[0]?.path ?? null

  const apply = async (): Promise<void> => {
    if (!chosen) return
    setNotice(null)
    const result = await api.applySave(chosen)
    setNotice({ text: result.message, error: !result.ok })
    setPicked(null)
    await loadSaves()
  }

  const gameLine = !game.connected
    ? 'FM이 꺼져 있습니다. 세이브에 저장된 값으로 쓸 수 있고, 값을 고치려면 FM을 켜야 합니다.'
    : !game.loaded
      ? 'FM이 켜져 있습니다. 아직 세이브를 불러오지 않았습니다(메인 메뉴).'
      : `FM이 켜져 있습니다. ${game.team}${game.manager ? `, 감독 ${game.manager}` : ''}`

  return (
    <>
      <header className="page-head">
        <h1>홈</h1>
        <span className="page-sub">FM이 켜져 있는지 확인하고, 쓸 세이브를 골라 적용하세요.</span>
      </header>

      <div className="page-body">
        <div className="start">
          <section className="panel">
            <div className="panel-head">
              <span className={`step ${game.connected && !game.pluginOld ? 'done' : ''}`} aria-hidden="true">1</span>
              <h2>FM 켜기</h2>
            </div>
            <div className="panel-body">
              <p className="start-line">
                <span className={`dot ${game.connected ? 'on' : 'off'}`} />
                <span>{gameLine}</span>
              </p>
              {game.connected && !game.pluginOld && <p className="faint num">게임 안 플러그인 {game.pluginVersion}</p>}
              {game.pluginOld && (
                <p className="chat-caution" role="status">
                  <CircleAlert size={15} />
                  게임에 올라가 있는 연결 플러그인이 옛 버전({game.pluginVersion || '알 수 없음'})입니다. FM을 완전히 껐다가 다시 켜면 새
                  버전({NEEDED_PLUGIN})으로 바뀝니다. 그 전까지는 세이브에 저장된 값만 볼 수 있고, 에디터로 값을 고칠 수 없습니다.
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className={`step ${data.save ? 'done' : ''}`} aria-hidden="true">2</span>
              <h2>세이브 고르기</h2>
              <div className="spacer" />
              {status?.saveDir.exists && (
                <button className="btn ghost" onClick={() => void api.openPath(status.saveDir.dir)} title={status.saveDir.dir}>
                  <FolderOpen size={16} />
                  세이브 폴더
                </button>
              )}
            </div>
            <div className="panel-body">
              {saves === null ? (
                <p className="muted">세이브 폴더를 보는 중입니다.</p>
              ) : saves.length === 0 ? (
                <p className="muted">
                  세이브 폴더에 세이브가 없습니다. 게임에서 한 번 저장해 주세요.
                  {status && !status.saveDir.exists && ` (${status.saveDir.dir} 폴더가 없습니다)`}
                </p>
              ) : (
                <>
                  <ul className="save-list" role="radiogroup" aria-label="세이브">
                    {saves.map((save) => (
                      <li key={save.path}>
                        <label className={chosen === save.path ? 'save-row on' : 'save-row'}>
                          <input
                            type="radio"
                            name="save"
                            checked={chosen === save.path}
                            disabled={busy}
                            onChange={() => setPicked(save.path)}
                          />
                          <span className="save-name">{save.name}</span>
                          {applied === save.path && <span className="tag squad">적용됨</span>}
                          <span className="spacer" />
                          <span className="muted num">
                            {formatTime(save.savedAt)} 저장 · {formatBytes(save.bytes)}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="start-actions">
                    <button className="btn primary" disabled={busy || !chosen} onClick={() => void apply()}>
                      {busy ? '읽는 중…' : chosen === applied ? '다시 읽기' : '적용'}
                    </button>
                    <span className="muted">
                      {busy
                        ? '세이브의 모든 선수를 읽고 있습니다. 몇 초 걸립니다.'
                        : '고른 세이브의 자료로 스쿼드, 영입 후보, 에디터가 채워집니다.'}
                    </span>
                  </div>
                </>
              )}
              {notice && (
                <p className={notice.error ? 'chat-caution' : 'backup-notice'} role={notice.error ? 'alert' : 'status'}>
                  {notice.error && <CircleAlert size={15} />}
                  {notice.text}
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className={`step ${data.save ? 'done' : ''}`} aria-hidden="true">3</span>
              <h2>자료 쓰기</h2>
              <div className="spacer" />
              {data.save && game.loaded && (
                <button className="btn ghost" disabled={busy} onClick={() => void api.refreshLive(true)}>
                  <RefreshCw size={15} />
                  게임에서 값 다시 받기
                </button>
              )}
            </div>
            <div className="panel-body">
              {!data.save ? (
                <p className="muted">아직 적용한 세이브가 없습니다.</p>
              ) : (
                <>
                  <dl className="facts">
                    <dt>세이브</dt>
                    <dd>{data.save.name}</dd>
                    <dt>선수</dt>
                    <dd className="num">{data.players.toLocaleString()}명</dd>
                    <dt>내 팀</dt>
                    <dd>{data.hasTeam ? data.club || '찾음' : '아직 찾지 못함'}</dd>
                    <dt>능력치 값</dt>
                    <dd>
                      {data.source === 'game' && data.liveAt
                        ? `켜져 있는 게임의 지금 값 (${formatTime(data.liveAt)}에 받음, ${data.liveMatched.toLocaleString()}명)`
                        : `세이브에 저장된 값 (${formatTime(data.save.savedAt)} 저장)`}
                    </dd>
                  </dl>
                  {data.note && (
                    <p className="muted" style={{ marginTop: 10 }}>
                      {data.note}
                    </p>
                  )}
                  <div className="start-actions">
                    <button className="btn" onClick={() => onNavigate('squad')}>
                      스쿼드 보기
                    </button>
                    <button className="btn" onClick={() => onNavigate('targets')}>
                      영입 후보 찾기
                    </button>
                    <button className="btn" onClick={() => onNavigate('editor')}>
                      에디터 열기
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        <SeasonCenter season={season} applied={data.save !== null} loading={seasonLoading || busy} />
      </div>
    </>
  )
}
