import { describe, expect, it } from 'vitest'
import { parseNumber, stepNumber } from '../src/renderer/src/lib/numberInput'

describe('parseNumber: 숫자 칸에 적힌 글자를 값으로', () => {
  it('숫자만 받는다', () => {
    expect(parseNumber('12', 0, 20)).toBe(12)
    expect(parseNumber('0', 0, 20)).toBe(0)
    expect(parseNumber(' 7 ', 0, 20)).toBe(7)
    expect(parseNumber('abc', 0, 20)).toBe('invalid')
    expect(parseNumber('12a', 0, 20)).toBe('invalid')
    expect(parseNumber('1 2', 0, 20)).toBe('invalid')
    expect(parseNumber('3.5', 0, 20)).toBe('invalid')
    expect(parseNumber('+4', 0, 20)).toBe('invalid')
    expect(parseNumber('-', -5, 5)).toBe('invalid')
  })

  it('전각 숫자도 받는다: ‘１２’는 12', () => {
    expect(parseNumber('１２', 0, 20)).toBe(12)
    expect(parseNumber('０', 0, 20)).toBe(0)
    expect(parseNumber('１２３', 0, 200)).toBe(123)
    expect(parseNumber('－３', -5, 5)).toBe(-3)
  })

  it('범위를 벗어나면 끝값으로 맞춘다', () => {
    expect(parseNumber('99', 1, 20)).toBe(20)
    expect(parseNumber('0', 1, 20)).toBe(1)
    expect(parseNumber('-3', 0, 20)).toBe(0)
    expect(parseNumber('-3', -5, 5)).toBe(-3)
    expect(parseNumber('99999999999999999999', 1, 20)).toBe(20)
  })

  it('빈 칸은 null이다(allowEmpty인 칸에서 값 없음이 된다)', () => {
    expect(parseNumber('', 0, 20)).toBeNull()
    expect(parseNumber('   ', 0, 20)).toBeNull()
  })
})

describe('stepNumber: ↑↓는 1씩, 끝에서 멈춘다', () => {
  it('1씩 바뀐다', () => {
    expect(stepNumber(5, 'ArrowUp', 1, 20)).toBe(6)
    expect(stepNumber(5, 'ArrowDown', 1, 20)).toBe(4)
  })

  it('끝에서 멈춘다', () => {
    expect(stepNumber(20, 'ArrowUp', 1, 20)).toBe(20)
    expect(stepNumber(1, 'ArrowDown', 1, 20)).toBe(1)
  })

  it('범위 밖의 값에서 시작해도 끝값으로 돌아온다', () => {
    expect(stepNumber(25, 'ArrowUp', 1, 20)).toBe(20)
    expect(stepNumber(25, 'ArrowDown', 1, 20)).toBe(20)
    expect(stepNumber(-4, 'ArrowUp', 1, 20)).toBe(1)
  })

  it('빈 칸에서는 가장 작은 값이 된다', () => {
    expect(stepNumber(null, 'ArrowUp', 15, 45)).toBe(15)
    expect(stepNumber(null, 'ArrowDown', 15, 45)).toBe(15)
  })
})
