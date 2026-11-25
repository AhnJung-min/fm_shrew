import { describe, expect, it } from 'vitest'
import { positionsLabel } from '../src/shared/positions'

// 순서: GK SW DL DC DR DM ML MC MR AML AMC AMR ST WBL WBR
const ratings = (set: Record<number, number>): number[] => Array.from({ length: 15 }, (_, i) => set[i] ?? 1)

describe('positionsLabel: 실제 세이브의 숙련도와 게임 표기를 맞춰 본 사례', () => {
  it('골키퍼', () => {
    expect(positionsLabel(ratings({ 0: 20 }))).toBe('GK')
  })
  it('흐라번베르흐: DM, M (C)', () => {
    expect(positionsLabel(ratings({ 5: 20, 7: 18 }))).toBe('DM, M (C)')
  })
  it('소보슬라이: DM, M/AM (C) (숙련도 12 이하는 뺀다)', () => {
    expect(positionsLabel(ratings({ 4: 12, 5: 18, 7: 20, 9: 10, 10: 18, 11: 12 }))).toBe('DM, M/AM (C)')
  })
  it('아라우호: D (RC), WB (R)', () => {
    expect(positionsLabel(ratings({ 3: 20, 4: 16, 14: 15 }))).toBe('D (RC), WB (R)')
  })
  it('치미카스: D/WB/M (L)', () => {
    expect(positionsLabel(ratings({ 2: 20, 6: 15, 13: 17 }))).toBe('D/WB/M (L)')
  })
  it('프림퐁: D/WB/AM (R)', () => {
    expect(positionsLabel(ratings({ 4: 20, 11: 17, 14: 18 }))).toBe('D/WB/AM (R)')
  })
  it('엔도: D (C), DM, M (C)', () => {
    expect(positionsLabel(ratings({ 3: 16, 5: 20, 7: 16 }))).toBe('D (C), DM, M (C)')
  })
  it('키에사: AM (RLC), ST (C)', () => {
    expect(positionsLabel(ratings({ 9: 20, 10: 16, 11: 19, 12: 16 }))).toBe('AM (RLC), ST (C)')
  })
})
