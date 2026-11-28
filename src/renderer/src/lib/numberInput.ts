/**
 * 숫자 칸의 순수한 규칙(C-67). 숫자 입력 칸(type=number)은 칸 위에서 휠을 굴리면 값이 저절로 바뀌므로 쓰지 않고,
 * 숫자만 받는 글자 칸(type=text, inputMode=numeric)에서 이 규칙으로 값을 읽고 ↑↓로 1씩 바꾼다. 정수만 다룬다.
 */

/** 전각 숫자와 여러 가지 빼기 기호를 ASCII로 바꾸고 앞뒤 빈칸을 뗀다 */
function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[－−–﹣]/g, '-')
    .trim()
}

/**
 * 칸에 적힌 글자를 값으로 읽는다.
 * - 빈 칸은 null(값이 없음), 숫자가 아닌 글자가 섞였으면 'invalid'.
 * - 전각 숫자('１２')도 받는다. 범위를 벗어나면 가까운 끝값으로 맞춘다.
 */
export function parseNumber(text: string, min: number, max: number): number | null | 'invalid' {
  const normalized = normalize(text)
  if (normalized === '') return null
  if (!/^-?\d+$/.test(normalized)) return 'invalid'
  return Math.min(max, Math.max(min, Number(normalized)))
}

/** 위·아래 화살표로 1씩 바꾼다. 끝값에서 멈추고, 빈 칸에서는 가장 작은 값이 된다 */
export function stepNumber(value: number | null, key: 'ArrowUp' | 'ArrowDown', min: number, max: number): number {
  if (value === null) return min
  const next = key === 'ArrowUp' ? value + 1 : value - 1
  return Math.min(max, Math.max(min, next))
}
