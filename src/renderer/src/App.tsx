import { useCallback, useEffect, useRef, useState } from 'react'
import { NO_DATA, NO_GAME, type LinkStatus } from '@shared/game'
import type { AppStatus, Settings as SettingsData } from '@shared/types'
import { api } from './api'
import { Sidebar, type Route } from './components/Sidebar'
import { Backups } from './screens/Backups'
import { Compare, MAX_COMPARE } from './screens/Compare'
import { Dashboard } from './screens/Dashboard'
import { Editor } from './screens/Editor'
import { Home } from './screens/Home'
import { Settings } from './screens/Settings'
import { Squad } from './screens/Squad'
import { Targets } from './screens/Targets'

const ROUTES: Route[] = ['dashboard', 'home', 'squad', 'targets', 'compare', 'editor', 'backups', 'settings']

/** 주소의 #화면이름이 있으면 그 화면 */
function hashRoute(): Route | null {
  const fromHash = location.hash.replace('#', '') as Route
  return ROUTES.includes(fromHash) ? fromHash : null
}

function initialRoute(): Route {
  return hashRoute() ?? 'home'
}

/** 앱을 켠 뒤 이 시간 안에 세이브가 적용되면(지난번 세이브를 자동으로 다시 읽는 중) 대시보드로 연다 */
const AUTO_OPEN_MS = 20_000

/**
 * 적용한 세이브나 게임에서 받은 값이 바뀌면 달라지는 글자.
 * 화면들은 이것이 바뀔 때 자료를 다시 청한다.
 */
function dataKeyOf(link: LinkStatus): string {
  const { save, liveAt, hasTeam, namesStage } = link.data
  return `${save?.path ?? ''}|${save?.savedAt ?? ''}|${liveAt ?? ''}|${hasTeam}|${namesStage}`
}

export function App() {
  const [route, setRoute] = useState<Route>(initialRoute)
  /** 사용자가 화면을 직접 골랐는지(주소의 #화면이름 포함). 고르지 않았으면 세이브가 적용될 때 대시보드로 연다 */
  const chosen = useRef(hashRoute() !== null)
  const startedAt = useRef(Date.now())
  const navigate = useCallback((next: Route): void => {
    chosen.current = true
    setRoute(next)
  }, [])
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [link, setLink] = useState<LinkStatus>({ game: NO_GAME, data: NO_DATA, busy: false })
  /** 선수 비교에 담은 선수들(고유 번호) */
  const [compare, setCompare] = useState<number[]>([])
  /** 영입 후보에서 고른 선수를 에디터로 넘길 때 */
  const [editorUid, setEditorUid] = useState<number | null>(null)
  /** 스쿼드 전술판에서 "이 자리 영입 후보 보기"를 눌렀을 때 영입 후보가 열 자리 */
  const [targetSlot, setTargetSlot] = useState<{ formation: string; index: number; at: number } | null>(null)

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.getStatus().then(setStatus)
    void api.linkStatus().then(setLink)
    return api.onLinkChanged(setLink)
  }, [])

  useEffect(() => {
    if (settings) document.documentElement.dataset.density = settings.density
  }, [settings])

  useEffect(() => {
    const onHash = (): void => {
      chosen.current = true
      setRoute(initialRoute())
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // 켤 때 적용된 세이브가 있으면 시작 화면 대신 대시보드로 연다(사용자가 이미 화면을 골랐다면 그대로 둔다)
  const hasSave = link.data.save !== null
  useEffect(() => {
    if (hasSave && !chosen.current && Date.now() - startedAt.current < AUTO_OPEN_MS) {
      chosen.current = true
      setRoute((current) => (current === 'home' ? 'dashboard' : current))
    }
  }, [hasSave])

  // 다른 세이브를 적용하면 담아 둔 비교 선수는 비운다
  const savePath = link.data.save?.path ?? ''
  useEffect(() => setCompare([]), [savePath])

  const toggleCompare = (uid: number): void => {
    setCompare((current) => {
      if (current.includes(uid)) return current.filter((each) => each !== uid)
      return current.length >= MAX_COMPARE ? current : [...current, uid]
    })
  }

  const changeSettings = useCallback(async (patch: Partial<SettingsData>): Promise<void> => {
    setSettings(await api.setSettings(patch))
    setStatus(await api.getStatus())
  }, [])

  if (!settings) return null
  const dataKey = dataKeyOf(link)

  return (
    <div className="app">
      <Sidebar route={route} onNavigate={navigate} link={link} />
      <main className="main">
        {route === 'dashboard' && (
          <Dashboard
            dataKey={dataKey}
            link={link}
            settings={settings}
            onGoStart={() => navigate('home')}
            onGoSquad={() => navigate('squad')}
            onFindTargets={(slot) => {
              setTargetSlot({ ...slot, at: Date.now() })
              navigate('targets')
            }}
          />
        )}
        {route === 'home' && <Home status={status} link={link} onNavigate={navigate} />}
        {route === 'squad' && (
          <Squad
            dataKey={dataKey}
            link={link}
            settings={settings}
            onSettings={(patch) => void changeSettings(patch)}
            onGoHome={() => navigate('home')}
            compare={compare}
            onToggleCompare={toggleCompare}
            onOpenCompare={() => navigate('compare')}
            onFindTargets={(slot) => {
              setTargetSlot({ ...slot, at: Date.now() })
              navigate('targets')
            }}
          />
        )}
        {route === 'targets' && (
          <Targets
            dataKey={dataKey}
            link={link}
            settings={settings}
            slotRequest={targetSlot}
            onGoHome={() => navigate('home')}
            onEdit={(uid) => {
              setEditorUid(uid)
              navigate('editor')
            }}
          />
        )}
        {route === 'compare' && (
          <Compare dataKey={dataKey} idxs={compare} onIdxs={setCompare} settings={settings} onGoSquad={() => navigate('squad')} />
        )}
        {route === 'editor' && (
          <Editor dataKey={dataKey} link={link} openUid={editorUid} onOpened={() => setEditorUid(null)} onGoHome={() => navigate('home')} />
        )}
        {route === 'backups' && <Backups settings={settings} onChange={changeSettings} />}
        {route === 'settings' && <Settings status={status} settings={settings} onChange={changeSettings} />}
      </main>
    </div>
  )
}
