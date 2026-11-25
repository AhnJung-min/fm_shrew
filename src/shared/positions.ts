/** 세이브에 저장된 포지션 숙련도 15개의 순서 */
export const POSITION_KEYS = ['GK', 'SW', 'DL', 'DC', 'DR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST', 'WBL', 'WBR'] as const

/** 이 값 이상이면 그 자리에서 뛸 수 있는 것으로 본다(게임의 "능숙" 이상) */
export const PLAYABLE_RATING = 15

type Side = 'R' | 'L' | 'C'

/** 줄(D, WB, M, AM)마다 어느 숙련도가 어느 쪽인지 */
const LINES: Array<{ label: string; sides: Partial<Record<Side, number>> }> = [
  { label: 'D', sides: { R: 4, L: 2, C: 3 } },
  { label: 'WB', sides: { R: 14, L: 13 } },
  { label: 'DM', sides: {} },
  { label: 'M', sides: { R: 8, L: 6, C: 7 } },
  { label: 'AM', sides: { R: 11, L: 9, C: 10 } }
]

/**
 * 숙련도 15개를 게임 표기로 바꾼다. 예: "D (RC), WB (R)", "DM, M/AM (C)", "D/WB/M (L)".
 * 쪽(R·L·C)이 같은 이웃 줄은 "/"로 합친다. DM은 쪽이 없어 따로 쓴다.
 */
export function positionsLabel(ratings: number[]): string {
  const can = (index: number): boolean => (ratings[index] ?? 0) >= PLAYABLE_RATING
  const parts: Array<{ labels: string[]; sides: string }> = []

  if (can(0)) parts.push({ labels: ['GK'], sides: '' })
  for (const line of LINES) {
    if (line.label === 'DM') {
      if (can(5)) parts.push({ labels: ['DM'], sides: '' })
      continue
    }
    const sides = (['R', 'L', 'C'] as Side[]).filter((side) => line.sides[side] !== undefined && can(line.sides[side]!)).join('')
    if (!sides) continue
    const last = parts[parts.length - 1]
    if (last && last.sides === sides && last.sides !== '') last.labels.push(line.label)
    else parts.push({ labels: [line.label], sides })
  }
  if (can(12)) parts.push({ labels: ['ST'], sides: 'C' })

  return parts.map((part) => (part.sides ? `${part.labels.join('/')} (${part.sides})` : part.labels.join('/'))).join(', ')
}

/**
 * 게임 표기("D (RC), WB (R)", "DM, M/AM (C)")를 뛸 수 있는 자리 목록으로 되돌린다.
 * 세이브에서 읽은 기록과 게임에서 내보낸 기록이 같은 표기를 쓰므로 둘 다 이것으로 읽는다.
 */
export function parsePositions(label: string): string[] {
  const found = new Set<string>()
  // 괄호 안의 쉼표를 건드리지 않도록, 괄호가 닫힌 뒤의 쉼표에서만 나눈다
  for (const part of label.split(/,(?![^(]*\))/)) {
    const match = /^\s*([A-Za-z/]+)\s*(?:\(([A-Za-z]+)\))?\s*$/.exec(part)
    if (!match) continue
    const sides = (match[2] ?? '').toUpperCase().split('')
    for (const line of match[1].toUpperCase().split('/')) {
      if (line === 'GK' || line === 'DM') found.add(line)
      else if (line === 'ST') found.add('ST')
      else if (line === 'D' || line === 'WB' || line === 'M' || line === 'AM') {
        for (const side of sides) {
          if (line === 'WB' && side === 'C') continue
          found.add(`${line}${side}`)
        }
      }
    }
  }
  return [...found]
}

/** 정렬용: 가장 숙련도가 높은 자리를 골키퍼→수비→미드→공격 순서의 번호로 */
export function positionOrder(ratings: number[]): number {
  const order = [0, 1, 3, 4, 2, 13, 14, 5, 7, 8, 6, 10, 11, 9, 12]
  let best = 0
  for (const index of order) if ((ratings[index] ?? 0) > (ratings[best] ?? 0)) best = index
  return order.indexOf(best)
}
