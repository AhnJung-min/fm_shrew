import { CircleAlert, FolderOpen, History, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { BackupEntry, BackupList, Settings } from '@shared/types'
import { api } from '@/api'
import { MetaLine } from '@/components/MetaLine'
import { formatBytes, formatTime } from '@/lib/format'

const KEEP_CHOICES = [3, 5, 10, 20, 30]

/** 세이브 자동 백업: 사본 목록, 차지한 용량, 복원 */
export function Backups(props: { settings: Settings; onChange: (patch: Partial<Settings>) => Promise<void> }) {
  const { settings, onChange } = props
  const [list, setList] = useState<BackupList | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)

  const refresh = useCallback(async (): Promise<void> => setList(await api.backupList()), [])

  useEffect(() => {
    void refresh()
    return api.onBackupChanged(() => void refresh())
  }, [refresh])

  const backupNow = async (): Promise<void> => {
    setBusy('now')
    const result = await api.backupNow()
    setNotice({ text: result.message ?? (result.ok ? '사본을 남겼습니다.' : '사본을 남기지 못했습니다.'), error: !result.ok })
    setBusy(null)
    await refresh()
  }

  const restore = async (entry: BackupEntry): Promise<void> => {
    const ok = window.confirm(
      `“${entry.saveName}”을 ${formatTime(entry.savedAt)}에 저장된 상태로 되돌릴까요?\n\n` +
        '지금 세이브 폴더에 있는 파일은 먼저 사본으로 남긴 뒤에 바꿉니다.\n' +
        '게임이 켜져 있으면 게임에서 이 세이브를 다시 불러와야 반영됩니다.'
    )
    if (!ok) return
    setBusy(entry.id)
    const result = await api.backupRestore(entry.id)
    setNotice(
      result.ok
        ? { text: `“${entry.saveName}”을 ${formatTime(entry.savedAt)} 상태로 되돌렸습니다. 게임에서 다시 불러오세요.` }
        : { text: result.message ?? '복원하지 못했습니다.', error: true }
    )
    setBusy(null)
    await refresh()
  }

  const remove = async (entry: BackupEntry): Promise<void> => {
    if (!window.confirm(`${formatTime(entry.savedAt)}에 저장된 “${entry.saveName}” 사본을 지울까요? 되돌릴 수 없습니다.`)) return
    setBusy(entry.id)
    await api.backupDelete(entry.id)
    setBusy(null)
    await refresh()
  }

  const entries = list?.entries ?? []

  return (
    <>
      <header className="page-head">
        <h1>백업</h1>
        <span className="page-sub">게임이 저장할 때마다 세이브 사본을 남깁니다.</span>
        <div className="spacer" />
        <button className="btn" disabled={busy !== null} onClick={() => void backupNow()}>
          <History size={16} />
          지금 사본 남기기
        </button>
      </header>

      <div className="page-body backups-body">
        <section className="panel">
          <div className="panel-body backup-controls">
            <label className="inline-field">
              <input
                type="checkbox"
                checked={settings.backupEnabled}
                onChange={(event) => void onChange({ backupEnabled: event.target.checked })}
              />
              <span>저장할 때마다 자동으로 남기기</span>
            </label>
            <label className="inline-field">
              <span>세이브마다 보관할 개수</span>
              <select className="field" value={settings.backupKeep} onChange={(event) => void onChange({ backupKeep: Number(event.target.value) })}>
                {KEEP_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n}개
                  </option>
                ))}
              </select>
            </label>
            <span className="muted">
              <MetaLine items={[`사본 ${entries.length}개`, formatBytes(list?.totalBytes ?? 0)]} />
            </span>
            {list && (
              <button className="btn ghost" onClick={() => void api.openPath(list.dir)} title={list.dir}>
                <FolderOpen size={16} />
                폴더 열기
              </button>
            )}
          </div>
        </section>

        {notice && (
          <p className={notice.error ? 'chat-caution' : 'backup-notice'} role={notice.error ? 'alert' : 'status'}>
            {notice.error && <CircleAlert size={15} />}
            {notice.text}
          </p>
        )}

        <section className="panel">
          <div className="panel-head">
            <h2>사본</h2>
          </div>
          {list === null ? (
            <div className="panel-body muted">불러오는 중입니다.</div>
          ) : entries.length === 0 ? (
            <div className="panel-body">
              <p className="muted">
                아직 사본이 없습니다. 게임에서 저장하면 여기에 생깁니다. 지금 있는 세이브를 바로 남기려면 위의 “지금 사본
                남기기”를 누르세요.
              </p>
            </div>
          ) : (
            <table className="backup-table">
              <thead>
                <tr>
                  <th>저장 시각</th>
                  <th>세이브</th>
                  <th className="num">크기</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="num-like">{formatTime(entry.savedAt)}</td>
                    <td>
                      {entry.saveName}
                      {entry.beforeRestore && (
                        <span className="tag" title="복원하기 직전에 있던 세이브를 남겨 둔 것입니다.">
                          복원 전 상태
                        </span>
                      )}
                    </td>
                    <td className="num">{formatBytes(entry.bytes)}</td>
                    <td className="actions">
                      <button className="btn" disabled={busy !== null} onClick={() => void restore(entry)}>
                        <RotateCcw size={15} />
                        {busy === entry.id ? '처리 중…' : '복원'}
                      </button>
                      <button
                        className="btn ghost danger"
                        disabled={busy !== null}
                        onClick={() => void remove(entry)}
                        title="이 사본 지우기"
                        aria-label="이 사본 지우기"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  )
}
