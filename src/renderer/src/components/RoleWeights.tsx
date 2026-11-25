import { useState } from 'react'
import { FIELDS, GROUP_LABEL } from '@shared/fields'
import { effectiveWeights, ROLE_BY_ID, ROLES } from '@shared/roles'
import type { ColumnGroup, Settings } from '@shared/types'

/** 역할마다 어떤 능력치를 얼마나 중요하게 볼지 고친다. 바꾸면 적합도와 뎁스 차트 순위가 바로 달라진다. */
export function RoleWeights(props: { settings: Settings; onChange: (patch: Partial<Settings>) => Promise<void> }) {
  const { settings, onChange } = props
  const [roleId, setRoleId] = useState(ROLES[0].id)
  const role = ROLE_BY_ID[roleId]
  const weights = effectiveWeights(roleId, settings.roleWeights)
  const overrides = settings.roleWeights[roleId] ?? {}
  const changedCount = Object.keys(overrides).length

  // 골키퍼 역할은 골키퍼·정신·신체, 나머지는 기술·정신·신체 능력치를 보여 준다
  const groups: ColumnGroup[] = role.positions.includes('GK')
    ? ['goalkeeping', 'mental', 'physical']
    : ['technical', 'mental', 'physical']

  const setWeight = (attrId: string, value: number): Promise<void> => {
    const next = { ...overrides }
    const base = role.weights[attrId] ?? 0
    if (value === base) delete next[attrId]
    else next[attrId] = value
    const all = { ...settings.roleWeights }
    if (Object.keys(next).length > 0) all[roleId] = next
    else delete all[roleId]
    return onChange({ roleWeights: all })
  }

  const reset = (): Promise<void> => {
    const all = { ...settings.roleWeights }
    delete all[roleId]
    return onChange({ roleWeights: all })
  }

  return (
    <>
      <p className="muted" style={{ marginBottom: 12 }}>
        0은 보지 않음, 5는 가장 중요함입니다. 기본값은 게임의 계산식이 아니라 역할별로 흔히 중요하게 보는 능력치로 잡은
        것이니, 내 전술에 맞게 고쳐 쓰세요.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select className="field" aria-label="역할" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
              {settings.roleWeights[r.id] ? ' (고침)' : ''}
            </option>
          ))}
        </select>
        <button className="btn" disabled={changedCount === 0} onClick={() => void reset()}>
          기본값으로 되돌리기
        </button>
        {changedCount > 0 && <span className="faint">{changedCount}개 바꿈</span>}
      </div>

      {groups.map((group) => (
        <div key={group}>
          <h3 className="weights-group">{GROUP_LABEL[group]}</h3>
          <div className="weights">
            {FIELDS.filter((field) => field.isAttr && field.group === group).map((field) => {
              const value = weights[field.id] ?? 0
              const changed = field.id in overrides
              return (
                <label key={field.id} className={`${value > 0 ? 'on' : ''} ${changed ? 'changed' : ''}`}>
                  <span>{field.label}</span>
                  <input
                    className="field num"
                    type="number"
                    min={0}
                    max={5}
                    step={1}
                    value={value}
                    onChange={(event) => {
                      const next = Math.min(5, Math.max(0, Math.round(Number(event.target.value) || 0)))
                      void setWeight(field.id, next)
                    }}
                  />
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}
