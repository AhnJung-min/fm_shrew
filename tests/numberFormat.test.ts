import { describe, expect, it } from 'vitest'
import { moneyRange, people, pointsOf, rangeText, signed, times } from '../src/shared/numberFormat'

/** 진짜 빼기 기호(U+2212). 하이픈(-)과 다르다 */
const MINUS = '−'

describe('signed: 부호를 붙인 차이', () => {
  it('더하기는 +, 빼기는 진짜 빼기 기호(U+2212), 0은 부호 없이 소수 첫째 자리까지', () => {
    expect(signed(3)).toBe('+3.0')
    expect(signed(-2.1)).toBe(`${MINUS}2.1`)
    expect(signed(-2.1)).not.toContain('-')
    expect(signed(0)).toBe('0.0')
  })

  it('자릿수를 정할 수 있다', () => {
    expect(signed(1.25, 2)).toBe('+1.25')
    expect(signed(-1.25, 0)).toBe(`${MINUS}1`)
    expect(signed(7, 0)).toBe('+7')
  })

  it('반올림하면 0이 되는 값은 부호를 붙이지 않는다(−0.0이나 +0.0을 쓰지 않는다)', () => {
    expect(signed(-0.04)).toBe('0.0')
    expect(signed(0.04)).toBe('0.0')
    expect(signed(-0)).toBe('0.0')
    expect(signed(-0.06)).toBe(`${MINUS}0.1`)
  })

  it('숫자가 아니면 줄표', () => {
    expect(signed(Number.NaN)).toBe('–')
    expect(signed(Number.POSITIVE_INFINITY)).toBe('–')
  })
})

describe('pointsOf: 얻은 점수와 만점', () => {
  it('44 / 50', () => {
    expect(pointsOf(44, 50)).toBe('44 / 50')
    expect(pointsOf(5, 10)).toBe('5 / 10')
  })

  it('점수에는 자릿수를 주고, 만점이 정수이면 소수 없이 쓴다', () => {
    expect(pointsOf(3.4, 14, 1)).toBe('3.4 / 14')
    expect(pointsOf(12.04, 12.5, 1)).toBe('12.0 / 12.5')
  })

  it('숫자가 아니면 줄표', () => {
    expect(pointsOf(Number.NaN, 10)).toBe('–')
  })
})

describe('rangeText: 범위는 한 꼴', () => {
  it('단위가 없으면 12~15, 점수는 76~81점', () => {
    expect(rangeText(12, 15)).toBe('12~15')
    expect(rangeText(76, 81, '점')).toBe('76~81점')
  })

  it('글자로 주면 그대로 잇고, 숫자로 주면 천 단위 쉼표를 넣는다', () => {
    expect(rangeText('120', '180', '억 원')).toBe('120~180억 원')
    expect(rangeText(1560, 2350, '억 원')).toBe('1,560~2,350억 원')
    expect(rangeText('1,560', '2,350')).toBe('1,560~2,350')
  })

  it('물결표(~) 한 가지만 쓴다: 엔 대시(–)나 하이픈을 섞지 않는다', () => {
    const text = rangeText(12, 15)
    expect(text).not.toContain('–')
    expect(text).not.toContain('-')
  })
})

describe('moneyRange: 게임이 적은 몸값 범위를 한 꼴로', () => {
  it('단위가 같으면 뒤 단위 하나로 묶는다', () => {
    expect(moneyRange('170억 원 - 185억 원')).toBe('170~185억 원')
    expect(moneyRange('1,560억 원 - 2,350억 원')).toBe('1,560~2,350억 원')
    expect(moneyRange('500만 원 - 900만 원')).toBe('500~900만 원')
  })

  it('단위가 다르면 양쪽에 단위를 적는다', () => {
    expect(moneyRange('9,500만 원 - 1.2억 원')).toBe('9,500만~1.2억 원')
    expect(moneyRange('900만 원 - 1.2억 원')).toBe('900만~1.2억 원')
  })

  it('붙임표 모양이 달라도(엔 대시, 붙여 쓴 것) 알아본다', () => {
    expect(moneyRange('170억 원 – 185억 원')).toBe('170~185억 원')
    expect(moneyRange('170억 원-185억 원')).toBe('170~185억 원')
  })

  it('모르는 꼴은 그대로 둔다: 범위가 아닌 값, 이미 ~로 쓴 글, 다른 글', () => {
    expect(moneyRange('970억 원')).toBe('970억 원')
    expect(moneyRange('170~185억 원')).toBe('170~185억 원')
    expect(moneyRange('')).toBe('')
    expect(moneyRange('값을 모름')).toBe('값을 모름')
    expect(moneyRange('주급 3.4억 원 - 4억 원')).toBe('주급 3.4억 원 - 4억 원')
  })

  it('한 번 바꾼 글에 다시 써도 같다', () => {
    for (const text of ['170억 원 - 185억 원', '9,500만 원 - 1.2억 원']) expect(moneyRange(moneyRange(text))).toBe(moneyRange(text))
  })
})

describe('times, people', () => {
  it('times: 1.85배', () => {
    expect(times(1.85)).toBe('1.85배')
    expect(times(2)).toBe('2.00배')
    expect(times(1.854, 1)).toBe('1.9배')
    expect(times(Number.NaN)).toBe('–')
  })

  it('people: 1,234명(천 단위 쉼표, 소수는 반올림)', () => {
    expect(people(1234)).toBe('1,234명')
    expect(people(412)).toBe('412명')
    expect(people(0)).toBe('0명')
    expect(people(99_892)).toBe('99,892명')
    expect(people(1_234_567)).toBe('1,234,567명')
    expect(people(2.6)).toBe('3명')
  })
})
