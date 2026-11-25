import { FolderOpen, FolderPlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FIELDS, GROUP_LABEL, GROUP_ORDER } from '@shared/fields'
import type { AppStatus, ColumnInfo, Settings as SettingsData, SnapshotMeta } from '@shared/types'
import { api } from '@/api'
import { RoleWeights } from '@/components/RoleWeights'

export function Settings(props: {
  status: AppStatus | null
  settings: SettingsData
  latest: SnapshotMeta | null
  onChange: (patch: Partial<SettingsData>) => Promise<void>
}) {
  const { status, settings, latest, onChange } = props
  const [columns, setColumns] = useState<ColumnInfo[]>([])

  // 열 지정은 가장 최근에 가져온 기록의 열을 기준으로 보여 준다
  useEffect(() => {
    let alive = true
    if (!latest) {
      setColumns([])
      return
    }
    void api.getSnapshot(latest.id).then((snapshot) => {
      if (alive) setColumns(snapshot?.columns ?? [])
    })
    return () => {
      alive = false
    }
  }, [latest, settings.columnOverrides])

  const addFolder = async (): Promise<void> => {
    const dir = await api.pickFolder()
    if (dir && !settings.watchDirs.includes(dir)) await onChange({ watchDirs: [...settings.watchDirs, dir] })
  }

  const removeFolder = (dir: string): Promise<void> =>
    onChange({ watchDirs: settings.watchDirs.filter((d) => d !== dir) })

  const assign = (header: string, fieldId: string): Promise<void> => {
    const next = { ...settings.columnOverrides }
    if (fieldId) next[header] = fieldId
    else delete next[header]
    return onChange({ columnOverrides: next })
  }

  const unknown = columns.filter((col) => col.field === null)
  const overridden = columns.filter((col) => settings.columnOverrides[col.header])
  const listed = [...unknown, ...overridden.filter((col) => !unknown.includes(col))]
  const exists = (dir: string): boolean => status?.watchDirs.find((d) => d.dir === dir)?.exists ?? false

  return (
    <>
      <header className="page-head">
        <h1>설정</h1>
      </header>
      <div className="page-body">
        <div className="settings">
          <section className="panel">
            <div className="panel-head">
              <h2>지켜볼 폴더</h2>
            </div>
            <div className="panel-body">
              <p className="muted" style={{ marginBottom: 12 }}>
                이 폴더와 그 아래 세 단계까지에 선수 목록 CSV가 생기면 자동으로 가져옵니다.
              </p>
              <ul className="folder-list">
                {settings.watchDirs.map((dir) => (
                  <li key={dir}>
                    <span className={`dot ${exists(dir) ? 'on' : ''}`} />
                    <span className="path">
                      {dir}
                      {!exists(dir) && <span className="faint"> (아직 없는 폴더)</span>}
                    </span>
                    {exists(dir) && (
                      <button
                        className="btn ghost icon"
                        onClick={() => void api.openPath(dir)}
                        aria-label="폴더 열기"
                        title="폴더 열기"
                      >
                        <FolderOpen size={16} />
                      </button>
                    )}
                    <button
                      className="btn ghost icon danger"
                      onClick={() => void removeFolder(dir)}
                      aria-label="목록에서 빼기"
                      title="목록에서 빼기"
                    >
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
              <button className="btn" style={{ marginTop: 12 }} onClick={() => void addFolder()}>
                <FolderPlus size={16} />
                폴더 추가
              </button>
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
              <h2>열 이름 지정</h2>
            </div>
            <div className="panel-body">
              {!latest ? (
                <p className="muted">선수 목록을 한 번 가져오면, 알아보지 못한 열을 여기서 지정할 수 있습니다.</p>
              ) : listed.length === 0 ? (
                <p className="muted">
                  가장 최근 기록의 열 {columns.length}개를 모두 알아봤습니다. 지정할 것이 없습니다.
                </p>
              ) : (
                <>
                  <p className="muted" style={{ marginBottom: 8 }}>
                    가장 최근 기록에서 알아보지 못한 열입니다. 어떤 항목인지 고르면 예전 기록에도 바로 적용됩니다.
                  </p>
                  <table className="map-table">
                    <thead>
                      <tr>
                        <th>파일의 열 이름</th>
                        <th>항목</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listed.map((col) => (
                        <tr key={col.header}>
                          <td>{col.header}</td>
                          <td>
                            <select
                              className="field"
                              aria-label={`${col.header} 열의 항목`}
                              value={settings.columnOverrides[col.header] ?? ''}
                              onChange={(event) => void assign(col.header, event.target.value)}
                            >
                              <option value="">지정 안 함 (그대로 표시)</option>
                              {GROUP_ORDER.filter((group) => group !== 'other').map((group) => (
                                <optgroup key={group} label={GROUP_LABEL[group]}>
                                  {FIELDS.filter((field) => field.group === group).map((field) => (
                                    <option key={field.id} value={field.id}>
                                      {field.label}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>데이터 위치</h2>
            </div>
            <div className="panel-body">
              <p className="muted" style={{ marginBottom: 8 }}>
                가져온 기록과 설정은 이 PC의 아래 폴더에만 저장됩니다.
              </p>
              <div className="folder-list">
                <li style={{ listStyle: 'none', display: 'flex', gap: 8 }}>
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
              </div>
              <p className="faint num" style={{ marginTop: 12, fontSize: 12 }}>
                FM 보좌관 {status?.version}
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
