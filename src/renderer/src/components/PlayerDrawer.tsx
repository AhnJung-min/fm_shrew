import { X } from 'lucide-react'
import { GROUP_LABEL } from '@shared/fields'
import type { ColumnGroup, ColumnInfo, PlayerRow } from '@shared/types'
import { attrBand, attrText, attrTitle, plainText } from '@/lib/format'

const ATTR_GROUPS: ColumnGroup[] = ['technical', 'mental', 'physical', 'goalkeeping']

/** 선수 한 명의 상세. 게임의 선수 프로필처럼 능력치를 묶음별로 나란히 보여 준다. */
export function PlayerDrawer(props: { columns: ColumnInfo[]; row: PlayerRow; onClose: () => void }) {
  const { columns, row, onClose } = props
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
                      <dd className={attrBand(cell?.num ?? null)}>
                        <span className={cell?.range ? 'ranged' : undefined}>{attrText(cell)}</span>
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
