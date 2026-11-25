import { useEffect, useMemo, useState } from 'react'
import { parsePositions } from '@shared/positions'
import { attributesOf, effectiveWeights, ROLE_BY_ID, ROLES, scoreRole } from '@shared/roles'
import type { ColumnInfo, PlayerRow, Settings, Snapshot, SnapshotMeta } from '@shared/types'
import { api } from '@/api'
import { PlayerDrawer } from '@/components/PlayerDrawer'
import { PlayerTable, sortRows, type SortState } from '@/components/PlayerTable'
import { formatTime, isFromSave } from '@/lib/format'

const SCORE: ColumnInfo = {
  header: '역할 점수', field: 'roleScore', group: 'info', short: '역할 점수', label: '고른 역할의 적합도 (0~100)', isAttr: false, numeric: true
}
const GAP: ColumnInfo = {
  header: '주전 대비', field: 'starterGap', group: 'info', short: '주전 대비', label: '내 팀에서 이 역할 점수가 가장 높은 선수와의 차이', isAttr: false, numeric: true
}

interface Benchmark {
  name: string
  score: number
}

/** 내 스쿼드에서 이 역할을 뛸 수 있는 선수 가운데 점수가 가장 높은 선수 */
function benchmarkOf(squad: Snapshot | null, roleId: string, weights: Settings['roleWeights']): Benchmark | null {
  if (!squad) return null
  const role = ROLE_BY_ID[roleId]
  const positionHeader = squad.columns.find((col) => col.field === 'position')?.header
  if (!positionHeader) return null
  let best: Benchmark | null = null
  for (const row of squad.rows) {
    const positions = parsePositions(row.cells[positionHeader]?.raw ?? '')
    if (!role.positions.some((p) => positions.includes(p))) continue
    const result = scoreRole(attributesOf(row, squad.columns), effectiveWeights(roleId, weights))
    if (result && (!best || result.score > best.score)) best = { name: row.name, score: result.score }
  }
  return best
}

/** 게임에서 내보낸 선수 검색 목록을 고른 역할의 점수로 줄 세우고, 내 주전과 비교한다. */
export function Targets(props: { snapshots: SnapshotMeta[]; settings: Settings }) {
  const { snapshots, settings } = props
  const lists = useMemo(() => snapshots.filter((s) => s.kind === 'search'), [snapshots])
  const squadMeta = useMemo(
    () => snapshots.find((s) => isFromSave(s.fileName)) ?? snapshots.find((s) => s.kind === 'squad') ?? null,
    [snapshots]
  )
  const [listId, setListId] = useState<number | null>(null)
  const [list, setList] = useState<Snapshot | null>(null)
  const [squad, setSquad] = useState<Snapshot | null>(null)
  const [roleId, setRoleId] = useState('cb')
  const [onlyEligible, setOnlyEligible] = useState(true)
  const [maxAge, setMaxAge] = useState('')
  const [sort, setSort] = useState<SortState | null>({ header: SCORE.header, dir: 'desc' })
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const activeId = listId ?? lists[0]?.id ?? null
  useEffect(() => {
    let alive = true
    setSelectedIdx(null)
    if (activeId === null) setList(null)
    else void api.getSnapshot(activeId).then((loaded) => alive && setList(loaded))
    return () => {
      alive = false
    }
  }, [activeId])
  useEffect(() => {
    let alive = true
    if (!squadMeta) setSquad(null)
    else void api.getSnapshot(squadMeta.id).then((loaded) => alive && setSquad(loaded))
    return () => {
      alive = false
    }
  }, [squadMeta])

  const benchmark = useMemo(() => benchmarkOf(squad, roleId, settings.roleWeights), [squad, roleId, settings.roleWeights])

  const ranked = useMemo(() => {
    if (!list) return null
    const role = ROLE_BY_ID[roleId]
    const weights = effectiveWeights(roleId, settings.roleWeights)
    const positionHeader = list.columns.find((col) => col.field === 'position')?.header
    const ageHeader = list.columns.find((col) => col.field === 'age')?.header
    const ageLimit = Number(maxAge) || null
    const rows: PlayerRow[] = []
    for (const row of list.rows) {
      const positions = positionHeader ? parsePositions(row.cells[positionHeader]?.raw ?? '') : []
      if (onlyEligible && positionHeader && !role.positions.some((p) => positions.includes(p))) continue
      const age = ageHeader ? row.cells[ageHeader]?.num : null
      if (ageLimit && age !== null && age !== undefined && age > ageLimit) continue
      const result = scoreRole(attributesOf(row, list.columns), weights)
      const gap = result && benchmark ? Math.round((result.score - benchmark.score) * 10) / 10 : null
      rows.push({
        ...row,
        cells: {
          ...row.cells,
          [SCORE.header]: result
            ? { raw: `${result.uncertain ? '~' : ''}${Math.round(result.score)}`, num: result.score }
            : { raw: '', num: null },
          [GAP.header]: gap === null ? { raw: '', num: null } : { raw: `${gap > 0 ? '+' : ''}${gap.toFixed(1)}`, num: gap }
        }
      })
    }
    const nameAt = Math.max(0, list.columns.findIndex((col) => col.field === 'name'))
    const columns = [...list.columns]
    columns.splice(nameAt + 1, 0, SCORE, GAP)
    return { columns, rows }
  }, [list, roleId, settings.roleWeights, onlyEligible, maxAge, benchmark])

  const hasAttrs = list?.columns.some((col) => col.isAttr) ?? false
  const sorted = useMemo(() => (ranked ? sortRows(ranked.rows, sort) : []), [ranked, sort])
  const selected = selectedIdx === null ? null : (ranked?.rows.find((row) => row.idx === selectedIdx) ?? null)

  if (lists.length === 0) {
    return (
      <>
        <header className="page-head">
          <h1>영입 후보</h1>
        </header>
        <div className="page-body">
          <div className="empty" style={{ maxWidth: 560, margin: '0 auto', textAlign: 'left' }}>
            <strong>아직 가져온 선수 검색 목록이 없습니다</strong>
            <ol className="steps" style={{ marginTop: 12 }}>
              <li>게임의 선수 검색 화면에서 원하는 조건으로 거릅니다.</li>
              <li>능력치가 열로 보이는 뷰로 바꿉니다. 화면에 보이는 열만 내보내집니다.</li>
              <li>
                선수를 모두 선택하고 <kbd>F9</kbd>를 누릅니다.
              </li>
            </ol>
            <p style={{ marginTop: 12 }}>
              60명이 넘는 목록은 자동으로 여기에 나타납니다. 그보다 적은 목록은 스쿼드 화면에서 종류를 “선수 검색”으로
              바꾸면 됩니다.
            </p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <header className="page-head">
        <h1>영입 후보</h1>
        <select
          className="field"
          aria-label="선수 검색 목록"
          value={activeId ?? ''}
          onChange={(event) => setListId(Number(event.target.value))}
          style={{ maxWidth: 340 }}
        >
          {lists.map((s) => (
            <option key={s.id} value={s.id}>
              선수 검색 {s.rowCount}명, {formatTime(s.importedAt)}
            </option>
          ))}
        </select>
        <div className="spacer" />
        {ranked && <span className="page-sub num">{`${list!.rows.length}명 중 ${ranked.rows.length}명`}</span>}
      </header>

      <div className="toolbar">
        <label className="inline-field">
          <span className="muted">역할</span>
          <select className="field" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
            {ROLES.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span className="muted">나이</span>
          <input
            className="field num"
            type="number"
            min={15}
            max={45}
            placeholder="제한 없음"
            value={maxAge}
            onChange={(event) => setMaxAge(event.target.value)}
            style={{ width: 104 }}
          />
          <span className="muted">세 이하</span>
        </label>
        <label className="inline-field">
          <input type="checkbox" checked={onlyEligible} onChange={(event) => setOnlyEligible(event.target.checked)} />
          <span>이 역할의 자리에서 뛸 수 있는 선수만</span>
        </label>
        <div className="spacer" />
        <span className="page-sub num">
          {benchmark
            ? `내 팀 기준: ${benchmark.name} ${Math.round(benchmark.score)}점`
            : '내 팀에 이 역할을 뛸 선수가 없어 비교 기준이 없습니다'}
        </span>
      </div>

      <div className="table-wrap">
        {!hasAttrs ? (
          <div className="empty" style={{ flex: 1 }}>
            <strong>이 목록에는 능력치 열이 없어 점수를 매길 수 없습니다</strong>
            게임에서 능력치가 열로 보이는 뷰로 바꾼 뒤 다시 내보내 주세요.
          </div>
        ) : sorted.length === 0 ? (
          <div className="empty" style={{ flex: 1 }}>
            <strong>조건에 맞는 선수가 없습니다</strong>
            역할이나 나이 조건을 바꿔 보세요.
          </div>
        ) : (
          <PlayerTable
            columns={ranked!.columns}
            rows={sorted}
            density={settings.density}
            sort={sort}
            onSort={setSort}
            selectedIdx={selectedIdx}
            onSelect={(row) => setSelectedIdx(selectedIdx === row.idx ? null : row.idx)}
          />
        )}
        {ranked && selected && (
          <PlayerDrawer columns={ranked.columns} row={selected} onClose={() => setSelectedIdx(null)} />
        )}
      </div>
    </>
  )
}
