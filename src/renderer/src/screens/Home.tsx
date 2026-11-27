import { Check, CircleAlert, FolderOpen, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { extrasOf } from '@shared/connect'
import type { LinkStatus, SaveFileInfo } from '@shared/game'
import { oldPluginNotice, pluginUnmetLine } from '@shared/pluginGates'
import type { AppStatus } from '@shared/types'
import { api } from '@/api'
import { ClubPicker } from '@/components/ClubPicker'
import { MetaLine } from '@/components/MetaLine'
import type { Route } from '@/components/Sidebar'
import { formatBytes, formatTime } from '@/lib/format'

/** 단계 표시: 끝났으면 체크 아이콘(색만으로 알리지 않는다) */
function Step(props: { n: number; done: boolean }) {
  return (
    <span className={`step ${props.done ? 'done' : ''}`} aria-hidden="true">
      {props.done ? <Check size={18} strokeWidth={3} /> : props.n}
    </span>
  )
}

/**
 * 시작 화면. 순서대로: 게임이 켜져 있는지 보고, 쓸 세이브를 골라 적용하고, 그 자료로 다른 화면을 쓴다.
 */
export function Home(props: { status: AppStatus | null; link: LinkStatus; onNavigate: (route: Route) => void }) {
  const { status, link, onNavigate } = props
  const { game, data, busy } = link
  const [saves, setSaves] = useState<SaveFileInfo[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  /** 내 구단을 이미 아는데 다시 고르려고 목록을 연 상태 */
  const [repick, setRepick] = useState(false)
  const { check, teamNote } = extrasOf(link)

  const loadSaves = useCallback(async (): Promise<void> => setSaves(await api.listSaves()), [])

  // 게임이 저장하면 목록의 저장 시각이 바뀐다
  useEffect(() => {
    void loadSaves()
  }, [loadSaves, data.save?.savedAt])

  const applied = data.save?.path ?? null

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
        <h1>시작</h1>
        <span className="page-sub">FM이 켜져 있는지 보고, 쓸 세이브를 골라 적용하세요. 적용한 뒤의 구단 현황은 대시보드에서 봅니다.</span>
      </header>

      <div className="page-body">
        <div className="start">
          <div className={`start-step ${game.connected && !game.pluginOld ? 'done' : ''}`}>
            <Step n={1} done={game.connected && !game.pluginOld} />
            <section className="panel">
              <div className="panel-head">
                <h2>FM 켜기</h2>
              </div>
              <div className="panel-body">
                <p className="start-line">
                  <span className={`dot ${game.pluginOld ? 'warn' : game.connected ? 'on' : 'idle'}`} aria-hidden="true" />
                  <span>{gameLine}</span>
                </p>
                {game.connected && !game.pluginOld && (
                  <p className="faint num">
                    게임 안 플러그인 {game.pluginVersion}
                    {pluginUnmetLine(game.pluginVersion) && ` · ${pluginUnmetLine(game.pluginVersion)}`}
                  </p>
                )}
                {game.pluginOld && (
                  <p className="chat-caution" role="status">
                    <CircleAlert size={15} />
                    {oldPluginNotice(game.pluginVersion)} 그 전까지는 세이브에 저장된 값만 볼 수 있고, 에디터로 값을 고칠 수 없습니다.
                  </p>
                )}
              </div>
            </section>
          </div>

          <div className={`start-step ${data.save ? 'done' : ''}`}>
            <Step n={2} done={data.save !== null} />
            <section className="panel">
              <div className="panel-head">
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
                              <MetaLine items={[`${formatTime(save.savedAt)} 저장`, formatBytes(save.bytes)]} />
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="start-actions">
                      <button
                        className={chosen === applied ? 'btn' : 'btn primary'}
                        disabled={busy || !chosen}
                        onClick={() => void apply()}
                      >
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
          </div>

          <div className={`start-step ${data.save ? 'done' : ''}`}>
            <Step n={3} done={data.save !== null} />
            <section className="panel">
              <div className="panel-head">
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
                      <dd>
                        {data.hasTeam ? data.club || '찾음' : '아직 모름'}
                        {data.hasTeam && !repick && (
                          <button className="btn ghost" disabled={busy} onClick={() => setRepick(true)}>
                            다시 고르기
                          </button>
                        )}
                      </dd>
                      <dt>능력치 값</dt>
                      <dd>
                        {data.source === 'game' && data.liveAt
                          ? `켜져 있는 게임의 지금 값 (${formatTime(data.liveAt)}에 받음, ${data.liveMatched.toLocaleString()}명)`
                          : `세이브에 저장된 값 (${formatTime(data.save.savedAt)} 저장)`}
                      </dd>
                    </dl>
                    {teamNote && <p className="muted">{teamNote}</p>}
                    {!check.ok && (
                      <div className="chat-caution ed-report" role="alert">
                        <CircleAlert size={15} />
                        <div>
                          <p>세이브 형식이 바뀐 것 같습니다. 점수 화면(대시보드, 스쿼드, 영입 후보, 선수 비교)을 막았습니다. 백업과 설정은 쓸 수 있습니다.</p>
                          <ul>
                            {check.problems.map((problem) => (
                              <li key={problem}>{problem}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                    {(!data.hasTeam || repick) && check.ok && (
                      <div style={{ marginTop: 12 }}>
                        <ClubPicker
                          busy={busy}
                          savePath={data.save.path}
                          onChosen={() => {
                            setRepick(false)
                            onNavigate('dashboard')
                          }}
                        />
                      </div>
                    )}
                    {data.note && (
                      <p className="muted" style={{ marginTop: 10 }}>
                        {data.note}
                      </p>
                    )}
                    <div className="start-actions">
                      <button className="btn primary" onClick={() => onNavigate('dashboard')}>
                        대시보드 보기
                      </button>
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
        </div>

        <p className="muted" style={{ marginTop: 16 }}>
          경기 센터와 리그 순위는 <strong>대시보드</strong>로 옮겼습니다.{' '}
          {data.save ? (
            <button className="btn ghost" onClick={() => onNavigate('dashboard')}>
              대시보드 열기
            </button>
          ) : (
            '세이브를 적용하면 거기서 볼 수 있습니다.'
          )}
        </p>
      </div>
    </>
  )
}
