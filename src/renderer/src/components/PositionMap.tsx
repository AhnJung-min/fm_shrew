import { EditNumber } from '@/components/EditNumber'
import { POSITION_KEYS } from '@shared/positions'
import { POSITION_LEVEL_LABEL, POSITION_NAME, positionLevel, type PositionLevel } from '@shared/playerView'

/** 그림 안 자리(가로 0~220, 세로 0~340. 자리 원은 지름 38 + 테두리라 이웃과 중심이 44 이상 떨어져야 겹치지 않는다). 위쪽이 상대 골문, 아래쪽이 우리 골문이다. */
export const SPOT: Record<string, [number, number]> = {
  ST: [110, 36],
  AML: [34, 84],
  AMC: [110, 84],
  AMR: [186, 84],
  ML: [34, 132],
  MC: [110, 132],
  MR: [186, 132],
  DM: [110, 176],
  WBL: [24, 178],
  WBR: [196, 178],
  DL: [48, 222],
  DC: [110, 222],
  DR: [172, 222],
  SW: [110, 266],
  GK: [110, 310]
}

const LEVELS: PositionLevel[] = ['main', 'good', 'fair', 'poor']

/**
 * 선수가 15개 자리를 얼마나 잘 소화하는지 보여 주는 작은 경기장 그림.
 * 색과 함께 모양(굵은 테두리, 점선)과 글(아래 범례와 목록)로도 구분된다.
 */
export function PositionMap(props: {
  ratings: number[]
  /** 주면 에디터 모양: 15자리 모두 1~20으로 고칠 수 있고, 고친 값은 노란 테두리로 드러난다 */
  edit?: { original: number[]; onChange: (index: number, value: number) => void; disabled?: boolean }
}) {
  const { ratings, edit } = props
  const rated = POSITION_KEYS.map((key, i) => ({ key, rating: ratings[i] ?? 1 }))
  const playable = rated.filter((each) => each.rating >= 10).sort((a, b) => b.rating - a.rating)

  return (
    <div className="posmap">
      <svg viewBox="0 0 220 340" role="img" aria-label="포지션별 소화 능력을 보여 주는 경기장 그림" className="posmap-pitch">
        <rect x="2" y="2" width="216" height="336" rx="8" className="pm-grass" />
        <line x1="2" y1="154" x2="218" y2="154" className="pm-line" />
        <circle cx="110" cy="154" r="26" className="pm-line" fill="none" />
        <rect x="52" y="2" width="116" height="40" className="pm-line" fill="none" />
        <rect x="52" y="298" width="116" height="40" className="pm-line" fill="none" />
        {rated.map(({ key, rating }) => {
          const [x, y] = SPOT[key]
          const level = positionLevel(rating)
          return (
            <g
              key={key}
              className={`pm-spot ${level} ${edit && edit.original[POSITION_KEYS.indexOf(key)] !== rating ? 'changed' : ''}`}
              transform={`translate(${x} ${y})`}
              onClick={edit ? () => document.getElementById(`pm-in-${key}`)?.focus() : undefined}
            >
              <title>{`${POSITION_NAME[key]}: ${rating} (${POSITION_LEVEL_LABEL[level]})`}</title>
              <circle r="19" />
              <text y="-3" className="pm-code">
                {key}
              </text>
              <text y="12" className="pm-rate">
                {rating}
              </text>
            </g>
          )
        })}
      </svg>

      <div className="posmap-side">
        <ul className="pm-legend" aria-label="색과 모양의 뜻">
          {LEVELS.map((level) => (
            <li key={level}>
              <span className={`pm-swatch ${level}`} aria-hidden="true" />
              <b>{POSITION_LEVEL_LABEL[level]}</b>
              <span className="faint">{level === 'main' ? '20' : level === 'good' ? '15~19' : level === 'fair' ? '10~14' : '9 이하'}</span>
            </li>
          ))}
        </ul>
        {edit ? (
          <>
            <h4>자리마다 1~20</h4>
            <ul className="pm-list editing">
              {rated.map(({ key, rating }, index) => {
                const original = edit.original[index] ?? rating
                return (
                  <li key={key} className={original !== rating ? 'changed' : ''}>
                    <label htmlFor={`pm-in-${key}`}>
                      {POSITION_NAME[key]}
                      {original !== rating && <small className="pl-orig">원래 값 {original}</small>}
                    </label>
                    <EditNumber
                      id={`pm-in-${key}`}
                      label={POSITION_NAME[key]}
                      value={rating}
                      original={original}
                      min={1}
                      max={20}
                      disabled={edit.disabled}
                      onChange={(value) => edit.onChange(index, value)}
                    />
                  </li>
                )
              })}
            </ul>
          </>
        ) : (
          <>
            <h4>뛸 수 있는 자리</h4>
            {playable.length === 0 ? (
              <p className="faint">어느 자리도 잘 소화하지 못합니다.</p>
            ) : (
              <ul className="pm-list">
                {playable.map(({ key, rating }) => (
                  <li key={key}>
                    <span>{POSITION_NAME[key]}</span>
                    <span className={`pm-tag ${positionLevel(rating)}`}>
                      {POSITION_LEVEL_LABEL[positionLevel(rating)]} {rating}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
