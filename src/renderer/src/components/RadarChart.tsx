import { useState } from 'react'

export interface RadarSeries {
  name: string
  /** CSS 색 변수 이름(예: --series-1) */
  color: string
  /** 축 순서대로 1~20, 값이 없으면 null */
  values: Array<number | null>
}

const SIZE = 380
const CENTER = SIZE / 2
const RADIUS = 122
const MAX = 20
const RINGS = [5, 10, 15, 20]

function point(axisIndex: number, axisCount: number, value: number): [number, number] {
  const angle = (Math.PI * 2 * axisIndex) / axisCount - Math.PI / 2
  const r = (value / MAX) * RADIUS
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)]
}

/**
 * 선수 성향 비교 그림. 축은 관련 능력치의 평균(1~20)이다.
 * 정확한 값은 축에 마우스를 올리거나(키보드는 Tab) 아래 표에서 읽는다.
 */
export function RadarChart(props: { axes: string[]; series: RadarSeries[] }) {
  const { axes, series } = props
  const [active, setActive] = useState<number | null>(null)
  const n = axes.length
  const ringPath = (value: number): string =>
    axes.map((_, i) => point(i, n, value)).map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + 'Z'

  return (
    <div className="radar">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${series.map((s) => s.name).join(', ')}의 성향 비교`}>
        {RINGS.map((ring) => (
          <path key={ring} d={ringPath(ring)} className={ring === MAX ? 'radar-edge' : 'radar-grid'} />
        ))}
        {axes.map((_, i) => {
          const [x, y] = point(i, n, MAX)
          return <line key={i} x1={CENTER} y1={CENTER} x2={x} y2={y} className={active === i ? 'radar-spoke on' : 'radar-spoke'} />
        })}
        {[10, 20].map((ring) => {
          const [x, y] = point(0, n, ring)
          return (
            <text key={ring} x={x + 5} y={y + 4} className="radar-tick">
              {ring}
            </text>
          )
        })}

        {series.map((s) => {
          const points = s.values.map((v, i) => point(i, n, v ?? 0))
          return (
            <g key={s.name}>
              <path
                d={points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + 'Z'}
                style={{ stroke: `var(${s.color})`, fill: `var(${s.color})` }}
                className="radar-area"
              />
              {points.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={active === i ? 5.5 : 4} style={{ fill: `var(${s.color})` }} className="radar-dot" />
              ))}
            </g>
          )
        })}

        {axes.map((label, i) => {
          const [x, y] = point(i, n, MAX + 3.4)
          const anchor = Math.abs(x - CENTER) < 8 ? 'middle' : x > CENTER ? 'start' : 'end'
          return (
            <text key={label} x={x} y={y + 4} textAnchor={anchor} className={active === i ? 'radar-label on' : 'radar-label'}>
              {label}
            </text>
          )
        })}

        {/* 축마다 넓은 부채꼴을 깔아 마우스와 키보드로 값을 읽을 수 있게 한다 */}
        {axes.map((label, i) => {
          const half = Math.PI / n
          const mid = (Math.PI * 2 * i) / n - Math.PI / 2
          const reach = RADIUS + 44
          const a = [CENTER + reach * Math.cos(mid - half), CENTER + reach * Math.sin(mid - half)]
          const b = [CENTER + reach * Math.cos(mid + half), CENTER + reach * Math.sin(mid + half)]
          return (
            <path
              key={label}
              d={`M${CENTER} ${CENTER}L${a[0].toFixed(1)} ${a[1].toFixed(1)}A${reach} ${reach} 0 0 1 ${b[0].toFixed(1)} ${b[1].toFixed(1)}Z`}
              className="radar-hit"
              tabIndex={0}
              aria-label={`${label}: ${series.map((s) => `${s.name} ${s.values[i] ?? '값 없음'}`).join(', ')}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          )
        })}
      </svg>

      <div className="radar-readout" aria-live="polite">
        {active === null ? (
          <p className="faint">축에 마우스를 올리면 선수별 값을 보여 줍니다.</p>
        ) : (
          <>
            <strong>{axes[active]}</strong>
            <ul>
              {series.map((s) => (
                <li key={s.name}>
                  <span className="swatch" style={{ background: `var(${s.color})` }} />
                  <span className="radar-readout-name">{s.name}</span>
                  <span className="num">{s.values[active] === null ? '–' : s.values[active]!.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
