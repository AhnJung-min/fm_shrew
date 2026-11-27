import { CircleAlert, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { SaveRecords } from '@shared/records'
import { api } from '@/api'

/** 1MB 아래는 KB로(기록 하나가 작아서 MB로만 쓰면 0으로 보인다) */
function size(bytes: number): string {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}MB`
  return `${Math.max(1, Math.round(bytes / 1024))}KB`
}

/** 세이브마다 쌓인 기록(성장 스냅샷, 경기 평점)을 보고, 세이브 하나의 기록을 휴지통으로 보낸다 */
export function RecordsSettings() {
  const [list, setList] = useState<SaveRecords[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => setList(await api.recordsList()), [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const remove = async (entry: SaveRecords): Promise<void> => {
    const ok = window.confirm(
      `“${entry.label}”의 기록(스냅샷 ${entry.snapshots}개, 평점 ${entry.ratedMatches}경기)을 휴지통으로 보낼까요?\n\n` +
        '휴지통에서 되돌릴 수 있습니다. 같은 세이브를 다시 적용하면 그날부터 새로 쌓입니다.'
    )
    if (!ok) return
    setBusy(entry.id)
    const result = await api.recordsRemove(entry.id)
    setError(result.ok ? null : (result.message ?? '지우지 못했습니다.'))
    setBusy(null)
    await refresh()
  }

  return (
    <>
      <p className="muted" style={{ marginBottom: 8 }}>
        세이브를 적용할 때 게임 속 한 달에 한 번 선수들의 능력을 남기고, 플러그인이 모은 경기 평점을 가져옵니다. 모두 이 PC 안에만
        있고, 세이브 하나에 50MB를 넘지 않습니다.
      </p>
      {error && (
        <p className="chat-caution" role="alert">
          <CircleAlert size={15} />
          {error}
        </p>
      )}
      {list === null ? (
        <p className="muted">불러오는 중입니다.</p>
      ) : list.length === 0 ? (
        <p className="muted">아직 쌓인 기록이 없습니다. 홈 화면에서 세이브를 적용하면 시작됩니다.</p>
      ) : (
        <table className="backup-table">
          <thead>
            <tr>
              <th>세이브</th>
              <th className="num">크기</th>
              <th className="num">스냅샷</th>
              <th>마지막 스냅샷</th>
              <th className="num">평점 경기</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.label}</td>
                <td className="num">{size(entry.bytes)}</td>
                <td className="num">{entry.snapshots}개</td>
                <td className="num-like">{entry.lastSnapshot ?? '–'}</td>
                <td className="num">{entry.ratedMatches}경기</td>
                <td className="actions">
                  <button
                    className="btn ghost danger"
                    disabled={busy !== null}
                    onClick={() => void remove(entry)}
                    title="이 세이브의 기록을 휴지통으로 보내기"
                    aria-label={`${entry.label}의 기록 지우기`}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
