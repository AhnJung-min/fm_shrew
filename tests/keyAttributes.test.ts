import { describe, expect, it } from 'vitest'
import { FIELDS } from '../src/shared/fields'
import { GROUP_WEIGHT_MIN, groupKeyAttributes, KEY_WEIGHT_MIN, keyAttributesOf, playsInGroup, POSITION_GROUPS } from '../src/shared/keyAttributes'
import { ROLE_BY_ID } from '../src/shared/roles'

const screenOrder = FIELDS.filter((field) => field.isAttr).map((field) => field.id)
const group = (id: string) => POSITION_GROUPS.find((each) => each.id === id)!

describe('주요 능력치(표에서 보여 줄 열 고르기)', () => {
  it('역할의 가중치가 걸린 능력치만, 무거운 것부터 게임 화면 순서로 놓는다', () => {
    const keys = keyAttributesOf('fb', {})
    const weights = ROLE_BY_ID.fb.weights
    expect(keys.map((key) => key.id).sort()).toEqual(Object.keys(weights).filter((id) => weights[id] > 0).sort())
    for (let i = 1; i < keys.length; i++) {
      const before = keys[i - 1]
      const after = keys[i]
      expect(before.weight >= after.weight).toBe(true)
      if (before.weight === after.weight) expect(screenOrder.indexOf(before.id)).toBeLessThan(screenOrder.indexOf(after.id))
    }
    // 기본 역할은 핵심 4, 도움 2라서 핵심이 앞에 모여 있다
    expect(keys.filter((key) => key.core).every((key) => key.weight === 4)).toBe(true)
    expect(keys.findIndex((key) => !key.core)).toBe(keys.filter((key) => key.core).length)
  })

  it('설정에서 고친 가중치를 따른다(0이면 빠지고, 새로 걸면 들어간다)', () => {
    const base = keyAttributesOf('st', {})
    const dropped = base[0].id
    const keys = keyAttributesOf('st', { st: { [dropped]: 0, corners: 5 } })
    expect(keys.some((key) => key.id === dropped)).toBe(false)
    expect(keys[0]).toEqual({ id: 'corners', weight: 5, core: true })
  })

  it('포지션 묶음은 그 묶음 역할들의 평균 가중치로 고른다', () => {
    // 골키퍼 묶음은 골키퍼 역할 하나뿐이라 그 역할의 능력치와 같다
    expect(groupKeyAttributes(group('gk'), {})).toEqual(keyAttributesOf('gk', {}))
    for (const each of POSITION_GROUPS) {
      const keys = groupKeyAttributes(each, {})
      expect(keys.length).toBeGreaterThan(0)
      // 묶음마다 열이 너무 많아지지 않는다(모든 능력치는 30개가 넘는다)
      expect(keys.length).toBeLessThanOrEqual(15)
      for (const key of keys) {
        expect(key.weight).toBeGreaterThanOrEqual(GROUP_WEIGHT_MIN)
        expect(key.core).toBe(key.weight >= KEY_WEIGHT_MIN)
      }
    }
    // 수비 묶음에서 태클은 핵심, 마무리는 없다
    const defence = groupKeyAttributes(group('def'), {})
    expect(defence.find((key) => key.id === 'tackling')?.core).toBe(true)
    expect(defence.some((key) => key.id === 'finishing')).toBe(false)
  })

  it('포지션 표기로 묶음을 가린다', () => {
    expect(playsInGroup('D (RC), WB (R)', group('def'))).toBe(true)
    expect(playsInGroup('D (RC), WB (R)', group('mid'))).toBe(false)
    expect(playsInGroup('DM, M (C)', group('mid'))).toBe(true)
    expect(playsInGroup('AM (L), ST (C)', group('att'))).toBe(true)
    expect(playsInGroup('GK', group('gk'))).toBe(true)
    expect(playsInGroup('GK', group('def'))).toBe(false)
  })
})
