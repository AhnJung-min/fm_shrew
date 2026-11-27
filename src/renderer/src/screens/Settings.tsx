import { FolderOpen } from 'lucide-react'
import type { AppStatus, Settings as SettingsData, ThemeId } from '@shared/types'
import { api } from '@/api'
import { RoleWeights } from '@/components/RoleWeights'
import { TalkSettings } from '@/components/TalkSettings'

const THEMES: Array<{ id: ThemeId; label: string }> = [
  { id: 'blue', label: '어두운 블루' },
  { id: 'black', label: '블랙' }
]

export function Settings(props: {
  status: AppStatus | null
  settings: SettingsData
  onChange: (patch: Partial<SettingsData>) => Promise<void>
}) {
  const { status, settings, onChange } = props

  return (
    <>
      <header className="page-head">
        <h1>설정</h1>
      </header>
      <div className="page-body">
        <div className="settings">
          <section className="panel">
            <div className="panel-head">
              <h2>앱</h2>
            </div>
            <div className="panel-body">
              <div style={{ marginBottom: 16 }}>
                <div className="inline-field">
                  <span>화면 색</span>
                  <div className="segmented" role="group" aria-label="화면 색">
                    {THEMES.map((theme) => (
                      <button key={theme.id} aria-pressed={settings.theme === theme.id} onClick={() => void onChange({ theme: theme.id })}>
                        {theme.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <label className="inline-field">
                <input
                  type="checkbox"
                  checked={settings.keepRunning}
                  onChange={(event) => void onChange({ keepRunning: event.target.checked })}
                />
                <span>창을 닫아도 끄지 않고 알림 영역에 남겨 두기</span>
              </label>
              <p className="muted" style={{ marginTop: 8 }}>
                게임 안 직접 답변과 세이브 백업은 앱이 켜져 있어야 동작합니다. 끌 때는 알림 영역의 아이콘을 오른쪽 클릭해
                “종료”를 누릅니다.
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>게임 안 직접 답변</h2>
            </div>
            <div className="panel-body">
              <TalkSettings settings={settings} onChange={onChange} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>역할 가중치</h2>
            </div>
            <div className="panel-body">
              <RoleWeights settings={settings} onChange={onChange} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>데이터 위치</h2>
            </div>
            <div className="panel-body">
              <p className="muted" style={{ marginBottom: 8 }}>
                설정과 세이브 사본은 이 PC의 아래 폴더에만 저장됩니다.
              </p>
              <ul className="folder-list">
                <li>
                  <span className="path">{status?.dataDir}</span>
                  <button
                    className="btn ghost icon"
                    onClick={() => status && void api.openPath(status.dataDir)}
                    aria-label="데이터 폴더 열기"
                    title="폴더 열기"
                  >
                    <FolderOpen size={16} />
                  </button>
                </li>
              </ul>
              <p className="faint num" style={{ marginTop: 12 }}>
                FM 보좌관 {status?.version}
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
