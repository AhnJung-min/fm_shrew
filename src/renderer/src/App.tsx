import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TalkCapture } from '@shared/talk'
import type { AppStatus, ImportResult, Settings as SettingsData, SnapshotMeta } from '@shared/types'
import { api } from './api'
import { Sidebar, type Route } from './components/Sidebar'
import { isFromSave, KIND_LABEL } from './lib/format'
import { Compare, MAX_COMPARE, type CompareState } from './screens/Compare'
import { Home } from './screens/Home'
import { Settings } from './screens/Settings'
import { Squad } from './screens/Squad'
import { Talk } from './screens/Talk'
import { Targets } from './screens/Targets'

interface Toast {
  id: number
  text: string
  error?: boolean
  /** 누르면 열 스냅샷 */
  snapshotId?: number
}

const ROUTES: Route[] = ['home', 'squad', 'targets', 'compare', 'talk', 'settings']

function initialRoute(): Route {
  const fromHash = location.hash.replace('#', '') as Route
  return ROUTES.includes(fromHash) ? fromHash : 'home'
}

export function App() {
  const [route, setRoute] = useState<Route>(initialRoute)
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [compare, setCompare] = useState<CompareState>({ snapshotId: null, idxs: [] })
  const nextToastId = useRef(1)
  const [talkCapture, setTalkCapture] = useState<TalkCapture | null>(null)
  const [talkError, setTalkError] = useState<string | null>(null)

  // 게임에서 단축키를 누르면 화면이 찍혀 오고, 토크 도우미로 바로 넘어간다
  useEffect(
    () =>
      api.onTalkCaptured((event) => {
        if (event.capture) setTalkCapture(event.capture)
        setTalkError(event.message ?? null)
        setRoute('talk')
      }),
    []
  )

  /** 스쿼드 표에서 선수를 비교에 담거나 뺀다. 다른 기록의 선수를 담으면 새로 시작한다. */
  const toggleCompare = (snapshotId: number, idx: number): void => {
    setCompare((current) => {
      const idxs = current.snapshotId === snapshotId ? current.idxs : []
      if (idxs.includes(idx)) return { snapshotId, idxs: idxs.filter((i) => i !== idx) }
      return idxs.length >= MAX_COMPARE ? { snapshotId, idxs } : { snapshotId, idxs: [...idxs, idx] }
    })
  }

  const refresh = useCallback(async (): Promise<SnapshotMeta[]> => {
    const [nextStatus, list] = await Promise.all([api.getStatus(), api.listSnapshots()])
    setStatus(nextStatus)
    setSnapshots(list)
    // 보고 있던 기록이 지워졌으면 가장 최근 기록으로 옮긴다
    setSelectedId((current) => (current !== null && list.some((s) => s.id === current) ? current : (list[0]?.id ?? null)))
    return list
  }, [])

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = nextToastId.current++
    setToasts((current) => [...current.slice(-2), { ...toast, id }])
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 7000)
  }, [])

  const reportImports = useCallback(
    (results: ImportResult[]) => {
      for (const result of results) {
        if (result.ok && result.snapshot) {
          const s = result.snapshot
          const what = isFromSave(s.fileName) ? '세이브에서 내 스쿼드' : KIND_LABEL[s.kind]
          pushToast({ text: `${what} ${s.rowCount}명을 가져왔습니다.`, snapshotId: s.id })
          setSelectedId(s.id)
        } else if (result.ok && result.skipped) {
          pushToast({ text: '이미 가져온 파일이라 건너뛰었습니다.' })
        } else {
          pushToast({ text: `가져오지 못했습니다. ${result.message ?? ''}`, error: true })
        }
      }
      void refresh()
    },
    [pushToast, refresh]
  )

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void refresh()
    return api.onImported((result) => reportImports([result]))
  }, [refresh, reportImports])

  useEffect(() => {
    if (settings) document.documentElement.dataset.density = settings.density
  }, [settings])

  useEffect(() => {
    const onHash = (): void => setRoute(initialRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const changeSettings = async (patch: Partial<SettingsData>): Promise<void> => {
    setSettings(await api.setSettings(patch))
    await refresh()
  }

  const openSnapshot = (id: number): void => {
    setSelectedId(id)
    setRoute('squad')
  }

  if (!settings) return null

  return (
    <div className="app">
      <Sidebar route={route} onNavigate={setRoute} status={status} />
      <main className="main">
        {route === 'home' && (
          <Home
            status={status}
            snapshots={snapshots}
            onOpenSnapshot={openSnapshot}
            onImported={reportImports}
            onChanged={() => void refresh()}
          />
        )}
        {route === 'squad' && (
          <Squad
            snapshots={snapshots}
            selectedId={selectedId}
            onSelectSnapshot={setSelectedId}
            onChanged={() => void refresh()}
            settings={settings}
            onSettings={(patch) => void changeSettings(patch)}
            onGoHome={() => setRoute('home')}
            compare={compare}
            onToggleCompare={toggleCompare}
            onOpenCompare={() => setRoute('compare')}
          />
        )}
        {route === 'targets' && <Targets snapshots={snapshots} settings={settings} />}
        {route === 'compare' && (
          <Compare
            snapshots={snapshots}
            state={compare}
            onState={setCompare}
            settings={settings}
            onGoSquad={() => setRoute('squad')}
          />
        )}
        {route === 'talk' && (
          <Talk
            settings={settings}
            capture={talkCapture}
            captureError={talkError}
            onCapture={(capture, error) => {
              if (capture) setTalkCapture(capture)
              setTalkError(error)
            }}
            onGoSettings={() => setRoute('settings')}
          />
        )}
        {route === 'settings' && (
          <Settings status={status} settings={settings} latest={snapshots[0] ?? null} onChange={changeSettings} />
        )}
      </main>

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.error ? 'error' : ''}`}>
            <p>{toast.text}</p>
            {toast.snapshotId !== undefined && route !== 'squad' && (
              <button className="btn" onClick={() => openSnapshot(toast.snapshotId!)}>
                표로 보기
              </button>
            )}
            <button
              className="btn ghost icon"
              aria-label="알림 닫기"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
