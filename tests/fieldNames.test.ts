/**
 * 능력치 이름이 게임의 한국어 이름을 따르는지(2단계 리드 결정 4).
 * 까닭: 예전에 앱의 "수비 조율"은 게임의 "페널티 박스 장악력"(commandOfArea)을 가리켰고 게임의 "수비 조율"은 communication이라서,
 * 에디터에서 "수비 조율"을 고치면 게임에서 다른 능력치가 바뀌었다. 항목 id는 바뀌지 않는다. 계산은 id로만 하므로 점수는 그대로다.
 */
import { describe, expect, it } from 'vitest'
import type { Fm26Data } from '../src/shared/catalogFm26'
import raw from '../src/shared/data/fm26-roles.json'
import { FIELD_BY_ID, FIELDS, matchField, normalizeHeader } from '../src/shared/fields'

const data = raw as unknown as Fm26Data

/** 이름을 게임 이름으로 바꾼 아홉 항목: id → { 게임 이름, 표 머리의 짧은 이름, 앱이 예전에 쓰던 이름 } */
const RENAMED: Record<string, { label: string; short: string; old: string }> = {
  handling: { label: '볼 핸들링', short: '핸들', old: '핸들링' },
  aerialReach: { label: '공중 장악력', short: '공중', old: '공중볼 처리' },
  commandOfArea: { label: '페널티 박스 장악력', short: '박스', old: '수비 조율' },
  communication: { label: '수비 조율', short: '조율', old: '의사소통' },
  positioning: { label: '수비 위치 선정', short: '위치', old: '위치 선정' },
  marking: { label: '일대일 마크', short: '마크', old: '대인 방어' },
  balance: { label: '균형 감각', short: '균형', old: '밸런스' },
  oneOnOnes: { label: '일대일 방어', short: '1대1', old: '일대일' },
  rushingOut: { label: '돌진(빈도)', short: '돌진', old: '달려 나오기' }
}

describe('능력치 이름은 게임의 한국어 이름이다', () => {
  it('이름을 바꾼 아홉 항목: id는 그대로이고 이름과 표 머리의 짧은 이름이 게임 이름에서 온 것이다', () => {
    for (const [id, expected] of Object.entries(RENAMED)) {
      const field = FIELD_BY_ID[id]
      expect(field, id).toBeDefined()
      expect(field.isAttr, id).toBe(true)
      expect(field.label, id).toBe(expected.label)
      expect(field.short, id).toBe(expected.short)
    }
  })

  it('능력치 37개 모두 이름이 게임 이름과 같다(생성기가 쓰는 능력치 이름 표와 같다)', () => {
    const attributes = FIELDS.filter((field) => field.isAttr)
    expect(Object.keys(data.attributeNames)).toHaveLength(37)
    for (const [name, id] of Object.entries(data.attributeNames)) expect(FIELD_BY_ID[id]?.label, id).toBe(name)
    // 게임에는 보이지 않거나 역할에 쓰이지 않는 능력치(페널티킥, 코너킥 등)는 이 표에 없다
    const named = new Set(Object.values(data.attributeNames))
    expect(attributes.filter((field) => !named.has(field.id)).length).toBeGreaterThan(0)
  })

  it('게임 이름의 열은 그 능력치로 읽는다(옛 이름의 열도 같은 능력치로 읽는다: 단 옛 "수비 조율"은 이제 게임대로 communication이다)', () => {
    for (const [id, expected] of Object.entries(RENAMED)) {
      expect(matchField(expected.label, true)?.id, `${expected.label} → ${id}`).toBe(id)
      expect(matchField(expected.short, true)?.id ?? id, `짧은 이름 ${expected.short} → ${id}`).toBe(id)
    }
    for (const [id, expected] of Object.entries(RENAMED)) {
      const reads = matchField(expected.old, true)?.id
      expect(reads, `옛 이름 ${expected.old}`).toBe(expected.old === '수비 조율' ? 'communication' : id)
    }
    // 게임이 같은 이름으로 내보낸 열: 수비 조율은 communication, 페널티 박스 장악력은 commandOfArea
    expect(matchField('수비 조율', true)?.id).toBe('communication')
    expect(matchField('페널티 박스 장악력', true)?.id).toBe('commandOfArea')
  })

  it('이름과 짧은 이름이 다른 항목과 겹치지 않는다(같은 열 이름이 두 능력치를 가리키지 않는다)', () => {
    const labels = FIELDS.filter((field) => field.isAttr).map((field) => normalizeHeader(field.label))
    expect(new Set(labels).size).toBe(labels.length)
    for (const [id, expected] of Object.entries(RENAMED)) {
      const same = FIELDS.filter((field) => field.id !== id && field.isAttr && (normalizeHeader(field.label) === normalizeHeader(expected.short) || normalizeHeader(field.short) === normalizeHeader(expected.short)))
      expect(same.map((field) => field.id), `${id}의 짧은 이름 ${expected.short}`).toEqual([])
    }
  })
})
