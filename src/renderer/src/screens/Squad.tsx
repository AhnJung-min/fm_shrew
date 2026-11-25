import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { GROUP_LABEL, GROUP_ORDER } from '@shared/fields'
import type { ColumnGroup, Density, PlayerRow, Snapshot, SnapshotKind, SnapshotMeta } from '@shared/types'
import { api } from '@/api'
import { PlayerDrawer } from '@/components/PlayerDrawer'
import { PlayerTable, sortRows, type SortState } from '@/components/PlayerTable'
import { formatTime, isFromSave, KIND_LABEL } from '@/lib/format'

export function Squad(props: {
  snapshots: SnapshotMeta[]
  selectedId: number | null
  onSelectSnapshot: (id: number) => void
  onChanged: () => void
  density: Density
  onDensity: (density: Density) => void
  onGoHome: () => void
}) {
  const { snapshots, selectedId, onSelectSnapshot, onChanged, density, onDensity, onGoHome } = props
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [query, setQuery] = useState('')
  const [hidden, setHidden] = useState<Set<ColumnGroup>>(new Set())
  const [sort, setSort] = useState<SortState | null>(null)
  const [selected, setSelected] = useState<PlayerRow | null>(null)

  useEffect(() => {
    let alive = true
    setSelected(null)
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

  const groups = useMemo(() => {
    const present = new Set(snapshot?.columns.filter((c) => c.field !== 'name').map((c) => c.group))
    return GROUP_ORDER.filter((group) => present.has(group))
  }, [snapshot])

  const columns = useMemo(
    () => snapshot?.columns.filter((col) => col.field === 'name' || !hidden.has(col.group)) ?? [],
    [snapshot, hidden]
  )

  const rows = useMemo(() => {
    if (!snapshot) return []
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? snapshot.rows.filter((row) =>
          Object.values(row.cells).some((cell) => cell.raw.toLowerCase().includes(needle))
        )
      : snapshot.rows
    return sortRows(filtered, sort)
  }, [snapshot, query, sort])

  if (snapshots.length === 0) {
    return (
      <>
        <header className="page-head">
          <h1>스쿼드</h1>
        </header>
        <div className="page-body">
          <div className="empty">
            <strong>아직 가져온 선수 목록이 없습니다</strong>
            게임에서 스쿼드 화면을 내보내면 여기에 표로 나타납니다.
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
        {snapshot && (
          <div className="segmented" role="group" aria-label="이 기록의 종류">
            {(['squad', 'search'] as const).map((kind) => (
              <button key={kind} aria-pressed={snapshot.kind === kind} onClick={() => void changeKind(kind)}>
                {KIND_LABEL[kind]}
              </button>
            ))}
          </div>
        )}
        <div className="spacer" />
        {snapshot && (
          <span className="page-sub num">
            {rows.length === snapshot.rows.length
              ? `선수 ${snapshot.rows.length}명`
              : `${snapshot.rows.length}명 중 ${rows.length}명`}
          </span>
        )}
      </header>

      <div className="toolbar">
        <label className="search-box">
          <Search size={15} />
          <input
            className="field"
            type="search"
            placeholder="이름, 포지션, 국적 찾기"
            aria-label="선수 찾기"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="chips" role="group" aria-label="보여 줄 열 묶음">
          {groups.map((group) => (
            <button
              key={group}
              className="chip"
              aria-pressed={!hidden.has(group)}
              onClick={() => toggleGroup(group)}
            >
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
          <button aria-pressed={density === 'compact'} onClick={() => onDensity('compact')}>
            촘촘하게
          </button>
          <button aria-pressed={density === 'comfortable'} onClick={() => onDensity('comfortable')}>
            넉넉하게
          </button>
        </div>
      </div>

      {snapshot && unknownCount > 0 && (
        <p className="page-sub" style={{ padding: '8px 24px 0' }}>
          알아보지 못한 열이 {unknownCount}개 있습니다. 표에는 그대로 보이고, 설정에서 어떤 항목인지 지정할 수 있습니다.
        </p>
      )}

      <div className="table-wrap">
        {snapshot && rows.length > 0 && (
          <PlayerTable
            columns={columns}
            rows={rows}
            density={density}
            sort={sort}
            onSort={setSort}
            selectedIdx={selected?.idx ?? null}
            onSelect={(row) => setSelected(selected?.idx === row.idx ? null : row)}
          />
        )}
        {snapshot && rows.length === 0 && (
          <div className="empty" style={{ flex: 1 }}>
            <strong>“{query}”에 맞는 선수가 없습니다</strong>
            다른 이름이나 포지션으로 찾아보세요.
          </div>
        )}
        {snapshot && selected && (
          <PlayerDrawer columns={snapshot.columns} row={selected} onClose={() => setSelected(null)} />
        )}
      </div>
    </>
  )
}
