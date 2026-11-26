import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { bestRoleOf } from '@shared/depth'
import { GROUP_LABEL, GROUP_ORDER } from '@shared/fields'
import type { LinkStatus } from '@shared/game'
import type { ColumnGroup, ColumnInfo, PlayerRow, Settings, SquadResult } from '@shared/types'
import { api } from '@/api'
import { DepthChart } from '@/components/DepthChart'
import { PlayerDrawer } from '@/components/PlayerDrawer'
import { PlayerTable, sortRows, type SortState } from '@/components/PlayerTable'
import { MAX_COMPARE } from './Compare'

type View = 'table' | 'depth'

const FIT_ROLE: ColumnInfo = {
  header: '최적 역할', field: 'fitRole', group: 'info', short: '최적 역할', label: '점수가 가장 높은 역할', isAttr: false, numeric: false
}
const FIT_SCORE: ColumnInfo = {
  header: '적합도', field: 'fitScore', group: 'info', short: '적합도', label: '최적 역할의 적합도 (0~100)', isAttr: false, numeric: true
}

/** 선수마다 최적 역할과 적합도 열을 덧붙인다. */
function withRoleFit(snapshot: SquadResult, weights: Settings['roleWeights']): { columns: ColumnInfo[]; rows: PlayerRow[] } {
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

/** 적용한 세이브의 내 팀 선수들. 게임이 켜져 있으면 게임의 지금 값으로 보인다. */
export function Squad(props: {
  /** 자료가 바뀌면 달라지는 글자(다시 읽을 때를 안다) */
  dataKey: string
  link: LinkStatus
  settings: Settings
  onSettings: (patch: Partial<Settings>) => void
  onGoHome: () => void
  /** 선수 비교에 담은 선수들(고유 번호) */
  compare: number[]
  onToggleCompare: (uid: number) => void
  onOpenCompare: () => void
}) {
  const { dataKey, link, settings, onSettings, onGoHome } = props
  const { compare, onToggleCompare, onOpenCompare } = props
  const [snapshot, setSnapshot] = useState<SquadResult | null>(null)
  const [view, setView] = useState<View>('table')
  const [query, setQuery] = useState('')
  // 열이 많아 골키퍼 능력치는 처음에 접어 두고 필요할 때 켠다
  const [hidden, setHidden] = useState<Set<ColumnGroup>>(new Set(['goalkeeping']))
  const [sort, setSort] = useState<SortState | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    void api.worldSquad().then((loaded) => {
      if (alive) setSnapshot(loaded)
    })
    return () => {
      alive = false
    }
  }, [dataKey])

  const fitted = useMemo(
    () => (snapshot?.ok ? withRoleFit(snapshot, settings.roleWeights) : null),
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

  if (snapshot && !snapshot.ok) {
    return (
      <>
        <header className="page-head">
          <h1>스쿼드</h1>
        </header>
        <div className="page-body">
          <div className="empty">
            <strong>아직 보여 줄 선수가 없습니다</strong>
            {snapshot.message}
            <div style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={onGoHome}>
                홈에서 세이브 고르기
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

  const selected = selectedIdx === null ? null : (fitted?.rows.find((row) => row.idx === selectedIdx) ?? null)
  const inCompare = compare
  const { data } = link

  return (
    <>
      <header className="page-head">
        <h1>스쿼드</h1>
        <span className="page-sub">
          {data.save ? `${data.club || data.save.name} · ${data.source === 'game' ? '게임의 지금 값' : '세이브에 저장된 값'}` : ''}
        </span>
        <div className="segmented" role="group" aria-label="보기 방식">
          <button aria-pressed={view === 'table'} onClick={() => setView('table')}>
            표
          </button>
          <button aria-pressed={view === 'depth'} onClick={() => setView('depth')}>
            뎁스 차트
          </button>
        </div>
        <div className="spacer" />
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
          {fitted && (
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
        {view === 'depth' && snapshot?.ok && (
          <DepthChart
            columns={snapshot.columns}
            rows={snapshot.rows}
            settings={settings}
            onChange={onSettings}
            onPick={(idx) => setSelectedIdx(selectedIdx === idx ? null : idx)}
          />
        )}
        {fitted && snapshot && selected && (
          <PlayerDrawer
            columns={fitted.columns}
            row={selected}
            onClose={() => setSelectedIdx(null)}
            compare={{
              included: inCompare.includes(selected.idx),
              count: inCompare.length,
              full: inCompare.length >= MAX_COMPARE,
              onToggle: () => onToggleCompare(selected.idx),
              onOpen: onOpenCompare
            }}
          />
        )}
      </div>
    </>
  )
}
