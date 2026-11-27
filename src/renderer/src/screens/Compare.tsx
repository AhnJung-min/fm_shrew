import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { bestRoleOf } from '@shared/depth'
import { GROUP_LABEL } from '@shared/fields'
import { parsePositions } from '@shared/positions'
import { GOALKEEPER_AXES, OUTFIELD_AXES, profileOf } from '@shared/profile'
import { attributesOf } from '@shared/roles'
import type { ColumnGroup, Settings, SquadResult } from '@shared/types'
import { api } from '@/api'
import { RadarChart } from '@/components/RadarChart'
import { attrBand, attrText } from '@/lib/format'

/** 겹쳐 그려도 서로 구분되는 색은 셋까지다(색각 이상 포함 검증). 그래서 한 번에 세 명까지 비교한다. */
export const MAX_COMPARE = 3
const SERIES_COLORS = ['--series-1', '--series-2', '--series-3']
const ATTR_GROUPS: ColumnGroup[] = ['technical', 'mental', 'physical', 'goalkeeping']

/** 내 팀 선수를 세 명까지 나란히 놓고 본다. */
export function Compare(props: {
  /** 자료가 바뀌면 달라지는 글자(다시 읽을 때를 안다) */
  dataKey: string
  /** 비교에 담은 선수들(고유 번호) */
  idxs: number[]
  onIdxs: (idxs: number[]) => void
  settings: Settings
  onGoSquad: () => void
}) {
  const { dataKey, idxs, onIdxs, settings, onGoSquad } = props
  const [snapshot, setSnapshot] = useState<SquadResult | null>(null)

  useEffect(() => {
    let alive = true
    void api.worldSquad().then((loaded) => {
      if (alive) setSnapshot(loaded)
    })
    return () => {
      alive = false
    }
  }, [dataKey])

  const players = useMemo(() => {
    if (!snapshot) return []
    return idxs
      .map((idx) => snapshot.rows.find((row) => row.idx === idx))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map((row, i) => ({
        row,
        color: SERIES_COLORS[i],
        attrs: attributesOf(row, snapshot.columns),
        best: bestRoleOf(row, snapshot.columns, settings.roleWeights)
      }))
  }, [snapshot, idxs, settings.roleWeights])

  if (snapshot && !snapshot.ok) {
    return (
      <>
        <header className="page-head">
          <h1>선수 비교</h1>
          <span className="page-sub">내 팀 선수를 최대 {MAX_COMPARE}명까지 나란히 놓고 성향과 능력치를 비교합니다.</span>
        </header>
        <div className="page-body">
          <div className="empty">
            <strong>비교할 선수가 아직 없습니다</strong>
            {snapshot.message}
          </div>
        </div>
      </>
    )
  }

  const fieldValue = (field: string, row: (typeof players)[number]['row']): string => {
    const col = snapshot?.columns.find((c) => c.field === field)
    return col ? (row.cells[col.header]?.raw ?? '') : ''
  }
  const positionsOf = (row: (typeof players)[number]['row']): string[] => parsePositions(fieldValue('position', row))
  const allGoalkeepers = players.length > 0 && players.every((p) => positionsOf(p.row).includes('GK'))
  const axes = allGoalkeepers ? GOALKEEPER_AXES : OUTFIELD_AXES
  const hasAttrs = snapshot?.columns.some((col) => col.isAttr) ?? false
  const available = snapshot?.rows.filter((row) => !idxs.includes(row.idx)) ?? []
  const full = idxs.length >= MAX_COMPARE

  const picker = (
    <select
      className="field"
      aria-label="비교에 넣을 선수"
      value=""
      disabled={full || !snapshot}
      onChange={(event) => onIdxs([...idxs, Number(event.target.value)])}
      style={{ maxWidth: 240 }}
    >
      <option value="">{full ? `${MAX_COMPARE}명까지 비교합니다` : '선수 넣기'}</option>
      {available.map((row) => (
        <option key={row.idx} value={row.idx}>
          {row.name}
        </option>
      ))}
    </select>
  )

  return (
    <>
      <header className="page-head">
        <h1>선수 비교</h1>
        <span className="page-sub">내 팀 선수를 최대 {MAX_COMPARE}명까지 나란히 놓고 성향과 능력치를 비교합니다.</span>
        {players.length > 0 && picker}
      </header>

      <div className="page-body">
        {players.length === 0 ? (
          <div className="empty">
            <strong>비교할 선수를 넣어 주세요</strong>
            아래에서 고르거나, 스쿼드 표에서 선수를 누른 뒤 “비교에 담기”를 누릅니다. {MAX_COMPARE}명까지 됩니다.
            <div className="empty-actions">
              {picker}
              <button className="btn primary" onClick={onGoSquad}>
                스쿼드로 가기
              </button>
            </div>
          </div>
        ) : !hasAttrs ? (
          <div className="empty">
            <strong>이 기록에는 능력치 열이 없습니다</strong>
            세이브에서 읽은 기록을 골라 주세요.
          </div>
        ) : (
          <div className="compare">
            <section className="panel compare-chart">
              <ul className="compare-legend">
                {players.map((p) => (
                  <li key={p.row.idx}>
                    <span className="swatch" style={{ background: `var(${p.color})` }} />
                    <div className="compare-who">
                      <strong>{p.row.name}</strong>
                      <span className="muted">
                        {[fieldValue('position', p.row), fieldValue('age', p.row) && `${fieldValue('age', p.row)}세`]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                      {p.best && (
                        <span className="muted num">
                          {p.best.label} {Math.round(p.best.score)}점
                        </span>
                      )}
                    </div>
                    <button
                      className="btn ghost icon"
                      aria-label={`${p.row.name} 빼기`}
                      title="비교에서 빼기"
                      onClick={() => onIdxs(idxs.filter((idx) => idx !== p.row.idx))}
                    >
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
              <RadarChart
                axes={axes.map((axis) => axis.label)}
                series={players.map((p) => ({ name: p.row.name, color: p.color, values: profileOf(p.attrs, axes) }))}
              />
              <p className="faint compare-note">
                각 축은 관련 능력치의 평균입니다(예: 속도 = 주력·가속도·민첩성). 정확한 값은 오른쪽 표에 있습니다.
              </p>
            </section>

            <section className="panel compare-table-wrap">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>능력치</th>
                    {players.map((p) => (
                      <th key={p.row.idx} className="right">
                        <span className="swatch" style={{ background: `var(${p.color})` }} />
                        {p.row.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                {ATTR_GROUPS.map((group) => {
                  const cols = snapshot!.columns.filter((col) => col.isAttr && col.group === group)
                  // 골키퍼끼리 비교할 때는 기술 대신 골키퍼 능력치를, 그 밖에는 골키퍼 능력치를 뺀다
                  const shown = allGoalkeepers ? group !== 'technical' : group !== 'goalkeeping'
                  if (cols.length === 0 || !shown) return null
                  return (
                    <tbody key={group}>
                      <tr className="compare-group">
                        <th colSpan={players.length + 1}>{GROUP_LABEL[group]}</th>
                      </tr>
                      {cols.map((col) => {
                        const values = players.map((p) => p.row.cells[col.header]?.num ?? null)
                        const top = Math.max(...values.map((v) => v ?? -1))
                        const tie = values.filter((v) => v === top).length === players.length
                        return (
                          <tr key={col.header}>
                            <td>{col.label}</td>
                            {players.map((p, i) => {
                              const cell = p.row.cells[col.header]
                              const best = players.length > 1 && !tie && values[i] === top
                              return (
                                <td key={p.row.idx} className={`right ${best ? 'best' : ''}`}>
                                  {best && <span className="best-mark" aria-label="가장 높음" title="가장 높음" />}
                                  <span className={`attr-chip ${attrBand(values[i])} ${cell?.range ? 'ranged' : ''}`}>{attrText(cell)}</span>
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  )
                })}
              </table>
            </section>
          </div>
        )}
      </div>
    </>
  )
}
