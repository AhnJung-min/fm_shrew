import { FORMATIONS, type DepthPlayer } from '@shared/depth'
import { TERM_HELP } from '@shared/recommend'
import { ROLE_BY_ID, rolesFor } from '@shared/roles'
import type { SlotAnalysis, TacticAnalysis } from '@shared/tactic'
import type { ColumnInfo, PlayerRow, Settings } from '@shared/types'
import { attrBand } from '@/lib/format'

/** 적합도(0~100)를 능력치와 같은 네 단계 색으로. 숫자와 "적합도"라는 글자도 함께 보인다. */
function fitBand(score: number): string {
  return attrBand(Math.max(1, Math.min(20, Math.round(score / 5))))
}

function Fit(props: { player: DepthPlayer }) {
  const { player } = props
  return (
    <span
      className={`tp-fit ${fitBand(player.score)}`}
      title={`${TERM_HELP.fit} 이 선수는 ${player.score.toFixed(1)}점${player.uncertain ? ' (범위로 나온 능력치가 섞여 있어 정확하지 않을 수 있음)' : ''}.`}
    >
      적합도 <b className="num">{player.uncertain ? '~' : ''}{Math.round(player.score)}</b>
    </span>
  )
}

function Slot(props: {
  analysis: SlotAnalysis
  abilityOf: (idx: number) => number | null
  selectedIdx: number | null
  focused: boolean
  onFocus: (index: number) => void
  onRole: (slot: SlotAnalysis, roleId: string) => void
  onPick: (idx: number) => void
}) {
  const { analysis, abilityOf, selectedIdx, focused, onFocus, onRole, onPick } = props
  const { slot } = analysis
  const position = analysis.label
  const roles = rolesFor(slot.position)
  const { starter } = slot
  const ability = starter ? abilityOf(starter.idx) : null
  const flags = [
    !starter ? { text: '뛸 선수 없음', bad: true } : null,
    starter && slot.weak ? { text: '약한 자리', bad: true } : null,
    slot.thin ? { text: '후보 없음', bad: false } : null
  ].filter((flag): flag is { text: string; bad: boolean } => flag !== null)

  return (
    <section
      className={`tp-slot ${!starter || slot.weak ? 'weak' : ''} ${starter && starter.idx === selectedIdx ? 'selected' : ''} ${focused ? 'focused' : ''}`}
      aria-label={`${position} 자리`}
    >
      <div className="tp-pos" title={position}>
        {position}
      </div>
      {starter ? (
        <button
          className="tp-card"
          onClick={() => onPick(starter.idx)}
          title={`${starter.name}: ${ROLE_BY_ID[slot.roleId].label} 적합도 ${starter.score.toFixed(1)}점${ability !== null ? `, 현재 능력 ${ability}` : ''}`}
          aria-label={`${position} 주전 ${starter.name}, ${ROLE_BY_ID[slot.roleId].label} 적합도 ${Math.round(starter.score)}점${ability !== null ? `, 현재 능력 ${ability}` : ''}. 선수 정보 열기`}
        >
          <span className="tp-name">{starter.name}</span>
          <span className="tp-meta">
            <Fit player={starter} />
            {ability !== null && (
              <span className="tp-ca" title="현재 능력 (1~200)">
                능력 <b className="num">{ability}</b>
              </span>
            )}
          </span>
        </button>
      ) : (
        <div className="tp-card empty">이 자리에서 뛸 수 있는 선수가 없습니다.</div>
      )}

      {roles.length > 1 ? (
        <select
          className="field tp-role"
          aria-label={`${position} 자리의 역할`}
          value={slot.roleId}
          onChange={(event) => onRole(analysis, event.target.value)}
        >
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="tp-role-fixed">{ROLE_BY_ID[slot.roleId].label}</div>
      )}

      <button
        className={`tp-need ${analysis.level}`}
        aria-pressed={focused}
        aria-label={`${position} 보강 필요도 ${Math.round(analysis.need)}점, ${analysis.levelLabel}. 자리 분석 보기`}
        title={`${TERM_HELP.need} ${analysis.reason}`}
        onClick={() => onFocus(slot.index)}
      >
        <span>보강 필요도</span>
        <b className="num">{Math.round(analysis.need)}</b>
        <em>{analysis.levelLabel}</em>
      </button>

      {flags.length > 0 && (
        <div className="tp-flags">
          {flags.map((flag) => (
            <span key={flag.text} className={flag.bad ? 'bad' : 'warn'}>
              {flag.text}
            </span>
          ))}
        </div>
      )}

      {slot.backups.length > 0 && (
        <ol className="tp-backups" aria-label={`${position} 후보`}>
          {slot.backups.map((player) => (
            <li key={player.idx}>
              <button
                onClick={() => onPick(player.idx)}
                title={`후보 ${player.name}: 적합도 ${player.score.toFixed(1)}점`}
                aria-label={`후보 ${player.name}, 적합도 ${Math.round(player.score)}점. 선수 정보 열기`}
              >
                <span className="tp-brank">후보</span>
                <span className="tp-bname">{player.name}</span>
                <span className="tp-bscore num">
                  {player.uncertain ? '~' : ''}
                  {Math.round(player.score)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * 포메이션 모양으로 선수를 놓은 전술판. 자리마다 주전의 적합도와 현재 능력, 역할, 보강 필요도, 후보를 보여 준다.
 * 포메이션과 역할은 뎁스 차트와 같은 설정이라 어느 쪽에서 바꿔도 같이 바뀐다.
 * 보강 필요도를 누르면 그 자리의 분석(옆 패널)이 열린다.
 */
export function TacticsPitch(props: {
  columns: ColumnInfo[]
  rows: PlayerRow[]
  analysis: TacticAnalysis
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  selectedIdx: number | null
  onPick: (idx: number) => void
  focusedSlot: number | null
  onFocusSlot: (index: number) => void
}) {
  const { columns, rows, analysis, settings, onChange, selectedIdx, onPick, focusedSlot, onFocusSlot } = props
  const { formation } = analysis
  const abilityHeader = columns.find((col) => col.field === 'ability')?.header
  const abilityOf = (idx: number): number | null => {
    if (!abilityHeader) return null
    return rows.find((each) => each.idx === idx)?.cells[abilityHeader]?.num ?? null
  }
  const setRole = (target: SlotAnalysis, roleId: string): void =>
    onChange({ slotRoles: { ...settings.slotRoles, [`${formation.id}:${target.slot.index}`]: roleId } })
  const weakCount = analysis.slots.filter((each) => each.slot.weak || !each.slot.starter).length

  return (
    <div className="tactics-main">
      <div className="tp-bar">
        <label className="tp-formation">
          <span className="muted">포메이션</span>
          <select
            className="field"
            aria-label="포메이션"
            value={formation.id}
            onChange={(event) => onChange({ formation: event.target.value })}
          >
            {FORMATIONS.map((each) => (
              <option key={each.id} value={each.id}>
                {each.label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted tp-summary">
          {weakCount === 0
            ? '주전 점수가 고르게 나옵니다. 눈에 띄게 약한 자리가 없습니다.'
            : `약한 자리 ${weakCount}곳: 주전 점수가 다른 자리 평균보다 5점 이상 낮거나 뛸 선수가 없습니다.`}
        </p>
      </div>

      <div className="tp-pitch" role="group" aria-label={`${formation.label} 전술판. 위쪽이 공격 방향`}>
        <div className="tp-lines" aria-hidden="true">
          <i className="tp-box top" />
          <i className="tp-half" />
          <i className="tp-circle" />
          <i className="tp-box bottom" />
        </div>
        {formation.rows.map((_, rowIndex) => (
          <div className="tp-row" key={rowIndex}>
            {analysis.slots
              .filter((each) => each.slot.row === rowIndex)
              .map((each) => (
                <Slot
                  key={each.slot.index}
                  analysis={each}
                  abilityOf={abilityOf}
                  selectedIdx={selectedIdx}
                  focused={focusedSlot === each.slot.index}
                  onFocus={onFocusSlot}
                  onRole={setRole}
                  onPick={onPick}
                />
              ))}
          </div>
        ))}
      </div>
      <p className="muted tp-help">
        위쪽이 공격 방향입니다. 적합도는 자리 역할에 필요한 능력치로 계산한 0~100점이고, 보강 필요도는 그 자리에 선수를 더 데려와야 하는 정도입니다.
        선수를 누르면 상세 정보가, 보강 필요도를 누르면 그 자리의 분석이 열립니다.
      </p>
    </div>
  )
}
