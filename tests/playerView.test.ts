import { describe, expect, it } from 'vitest'
import {
  footSummary,
  formatPounds,
  growthRoom,
  hiddenAttributes,
  hiddenBand,
  initialsOf,
  positionLevel,
  visibleAttributes
} from '../src/shared/playerView'
import { SAVE_ATTRIBUTE_ORDER } from '../src/shared/world'

describe('positionLevel', () => {
  it('20은 주 포지션, 15~19는 능숙, 10~14는 어느 정도, 그 아래는 서툼', () => {
    expect([20, 19, 15, 14, 10, 9, 1].map(positionLevel)).toEqual(['main', 'good', 'good', 'fair', 'fair', 'poor', 'poor'])
  })
})

describe('growthRoom', () => {
  it('잠재 능력이 10 이상 높을 때만 성장 여지를 준다', () => {
    expect(growthRoom(120, 130)).toBe(10)
    expect(growthRoom(120, 129)).toBeNull()
    expect(growthRoom(150, 150)).toBeNull()
  })
})

describe('footSummary', () => {
  it('더 강한 발이 주발이다', () => {
    expect(footSummary(5, 19)).toMatchObject({ main: '오른발', weak: '왼발', weakNote: '매우 약함' })
    expect(footSummary(18, 8)).toMatchObject({ main: '왼발', weak: '오른발' })
  })
  it('양쪽이 모두 강하고 비슷하면 양발이다', () => {
    expect(footSummary(17, 18)).toMatchObject({ main: '양발', weak: null })
    expect(footSummary(12, 19).main).toBe('오른발')
  })
})

describe('hiddenBand', () => {
  it('낮을수록 좋은 값은 뒤집어 단계를 매긴다', () => {
    expect(hiddenBand(18, true)).toBe('a4')
    expect(hiddenBand(18, false)).toBe('a1')
    expect(hiddenBand(3, false)).toBe('a4')
  })
})

describe('formatPounds', () => {
  it('금액을 짧게 쓰고 모르면 빈 글자', () => {
    expect(formatPounds(25_000_000)).toBe('£25M')
    expect(formatPounds(2_400_000)).toBe('£2.4M')
    expect(formatPounds(180_000)).toBe('£180K')
    expect(formatPounds(0)).toBe('')
    expect(formatPounds(null)).toBe('')
  })
})

describe('initialsOf', () => {
  it('한글은 첫 글자, 영문은 성과 이름의 첫 글자', () => {
    expect(initialsOf('한지후')).toBe('한')
    expect(initialsOf('Ada Quinn')).toBe('AQ')
    expect(initialsOf('  ')).toBe('?')
  })
})

describe('능력치 묶기', () => {
  const shown = SAVE_ATTRIBUTE_ORDER.map((_, i) => (i % 20) + 1)
  it('필드 선수는 골키퍼 묶음을, 골키퍼는 기술 묶음을 뺀다', () => {
    const field = visibleAttributes(shown, false)
    const keeper = visibleAttributes(shown, true)
    expect(field.some((a) => a.group === 'goalkeeping')).toBe(false)
    expect(keeper.some((a) => a.group === 'technical')).toBe(false)
    expect(field.map((a) => a.group)[0]).toBe('technical')
    expect(keeper.map((a) => a.group)[0]).toBe('goalkeeping')
  })
  it('보이는 능력치와 숨은 능력치 5개가 겹치지 않는다', () => {
    const hidden = hiddenAttributes(shown).map((a) => a.id)
    expect(hidden).toHaveLength(5)
    expect(visibleAttributes(shown, false).some((a) => hidden.includes(a.id))).toBe(false)
  })
})
