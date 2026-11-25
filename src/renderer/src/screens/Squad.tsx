import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { bestRoleOf } from '@shared/depth'
import { GROUP_LABEL, GROUP_ORDER } from '@shared/fields'
import type { ColumnGroup, ColumnInfo, PlayerRow, Settings, Snapshot, SnapshotKind, SnapshotMeta } from '@shared/types'
import { api } from '@/api'
import { DepthChart } from '@/components/DepthChart'
import { PlayerDrawer } from '@/components/PlayerDrawer'
import { PlayerTable, sortRows, type SortState } from '@/components/PlayerTable'
import { formatTime, isFromSave, KIND_LABEL } from '@/lib/format'

type View = 'table' | 'depth'

const FIT_ROLE: ColumnInfo = {
  header: '최적 역할', field: 'fitRole', group: 'info', short: '최적 역할', label: '점수가 가장 높은 역할', isAttr: false, numeric: false
}
const FIT_SCORE: ColumnInfo = {
  header: '적합도', field: 'fitScore', group: 'info', short: '적합도', label: '최적 역할의 적합도 (0~100)', isAttr: false, numeric: true
}

/** 포지션과 능력치가 있는 기록이면 선수마다 최적 역할과 적합도 열을 덧붙인다. */
function withRoleFit(snapshot: Snapshot, weights: Settings['roleWeights']): { columns: ColumnInfo[]; rows: PlayerRow[] } {
  const positionAt = snapshot.columns.findIndex((col) => col.field === 'position')
  if (positionAt < 0 || !snapshot.columns.some((col) => col.isAttr)) return snapshot
  const columns = [...snapshot.columns]
  columns.splice(positionAt + 1, 0, FIT_ROLE, FIT_SCORE)
  const rows = snapshot.rows.map((row) => {
    const best = bestRoleOf(row, snapshot.columns, weights)
    return {
      ...row,
      cells: {
        ...row.cells,
        [FIT_ROLE.header]: { raw: best?.label ?? '', num: null },
        [FIT_SCORE.header]: best
          ? { raw: `${best.uncertain ? '~' : ''}${Math.round(best.score)}`, num: best.score }
          : { raw: '', num: null }
      }
    }
  })
  return { columns, rows }
}

export function Squad(props: {
  snapshots: SnapshotMeta[]
  selectedId: number | null
  onSelectSnapshot: (id: number) => void
  onChanged: () => void
  settings: Settings
  onSettings: (patch: Partial<Settings>) => void
  onGoHome: () => void
}) {
  const { snapshots, selectedId, onSelectSnapshot, onChanged, settings, onSettings, onGoHome } = props
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [view, setView] = useState<View>('table')
  const [query, setQuery] = useState('')
  const [hidden, setHidden] = useState<Set<ColumnGroup>>(new Set())
  const [sort, setSort] = useState<SortState | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    setSelectedIdx(null)
    setSort(null)
    if (selectedId === null) {
      setSnapshot(null)
      return
    }
    void api.getSnapshot(selectedId).then((loaded) => {
      if (!alive) return
      setSnapshot(loaded)
      // 세이브에서 읽은 기록은 열이 많다. 골키퍼 능력치는 처음에 접어 두고 필요할 때 켠다.
      const groups = new Set(loaded?.columns.map((col) => col.group))
      setHidden(groups.has('technical') && groups.has('goalkeeping') ? new Set(['goalkeeping']) : new Set())
    })
    return () => {
      alive = false
    }
  }, [selectedId])

  const fitted = useMemo(
    () => (snapshot ? withRoleFit(snapshot, settings.roleWeights) : null),
    [snapshot, settings.roleWeights]
  )

  const groups = useMemo(() => {
    const present = new Set(fitted?.columns.filter((c) => c.field !== 'name').map((c) => c.group))
    return GROUP_ORDER.filter((group) => present.has(group))
  }, [fitted])

  const columns = useMemo(
    () => fitted?.columns.filter((col) => col.field === 'name' || !hidden.has(col.group)) ?? [],
    [fitted, hidden]
  )

  const rows = useMemo(() => {
    if (!fitted) return []
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? fitted.rows.filter((row) => Object.values(row.cells).some((cell) => cell.raw.toLowerCase().includes(needle)))
      : fitted.rows
    return sortRows(filtered, sort)
  }, [fitted, query, sort])

  if (snapshots.length === 0) {
    return (
      <>
        <header className="page-head">
          <h1>스쿼드</h1>
        </header>
        <div className="page-body">
          <div className="empty">
            <strong>아직 읽어 온 선수 목록이 없습니다</strong>
            게임에서 저장하면 내 스쿼드가 여기에 표로 나타납니다.
            <div style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={onGoHome}>
                가져오는 방법 보기
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  const toggleGroup = (group: ColumnGroup): void => {
    const next = new Set(hidden)
    if (next.has(group)) next.delete(group)
    else next.add(group)
    setHidden(next)
  }

  const changeKind = async (kind: SnapshotKind): Promise<void> => {
    if (!snapshot) return
    await api.setSnapshotKind(snapshot.id, kind)
    setSnapshot({ ...snapshot, kind })
    onChanged()
  }

  const unknownCount = snapshot?.columns.filter((col) => col.field === null).length ?? 0
  const hasAttrs = snapshot?.columns.some((col) => col.isAttr) ?? false
  const selected = selectedIdx === null ? null : (fitted?.rows.find((row) => row.idx === selectedIdx) ?? null)

  return (
    <>
      <header className="page-head">
        <h1>스쿼드</h1>
        <select
          className="field"
          aria-label="가져온 기록 선택"
          value={selectedId ?? ''}
          onChange={(event) => onSelectSnapshot(Number(event.target.value))}
          style={{ maxWidth: 380 }}
        >
          {snapshots.map((s) => (
            <option key={s.id} value={s.id}>
              {isFromSave(s.fileName) ? '세이브' : KIND_LABEL[s.kind]} {s.rowCount}명, {formatTime(s.importedAt)}
            </option>
          ))}
        </select>
        <div className="segmented" role="group" aria-label="보기 방식">
          <button aria-pressed={view === 'table'} onClick={() => setView('table')}>
            표
          </button>
          <button aria-pressed={view === 'depth'} onClick={() => setView('depth')}>
            뎁스 차트
          </button>
        </div>
        <div className="spacer" />
        {snapshot && !isFromSave(snapshot.fileName) && (
          <div className="segmented" role="group" aria-label="이 기록의 종류">
            {(['squad', 'search'] as const).map((kind) => (
              <button key={kind} aria-pressed={snapshot.kind === kind} onClick={() => void changeKind(kind)}>
                {KIND_LABEL[kind]}
              </button>
            ))}
          </div>
        )}
        {fitted && (
          <span className="page-sub num">
            {view === 'depth' || rows.length === fitted.rows.length
              ? `선수 ${fitted.rows.length}명`
              : `${fitted.rows.length}명 중 ${rows.length}명`}
          </span>
        )}
      </header>

      {view === 'table' && (
        <div className="toolbar">
          <label className="search-box">
            <Search size={15} />
            <input
              className="field"
              type="search"
              placeholder="이름, 포지션, 역할 찾기"
              aria-label="선수 찾기"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="chips" role="group" aria-label="보여 줄 열 묶음">
            {groups.map((group) => (
              <button key={group} className="chip" aria-pressed={!hidden.has(group)} onClick={() => toggleGroup(group)}>
                {GROUP_LABEL[group]}
              </button>
            ))}
          </div>
          <div className="spacer" />
          {hasAttrs && (
            <div className="legend" aria-label="능력치 표시 기준">
              <span className="a1">
                <b>1–7</b>
              </span>
              <span className="a2">
                <b>8–11</b>
              </span>
              <span className="a3">
                <b>12–15</b>
              </span>
              <span className="a4">
                <b>16–20</b>
              </span>
            </div>
          )}
          <div className="segmented" role="group" aria-label="표 밀도">
            <button aria-pressed={settings.density === 'compact'} onClick={() => onSettings({ density: 'compact' })}>
              촘촘하게
            </button>
            <button
              aria-pressed={settings.density === 'comfortable'}
              onClick={() => onSettings({ density: 'comfortable' })}
            >
              넉넉하게
            </button>
          </div>
        </div>
      )}

      {view === 'table' && snapshot && unknownCount > 0 && (
        <p className="page-sub" style={{ padding: '8px 24px 0' }}>
          알아보지 못한 열이 {unknownCount}개 있습니다. 표에는 그대로 보이고, 설정에서 어떤 항목인지 지정할 수 있습니다.
        </p>
      )}

      <div className="table-wrap">
        {view === 'table' && fitted && rows.length > 0 && (
          <PlayerTable
            columns={columns}
            rows={rows}
            density={settings.density}
            sort={sort}
            onSort={setSort}
            selectedIdx={selectedIdx}
            onSelect={(row) => setSelectedIdx(selectedIdx === row.idx ? null : row.idx)}
          />
        )}
        {view === 'table' && fitted && rows.length === 0 && (
          <div className="empty" style={{ flex: 1 }}>
            <strong>“{query}”에 맞는 선수가 없습니다</strong>
            다른 이름이나 포지션으로 찾아보세요.
          </div>
        )}
        {view === 'depth' && snapshot && (
          <DepthChart
            columns={snapshot.columns}
            rows={snapshot.rows}
            settings={settings}
            onChange={onSettings}
            onPick={(idx) => setSelectedIdx(selectedIdx === idx ? null : idx)}
          />
        )}
        {fitted && selected && (
          <PlayerDrawer columns={fitted.columns} row={selected} onClose={() => setSelectedIdx(null)} />
        )}
      </div>
    </>
  )
}
