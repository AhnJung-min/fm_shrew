import { describe, expect, it } from 'vitest'
import { SPOT } from '../src/renderer/src/components/PositionMap'
import { POSITION_KEYS } from '../src/shared/positions'

describe('포지션 그림의 자리 원(D-10)', () => {
  it('15자리가 모두 있고 서로 겹치지 않는다(원 반지름 19 + 가장 굵은 테두리 1.5씩)', () => {
    expect(Object.keys(SPOT).sort()).toEqual([...POSITION_KEYS].sort())
    const keys = Object.keys(SPOT)
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const [ax, ay] = SPOT[keys[i]]
        const [bx, by] = SPOT[keys[j]]
        expect(Math.hypot(ax - bx, ay - by), `${keys[i]} - ${keys[j]}`).toBeGreaterThanOrEqual(2 * (19 + 1.5))
      }
    }
  })

  it('모든 원이 경기장 안에 들어간다(가로 0~220, 세로 0~340)', () => {
    for (const [x, y] of Object.values(SPOT)) {
      expect(x - 20.5).toBeGreaterThanOrEqual(2)
      expect(x + 20.5).toBeLessThanOrEqual(218)
      expect(y - 20.5).toBeGreaterThanOrEqual(2)
      expect(y + 20.5).toBeLessThanOrEqual(338)
    }
  })
})
