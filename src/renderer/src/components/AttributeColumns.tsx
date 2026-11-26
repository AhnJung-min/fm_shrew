import { GROUP_LABEL } from '@shared/fields'
import { abilityWord } from '@shared/playerView'
import type { CellValue } from '@shared/types'
import type { ProfileAttribute } from '@shared/world'
import { EditNumber } from '@/components/EditNumber'
import { attrBand, attrText, attrTitle } from '@/lib/format'

const ORDER = ['technical', 'goalkeeping', 'mental', 'physical'] as const

type ViewProps = {
  mode: 'view'
  attributes: ProfileAttribute[]
  /** 스카우트 정보가 부족해 범위로 나온 능력치의 표 칸 */
  rangeOf?: (id: string) => CellValue | undefined
}

type EditProps = {
  mode: 'edit'
  attributes: ProfileAttribute[]
  /** 능력치 id → 고치기 전의 값(1~20) */
  original: Record<string, number>
  onChange: (id: string, value: number) => void
  disabled?: boolean
}

/**
 * 능력치를 기술(골키퍼는 골키퍼) · 정신 · 신체 세 줄로 나란히 보여 준다.
 * view는 색 칩으로 읽기만, edit는 칸마다 1~20을 고칠 수 있다(Tab은 줄을 따라 아래로 내려간다).
 */
export function AttributeColumns(props: ViewProps | EditProps) {
  const { attributes } = props
  const groups = ORDER.filter((group) => attributes.some((attribute) => attribute.group === group))
  return (
    <div className={`pl-cols ${props.mode === 'edit' ? 'editing' : ''}`}>
      {groups.map((group) => (
        <div key={group} className={`pl-col ${group}`}>
          <h4>{GROUP_LABEL[group]}</h4>
          <ul>
            {attributes
              .filter((attribute) => attribute.group === group)
              .map((attribute) => {
                if (props.mode === 'view') {
                  const range = props.rangeOf?.(attribute.id)
                  return (
                    <li key={attribute.id}>
                      <span>{attribute.label}</span>
                      <span
                        className={`attr-chip ${attrBand(range?.num ?? attribute.value)} ${range ? 'ranged' : ''}`}
                        title={range ? attrTitle(attribute.label, range) : `${attribute.label}: ${attribute.value} (${abilityWord(attribute.value)})`}
                      >
                        {range ? attrText(range) : attribute.value}
                      </span>
                    </li>
                  )
                }
                const original = props.original[attribute.id] ?? attribute.value
                const changed = original !== attribute.value
                return (
                  <li key={attribute.id} className={changed ? 'changed' : ''}>
                    <label>
                      <span>
                        {attribute.label}
                        {changed && <small className="pl-orig">원래 값 {original}</small>}
                      </span>
                      <EditNumber
                        label={attribute.label}
                        value={attribute.value}
                        original={original}
                        min={1}
                        max={20}
                        band={attrBand(attribute.value)}
                        disabled={props.disabled}
                        onChange={(value) => props.onChange(attribute.id, value)}
                      />
                    </label>
                  </li>
                )
              })}
          </ul>
        </div>
      ))}
    </div>
  )
}
