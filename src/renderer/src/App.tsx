import { useCallback, useEffect, useState } from 'react'
import { NO_DATA, NO_GAME, type LinkStatus } from '@shared/game'
import type { AppStatus, Settings as SettingsData } from '@shared/types'
import { api } from './api'
import { Sidebar, type Route } from './components/Sidebar'
import { Backups } from './screens/Backups'
import { Compare, MAX_COMPARE } from './screens/Compare'
import { Editor } from './screens/Editor'
import { Home } from './screens/Home'
import { Settings } from './screens/Settings'
import { Squad } from './screens/Squad'
import { Targets } from './screens/Targets'

const ROUTES: Route[] = ['home', 'squad', 'targets', 'compare', 'editor', 'backups', 'settings']

function initialRoute(): Route {
  const fromHash = location.hash.replace('#', '') as Route
  return ROUTES.includes(fromHash) ? fromHash : 'home'
}

/**
 * 적용한 세이브나 게임에서 받은 값이 바뀌면 달라지는 글자.
 * 화면들은 이것이 바뀔 때 자료를 다시 청한다.
 */
function dataKeyOf(link: LinkStatus): string {
  const { save, liveAt, hasTeam } = link.data
  return `${save?.path ?? ''}|${save?.savedAt ?? ''}|${liveAt ?? ''}|${hasTeam}`
}

export function App() {
  const [route, setRoute] = useState<Route>(initialRoute)
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [link, setLink] = useState<LinkStatus>({ game: NO_GAME, data: NO_DATA, busy: false })
  /** 선수 비교에 담은 선수들(고유 번호) */
  const [compare, setCompare] = useState<number[]>([])
  /** 영입 후보에서 고른 선수를 에디터로 넘길 때 */
  const [editorUid, setEditorUid] = useState<number | null>(null)

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
    const onHash = (): void => setRoute(initialRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

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
      <Sidebar route={route} onNavigate={setRoute} link={link} />
      <main className="main">
        {route === 'home' && <Home status={status} link={link} onNavigate={setRoute} />}
        {route === 'squad' && (
          <Squad
            dataKey={dataKey}
            link={link}
            settings={settings}
            onSettings={(patch) => void changeSettings(patch)}
            onGoHome={() => setRoute('home')}
            compare={compare}
            onToggleCompare={toggleCompare}
            onOpenCompare={() => setRoute('compare')}
          />
        )}
        {route === 'targets' && (
          <Targets
            dataKey={dataKey}
            link={link}
            settings={settings}
            onEdit={(uid) => {
              setEditorUid(uid)
              setRoute('editor')
            }}
          />
        )}
        {route === 'compare' && (
          <Compare dataKey={dataKey} idxs={compare} onIdxs={setCompare} settings={settings} onGoSquad={() => setRoute('squad')} />
        )}
        {route === 'editor' && <Editor dataKey={dataKey} link={link} openUid={editorUid} onOpened={() => setEditorUid(null)} />}
        {route === 'backups' && <Backups settings={settings} onChange={changeSettings} />}
        {route === 'settings' && <Settings status={status} settings={settings} onChange={changeSettings} />}
      </main>
    </div>
  )
}
