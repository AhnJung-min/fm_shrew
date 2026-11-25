import { FolderOpen, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import type { AppStatus, ImportResult, SnapshotMeta } from '@shared/types'
import { api } from '@/api'
import { formatTime, isFromSave, KIND_LABEL } from '@/lib/format'

export function Home(props: {
  status: AppStatus | null
  snapshots: SnapshotMeta[]
  onOpenSnapshot: (id: number) => void
  onImported: (results: ImportResult[]) => void
  onChanged: () => void
}) {
  const { status, snapshots, onOpenSnapshot, onImported, onChanged } = props
  const [over, setOver] = useState(false)

  const pick = async (): Promise<void> => onImported(await api.pickAndImport())

  const drop = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault()
    setOver(false)
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => api.pathForFile(file))
      .filter(Boolean)
    if (paths.length > 0) onImported(await api.importPaths(paths))
  }

  const remove = async (snapshot: SnapshotMeta): Promise<void> => {
    if (!window.confirm(`“${snapshot.fileName}” 기록을 지울까요? 원본 파일은 그대로 남습니다.`)) return
    await api.deleteSnapshot(snapshot.id)
    onChanged()
  }

  return (
    <>
      <header className="page-head">
        <h1>홈</h1>
        <span className="page-sub">게임에서 저장하면 내 스쿼드가 저절로 갱신됩니다.</span>
      </header>

      <div className="page-body">
        <div className="home-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>내 스쿼드: 세이브에서 자동으로</h2>
            </div>
            <div className="panel-body">
              <p className="muted" style={{ marginBottom: 10 }}>
                게임이 저장할 때마다(자동 저장 포함) 세이브 파일에서 내 1군 선수의 포지션과 능력치를 읽습니다. 게임에서
                따로 누를 것은 없습니다.
              </p>
              <ul className="folder-list">
                {status && (
                  <li>
                    <span className={`dot ${status.saveDir.exists ? 'on' : ''}`} />
                    <span className="path">
                      {status.saveDir.dir}
                      {!status.saveDir.exists && <span className="faint"> (아직 없는 폴더)</span>}
                    </span>
                    {status.saveDir.exists && (
                      <button
                        className="btn ghost icon"
                        onClick={() => void api.openPath(status.saveDir.dir)}
                        aria-label="세이브 폴더 열기"
                        title="폴더 열기"
                      >
                        <FolderOpen size={16} />
                      </button>
                    )}
                  </li>
                )}
              </ul>

              <h2 style={{ fontSize: 15, fontWeight: 600, margin: '22px 0 10px' }}>다른 선수 목록: 게임에서 내보내기</h2>
              <ol className="steps">
                <li>FM26에서 선수 검색 같은 목록 화면을 열고, 보고 싶은 열이 있는 뷰로 바꿉니다.</li>
                <li>
                  선수를 선택하고 <kbd>F9</kbd>를 누른 뒤, 목록이 끝까지 스크롤될 때까지 마우스에서 손을 뗍니다.
                </li>
                <li>파일이 저장되면 이 앱이 알아채고 표로 보여 줍니다.</li>
              </ol>

              <div
                className={`drop ${over ? 'over' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(event) => void drop(event)}
              >
                <Upload size={18} />
                <span style={{ flex: 1 }}>CSV나 HTML 파일을 여기에 끌어다 놓아도 됩니다.</span>
                <button className="btn" onClick={() => void pick()}>
                  파일 선택
                </button>
              </div>

              <h2 style={{ fontSize: 13, margin: '20px 0 8px', color: 'var(--text-2)' }}>내보내기를 지켜보는 폴더</h2>
              <ul className="folder-list">
                {status?.watchDirs.map((entry) => (
                  <li key={entry.dir}>
                    <span className={`dot ${entry.exists ? 'on' : ''}`} />
                    <span className="path">
                      {entry.dir}
                      {!entry.exists && <span className="faint"> (아직 없는 폴더)</span>}
                    </span>
                    {entry.exists && (
                      <button
                        className="btn ghost icon"
                        onClick={() => void api.openPath(entry.dir)}
                        aria-label="폴더 열기"
                        title="폴더 열기"
                      >
                        <FolderOpen size={16} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>가져온 기록</h2>
              <span className="faint num">{snapshots.length}개</span>
            </div>
            <div className="panel-body">
              {snapshots.length === 0 ? (
                <div className="empty">
                  <strong>아직 가져온 기록이 없습니다</strong>
                  ‘선수 목록 가져오기’의 순서대로 게임에서 한 번 내보내 보세요.
                </div>
              ) : (
                <ul className="snap-list">
                  {snapshots.map((snapshot) => (
                    <li className="snap-row" key={snapshot.id}>
                      <span className={`tag ${snapshot.kind}`}>
                        {isFromSave(snapshot.fileName) ? '세이브' : KIND_LABEL[snapshot.kind]}
                      </span>
                      <div className="snap-main">
                        <div className="snap-name" title={snapshot.sourceFile}>
                          {snapshot.fileName}
                        </div>
                        <div className="snap-meta num">
                          {formatTime(snapshot.importedAt)}에 가져옴, 선수 {snapshot.rowCount}명, 열{' '}
                          {snapshot.columnCount}개
                        </div>
                      </div>
                      <button className="btn" onClick={() => onOpenSnapshot(snapshot.id)}>
                        표로 보기
                      </button>
                      <button
                        className="btn ghost icon danger"
                        onClick={() => void remove(snapshot)}
                        aria-label={`${snapshot.fileName} 기록 지우기`}
                        title="기록 지우기"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
