/**
 * 역할 가중치 묶음(2단계 U8, A-45 백업 용도): 내보내기 → 되돌리기 → 가져오기가 적합도를 Object.is로 같게 되돌리는지, 믿을 수 없는 파일을 이유와 함께 거절하는지,
 * 가져오기 미리 보기가 바뀔 것과 건너뛴 것과 경고를 맞게 알리는지. 사용자 역할 만들기는 뒤로 미룬 기능이라 형식에 자리만 있고 가져오지 않는 것도 본다.
 * 선수 능력치는 모두 씨앗으로 지어낸 값이다.
 */
import { describe, expect, it } from 'vitest'
import { FM26_CATALOG } from '../src/shared/catalogFm26'
import { FIELDS } from '../src/shared/fields'
import { K, withLedger } from '../src/shared/ledger'
import { CUSTOM_ROLES_MAX, ROLE_BUNDLE_MAX_BYTES, ROLE_NAME_MAX, ROLE_WEIGHT_MAX } from '../src/shared/limits'
import { effectiveRoleWeights, LEGACY_CATALOG, profileWeights, type CustomRole, type RoleCatalog, type RoleOverrides } from '../src/shared/roleCatalog'
import { bundleToText, exportBundle, parseBundle, previewImport, type RoleBundle } from '../src/shared/roleShare'
import { scoreRole, type AttributeValue, type PositionKey } from '../src/shared/roles'
import type { SlotProfile } from '../src/shared/slotProfile'
import type { Settings } from '../src/shared/types'
import { seededDraw } from './helpers/searchSquad'

const ATTRIBUTES = FIELDS.filter((field) => field.isAttr).map((field) => field.id)
const settingsOf = (roleWeights: RoleOverrides, extra: Partial<Settings> = {}): Settings => ({ roleWeights, ...extra }) as Settings
const catalog = FM26_CATALOG

/** 지어낸 선수 능력치 6명(능력치 47개 모두 1~20, 일부는 범위로 나온 값) */
function players(): Array<Record<string, AttributeValue>> {
  const draw = seededDraw(77)
  return Array.from({ length: 6 }, (_, who) => Object.fromEntries(ATTRIBUTES.map((id) => [id, { value: 1 + Math.floor(draw() * 20), ranged: who === 5 && draw() < 0.3 }])))
}

/** 프로파일 일곱 개(비중 0·40·60·75·100과 골키퍼) */
function profiles(): SlotProfile[] {
  const spec: Array<[PositionKey, string, number]> = [['GK', 'GK', 60], ['DC', 'DC.pair', 60], ['DL', 'DL', 100], ['DM', 'DM.single', 0], ['MC', 'MC.pair', 40], ['AML', 'AML', 75], ['ST', 'ST.single', 60]]
  return spec.map(([position, kind, sharePct]) => ({
    ip: { position, roleId: catalog.choicesAt(position, 'ip', kind)[1].roleId },
    oop: { position, roleId: catalog.choicesAt(position, 'oop', kind)[1].roleId },
    sharePct
  }))
}

type Fit = { score: number; uncertain: boolean } | null

/** 모든 역할과 프로파일 몇 개의 적합도를 선수마다 구한다 */
function fits(cat: RoleCatalog, overrides: RoleOverrides): Fit[] {
  const list: Fit[] = []
  for (const attrs of players()) {
    for (const role of cat.roles) list.push(scoreRole(attrs, effectiveRoleWeights(cat, role.id, overrides)))
    for (const profile of profiles()) list.push(scoreRole(attrs, profileWeights(cat, profile, overrides)))
  }
  return list
}

function expectSameFits(actual: Fit[], expected: Fit[]): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((fit, at) => {
    const want = expected[at]
    expect(fit === null, `${at}번째 적합도가 있는가`).toBe(want === null)
    if (fit && want) {
      expect(Object.is(fit.score, want.score), `${at}번째 적합도 ${fit.score} / ${want.score}`).toBe(true)
      expect(fit.uncertain).toBe(want.uncertain)
    }
  })
}

/** 씨앗으로 고른 사용자 수정 가중치(역할 id → 능력치 id → 0~5 정수). 원래 값과 같은 값도 섞인다 */
function randomEdits(seed: number, count: number, cat: RoleCatalog = catalog): RoleOverrides {
  const draw = seededDraw(seed)
  const edits: RoleOverrides = {}
  for (let at = 0; at < count; at++) {
    const role = cat.roles[Math.floor(draw() * cat.roles.length)]
    const attribute = ATTRIBUTES[Math.floor(draw() * ATTRIBUTES.length)]
    edits[role.id] = { ...edits[role.id], [attribute]: Math.floor(draw() * (ROLE_WEIGHT_MAX + 1)) }
  }
  return edits
}

describe('내보내기', () => {
  it('카탈로그의 모든 역할의 실효 가중치 전체를 0~5 정수로 담고, 카탈로그와 게임 판을 적는다', () => {
    const bundle = exportBundle(settingsOf({}), catalog)
    expect(bundle).toMatchObject({ format: 'fmb-role-weights', version: 1, catalog: 'fm26', catalogVersion: catalog.dataVersion, customRoles: [] })
    expect(Object.keys(bundle.weights)).toEqual(catalog.roles.map((role) => role.id))
    for (const role of catalog.roles) {
      const table = bundle.weights[role.id]
      const effective = effectiveRoleWeights(catalog, role.id, {})
      // 0인 칸은 적지 않고, 나머지는 실효 가중치와 같다
      expect(table).toEqual(Object.fromEntries(Object.entries(effective).filter(([, weight]) => weight > 0).sort(([a], [b]) => ATTRIBUTES.indexOf(a) - ATTRIBUTES.indexOf(b))))
      for (const value of Object.values(table)) expect(Number.isInteger(value) && value >= 0 && value <= ROLE_WEIGHT_MAX).toBe(true)
    }
  })

  it('능력치는 화면의 역할 가중치 칸(능력치 47개)과 같다: 역할이 쓰는 능력치는 모두 이 안에 있고, 파일이 한도 안이다', () => {
    expect(ATTRIBUTES).toHaveLength(47)
    const text = bundleToText(exportBundle(settingsOf({}), catalog))
    expect(new TextEncoder().encode(text).length).toBeLessThan(ROLE_BUNDLE_MAX_BYTES / 2)
    expect(parseBundle(text).ok).toBe(true)
  })

  it('고친 값이 실효 가중치에 반영된다(0으로 끈 능력치는 빠지고, 새로 올린 능력치는 들어간다)', () => {
    const base = effectiveRoleWeights(catalog, 'ip.CentralDefender', {})
    const turnedOff = Object.keys(base)[0]
    const raised = ATTRIBUTES.find((id) => !(id in base))!
    const bundle = exportBundle(settingsOf({ 'ip.CentralDefender': { [turnedOff]: 0, [raised]: 5 } }), catalog)
    expect(bundle.weights['ip.CentralDefender'][raised]).toBe(5)
    expect(turnedOff in bundle.weights['ip.CentralDefender']).toBe(false)
  })

  it('옛 14역할 카탈로그도 같은 형식이다', () => {
    const bundle = exportBundle(settingsOf({ cb: { marking: 5 } }), LEGACY_CATALOG)
    expect(bundle).toMatchObject({ catalog: 'legacy14', catalogVersion: 'app' })
    expect(Object.keys(bundle.weights)).toHaveLength(14)
    expect(bundle.weights.cb.marking).toBe(5)
  })

  it('글로 바꿔 다시 읽으면 같은 묶음이다', () => {
    const bundle = exportBundle(settingsOf(randomEdits(5, 30)), catalog)
    const parsed = parseBundle(bundleToText(bundle))
    expect(parsed).toEqual({ ok: true, bundle })
  })

  it('사용자 역할은 customRoles에 실효 가중치로 담고 weights에는 넣지 않는다', () => {
    const custom: CustomRole = { id: 'user.시험', phase: 'ip', name: '시험 역할', positions: ['ST'], weights: { finishing: 3, passing: 2 }, base: 'ip.CentreForward' }
    const bundle = exportBundle(settingsOf({ 'user.시험': { passing: 5 } }, { customRoles: [custom] }), catalog)
    expect(Object.keys(bundle.weights).some((id) => id.startsWith('user.'))).toBe(false)
    expect(bundle.customRoles).toEqual([{ ...custom, weights: { finishing: 3, passing: 5 } }])
    expect(bundle.customRoles[0].positions).not.toBe(custom.positions)
  })
})

describe('가져오기: 내보내기 → 되돌리기 → 가져오기가 모든 역할과 프로파일의 적합도를 Object.is로 같게 되돌린다(A-45)', () => {
  const edits = randomEdits(11, 60)
  const reference = fits(catalog, edits)
  const bundle = exportBundle(settingsOf(edits), catalog)
  const parsed = parseBundle(bundleToText(bundle))

  it('시험 자료가 의미가 있다: 고친 값이 적합도를 실제로 바꾸고, 일부는 원래 값과 같은 값이다', () => {
    expect(Object.keys(edits).length).toBeGreaterThan(20)
    expect(fits(catalog, {}).some((fit, at) => (fit?.score ?? null) !== (reference[at]?.score ?? null))).toBe(true)
  })

  it.each(['merge', 'replace'] as const)('기본값으로 되돌린 설정에 가져오면(%s) 적합도가 내보내기 전과 같다', (mode) => {
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const reset = settingsOf({})
    const preview = previewImport(parsed.bundle, reset, catalog, mode)
    expect(preview.changes.length).toBeGreaterThan(0)
    expectSameFits(fits(catalog, preview.patch.roleWeights!), reference)
  })

  it.each(['merge', 'replace'] as const)('원래 값이 다른 판(다른 기본값)의 설정에 가져와도(%s) 적합도가 같다: 가져온 쪽의 원래 값과 다른 칸만 고친 값으로 남는다', (mode) => {
    if (!parsed.ok) throw new Error('읽지 못했다')
    // 가져오는 쪽: 핵심 가중치 기본값 3, 앱 추가 1(보내는 쪽은 4와 2)
    withLedger({ ROLE_KEY_WEIGHT: 3, ROLE_APP_WEIGHT: 1 }, () => {
      expect(catalog.baseWeights('ip.Goalkeeper')).not.toEqual(withLedger({ ROLE_KEY_WEIGHT: 4, ROLE_APP_WEIGHT: 2 }, () => catalog.baseWeights('ip.Goalkeeper')))
      // 가져오기 전에는 이 판의 적합도가 보내는 쪽과 다르다
      expect(fits(catalog, {}).some((fit, at) => fit?.score !== reference[at]?.score)).toBe(true)
      const importer = settingsOf(randomEdits(99, 40))
      const preview = previewImport(parsed.bundle, importer, catalog, mode)
      expectSameFits(fits(catalog, preview.patch.roleWeights!), reference)
      // 고친 값은 이 판의 원래 값과 다른 칸뿐이다
      for (const [roleId, table] of Object.entries(preview.patch.roleWeights!)) {
        const base = catalog.baseWeights(roleId)
        for (const [attribute, value] of Object.entries(table)) expect(value, `${roleId} ${attribute}`).not.toBe(base[attribute] ?? 0)
      }
    })
  })

  it('이미 같은 설정에 가져오면 바뀌는 것이 없다', () => {
    if (!parsed.ok) throw new Error('읽지 못했다')
    const preview = previewImport(parsed.bundle, settingsOf(edits), catalog, 'merge')
    expect(preview.changes).toEqual([])
    expectSameFits(fits(catalog, preview.patch.roleWeights!), reference)
  })

  it('옛 14역할 카탈로그도 같다', () => {
    const legacyEdits = randomEdits(3, 25, LEGACY_CATALOG)
    const exported = exportBundle(settingsOf(legacyEdits), LEGACY_CATALOG)
    const read = parseBundle(bundleToText(exported))
    if (!read.ok) throw new Error(read.reason)
    const next = previewImport(read.bundle, settingsOf({}), LEGACY_CATALOG, 'replace').patch.roleWeights!
    expectSameFits(fits(LEGACY_CATALOG, next), fits(LEGACY_CATALOG, legacyEdits))
  })
})

describe('믿을 수 없는 파일은 이유와 함께 통째로 거절한다', () => {
  const valid = (): Record<string, unknown> => ({
    format: 'fmb-role-weights',
    version: 1,
    catalog: 'fm26',
    catalogVersion: '26.3.2',
    weights: { 'ip.Goalkeeper': { handling: 4, reflexes: 2 } },
    customRoles: []
  })
  const rejected = (text: string): string => {
    const result = parseBundle(text)
    expect(result.ok, text.slice(0, 80)).toBe(false)
    return result.ok ? '' : result.reason
  }
  const withWeights = (weights: unknown): string => JSON.stringify({ ...valid(), weights })

  it('올바른 파일은 읽힌다(앞의 BOM이 있어도, 모르는 최상위 칸이 있어도 무시한다)', () => {
    expect(parseBundle(JSON.stringify(valid())).ok).toBe(true)
    expect(parseBundle(`﻿${JSON.stringify(valid())}`).ok).toBe(true)
    const extra = parseBundle(JSON.stringify({ ...valid(), 새로운_칸: { a: 1 } }))
    expect(extra.ok && Object.keys(extra.bundle)).toEqual(['format', 'version', 'catalog', 'catalogVersion', 'weights', 'customRoles'])
    // customRoles가 없어도 된다(빈 목록으로 읽는다)
    const { customRoles: _omitted, ...without } = valid()
    expect(parseBundle(JSON.stringify(without))).toMatchObject({ ok: true, bundle: { customRoles: [] } })
  })

  it('크기: 한도를 넘는 글(글자 수가 넘거나, 한글처럼 글자 하나가 세 바이트라서 바이트 수가 넘는 글)', () => {
    expect(rejected(' '.repeat(ROLE_BUNDLE_MAX_BYTES + 1))).toContain('너무 큽니다')
    expect(rejected(' '.repeat(ROLE_BUNDLE_MAX_BYTES + 1))).toContain(`${ROLE_BUNDLE_MAX_BYTES / 1024}KB`)
    const wide = JSON.stringify({ ...valid(), memo: '가'.repeat(100_000) })
    expect(wide.length).toBeLessThan(ROLE_BUNDLE_MAX_BYTES)
    expect(new TextEncoder().encode(wide).length).toBeGreaterThan(ROLE_BUNDLE_MAX_BYTES)
    expect(rejected(wide)).toContain('너무 큽니다')
  })

  it('크기: 한도와 딱 같은 바이트 수는 받고, 하나 넘으면 거절한다', () => {
    const base = JSON.stringify(valid())
    const exact = base + ' '.repeat(ROLE_BUNDLE_MAX_BYTES - base.length)
    expect(new TextEncoder().encode(exact).length).toBe(ROLE_BUNDLE_MAX_BYTES)
    expect(parseBundle(exact).ok).toBe(true)
    expect(parseBundle(`${exact} `).ok).toBe(false)
  })

  it('모양: JSON이 아님, 객체가 아님, 다른 파일, 모르는 판, 빠진 칸, 칸의 종류가 다름', () => {
    expect(rejected('이건 글입니다')).toContain('JSON')
    expect(rejected('')).toContain('JSON')
    for (const text of ['[]', '"x"', 'null', '7', 'true']) expect(rejected(text)).toContain('모양')
    expect(rejected(JSON.stringify({ ...valid(), format: 'other' }))).toContain('이 앱이 만든')
    expect(rejected(JSON.stringify({ ...valid(), version: 2 }))).toContain('판')
    expect(rejected(JSON.stringify({ ...valid(), version: '1' }))).toContain('판')
    expect(rejected(JSON.stringify({ ...valid(), catalog: 'fm25' }))).toContain('catalog')
    expect(rejected(JSON.stringify({ ...valid(), catalogVersion: '' }))).toContain('게임 판')
    expect(rejected(JSON.stringify({ ...valid(), catalogVersion: 'x'.repeat(41) }))).toContain('게임 판')
    const { weights: _weights, ...noWeights } = valid()
    expect(rejected(JSON.stringify(noWeights))).toContain('weights')
    expect(rejected(withWeights([]))).toContain('weights')
    expect(rejected(withWeights('x'))).toContain('weights')
    expect(rejected(withWeights({ 'ip.Goalkeeper': [] }))).toContain('weights.ip.Goalkeeper')
    expect(rejected(withWeights({ 'ip.Goalkeeper': { handling: '4' } }))).toContain('weights.ip.Goalkeeper.handling')
    expect(rejected(withWeights({ 'ip.Goalkeeper': { handling: null } }))).toContain('handling')
  })

  it('모르는 능력치: 이름을 모르는 것, 화면에 없는 능력치(왼발, 숨은 능력치)', () => {
    for (const attribute of ['없는능력치', 'leftFoot', 'consistency', '__proto', 'toString', '']) {
      const reason = rejected(withWeights({ 'ip.Goalkeeper': { [attribute]: 3 } }))
      expect(reason, attribute).toContain('알 수 없는 능력치')
    }
  })

  it('소수: 정수가 아닌 가중치', () => {
    for (const value of [2.5, 0.1, 4.000001, 1e-9]) expect(rejected(withWeights({ 'ip.Goalkeeper': { handling: value } })), String(value)).toContain('정수')
  })

  it('범위: 5를 넘거나 0보다 작은 가중치', () => {
    for (const value of [6, 5.5, 100, 1e308, -1, -5]) {
      const reason = rejected(withWeights({ 'ip.Goalkeeper': { handling: value } }))
      expect(reason, String(value)).toMatch(/정수|0에서 5 사이/)
    }
    expect(rejected(withWeights({ 'ip.Goalkeeper': { handling: 6 } }))).toContain(`0에서 ${ROLE_WEIGHT_MAX} 사이`)
    expect(rejected(withWeights({ 'ip.Goalkeeper': { handling: -1 } }))).toContain(`0에서 ${ROLE_WEIGHT_MAX} 사이`)
    // 경계 0과 5는 받는다
    expect(parseBundle(withWeights({ 'ip.Goalkeeper': { handling: 0, reflexes: ROLE_WEIGHT_MAX } })).ok).toBe(true)
  })

  it('__proto__ 열쇠: 어느 깊이에 있어도 거절한다', () => {
    const text = JSON.stringify(valid())
    const cases = [
      text.replace('"weights":{', '"weights":{"__proto__":{"handling":4},'),
      text.replace('"handling":4', '"__proto__":4,"handling":4'),
      text.replace('{"format"', '{"__proto__":{"x":1},"format"'),
      text.replace('"customRoles":[]', '"customRoles":[{"__proto__":{}}]'),
      '{"__proto__":{"polluted":true}}'
    ]
    for (const body of cases) {
      expect(body).toContain('__proto__')
      expect(rejected(body), body.slice(0, 60)).toContain('__proto__')
    }
    // 읽다가 전역 객체가 오염되지 않았다
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).handling).toBeUndefined()
  })

  it('다른 이름의 열쇠(constructor, prototype)는 능력치가 아니라서 거절하지만, 역할 id로 오면 모르는 역할로 건너뛸 뿐이다', () => {
    expect(rejected(withWeights({ 'ip.Goalkeeper': { constructor: 3 } }))).toContain('알 수 없는 능력치')
    const result = parseBundle(withWeights({ constructor: { handling: 3 }, prototype: { handling: 3 } }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const preview = previewImport(result.bundle, settingsOf({}), catalog, 'merge')
    expect(preview.warnings.join(' ')).toContain('건너뛴 역할 2개')
    expect(preview.patch.roleWeights).toEqual({})
    expect(Object.getPrototypeOf(preview.patch.roleWeights)).toBe(Object.prototype)
  })

  describe('사용자 역할(형식에는 있지만 이 판은 가져오지 않는다)', () => {
    const custom = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      id: 'user.시험',
      phase: 'ip',
      name: '시험 역할',
      positions: ['ST'],
      weights: { finishing: 3 },
      ...over
    })
    const withCustom = (...roles: Array<Record<string, unknown>>): string => JSON.stringify({ ...valid(), customRoles: roles })

    it('올바른 사용자 역할은 읽힌다(복사본이다)', () => {
      const result = parseBundle(withCustom(custom({ base: 'ip.CentreForward' })))
      expect(result).toMatchObject({ ok: true, bundle: { customRoles: [{ id: 'user.시험', phase: 'ip', name: '시험 역할', positions: ['ST'], weights: { finishing: 3 }, base: 'ip.CentreForward' }] } })
    })

    it('개수: 한도(CUSTOM_ROLES_MAX)를 넘으면 거절한다', () => {
      const many = Array.from({ length: CUSTOM_ROLES_MAX + 1 }, (_, at) => custom({ id: `user.${at}` }))
      expect(rejected(withCustom(...many))).toContain('너무 많습니다')
      const enough = Array.from({ length: CUSTOM_ROLES_MAX }, (_, at) => custom({ id: `user.${at}` }))
      expect(parseBundle(withCustom(...enough)).ok).toBe(true)
    })

    it('번호, 이름, 국면, 포지션, 가중치, 중복을 검사한다', () => {
      expect(rejected(withCustom(custom({ id: 'cb' })))).toContain('번호')
      expect(rejected(withCustom(custom({ id: 'user.a b' })))).toContain('번호')
      expect(rejected(withCustom(custom({ id: 'user.' })))).toContain('번호')
      expect(rejected(withCustom(custom({ name: '' })))).toContain('이름')
      expect(rejected(withCustom(custom({ name: '가'.repeat(ROLE_NAME_MAX + 1) })))).toContain('이름')
      expect(parseBundle(withCustom(custom({ name: '가'.repeat(ROLE_NAME_MAX) }))).ok).toBe(true)
      expect(rejected(withCustom(custom({ phase: 'both' })))).toContain('customRoles')
      expect(rejected(withCustom(custom({ positions: [] })))).toContain('포지션')
      expect(rejected(withCustom(custom({ positions: ['XX'] })))).toContain('포지션')
      expect(rejected(withCustom(custom({ positions: ['ST', 'ST'] })))).toContain('포지션')
      expect(rejected(withCustom(custom({ weights: { 없는능력치: 3 } })))).toContain('알 수 없는 능력치')
      expect(rejected(withCustom(custom({ weights: { finishing: 2.5 } })))).toContain('정수')
      expect(rejected(withCustom(custom({ weights: { finishing: 9 } })))).toContain('0에서')
      expect(rejected(withCustom(custom(), custom()))).toContain('같은 번호')
    })

    it('가져오기 미리 보기는 사용자 역할을 건너뛴다고 알리고, 설정의 사용자 역할과 가중치에는 손대지 않는다', () => {
      const result = parseBundle(withCustom(custom(), custom({ id: 'user.둘' })))
      if (!result.ok) throw new Error(result.reason)
      const mine: CustomRole = { id: 'user.내것', phase: 'oop', name: '내 역할', positions: ['DC'], weights: { tackling: 5 } }
      const settings = settingsOf({ 'user.내것': { tackling: 4 } }, { customRoles: [mine] })
      const preview = previewImport(result.bundle, settings, catalog, 'replace')
      expect(preview.warnings.join(' ')).toContain('사용자 역할 2개')
      expect(preview.patch).not.toHaveProperty('customRoles')
      // 바꾸기여도 지금 카탈로그에 든 사용자 역할 'user.내것'의 고친 값은 묶음에 없는 역할로 보지 않고 둔다
      expect(settings.customRoles).toEqual([mine])
    })
  })
})

describe('가져오기 미리 보기', () => {
  const bundleOf = (weights: RoleBundle['weights'], over: Partial<RoleBundle> = {}): RoleBundle => ({
    format: 'fmb-role-weights',
    version: 1,
    catalog: 'fm26',
    catalogVersion: catalog.dataVersion,
    weights,
    customRoles: [],
    ...over
  })

  it('바뀌는 역할을 한 줄씩 적는다: 역할 이름(국면)과 능력치 이름, 이전과 이후 값', () => {
    const base = exportBundle(settingsOf({}), catalog)
    const changed = bundleOf({ ...base.weights, 'ip.CentralDefender': { ...base.weights['ip.CentralDefender'], heading: 1, marking: 5 } })
    const { changes } = previewImport(changed, settingsOf({}), catalog, 'merge')
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatch(/^센터백\(공 소유 시\): /)
    const was = base.weights['ip.CentralDefender']
    expect(changes[0]).toContain(`헤더 ${was.heading ?? 0} → 1`)
    expect(changes[0]).toContain(`일대일 마크 ${was.marking ?? 0} → 5`)
  })

  it('한 역할에서 바뀐 능력치가 많으면 앞의 몇 개만 적고 나머지는 개수로 알린다', () => {
    const base = exportBundle(settingsOf({}), catalog)
    const everything = Object.fromEntries(ATTRIBUTES.map((id) => [id, 5]))
    const { changes } = previewImport(bundleOf({ ...base.weights, 'oop.OPGoalkeeper': everything }), settingsOf({}), catalog, 'merge')
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatch(/^골키퍼\(공 미소유 시\): .* 외 \d+개$/)
  })

  it('합치기는 묶음에 없는 역할의 고친 값을 두고, 바꾸기는 원래 값으로 되돌린다. 지금 카탈로그에 없는 옛 역할 id의 값은 어느 쪽도 건드리지 않는다', () => {
    const mine = settingsOf({ 'ip.Goalkeeper': { handling: 1 }, 'oop.OPGoalkeeper': { reflexes: 0 }, cb: { marking: 5 } })
    const only = bundleOf({ 'ip.CentralDefender': { marking: 5 } })
    const merged = previewImport(only, mine, catalog, 'merge')
    expect(merged.patch.roleWeights).toMatchObject({ 'ip.Goalkeeper': { handling: 1 }, 'oop.OPGoalkeeper': { reflexes: 0 }, cb: { marking: 5 } })
    expect(merged.warnings.join(' ')).toContain('이 묶음에 없는 역할 2개')
    const replaced = previewImport(only, mine, catalog, 'replace')
    expect(Object.keys(replaced.patch.roleWeights!).sort()).toEqual(['cb', 'ip.CentralDefender'])
    expect(replaced.patch.roleWeights!.cb).toEqual({ marking: 5 })
    expect(replaced.warnings.join(' ')).toContain('이 묶음에 없는 역할 2개')
    // 합치기에서도 묶음에 든 역할(센터백)은 묶음의 값이 이긴다
    expect(effectiveRoleWeights(catalog, 'ip.CentralDefender', merged.patch.roleWeights!)).toMatchObject({ marking: 5 })
    // 바꾸기가 지우는 것은 changes에도 나온다
    expect(replaced.changes.some((line) => line.startsWith('골키퍼(공 소유 시)'))).toBe(true)
    expect(merged.changes.some((line) => line.startsWith('골키퍼(공 소유 시)'))).toBe(false)
  })

  it('묶음에 든 역할은 묶음의 값이 이긴다: 가져오는 쪽의 원래 값과 같아진 칸은 옛 고친 값을 지운다', () => {
    const base = exportBundle(settingsOf({}), catalog)
    // 묶음의 센터백은 원래 값 그대로이고, 이 설정은 센터백의 마크를 5로 고쳐 두었다
    const preview = previewImport(base, settingsOf({ 'ip.CentralDefender': { marking: 5 } }), catalog, 'merge')
    expect(preview.patch.roleWeights).toEqual({})
    expect(preview.changes).toHaveLength(1)
  })

  it('다른 카탈로그의 묶음: 경고하고, 이 카탈로그에 없는 역할은 건너뛴다(옛 14역할 묶음 → FM26)', () => {
    const legacy = exportBundle(settingsOf({ cb: { marking: 5 } }), LEGACY_CATALOG)
    const preview = previewImport(legacy, settingsOf({}), catalog, 'merge')
    expect(preview.warnings[0]).toContain('옛 14역할')
    expect(preview.warnings[0]).toContain('FM26 역할을')
    expect(preview.warnings.join(' ')).toContain('건너뛴 역할 14개')
    expect(preview.changes).toEqual([])
    expect(preview.patch.roleWeights).toEqual({})
  })

  it('같은 카탈로그의 다른 게임 판: 경고한다', () => {
    const other = bundleOf({}, { catalogVersion: '26.4.0' })
    const preview = previewImport(other, settingsOf({}), catalog, 'merge')
    expect(preview.warnings[0]).toContain('26.4.0')
    expect(preview.warnings[0]).toContain(catalog.dataVersion)
    expect(previewImport(bundleOf({}), settingsOf({}), catalog, 'merge').warnings).toEqual([])
  })

  it('건너뛴 역할의 이름은 앞의 셋만 적고, 파일에서 온 글이라 길면 자르고 제어 문자는 뺀다', () => {
    const odd = bundleOf({ 'x.하나': {}, 'x.둘': {}, 'x.셋': {}, 'x.넷': {}, [`긴${'가'.repeat(60)}\n줄`]: {} })
    const warning = previewImport(odd, settingsOf({}), catalog, 'merge').warnings.join('\n')
    expect(warning).toContain('건너뛴 역할 5개')
    expect(warning).toContain('x.하나, x.둘, x.셋')
    expect(warning).toContain('외')
    expect(warning).not.toContain('x.넷')
    const long = previewImport(bundleOf({ [`긴${'가'.repeat(60)}\n줄`]: {} }), settingsOf({}), catalog, 'merge').warnings.join('\n')
    expect(long).toContain('…')
    expect(long).not.toContain('\n줄')
  })

  it('설정을 바꾸지 않는다(얼린 설정에도 돈다). patch는 설정과 같은 객체를 쓰지 않는다', () => {
    const frozen = Object.freeze(settingsOf(Object.freeze({ 'ip.Goalkeeper': Object.freeze({ handling: 1 }) }) as RoleOverrides))
    const preview = previewImport(bundleOf({ 'oop.OPGoalkeeper': { handling: 2 } }), frozen, catalog, 'merge')
    expect(preview.patch.roleWeights).not.toBe(frozen.roleWeights)
    expect(preview.patch.roleWeights!['ip.Goalkeeper']).not.toBe(frozen.roleWeights['ip.Goalkeeper'])
    expect(frozen.roleWeights).toEqual({ 'ip.Goalkeeper': { handling: 1 } })
  })

  it('설정에 roleWeights가 없어도 던지지 않는다', () => {
    expect(() => previewImport(bundleOf({}), {} as Settings, catalog, 'merge')).not.toThrow()
  })

  it('모르는 방식(merge, replace가 아닌 값)은 합치기로 본다', () => {
    const mine = settingsOf({ 'ip.Goalkeeper': { handling: 1 } })
    const odd = previewImport(bundleOf({}), mine, catalog, 'whatever' as never)
    expect(odd.patch.roleWeights).toEqual({ 'ip.Goalkeeper': { handling: 1 } })
  })

  it('가중치 상수를 판마다 바꾼 것(K)을 따라간다: 가져오는 쪽 원래 값 기준으로 고친 값을 만든다', () => {
    const base = exportBundle(settingsOf({}), catalog)
    const preview = withLedger({ ROLE_KEY_WEIGHT: 5 }, () => previewImport(base, settingsOf({}), catalog, 'merge'))
    // 보내는 쪽의 핵심(4)이 이 판의 원래 값(5)과 달라 모든 핵심 칸이 고친 값이 된다
    const goalkeeper = preview.patch.roleWeights!['ip.Goalkeeper']
    expect(Object.values(goalkeeper)).toContain(K.ROLE_KEY_WEIGHT)
    expect(Object.keys(goalkeeper).length).toBeGreaterThan(5)
  })
})
