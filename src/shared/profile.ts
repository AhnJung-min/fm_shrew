import type { AttributeValue } from './roles'

/** 비교 그림의 축 하나. 관련 능력치 몇 개의 평균으로 선수의 성향을 요약한다. */
export interface ProfileAxis {
  id: string
  label: string
  attrs: string[]
}

export const OUTFIELD_AXES: ProfileAxis[] = [
  { id: 'attack', label: '공격', attrs: ['finishing', 'offTheBall', 'composure'] },
  { id: 'technique', label: '기술', attrs: ['technique', 'firstTouch', 'dribbling'] },
  { id: 'creativity', label: '창의', attrs: ['passing', 'vision', 'flair'] },
  { id: 'mental', label: '정신', attrs: ['decisions', 'anticipation', 'teamwork', 'workRate'] },
  { id: 'defending', label: '수비', attrs: ['tackling', 'marking', 'positioning'] },
  { id: 'aerial', label: '공중', attrs: ['heading', 'jumping'] },
  { id: 'physical', label: '신체', attrs: ['strength', 'stamina', 'balance'] },
  { id: 'speed', label: '속도', attrs: ['pace', 'acceleration', 'agility'] }
]

export const GOALKEEPER_AXES: ProfileAxis[] = [
  { id: 'shotStopping', label: '선방', attrs: ['reflexes', 'oneOnOnes', 'handling'] },
  { id: 'aerial', label: '공중', attrs: ['aerialReach', 'commandOfArea', 'jumping'] },
  { id: 'distribution', label: '배급', attrs: ['kicking', 'throwing', 'passing'] },
  { id: 'organising', label: '조율', attrs: ['communication', 'positioning', 'leadership'] },
  { id: 'mental', label: '정신', attrs: ['concentration', 'decisions', 'composure', 'anticipation'] },
  { id: 'physical', label: '신체', attrs: ['agility', 'strength', 'acceleration'] }
]

/** 축마다 가진 능력치의 평균(1~20). 해당 능력치가 하나도 없으면 null. */
export function profileOf(attrs: Record<string, AttributeValue>, axes: ProfileAxis[]): Array<number | null> {
  return axes.map((axis) => {
    const values = axis.attrs.map((id) => attrs[id]?.value).filter((v): v is number => v !== undefined)
    if (values.length === 0) return null
    return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10
  })
}
