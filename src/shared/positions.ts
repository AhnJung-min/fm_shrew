/** 세이브에 저장된 포지션 숙련도 15개의 순서 */
export const POSITION_KEYS = ['GK', 'SW', 'DL', 'DC', 'DR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST', 'WBL', 'WBR'] as const

/** 이 값 이상이면 그 자리에서 뛸 수 있는 것으로 본다(게임의 "능숙" 이상) */
export const PLAYABLE_RATING = 15

/**
 * 숙련이 이 값 이상 15 미만이면 그 자리를 "임시 주전"으로 세울 수 있다(4회차). 감점(posPenaltySigma 0.70~1.90σ)을 뺀 값으로 견주고,
 * 후보(backups)가 되지는 못한다. 10 미만은 빈 자리로 둔다.
 */
export const TEMPORARY_MIN_RATING = 10

/** 이 숙련이면 자연스러운 자리다(감점 없음) */
export const POSITION_NATURAL = 20
/**
 * 숙련을 모르는 선수(숙련 숫자가 없는 옛 기록·미리보기)를 그 자리에서 뛸 수 있다고 적힌 경우에 보는 값.
 * 감점하지 않는 쪽으로 본다(모르는 값으로 선수를 깎지 않는다).
 */
export const RATING_UNKNOWN_ASSUMED = POSITION_NATURAL

/**
 * 포지션 숙련 r에 따른 적합도 감점(그 역할 표준편차 σ의 배수). 곱셈 보정으로 총점을 막지 않고 적합도에서 뺀다(검토 2회차).
 *   r ≥ 20            0
 *   15 ≤ r < 20       0.08 · (20 - r)              (15에서 0.40σ)
 *   10 ≤ r < 15       0.40 + 0.30 · (15 - r)       (10에서 1.90σ)
 *   r < 10            1.90 + 0.50 · (10 - r)       (1에서 6.40σ)
 * 계수 0.08, 0.30, 0.50은 추정이다(게임에서 숙련 15~19와 20의 실제 차이를 아직 대조하지 못했다).
 */
export const PENALTY_ACCOMPLISHED_PER_POINT = 0.08
export const PENALTY_AWKWARD_BASE = 0.4
export const PENALTY_AWKWARD_PER_POINT = 0.3
export const PENALTY_AWKWARD_FROM = 10
export const PENALTY_POOR_BASE = 1.9
export const PENALTY_POOR_PER_POINT = 0.5

export function posPenaltySigma(rating: number): number {
  const r = Math.max(0, rating)
  if (r >= POSITION_NATURAL) return 0
  if (r >= PLAYABLE_RATING) return PENALTY_ACCOMPLISHED_PER_POINT * (POSITION_NATURAL - r)
  if (r >= PENALTY_AWKWARD_FROM) return PENALTY_AWKWARD_BASE + PENALTY_AWKWARD_PER_POINT * (PLAYABLE_RATING - r)
  return PENALTY_POOR_BASE + PENALTY_POOR_PER_POINT * (PENALTY_AWKWARD_FROM - r)
}

/**
 * 숙련이 10 미만이면 총점에 곱하는 보정: 0.10 + 0.10 · (r - 1) (1에서 0.10, 9에서 0.90). 10 이상이면 1.
 * 적합도에서 빼는 것만으로는 "뛸 수 없는 자리의 선수가 다른 항목 점수로 위에 오르는 것"을 막지 못해서 남겨 둔 안전장치다. 추정.
 */
export const LOW_GATE_BELOW = 10
export const LOW_GATE_BASE = 0.1
export const LOW_GATE_STEP = 0.1

export function lowGate(rating: number): number {
  if (rating >= LOW_GATE_BELOW) return 1
  return Math.max(0, LOW_GATE_BASE + LOW_GATE_STEP * (rating - 1))
}

/** 숙련 15개(POSITION_KEYS 순서)에서 한 자리의 숙련. 숫자가 없으면 null */
export function ratingAt(ratings: readonly number[] | undefined, position: string): number | null {
  if (!ratings) return null
  const at = (POSITION_KEYS as readonly string[]).indexOf(position)
  const value = at < 0 ? undefined : ratings[at]
  return value === undefined ? null : value
}

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
