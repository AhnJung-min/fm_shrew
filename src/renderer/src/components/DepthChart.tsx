import { useMemo } from 'react'
import { buildDepth, FORMATION_BY_ID, FORMATIONS, type DepthPlayer, type DepthSlot } from '@shared/depth'
import { POSITION_LABEL } from '@shared/insights'
import { ROLE_BY_ID, rolesFor } from '@shared/roles'
import type { RoleNorms } from '@shared/norms'
import type { ColumnInfo, PlayerRow, Settings } from '@shared/types'

function PlayerLine(props: { rank: number; player: DepthPlayer; onPick: (idx: number) => void }) {
  const { rank, player, onPick } = props
  return (
    <li>
      <button
        className={`depth-player ${rank === 1 ? 'starter' : ''}`}
        onClick={() => onPick(player.idx)}
        title={`${player.name}: 적합도 ${player.score.toFixed(1)}점${player.uncertain ? ' (범위로 나온 능력치가 섞여 있어 정확하지 않을 수 있음)' : ''}`}
      >
        <span className="depth-rank">{rank}</span>
        <span className="depth-name">{player.name}</span>
        <span className="depth-score num">
          {player.uncertain ? '~' : ''}
          {Math.round(player.score)}
        </span>
      </button>
    </li>
  )
}

function SlotCard(props: {
  slot: DepthSlot
  onRole: (slot: DepthSlot, roleId: string) => void
  onPick: (idx: number) => void
}) {
  const { slot, onRole, onPick } = props
  const roles = rolesFor(slot.position)
  const note = slot.starter === null ? '뛸 선수 없음' : slot.weak ? '약한 자리' : slot.thin ? '후보 없음' : null

  return (
    <section className={`depth-slot ${slot.weak || slot.starter === null ? 'weak' : ''}`}>
      <header>
        <span className="depth-pos">{POSITION_LABEL[slot.position]}</span>
        {note && <span className={`depth-note ${slot.weak || !slot.starter ? 'bad' : ''}`}>{note}</span>}
      </header>
      {roles.length > 1 ? (
        <select
          className="field depth-role"
          aria-label={`${POSITION_LABEL[slot.position]} 자리의 역할`}
          value={slot.roleId}
          onChange={(event) => onRole(slot, event.target.value)}
        >
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="depth-role-fixed">{ROLE_BY_ID[slot.roleId].label}</div>
      )}
      <ol className="depth-list">
        {slot.starter && <PlayerLine rank={1} player={slot.starter} onPick={onPick} />}
        {slot.backups.map((player, i) => (
          <PlayerLine key={player.idx} rank={i + 2} player={player} onPick={onPick} />
        ))}
        {!slot.starter && <li className="depth-empty">이 자리에서 뛸 수 있는 선수가 없습니다.</li>}
      </ol>
    </section>
  )
}

/** 포메이션 모양대로 자리마다 주전과 후보, 약한 자리를 보여 준다. */
export function DepthChart(props: {
  columns: ColumnInfo[]
  rows: PlayerRow[]
  /** 역할별 기준 분포. 있으면 약한 자리를 그 역할의 눈금으로 가린다 */
  norms?: RoleNorms
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onPick: (idx: number) => void
}) {
  const { columns, rows, norms, settings, onChange, onPick } = props
  const formation = FORMATION_BY_ID[settings.formation] ?? FORMATIONS[0]
  const slots = useMemo(
    () => buildDepth(rows, columns, formation, settings.slotRoles, settings.roleWeights, 2, norms),
    [rows, columns, formation, settings.slotRoles, settings.roleWeights, norms]
  )

  const hasAttributes = columns.some((col) => col.isAttr)
  const hasPosition = columns.some((col) => col.field === 'position')
  if (!hasAttributes || !hasPosition) {
    return (
      <div className="empty" style={{ flex: 1 }}>
        <strong>이 기록으로는 뎁스 차트를 만들 수 없습니다</strong>
        포지션과 능력치 열이 있어야 합니다. 세이브에서 읽은 기록을 골라 보세요.
      </div>
    )
  }

  const weakCount = slots.filter((slot) => slot.weak || !slot.starter).length
  const setRole = (slot: DepthSlot, roleId: string): void =>
    onChange({ slotRoles: { ...settings.slotRoles, [`${formation.id}:${slot.index}`]: roleId } })

  return (
    <div className="depth">
      <div className="depth-bar">
        <label className="depth-formation">
          <span className="muted">포메이션</span>
          <select
            className="field"
            value={formation.id}
            onChange={(event) => onChange({ formation: event.target.value })}
          >
            {FORMATIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          {weakCount === 0
            ? '주전 점수가 고르게 나옵니다. 눈에 띄게 약한 자리가 없습니다.'
            : `약한 자리 ${weakCount}곳: 같은 역할 기준으로 다른 자리 주전들보다 뚜렷이 낮거나 뛸 선수가 없습니다.`}
        </p>
      </div>

      <div className="pitch">
        {formation.rows.map((_, rowIndex) => (
          <div className="pitch-row" key={rowIndex}>
            {slots
              .filter((slot) => slot.row === rowIndex)
              .map((slot) => (
                <SlotCard key={slot.index} slot={slot} onRole={setRole} onPick={onPick} />
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
