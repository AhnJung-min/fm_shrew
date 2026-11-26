import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GROUP_LABEL } from '@shared/fields'
import type { ColumnInfo, Density, PlayerRow } from '@shared/types'
import { attrBand, attrText, attrTitle, plainText } from '@/lib/format'

export interface SortState {
  header: string
  dir: 'asc' | 'desc'
}

const ROW_HEIGHT: Record<Density, number> = { compact: 36, comfortable: 44 }
const OVERSCAN = 10

function columnWidth(col: ColumnInfo, rows: PlayerRow[]): number {
  if (col.field === 'name') return 200
  if (col.isAttr) return 48
  // 글자 수로 어림한다. 한글은 영문보다 넓다.
  const sample = rows.slice(0, 40).map((row) => row.cells[col.header]?.raw ?? '')
  const longest = Math.max(col.short.length * 1.6, ...sample.map(textUnits))
  return Math.round(Math.min(190, Math.max(col.numeric ? 58 : 72, longest * 7.4 + 22)))
}

function textUnits(text: string): number {
  let units = 0
  for (const ch of text) units += ch.charCodeAt(0) > 0x2e7f ? 1.75 : 1
  return units
}

export function sortRows(rows: PlayerRow[], sort: SortState | null): PlayerRow[] {
  if (!sort) return rows
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = a.cells[sort.header]
    const y = b.cells[sort.header]
    const xn = x?.num ?? null
    const yn = y?.num ?? null
    // 값이 없는 선수는 정렬 방향과 무관하게 맨 아래에 둔다
    if (xn === null && yn === null) return sign * (x?.raw ?? '').localeCompare(y?.raw ?? '', 'ko')
    if (xn === null) return 1
    if (yn === null) return -1
    return sign * (xn - yn)
  })
}

export function PlayerTable(props: {
  columns: ColumnInfo[]
  rows: PlayerRow[]
  density: Density
  sort: SortState | null
  onSort: (sort: SortState | null) => void
  selectedIdx: number | null
  onSelect: (row: PlayerRow) => void
}) {
  const { columns, rows, density, sort, onSort, selectedIdx, onSelect } = props
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewHeight, setViewHeight] = useState(600)
  const rowHeight = ROW_HEIGHT[density]

  // 이름 열을 맨 앞에 고정한다
  const ordered = useMemo(() => {
    const nameCol = columns.find((col) => col.field === 'name') ?? columns[0]
    return nameCol ? [nameCol, ...columns.filter((col) => col !== nameCol)] : []
  }, [columns])

  const widths = useMemo(() => ordered.map((col) => columnWidth(col, rows)), [ordered, rows])
  const totalWidth = widths.reduce((sum, w) => sum + w, 0)

  // 머리 위 묶음 띠(정보/기술/정신/신체…): 같은 묶음이 이어지는 구간을 합친다
  const bands = useMemo(() => {
    const spans: Array<{ label: string; span: number }> = []
    ordered.forEach((col, i) => {
      const label = i === 0 ? '' : GROUP_LABEL[col.group]
      const last = spans[spans.length - 1]
      if (i > 1 && last && last.label === label) last.span++
      else spans.push({ label, span: 1 })
    })
    return spans
  }, [ordered])

  const groupStart = (i: number): boolean => i > 1 && ordered[i].group !== ordered[i - 1].group

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewHeight(el.clientHeight))
    observer.observe(el)
    setViewHeight(el.clientHeight)
    return () => observer.disconnect()
  }, [])

  // 정렬이 바뀌면 맨 위로, 다른 기록(열 구성)으로 바뀌면 왼쪽 위로 돌아간다
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
    setScrollTop(0)
  }, [sort, rows.length])
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0, left: 0 })
    setScrollTop(0)
  }, [columns])

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / rowHeight) + OVERSCAN)
  const visible = rows.slice(start, end)

  const toggleSort = (col: ColumnInfo): void => {
    if (sort?.header !== col.header) {
      // 숫자는 큰 값부터, 글자는 가나다순부터 보는 것이 자연스럽다
      onSort({ header: col.header, dir: col.numeric ? 'desc' : 'asc' })
    } else if ((sort.dir === 'desc') === col.numeric) {
      onSort({ header: col.header, dir: col.numeric ? 'asc' : 'desc' })
    } else {
      onSort(null)
    }
  }

  return (
    <div
      className="table-scroll"
      ref={scroller}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <table className="ptable" style={{ width: totalWidth }}>
        <colgroup>
          {widths.map((width, i) => (
            <col key={ordered[i].header} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr className="band">
            {bands.map((band, i) => (
              <th
                key={i}
                colSpan={band.span}
                className={i === 0 ? 'sticky-col' : i > 1 ? 'group-start' : undefined}
              >
                {band.label}
              </th>
            ))}
          </tr>
          <tr className="heads">
            {ordered.map((col, i) => {
              const active = sort?.header === col.header
              // 이름 열은 값이 숫자처럼 보여도 왼쪽에 맞춘다
              const right = col.numeric && i > 0
              const classes = [i === 0 ? 'sticky-col' : '', groupStart(i) ? 'group-start' : '', right ? 'right' : '']
              return (
                <th
                  key={col.header}
                  className={classes.join(' ')}
                  title={col.label === col.header ? col.label : `${col.label} (파일의 열 이름: ${col.header})`}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={() => toggleSort(col)}
                >
                  <span className={`th-inner ${right ? 'right' : ''}`}>
                    {col.short}
                    {active && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {start > 0 && (
            <tr aria-hidden="true">
              <td className="pad" colSpan={ordered.length} style={{ height: start * rowHeight }} />
            </tr>
          )}
          {visible.map((row) => (
            <tr
              key={row.idx}
              className={`row ${row.idx === selectedIdx ? 'selected' : ''}`}
              tabIndex={0}
              onClick={() => onSelect(row)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(row)
                }
              }}
            >
              {ordered.map((col, i) => {
                const cell = row.cells[col.header]
                const start = groupStart(i) ? 'group-start' : ''
                if (i === 0) {
                  return (
                    <td key={col.header} className="sticky-col name" title={row.name}>
                      {row.name}
                    </td>
                  )
                }
                if (col.isAttr) {
                  return (
                    <td
                      key={col.header}
                      className={`center ${start}`}
                      title={attrTitle(col.label, cell)}
                    >
                      <span className={`attr-chip ${attrBand(cell?.num ?? null)} ${cell?.range ? 'ranged' : ''}`}>{attrText(cell)}</span>
                    </td>
                  )
                }
                return (
                  <td
                    key={col.header}
                    className={`${col.numeric ? 'right' : 'text'} ${start}`}
                    title={cell?.raw}
                  >
                    {plainText(cell)}
                  </td>
                )
              })}
            </tr>
          ))}
          {end < rows.length && (
            <tr aria-hidden="true">
              <td className="pad" colSpan={ordered.length} style={{ height: (rows.length - end) * rowHeight }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
