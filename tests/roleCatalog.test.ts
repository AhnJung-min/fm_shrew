import { describe, expect, it } from 'vitest'
import { activeCatalog, catalogOf, DEFAULT_CATALOG } from '../src/shared/catalogs'
import { FM26_CATALOG } from '../src/shared/catalogFm26'
import {
  effectiveRoleWeights,
  LEGACY_CATALOG,
  prepareProfile,
  profileSpec,
  profileWeights,
  referenceSpec,
  weightEntries,
  withCustomRoles,
  type CatalogRole,
  type CustomRole,
  type RoleCatalog,
  type RoleOverrides
} from '../src/shared/roleCatalog'
import { DEFAULT_ROLE, effectiveWeights, prepareRole, ROLE_BY_ID, ROLES, rolesFor, type PositionKey } from '../src/shared/roles'
import { compositeWeights, type SlotProfile } from '../src/shared/slotProfile'
import { SAVE_ATTRIBUTE_ORDER } from '../src/shared/world'
import { catalogContract, kindsOf } from './helpers/catalogContract'

catalogContract(LEGACY_CATALOG)

const POSITIONS = Object.keys(DEFAULT_ROLE) as PositionKey[]

/** 사용자가 고친 값의 예: 센터백의 대인 마크를 5로, 태클을 0으로, 원래 없던 침착성을 3으로 */
const EDITED: RoleOverrides = { cb: { marking: 5, tackling: 0, composure: 3 }, st: { finishing: 1 } }

const single = (position: PositionKey, roleId: string, sharePct = 100): SlotProfile => ({ ip: { position, roleId }, oop: { position, roleId }, sharePct })

describe('LEGACY_CATALOG: 옛 14역할을 카탈로그 틀에 끼운 어댑터', () => {
  it('역할 14개가 ROLES 순서 그대로이고, 국면 없이(both) 모두 고를 수 있다', () => {
    expect(LEGACY_CATALOG.id).toBe('legacy14')
    expect(LEGACY_CATALOG.dataVersion).toBe('app')
    expect(LEGACY_CATALOG.roles.map((role) => role.id)).toEqual(ROLES.map((role) => role.id))
    for (const [i, role] of LEGACY_CATALOG.roles.entries()) {
      expect(role.label).toBe(ROLES[i].label)
      expect([...role.positions]).toEqual(ROLES[i].positions)
      expect(role.phase).toBe('both')
      expect(role.selectable).toBe(true)
      expect(role.gameId).toBeUndefined()
      expect(role.goalkeeper).toBe(role.id === 'gk')
    }
  })

  it('고를 수 있는 역할은 rolesFor 순서(근거는 모두 app), 기본 역할은 DEFAULT_ROLE이다(국면과 칸 종류는 보지 않는다)', () => {
    for (const position of POSITIONS) {
      const expected = rolesFor(position).map((role) => ({ roleId: role.id, evidence: 'app' }))
      for (const phase of ['ip', 'oop'] as const) {
        for (const kind of kindsOf(position)) {
          expect(LEGACY_CATALOG.choicesAt(position, phase, kind)).toEqual(expected)
          expect(LEGACY_CATALOG.defaultRole(position, phase, kind)).toBe(DEFAULT_ROLE[position])
        }
      }
    }
  })

  it('풀은 역할의 positions, 기준 분포 열쇠는 역할 id이고, 점유 시 역할만 본다', () => {
    for (const role of ROLES) {
      const profile = single(role.positions[0], role.id)
      expect([...LEGACY_CATALOG.poolOf(profile)]).toEqual(role.positions)
      expect(LEGACY_CATALOG.normKey(profile)).toBe(role.id)
      // 비점유 시 역할과 비중은 열쇠에 들어가지 않는다(옛 카탈로그에는 비점유 시가 없다)
      expect(LEGACY_CATALOG.normKey({ ...profile, oop: { position: profile.oop.position, roleId: 'dm' }, sharePct: 40 })).toBe(role.id)
    }
  })

  it('참조 프로파일은 ROLES 순서이고 열쇠는 역할 id다. 국면을 주어도 같다', () => {
    expect(LEGACY_CATALOG.references().map((ref) => ref.key)).toEqual(ROLES.map((role) => role.id))
    expect(LEGACY_CATALOG.references('ip')).toEqual(LEGACY_CATALOG.references())
    expect(LEGACY_CATALOG.references('oop')).toEqual(LEGACY_CATALOG.references())
    for (const role of ROLES) {
      const ref = LEGACY_CATALOG.referenceOf(role.id)!
      expect(ref).toMatchObject({ key: role.id, roleId: role.id, label: role.label, phase: 'both', goalkeeper: role.id === 'gk' })
      expect([...ref.positions]).toEqual(role.positions)
    }
  })

  it('가중치는 ROLES의 값 그대로이고 출처는 모두 app이다. 옛 14역할은 1:1로 자기 자신에 대응한다', () => {
    for (const role of ROLES) {
      expect(LEGACY_CATALOG.baseWeights(role.id)).toEqual(role.weights)
      expect(Object.keys(LEGACY_CATALOG.baseTags(role.id))).toEqual(Object.keys(role.weights))
      for (const tag of Object.values(LEGACY_CATALOG.baseTags(role.id))) expect(tag).toBe('app')
    }
    expect(Object.keys(LEGACY_CATALOG.legacyMap())).toEqual(ROLES.map((role) => role.id))
    for (const [id, entry] of Object.entries(LEGACY_CATALOG.legacyMap())) expect(entry).toEqual({ to: id, oneToOne: true })
  })

  it('모르는 역할 id는 빈 가중치이고 죽지 않는다', () => {
    expect(LEGACY_CATALOG.role('없는 역할')).toBeUndefined()
    expect(LEGACY_CATALOG.baseWeights('없는 역할')).toEqual({})
    expect(effectiveRoleWeights(LEGACY_CATALOG, '없는 역할', { 없는역할: { marking: 3 } })).toEqual({})
    expect(LEGACY_CATALOG.poolOf(single('DC', '없는 역할'))).toEqual(['DC'])
  })
})

describe('가중치: 실효 가중치, 프로파일 가중치, 준비된 꼴', () => {
  it('effectiveRoleWeights가 옛 effectiveWeights와 깊게 같다(키 순서까지, 사용자가 고친 값 포함)', () => {
    for (const overrides of [{}, EDITED, { cb: {}, 없는역할: { a: 1 } }]) {
      for (const role of ROLES) {
        const now = effectiveRoleWeights(LEGACY_CATALOG, role.id, overrides)
        const before = effectiveWeights(role.id, overrides)
        expect(now).toEqual(before)
        expect(Object.keys(now)).toEqual(Object.keys(before))
      }
    }
  })

  it('옛 단일 프로파일(두 국면이 같고 비중 100)의 prepareProfile이 prepareRole과 pairs·total까지 같다', () => {
    for (const overrides of [{}, EDITED]) {
      for (const role of ROLES) {
        for (const share of [100, 60, 0]) {
          expect(prepareProfile(LEGACY_CATALOG, single(role.positions[0], role.id, share), overrides)).toEqual(prepareRole(role.id, overrides))
        }
      }
    }
  })

  it('두 국면의 역할이 다르면 합성 가중치를 쓰고, 비중 100이면 점유 시 역할 그대로다', () => {
    const profile: SlotProfile = { ip: { position: 'DC', roleId: 'cb' }, oop: { position: 'DC', roleId: 'bpd' }, sharePct: 60 }
    const ip = effectiveRoleWeights(LEGACY_CATALOG, 'cb', EDITED)
    const oop = effectiveRoleWeights(LEGACY_CATALOG, 'bpd', EDITED)
    expect(profileWeights(LEGACY_CATALOG, profile, EDITED)).toEqual(compositeWeights(ip, oop, 60))
    expect(profileWeights(LEGACY_CATALOG, { ...profile, sharePct: 100 }, EDITED)).toEqual(ip)
    expect(profileWeights(LEGACY_CATALOG, { ...profile, sharePct: 0 }, EDITED)).toEqual(oop)
    expect(prepareProfile(LEGACY_CATALOG, { ...profile, sharePct: 100 }, EDITED)).toEqual(prepareRole('cb', EDITED))
  })

  it('profileSpec과 referenceSpec: 열쇠, 풀, 합성 가중치(옛 카탈로그는 14역할의 기준 분포 요청과 같다)', () => {
    for (const role of ROLES) {
      const spec = profileSpec(LEGACY_CATALOG, single(role.positions[0], role.id), EDITED)
      expect(spec).toEqual({ key: role.id, pool: role.positions, weights: effectiveWeights(role.id, EDITED) })
      expect(referenceSpec(LEGACY_CATALOG, LEGACY_CATALOG.referenceOf(role.id)!, EDITED)).toEqual(spec)
    }
  })
})

describe('weightEntries: 가중치 칸마다 출처 태그와 원래 값(F-04)', () => {
  it('옛 기본값은 app이고 원래 값과 같다. 능력치는 세이브의 능력치 순서로 나온다', () => {
    for (const role of ROLES) {
      const entries = weightEntries(LEGACY_CATALOG, role.id, {})
      expect(entries.map((entry) => entry.attr)).toEqual(SAVE_ATTRIBUTE_ORDER.filter((id) => (role.weights[id] ?? 0) > 0))
      for (const entry of entries) {
        expect(entry.tag, `${role.id} ${entry.attr}`).toBe('app')
        expect(entry.weight).toBe(role.weights[entry.attr])
        expect(entry.base).toBe(role.weights[entry.attr])
      }
    }
  })

  it('사용자가 원래 값과 다르게 고친 칸은 user다(0으로 끈 것과 새로 더한 것 포함). 원래 값 그대로인 칸은 app이다', () => {
    const entries = weightEntries(LEGACY_CATALOG, 'cb', { cb: { marking: 5, tackling: 0, composure: 3, heading: 4 } })
    const by = Object.fromEntries(entries.map((entry) => [entry.attr, entry]))
    expect(by.marking).toEqual({ attr: 'marking', weight: 5, tag: 'user', base: 4 })
    expect(by.tackling).toEqual({ attr: 'tackling', weight: 0, tag: 'user', base: 4 })
    expect(by.composure).toEqual({ attr: 'composure', weight: 3, tag: 'user', base: 2 })
    // 원래와 같은 값을 적어 둔 칸은 고친 것이 아니다
    expect(by.heading).toEqual({ attr: 'heading', weight: 4, tag: 'app', base: 4 })
    expect(by.positioning.tag).toBe('app')
    // 원래 없던 능력치를 더하면 원래 값 0
    const added = weightEntries(LEGACY_CATALOG, 'cb', { cb: { finishing: 2 } }).find((entry) => entry.attr === 'finishing')
    expect(added).toEqual({ attr: 'finishing', weight: 2, tag: 'user', base: 0 })
  })

  it('원래도 실효도 0인 능력치와 모르는 능력치 id는 싣지 않는다', () => {
    const entries = weightEntries(LEGACY_CATALOG, 'cb', { cb: { finishing: 0, 없는능력치: 3 } })
    expect(entries.some((entry) => entry.attr === 'finishing' || entry.attr === '없는능력치')).toBe(false)
  })
})

describe('withCustomRoles: 사용자 역할 얹기', () => {
  const custom = (id: string, phase: 'ip' | 'oop', positions: PositionKey[], weights: Record<string, number> = { passing: 4, vision: 2 }): CustomRole => ({
    id,
    phase,
    name: `사용자 ${id}`,
    positions,
    weights
  })

  it('사용자 역할이 없으면 바탕 카탈로그를 그대로 돌려준다', () => {
    expect(withCustomRoles(LEGACY_CATALOG, [])).toBe(LEGACY_CATALOG)
  })

  it('사용자 역할이 그 국면·포지션의 고를 수 있는 역할 끝에 근거 user로 더해지고, 다른 역할은 그대로다', () => {
    const roles = [custom('user.a', 'ip', ['MC', 'AMC']), custom('user.b', 'oop', ['MC']), custom('user.k', 'ip', ['GK'])]
    const catalog = withCustomRoles(LEGACY_CATALOG, roles)
    expect(catalog.id).toBe('legacy14')
    // 점유 시 중앙 미드: 옛 역할 뒤에 user.a만(국면이 다른 user.b와 포지션이 다른 user.k는 없다)
    const ip = catalog.choicesAt('MC', 'ip', 'MC.pair')
    expect(ip.slice(0, -1)).toEqual(LEGACY_CATALOG.choicesAt('MC', 'ip', 'MC.pair'))
    expect(ip[ip.length - 1]).toEqual({ roleId: 'user.a', evidence: 'user' })
    expect(ip.filter((choice) => choice.evidence === 'user')).toHaveLength(1)
    expect(catalog.choicesAt('MC', 'oop', 'MC.pair').at(-1)).toEqual({ roleId: 'user.b', evidence: 'user' })
    expect(catalog.choicesAt('AMC', 'ip', 'AMC.single').at(-1)).toEqual({ roleId: 'user.a', evidence: 'user' })
    expect(catalog.choicesAt('AMC', 'oop', 'AMC.single')).toEqual(LEGACY_CATALOG.choicesAt('AMC', 'oop', 'AMC.single'))
    expect(catalog.choicesAt('GK', 'ip', 'GK').at(-1)).toEqual({ roleId: 'user.k', evidence: 'user' })
    // 다른 포지션과 기본 역할, 풀, 열쇠, 참조(옛 14개)는 그대로다
    expect(catalog.choicesAt('DC', 'ip', 'DC.pair')).toEqual(LEGACY_CATALOG.choicesAt('DC', 'ip', 'DC.pair'))
    expect(catalog.defaultRole('MC', 'ip', 'MC.pair')).toBe(LEGACY_CATALOG.defaultRole('MC', 'ip', 'MC.pair'))
    expect(catalog.roles.slice(0, ROLES.length)).toEqual(LEGACY_CATALOG.roles)
    expect(catalog.roles.slice(ROLES.length).map((role) => role.id)).toEqual(['user.a', 'user.b', 'user.k'])
    expect(catalog.references().slice(0, ROLES.length)).toEqual(LEGACY_CATALOG.references())
  })

  it('사용자 역할은 번호로 찾고, 가중치와 출처 태그(모두 user)와 참조 프로파일이 있다', () => {
    const catalog = withCustomRoles(LEGACY_CATALOG, [custom('user.a', 'ip', ['MC'], { passing: 4, vision: 2 }), custom('user.k', 'oop', ['GK', 'DC'])])
    expect(catalog.role('user.a')).toMatchObject({ id: 'user.a', phase: 'ip', label: '사용자 user.a', selectable: true, goalkeeper: false, positions: ['MC'] })
    expect(catalog.role('user.k')?.goalkeeper).toBe(true)
    expect(catalog.role('cb')).toBe(LEGACY_CATALOG.role('cb'))
    expect(catalog.baseWeights('user.a')).toEqual({ passing: 4, vision: 2 })
    expect(catalog.baseWeights('cb')).toEqual(ROLE_BY_ID.cb.weights)
    expect(catalog.baseTags('user.a')).toEqual({})
    expect(catalog.baseTags('cb')).toEqual(LEGACY_CATALOG.baseTags('cb'))
    // 모두 사용자가 정한 값이라 태그는 user. 고치면 그것도 user
    expect(weightEntries(catalog, 'user.a', {}).map((entry) => [entry.attr, entry.tag, entry.base, entry.weight])).toEqual([['passing', 'user', 4, 4], ['vision', 'user', 2, 2]])
    expect(weightEntries(catalog, 'user.a', { 'user.a': { passing: 1 } }).find((entry) => entry.attr === 'passing')).toEqual({ attr: 'passing', weight: 1, tag: 'user', base: 4 })
    // 기준 분포를 구할 수 있다: 참조 프로파일의 요청이 만들어진다
    const ref = catalog.referenceOf('user.a')!
    expect(ref).toMatchObject({ key: 'ref:user.a', roleId: 'user.a', phase: 'ip', label: '사용자 user.a' })
    expect(referenceSpec(catalog, ref, {})).toEqual({ key: 'ref:user.a', pool: ['MC'], weights: { passing: 4, vision: 2 } })
    expect(catalog.references('oop').some((each) => each.roleId === 'user.a')).toBe(false)
    expect(catalog.references('ip').some((each) => each.roleId === 'user.a')).toBe(true)
    // 사용자 역할이 든 프로파일도 가중치와 기준 분포 요청을 만든다
    const profile: SlotProfile = { ip: { position: 'MC', roleId: 'user.a' }, oop: { position: 'MC', roleId: 'dm' }, sharePct: 50 }
    expect(profileWeights(catalog, profile, {})).toEqual(compositeWeights({ passing: 4, vision: 2 }, ROLE_BY_ID.dm.weights, 50))
    expect(profileSpec(catalog, profile, {}).key).toBe('user.a')
  })

  it('이미 있는 역할 번호와 겹치거나 앞의 사용자 역할과 같은 번호는 건너뛰고, 모양이 틀린 입력에도 죽지 않는다', () => {
    const catalog = withCustomRoles(LEGACY_CATALOG, [
      custom('cb', 'ip', ['DC']),
      custom('user.a', 'ip', ['MC']),
      custom('user.a', 'oop', ['DC']),
      { id: 'user.bad', phase: 'ip', name: 7 as unknown as string, positions: 'MC' as unknown as PositionKey[], weights: { passing: 'x' as unknown as number, vision: 2 } }
    ])
    expect(catalog.roles.map((role) => role.id)).toEqual([...ROLES.map((role) => role.id), 'user.a', 'user.bad'])
    expect(catalog.role('cb')).toBe(LEGACY_CATALOG.role('cb'))
    expect(catalog.role('user.a')?.phase).toBe('ip')
    expect(catalog.role('user.bad')).toMatchObject({ positions: [], label: 'user.bad' })
    expect(catalog.baseWeights('user.bad')).toEqual({ vision: 2 })
    expect(withCustomRoles(LEGACY_CATALOG, undefined as unknown as CustomRole[])).toBe(LEGACY_CATALOG)
  })

  it('배열이 아닌 값(손으로 고친 설정)이 와도 죽지 않고 사용자 역할이 없는 것으로 본다', () => {
    const one = custom('user.a', 'ip', ['MC'])
    for (const garbage of [null, {}, { 0: one }, { length: 1, 0: one }, 7, true, 'user.a']) {
      expect(() => withCustomRoles(LEGACY_CATALOG, garbage as unknown as CustomRole[]), JSON.stringify(garbage)).not.toThrow()
      expect(withCustomRoles(LEGACY_CATALOG, garbage as unknown as CustomRole[]), JSON.stringify(garbage)).toBe(LEGACY_CATALOG)
    }
    // 설정에서 오는 길(activeCatalog)도 같다. 배열 안의 틀린 항목은 그 항목만 건너뛴다
    expect(activeCatalog({ customRoles: {} as unknown as CustomRole[] })).toBe(catalogOf(DEFAULT_CATALOG))
    expect(activeCatalog({ catalog: 'legacy14', customRoles: 5 as unknown as CustomRole[] })).toBe(LEGACY_CATALOG)
    expect(activeCatalog({ catalog: 'legacy14', customRoles: [null, 3, one] as unknown as CustomRole[] }).roles.map((role) => role.id)).toEqual([...ROLES.map((role) => role.id), 'user.a'])
  })

  it('위쪽 카탈로그를 고르는 한 곳(catalogs.ts): 기본은 옛 14역할이고, 설정의 catalog와 customRoles를 따른다', () => {
    // 전환 묶음(기본 카탈로그를 FM26으로 바꾸는 한 줄의 커밋)에서 고칠 곳은 이 한 줄뿐이다. 아래는 모두 DEFAULT_CATALOG를 따라 읽는다
    expect(DEFAULT_CATALOG).toBe('legacy14')
    const base = catalogOf(DEFAULT_CATALOG)
    expect(catalogOf('legacy14')).toBe(LEGACY_CATALOG)
    expect(catalogOf('fm26')).toBe(FM26_CATALOG)
    expect(activeCatalog({})).toBe(base)
    expect(activeCatalog({ catalog: 'legacy14' })).toBe(LEGACY_CATALOG)
    expect(activeCatalog({ catalog: 'fm26' })).toBe(FM26_CATALOG)
    // 손으로 고쳐 모르는 값이 들어가도 기본으로 돈다
    expect(activeCatalog({ catalog: 'zzz' as never })).toBe(base)
    expect(activeCatalog({ customRoles: [custom('user.a', 'ip', ['MC'])] }).role('user.a')).toBeDefined()
    expect(activeCatalog({ customRoles: [] })).toBe(base)
  })
})

describe('FM26 카탈로그: 자료를 채우기 전에도 채운 뒤에도 죽지 않는다', () => {
  // 채운 뒤의 계약(번호, 가중치, 칸마다 역할 목록 등)은 채우는 단위가 catalogContract(FM26_CATALOG)로 본다. 여기서는 빈 틀이든 채운 것이든 참인 것만 본다
  it('번호가 fm26이고, 무엇을 물어도 던지지 않고 제 모양의 답을 준다', () => {
    expect(FM26_CATALOG.id).toBe('fm26')
    expect(FM26_CATALOG.dataVersion.length).toBeGreaterThan(0)
    expect(Array.isArray(FM26_CATALOG.roles)).toBe(true)
    for (const id of ['', '없는 역할', 'constructor', '__proto__', 'ip.없는역할', 'user.없는역할']) {
      expect(() => FM26_CATALOG.role(id), id).not.toThrow()
      expect(() => FM26_CATALOG.referenceOf(id), id).not.toThrow()
      expect(typeof FM26_CATALOG.baseWeights(id), id).toBe('object')
      expect(typeof FM26_CATALOG.baseTags(id), id).toBe('object')
    }
    for (const phase of ['ip', 'oop'] as const) {
      for (const gameId of ['', '1', '비트가 아닌 글자', '99999999999999999999']) expect(() => FM26_CATALOG.roleByGameId(phase, gameId), `${phase} ${gameId}`).not.toThrow()
      expect(Array.isArray(FM26_CATALOG.references(phase)), phase).toBe(true)
      for (const position of POSITIONS) {
        for (const kind of kindsOf(position)) {
          expect(Array.isArray(FM26_CATALOG.choicesAt(position, phase, kind)), `${position} ${phase} ${kind}`).toBe(true)
          expect(typeof FM26_CATALOG.defaultRole(position, phase, kind), `${position} ${phase} ${kind}`).toBe('string')
        }
      }
    }
    expect(Array.isArray(FM26_CATALOG.references())).toBe(true)
    const profile: SlotProfile = { ip: { position: 'DC', roleId: 'ip.CentralDefender' }, oop: { position: 'DC', roleId: 'oop.OPCentreBack' }, sharePct: 60 }
    expect(Array.isArray(FM26_CATALOG.poolOf(profile))).toBe(true)
    expect(typeof FM26_CATALOG.normKey(profile)).toBe('string')
    expect(typeof FM26_CATALOG.legacyMap()).toBe('object')
  })
})

describe('고를 수 없는 역할이 섞인 카탈로그', () => {
  /**
   * 게임이 이름을 주지 않은 옛 방식의 역할은 어느 칸 목록에도 없어서 이름과 포지션이 비어 있다(selectable false).
   * FM26 카탈로그를 채우는 단위가 catalogContract를 그대로 통과해야 하므로, 계약이 그런 역할에서 막히지 않는지를 옛 카탈로그에 하나 얹어 본다.
   */
  const HIDDEN: CatalogRole = { id: 'ip.HiddenOld', phase: 'ip', label: '', gameId: '4096', positions: [], selectable: false, goalkeeper: false }
  const WEIGHTS = { passing: 4, vision: 4, technique: 2 }
  const catalog: RoleCatalog = {
    ...LEGACY_CATALOG,
    roles: [...LEGACY_CATALOG.roles, HIDDEN],
    role: (id) => (id === HIDDEN.id ? HIDDEN : LEGACY_CATALOG.role(id)),
    roleByGameId: (phase, gameId) => (phase === HIDDEN.phase && gameId === HIDDEN.gameId ? HIDDEN : undefined),
    baseWeights: (id) => (id === HIDDEN.id ? WEIGHTS : LEGACY_CATALOG.baseWeights(id)),
    baseTags: (id) => (id === HIDDEN.id ? { passing: 'game', vision: 'game', technique: 'app' } : LEGACY_CATALOG.baseTags(id))
  }
  catalogContract(catalog)
})
