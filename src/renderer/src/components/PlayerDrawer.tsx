import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { GROUP_LABEL } from '@shared/fields'
import type { ColumnGroup, ColumnInfo, PlayerRow } from '@shared/types'
import { attrBand, attrText, attrTitle, plainText } from '@/lib/format'

const ATTR_GROUPS: ColumnGroup[] = ['technical', 'mental', 'physical', 'goalkeeping']

/** 선수 한 명의 상세. 게임의 선수 프로필처럼 능력치를 묶음별로 나란히 보여 준다. */
export interface DrawerCompare {
  included: boolean
  count: number
  full: boolean
  onToggle: () => void
  onOpen: () => void
}

export function PlayerDrawer(props: {
  columns: ColumnInfo[]
  row: PlayerRow
  onClose: () => void
  /** 선수 비교에 담는 버튼을 보여 줄 때만 넘긴다 */
  compare?: DrawerCompare
  /** 그 밖에 이 선수로 할 수 있는 일(버튼) */
  action?: ReactNode
}) {
  const { columns, row, onClose, compare, action } = props
  const byField = (field: string): string | undefined => {
    const col = columns.find((c) => c.field === field)
    return col ? row.cells[col.header]?.raw || undefined : undefined
  }
  const summary = [byField('position'), byField('age') && `${byField('age')}세`, byField('nationality')]
    .filter(Boolean)
    .join(', ')

  const facts = columns.filter((col) => !col.isAttr && col.field !== 'name' && row.cells[col.header]?.raw)
  const ranged = columns.some((col) => col.isAttr && row.cells[col.header]?.range)

  return (
    <aside className="drawer" aria-label={`${row.name} 상세`}>
      <div className="drawer-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{row.name}</h2>
          {summary && <p className="muted">{summary}</p>}
        </div>
        <button className="btn ghost icon" onClick={onClose} aria-label="상세 닫기" title="닫기">
          <X size={18} />
        </button>
      </div>

      <div className="drawer-body">
        {compare && (
          <div className="drawer-actions">
            <button
              className="btn"
              disabled={!compare.included && compare.full}
              onClick={compare.onToggle}
              title={!compare.included && compare.full ? '비교는 세 명까지 담을 수 있습니다' : undefined}
            >
              {compare.included ? '비교에서 빼기' : '비교에 담기'}
            </button>
            {compare.count > 0 && (
              <button className="btn ghost" onClick={compare.onOpen}>
                비교 보기 ({compare.count}명)
              </button>
            )}
          </div>
        )}
        {action && <div className="drawer-actions">{action}</div>}
        <dl className="facts">
          {facts.map((col) => (
            <div key={col.header} style={{ display: 'contents' }}>
              <dt>{col.label}</dt>
              <dd className="num">{plainText(row.cells[col.header])}</dd>
            </div>
          ))}
        </dl>

        {ATTR_GROUPS.map((group) => {
          const cols = columns.filter((col) => col.isAttr && col.group === group)
          if (cols.length === 0) return null
          return (
            <section className="attr-group" key={group}>
              <h3>{GROUP_LABEL[group]}</h3>
              <dl className="attr-list">
                {cols.map((col) => {
                  const cell = row.cells[col.header]
                  return (
                    <div key={col.header} title={attrTitle(col.label, cell)}>
                      <dt>{col.label}</dt>
                      <dd>
                        <span className={`attr-chip ${attrBand(cell?.num ?? null)} ${cell?.range ? 'ranged' : ''}`}>{attrText(cell)}</span>
                      </dd>
                    </div>
                  )
                })}
              </dl>
            </section>
          )
        })}

        {ranged && (
          <p className="faint" style={{ marginTop: 16, fontSize: 12 }}>
            점선 밑줄이 있는 값은 스카우트 정보가 부족해 범위로 나온 능력치입니다.
          </p>
        )}
      </div>
    </aside>
  )
}
