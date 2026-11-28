/**
 * 숫자를 글자로 쓰는 규칙을 한 곳에 둔다(디자인 적용 1차, C-03). 본체와 화면이 함께 쓰는 순수 함수들이다.
 *
 * - 부호가 있는 값의 빼기는 하이픈이 아니라 진짜 빼기 기호(U+2212)로 쓴다. 더하기와 같은 폭이라 줄이 맞는다.
 * - 범위는 한 꼴이다: `12~15`, `76~81점`, 단위가 같으면 `120~180억 원`, 다르면 `9,500만~1.2억 원`.
 * - 금액 글자 안의 공백은 바꾸지 않는다(시험이 글자 그대로 견준다). 단위가 다음 줄로 떨어지는 것은 CSS(`.money`)가 막는다.
 *
 * 이 파일의 맨 위에는 숫자 상수를 두지 않는다(tests/ledger.test.ts). 자릿수와 개수는 인자로 받고, 기본값은 인자 목록에 적는다.
 */

/** 진짜 빼기 기호(U+2212) */
const MINUS = '−'

/** 게임이 적어 주는 몸값 범위: "170억 원 - 185억 원", "9,500만 원 - 1.2억 원" */
const MONEY_RANGE = /^([\d.,]+)\s*(억|만)\s*원\s*[-–—]\s*([\d.,]+)\s*(억|만)\s*원$/

/** 줄 수 없는 값(숫자가 아님)을 대신하는 줄표. 빈 칸에 쓰는 것과 같다 */
const DASH = '–'

/** 소수점 아래를 정해진 자릿수로 쓴다. 음수는 빼기 기호로, 반올림하면 0이 되는 값은 부호 없이 */
function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits)
  if (Number(text) === 0) return text.replace('-', '')
  return text.startsWith('-') ? `${MINUS}${text.slice(1)}` : text
}

/** 정수 부분에 천 단위 쉼표를 넣는다(소수는 그대로). 음수는 빼기 기호로 */
function grouped(value: number): string {
  if (!Number.isFinite(value)) return DASH
  const [whole, fraction] = String(Math.abs(value)).split('.')
  const commas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const sign = value < 0 ? MINUS : ''
  return fraction === undefined ? `${sign}${commas}` : `${sign}${commas}.${fraction}`
}

/** 부호를 붙인 차이: `+3.0`, `−2.1`, `0.0`. 반올림하면 0인 값에는 부호를 붙이지 않는다. 숫자가 아니면 줄표 */
export function signed(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return DASH
  const text = fixed(Math.abs(value), digits)
  if (Number(text) === 0) return text
  return `${value < 0 ? MINUS : '+'}${text}`
}

/** 얻은 점수와 만점: `44 / 50`. 만점이 정수이면 소수 없이 쓴다(`3.4 / 14`) */
export function pointsOf(points: number, max: number, digits = 0): string {
  if (!Number.isFinite(points) || !Number.isFinite(max)) return DASH
  return `${fixed(points, digits)} / ${Number.isInteger(max) ? String(max) : fixed(max, digits)}`
}

/** 범위 한 꼴: `12~15`, `76~81점`. 숫자로 주면 천 단위 쉼표를 넣고, 글자로 주면 그대로 쓴다. 단위는 뒤에 그대로 붙인다(`rangeText('120', '180', '억 원')` → `120~180억 원`) */
export function rangeText(low: string | number, high: string | number, unit = ''): string {
  const part = (value: string | number): string => (typeof value === 'number' ? grouped(value) : value)
  return `${part(low)}~${part(high)}${unit}`
}

/**
 * 게임이 적어 준 몸값 범위를 한 꼴로: `170억 원 - 185억 원` → `170~185억 원`, `9,500만 원 - 1.2억 원` → `9,500만~1.2억 원`.
 * 범위가 아니거나 알아보지 못하는 꼴(`970억 원`, 이미 `~`로 쓴 글)은 그대로 둔다.
 */
export function moneyRange(text: string): string {
  const match = MONEY_RANGE.exec(text.trim())
  if (!match) return text
  const [, low, lowUnit, high, highUnit] = match
  return lowUnit === highUnit ? `${low}~${high}${lowUnit} 원` : `${low}${lowUnit}~${high}${highUnit} 원`
}

/** 몇 배인가: `1.85배` */
export function times(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return DASH
  return `${fixed(value, digits)}배`
}

/** 사람 수: `1,234명`(소수는 반올림) */
export function people(count: number): string {
  if (!Number.isFinite(count)) return DASH
  return `${grouped(Math.round(count))}명`
}
