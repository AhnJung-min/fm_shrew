/**
 * 프로파일 기준 분포(2단계 U5): 새 장치(computeProfileNorms, WorldService.roleNorms·normsFor·referenceNorms)가
 * (가) 옛 14역할 기준 분포를 옛 계산과 끝자리까지 같게 내고, (나) 역할별 합 열로 센 점수와 기준 분포가 직접 계산과 끝자리까지 같으며,
 * (다) 가중치를 고치면 캐시 열쇠가 바뀌어 낡은 값을 쓰지 않고, (라) FM26의 풀이 좌우 짝인지, (마) 화면이 보낸 엉뚱한 요청에 죽지 않는지 본다.
 * 세이브 파일 없이 지어낸 세계(tests/helpers/phaseWorld.ts, syntheticWorld.ts)로 돈다. 선수 이름은 모두 지어낸 것이다.
 */
import { rmSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { integerRole, poolKeyOf, ProfileColumns, scorerOf, weightsKeyOf } from '../src/main/profileColumns'
import { computeProfileNorms, computeRoleNorms, meanCaStarOf, normOfSpec, startCaOf, type ProfileNormSpec } from '../src/main/roleNorms'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from '../src/main/save/reader'
import { SEX_FEMALE, type SaveWorld } from '../src/main/save/world'
import { WorldService } from '../src/main/worldService'
import { FM26_CATALOG } from '../src/shared/catalogFm26'
import { K } from '../src/shared/ledger'
import { meanCaAbove, normFromScores, referenceCa, type RoleNorm, type RoleNorms } from '../src/shared/norms'
import { POSITION_KEYS } from '../src/shared/positions'
import { effectiveRoleWeights, LEGACY_CATALOG, profileSpec, referenceSpec } from '../src/shared/roleCatalog'
import { prepareRole, prepareWeights, ROLES, savedRoleScore, type PositionKey } from '../src/shared/roles'
import { compositeWeights, type SlotProfile } from '../src/shared/slotProfile'
import { presetTactic, profileOf } from '../src/shared/tacticModel'
import { buildWorld, POSITION_AT, randomWorld, serviceOf } from './helpers/phaseWorld'
import { EDITED_WEIGHTS, seeded, syntheticService, syntheticWorld } from './helpers/syntheticWorld'

const FIELDS = ['mu', 'sigma', 'beta', 'betaGrow', 'n', 'caRef', 'poolCa', 'shift'] as const
/** 두 기준 분포가 모든 칸에서 끝자리까지 같은가(Object.is). 다른 칸의 이름을 돌려준다(같으면 빈 목록) */
const differences = (a: RoleNorm, b: RoleNorm): string[] => FIELDS.filter((field) => !Object.is(a[field], b[field])).map((field) => `${field}: ${a[field]} / ${b[field]}`)

const femaleOf = (world: SaveWorld): Uint8Array => Uint8Array.from(world.sex, (sex) => (sex === SEX_FEMALE ? 1 : 0))
const namesDirs: string[] = []
afterAll(() => {
  for (const dir of namesDirs) rmSync(dir, { recursive: true, force: true })
})
/** 서비스를 만들고 이름 저장소 폴더를 치울 목록에 넣는다 */
function service(...args: Parameters<typeof serviceOf>): ReturnType<typeof serviceOf>['ws'] {
  const made = serviceOf(...args)
  namesDirs.push(made.namesDir)
  return made.ws
}

/**
 * 2단계 U5 전의 computeRoleNorms를 그대로 복사한 것: 옛 14역할 기준 분포의 "지금 값"이다. 새 장치가 이것과 Object.is로 같아야 한다.
 * (C̄*를 따로 보려고 meanCaStar도 함께 돌려준다. 계산은 바뀌지 않았다.)
 */
function oldRoleNorms(world: SaveWorld, weights: Record<string, Record<string, number>>, female: Uint8Array): { norms: RoleNorms; meanCaStar: number | undefined } {
  const mineCa: number[] = []
  if (world.teamId !== undefined) {
    for (let k = 0; k < world.count; k++) if (world.teamIds[k] === world.teamId && world.names[k]) mineCa.push(world.ca[k])
  }
  const startCa = referenceCa(mineCa)
  const positionIndex = new Map<string, number>(POSITION_KEYS.map((key, i) => [key, i]))
  const pools: Array<{ id: string; scores: number[]; abilities: number[]; ids: number[] }> = []
  for (const role of ROLES) {
    const prepared = prepareRole(role.id, weights)
    const slots = role.positions.map((key) => positionIndex.get(key)).filter((index): index is number => index !== undefined)
    const scores: number[] = []
    const abilities: number[] = []
    const ids: number[] = []
    for (let k = 0; k < world.count; k++) {
      if (female[k] || !world.names[k]) continue
      let plays = false
      for (const slot of slots) {
        if (world.positions[k * POSITION_COUNT + slot] >= K.NORM_MIN_RATING) {
          plays = true
          break
        }
      }
      if (!plays) continue
      const score = savedRoleScore(world.attributes, k * ATTRIBUTE_COUNT, prepared)
      if (score === null) continue
      scores.push(score)
      abilities.push(world.ca[k])
      ids.push(k)
    }
    pools.push({ id: role.id, scores, abilities, ids })
  }
  const meanCaStar = meanCaAbove(pools, startCa)
  const norms: RoleNorms = {}
  for (const pool of pools) norms[pool.id] = normFromScores(pool.scores, pool.abilities, startCa, meanCaStar)
  return { norms, meanCaStar }
}

/** 옛 14역할의 요청 14개(열쇠 = 역할 id) */
const legacySpecs = (weights: Record<string, Record<string, number>>): ProfileNormSpec[] => LEGACY_CATALOG.references('ip').map((ref) => referenceSpec(LEGACY_CATALOG, ref, weights))

// 가중치를 고친 경우의 예: 정수가 아닌 값, 5를 넘는 값, 끈 값이 섞여 있다(열 경로를 못 타고 직접 계산으로 간다)
const ODD_WEIGHTS = { cb: { heading: 2.5, marking: 7 }, st: { finishing: 3.3, composure: 0 }, gk: { reflexes: 0, handling: 5 } }

describe('옛 14역할 기준 분포: 새 장치가 옛 계산과 끝자리까지 같다(mu, sigma, beta, betaGrow, n, poolCa, shift, caRef)', () => {
  const worlds: Array<[string, SaveWorld]> = [
    ['지어낸 세이브 세계', syntheticWorld()],
    ['무작위 세계 1', randomWorld(11)],
    ['무작위 세계 2(작다)', randomWorld(12, 900)]
  ]
  const weightSets: Array<[string, Record<string, Record<string, number>>]> = [
    ['기본', {}],
    ['고친 값', EDITED_WEIGHTS],
    ['정수가 아닌 값·5 넘는 값', ODD_WEIGHTS]
  ]

  for (const [worldName, world] of worlds) {
    for (const [weightName, weights] of weightSets) {
      it(`${worldName}, 가중치 ${weightName}: computeRoleNorms가 옛 계산과 같다. C̄*도 같다`, () => {
        const female = femaleOf(world)
        const old = oldRoleNorms(world, weights, female)
        const now = computeRoleNorms(world, weights, female)
        expect(Object.keys(now)).toEqual(ROLES.map((role) => role.id))
        const wrong: string[] = []
        for (const role of ROLES) wrong.push(...differences(now[role.id], old.norms[role.id]).map((line) => `${role.id}.${line}`))
        expect(wrong).toEqual([])
        // 모든 역할이 같은 표본이 아니다: 풀 크기가 역할마다 다르다
        expect(new Set(ROLES.map((role) => now[role.id].n)).size).toBeGreaterThan(3)
        const specs = legacySpecs(weights)
        expect(Object.is(meanCaStarOf(world, new ProfileColumns(world, female), specs, startCaOf(world)), old.meanCaStar)).toBe(true)
      })
    }
  }

  it('WorldService.roleNorms(옛 카탈로그)와 referenceNorms도 옛 계산과 같고, 열쇠는 역할 id 14개다', () => {
    const world = syntheticWorld()
    const { ws, namesDir } = syntheticService(world)
    namesDirs.push(namesDir)
    const old = oldRoleNorms(world, {}, femaleOf(world))
    for (const norms of [ws.roleNorms()!, ws.referenceNorms('ip'), ws.referenceNorms()]) {
      expect(Object.keys(norms)).toEqual(ROLES.map((role) => role.id))
      for (const role of ROLES) expect(differences(norms[role.id], old.norms[role.id]), role.id).toEqual([])
    }
    // 옛 카탈로그의 normsFor도 같은 값이다(프로파일의 열쇠가 역할 id)
    const profile: SlotProfile = { ip: { position: 'DC', roleId: 'cb' }, oop: { position: 'DC', roleId: 'cb' }, sharePct: 100 }
    expect(differences(ws.normsFor([profile]).cb, old.norms.cb)).toEqual([])
  })
})

describe('역할별 합 열로 센 점수와 기준 분포는 직접 계산과 끝자리까지 같다', () => {
  const world = randomWorld(21)
  const female = femaleOf(world)
  const selectable = FM26_CATALOG.roles.filter((role) => role.selectable)
  const ips = selectable.filter((role) => role.phase === 'ip')
  const oops = selectable.filter((role) => role.phase === 'oop')
  const draw = seeded(9)
  const pick = <T>(list: T[]): T => list[Math.floor(draw() * list.length)]
  const SHARES = [0, 1, 7, 20, 40, 50, 60, 70, 80, 99, 100]

  /** 점수가 다른 선수의 수(0이어야 한다) */
  function mismatches(weights: Parameters<typeof scorerOf>[1], columns: ProfileColumns | null, parts: Parameters<typeof scorerOf>[3]): number {
    const direct = scorerOf(world, weights, null)
    const fast = scorerOf(world, weights, columns, parts)
    let bad = 0
    for (let k = 0; k < world.count; k++) if (!Object.is(fast(k), direct(k))) bad++
    return bad
  }

  it('점수: 두 국면의 역할 둘 × 비중 0~100(0, 1, 99, 100과 가운데 값) × 능력치가 비어 있는 선수까지, 선수마다 같다', () => {
    const columns = new ProfileColumns(world, female)
    let mixedCases = 0
    for (let n = 0; n < 66; n++) {
      const ip = pick(ips)
      const oop = n % 11 === 0 ? ip : pick(oops)
      const share = n < 33 ? SHARES[n % SHARES.length] : Math.floor(draw() * 101)
      const ipWeights = effectiveRoleWeights(FM26_CATALOG, ip.id, {})
      const oopWeights = effectiveRoleWeights(FM26_CATALOG, oop.id, {})
      const weights = compositeWeights(ipWeights, oopWeights, share)
      if (weights !== ipWeights && weights !== oopWeights) mixedCases++
      expect(mismatches(weights, columns, { ip: ipWeights, oop: oopWeights, sharePct: share }), `${ip.id} ${oop.id} ${share}`).toBe(0)
    }
    // 시험이 헛돌지 않는다: 섞는 경우가 많고, 열을 실제로 만들어 썼다
    expect(mixedCases).toBeGreaterThan(40)
    expect(columns.columnCount).toBeGreaterThan(20)
  })

  it('점수: 두 표가 같거나 한쪽 합이 0이거나 비중이 가득이면 섞지 않고 그 역할 표를 쓴다(그 경로도 같다)', () => {
    const columns = new ProfileColumns(world, female)
    const ip = ips[3]
    const same = effectiveRoleWeights(FM26_CATALOG, ip.id, {})
    const other = effectiveRoleWeights(FM26_CATALOG, oops[4].id, {})
    const none = {}
    const cases: Array<[Parameters<typeof scorerOf>[1], Parameters<typeof scorerOf>[3]]> = [
      [same, { ip: same, oop: { ...same }, sharePct: 60 }],
      [same, { ip: same, oop: other, sharePct: 100 }],
      [other, { ip: same, oop: other, sharePct: 0 }],
      [other, { ip: none, oop: other, sharePct: 60 }],
      [same, { ip: same, oop: none, sharePct: 60 }]
    ]
    for (const [weights, parts] of cases) expect(mismatches(weights, columns, parts)).toBe(0)
  })

  it('열로 셀 수 없는 가중치(정수가 아님, 5 넘음, 모르는 능력치)와 정수가 아닌 비중은 열을 만들지 않고 직접 계산으로 간다', () => {
    const ip = ips[5]
    const oop = oops[5]
    const base = effectiveRoleWeights(FM26_CATALOG, ip.id, {})
    const oopBase = effectiveRoleWeights(FM26_CATALOG, oop.id, {})
    const [first] = Object.keys(base)
    const odd = [
      { ...base, [first]: 2.5 },
      { ...base, [first]: 6 },
      { ...base, notAnAttribute: 3 }
    ]
    for (const weights of odd) {
      const columns = new ProfileColumns(world, female)
      expect(integerRole(weights)).toBeNull()
      expect(mismatches(weights, columns, { ip: weights, oop: oopBase, sharePct: 100 }), '섞지 않는 길').toBe(0)
      expect(mismatches(compositeWeights(weights, oopBase, 60), columns, { ip: weights, oop: oopBase, sharePct: 60 }), '섞는 길').toBe(0)
      expect(columns.columnCount).toBe(0)
    }
    const columns = new ProfileColumns(world, female)
    expect(mismatches(compositeWeights(base, oopBase, 33.3), columns, { ip: base, oop: oopBase, sharePct: 33.3 })).toBe(0)
    expect(columns.columnCount).toBe(0)
    // 0 이하 칸은 따지지 않는다: 끈 값이 섞여 있어도 열로 센다
    const withOff = { ...base, [first]: 0, shouldBeIgnored: -1 }
    expect(integerRole(withOff)).not.toBeNull()
    expect(mismatches(withOff, columns, { ip: withOff, oop: withOff, sharePct: 100 })).toBe(0)
    expect(columns.columnCount).toBe(1)
  })

  it('기준 분포: 열로 센 것과 직접 센 것이 모든 칸에서 같다(요청 30개)', () => {
    const columns = new ProfileColumns(world, female)
    const startCa = startCaOf(world)
    const refs = FM26_CATALOG.references('ip').map((ref) => referenceSpec(FM26_CATALOG, ref, {}))
    const mean = meanCaStarOf(world, columns, refs, startCa)
    for (let n = 0; n < 30; n++) {
      const ip = pick(ips)
      const oop = pick(oops)
      const position = (pick(ip.positions.length > 0 ? [...ip.positions] : ['DC']) as PositionKey) ?? 'DC'
      const profile: SlotProfile = { ip: { position, roleId: ip.id }, oop: { position, roleId: oop.id }, sharePct: SHARES[n % SHARES.length] }
      const spec: ProfileNormSpec = {
        ...profileSpec(FM26_CATALOG, profile, {}),
        parts: { ip: effectiveRoleWeights(FM26_CATALOG, ip.id, {}), oop: effectiveRoleWeights(FM26_CATALOG, oop.id, {}), sharePct: profile.sharePct }
      }
      const direct = normOfSpec(world, columns, spec, startCa, mean, false)
      const fast = normOfSpec(world, columns, spec, startCa, mean, true)
      expect(differences(fast, direct), `${spec.key}`).toEqual([])
      expect(direct.n).toBeGreaterThan(0)
    }
  })
})

describe('C̄*: 기준 목록의 풀 합집합에서 C* 이상인 선수의 평균 현재 능력(따로 짠 계산과 같다)', () => {
  it('FM26의 점유 시 역할 40개의 합집합, 능력치가 모자라 점수를 못 내는 선수는 합집합에 들지 않는다', () => {
    const world = randomWorld(41, 1500)
    const female = femaleOf(world)
    const refs = FM26_CATALOG.references('ip').map((ref) => referenceSpec(FM26_CATALOG, ref, {}))
    expect(refs).toHaveLength(40)
    const startCa = startCaOf(world)
    // 따로 짠 계산: 선수마다 어느 한 참조의 풀에 들고 그 참조의 가중치로 점수를 낼 수 있으면 합집합
    const prepared = refs.map((ref) => ({ ref, role: prepareWeights(ref.weights), slots: ref.pool.map((position) => POSITION_AT(position)) }))
    let sum = 0
    let count = 0
    let unscorable = 0
    for (let k = 0; k < world.count; k++) {
      if (female[k] || !world.names[k]) continue
      const inUnion = prepared.some(({ role, slots }) => slots.some((slot) => world.positions[k * POSITION_COUNT + slot] >= K.NORM_MIN_RATING) && savedRoleScore(world.attributes, k * ATTRIBUTE_COUNT, role) !== null)
      const inPool = prepared.some(({ slots }) => slots.some((slot) => world.positions[k * POSITION_COUNT + slot] >= K.NORM_MIN_RATING))
      if (inPool && !inUnion) unscorable++
      if (inUnion && world.ca[k] >= startCa) {
        sum += world.ca[k]
        count++
      }
    }
    expect(count).toBeGreaterThan(100)
    // 점수를 못 내는 선수가 실제로 있었다(합집합에서 빠지는 길을 시험이 지난다)
    expect(unscorable).toBeGreaterThan(0)
    expect(Object.is(meanCaStarOf(world, new ProfileColumns(world, female), refs, startCa), sum / count)).toBe(true)
  })

  it('합집합에 드는 선수가 하나도 없으면 undefined이고, 풀도 비어 기준 분포는 선수 0명에 보정(shift) 0으로 나온다', () => {
    const world = buildWorld([{ name: '시험 선수 1', team: 100, club: 0, ca: 150 }])
    const specs = FM26_CATALOG.references('ip').map((ref) => referenceSpec(FM26_CATALOG, ref, {}))
    expect(meanCaStarOf(world, new ProfileColumns(world, new Uint8Array(1)), specs, startCaOf(world))).toBeUndefined()
    const alone = computeProfileNorms(world, specs.slice(0, 1), new Uint8Array(1), specs)[specs[0].key]
    expect(alone.n).toBe(0)
    expect(alone.shift).toBe(0)
  })

  it('풀에 선수가 있어도 C* 이상인 선수가 없어 C̄*가 undefined이면, 표본을 넓힌 기준 분포도 보정 없이(shift 0) 나온다', () => {
    // 현재 능력이 모두 85~94라 C*(최저 100)에 못 미친다. 모든 선수가 모든 포지션을 뛰어서 풀은 비지 않는다
    const people = Array.from({ length: 60 }, (_, i) => ({ name: `시험 선수 ${i + 1}`, team: i < 14 ? 100 : 200, club: i < 14 ? 0 : 1, ca: 85 + (i % 10) }))
    const small = buildWorld(people)
    small.positions.fill(20)
    const female = new Uint8Array(small.count)
    const specs = FM26_CATALOG.references('ip').map((ref) => referenceSpec(FM26_CATALOG, ref, {}))
    const columns = new ProfileColumns(small, female)
    const startCa = startCaOf(small)
    expect(meanCaStarOf(small, columns, specs, startCa)).toBeUndefined()
    const norm = computeProfileNorms(small, specs.slice(0, 1), female, specs)[specs[0].key]
    expect(norm.n).toBe(60)
    // 표본을 넓혔다(C*보다 낮은 선수까지 모았다). 그래도 C̄*가 없으니 평균은 보정하지 않는다
    expect(norm.poolCa).toBeLessThan(norm.caRef)
    expect(norm.shift).toBe(0)
    // 같은 표본에 C̄*를 주면 보정이 생긴다: 위의 0이 우연이 아니다
    expect(normOfSpec(small, columns, specs[0], startCa, 120, false).shift).not.toBe(0)
  })
})

describe('WorldService: roleNorms·normsFor·referenceNorms·clearScoringCaches(FM26)', () => {
  const world = randomWorld(51, 2000)
  const female = femaleOf(world)
  const tactic = presetTactic('4-2-3-1', FM26_CATALOG)
  const refSpecs = (weights: Record<string, Record<string, number>> = {}) => FM26_CATALOG.references('ip').map((ref) => referenceSpec(FM26_CATALOG, ref, weights))
  const specOf = (profile: SlotProfile, weights: Record<string, Record<string, number>> = {}) => profileSpec(FM26_CATALOG, profile, weights)
  const tacticProfiles = tactic.slots.map((_, index) => profileOf(tactic, index))

  it('squad().roleNorms(roleNorms)는 주 전술의 프로파일마다다: 열쇠는 normKey이고 같은 프로파일의 자리는 한 개다. 값은 순수한 계산과 같다', () => {
    const ws = service(world, { catalog: FM26_CATALOG, mainTactic: tactic })
    const norms = ws.roleNorms()!
    const keys = [...new Set(tacticProfiles.map((profile) => FM26_CATALOG.normKey(profile)))]
    expect(Object.keys(norms).sort()).toEqual([...keys].sort())
    // 4-2-3-1: 최전방, 공격 줄 좌우 짝(한 열쇠), 공격형 미드, 수비형 미드 둘(한 열쇠), 풀백 좌우 짝(한 열쇠), 중앙 수비 둘(한 열쇠), 골키퍼
    expect(keys).toHaveLength(7)
    const pure = computeProfileNorms(world, tacticProfiles.map((profile) => specOf(profile)), female, refSpecs())
    for (const key of keys) expect(differences(norms[key], pure[key]), key).toEqual([])
    // 스쿼드 결과에 실린 값도 같다
    expect(Object.keys(ws.squad().roleNorms!).sort()).toEqual([...keys].sort())
  })

  it('주 전술을 주지 않으면 기본 포메이션(4-2-3-1)의 프리셋이다. 옛 카탈로그는 전술과 상관없이 역할 14개다', () => {
    expect(Object.keys(service(world, { catalog: FM26_CATALOG }).roleNorms()!).sort()).toEqual([...new Set(tacticProfiles.map((profile) => FM26_CATALOG.normKey(profile)))].sort())
    const legacy = service(world, { mainTactic: presetTactic('3-5-2', FM26_CATALOG) })
    expect(Object.keys(legacy.roleNorms()!)).toEqual(ROLES.map((role) => role.id))
  })

  it('세이브를 적용하지 않았으면 roleNorms는 null이고 나머지는 빈 객체다', () => {
    const empty = new WorldService({ knownTeam: () => undefined, rosterNames: () => [], rememberTeam: () => undefined, roleWeights: () => ({}), namesDir: '' })
    expect(empty.roleNorms()).toBeNull()
    expect(empty.normsFor(tacticProfiles)).toEqual({})
    expect(empty.referenceNorms('ip')).toEqual({})
    expect(() => empty.clearScoringCaches()).not.toThrow()
  })

  it('FM26의 기준 분포 풀은 점유 시 포지션과 그 좌우 짝이다(가운데 포지션은 하나): 왼쪽만 뛰는 선수와 오른쪽만 뛰는 선수가 같은 풀이다', () => {
    const specs = [
      ...Array.from({ length: 30 }, (_, i) => ({ name: `시험 선수 ${i + 1}`, team: 200, club: 1, ca: 160 })),
      ...Array.from({ length: 30 }, (_, i) => ({ name: `시험 선수 ${i + 31}`, team: 200, club: 1, ca: 160 })),
      ...Array.from({ length: 20 }, (_, i) => ({ name: `시험 선수 ${i + 61}`, team: 200, club: 1, ca: 160 })),
      ...Array.from({ length: 14 }, (_, i) => ({ name: `우리 ${i + 1}`, team: 100, club: 0, ca: 160 }))
    ]
    const small = buildWorld(specs)
    for (let k = 0; k < 30; k++) small.positions[k * POSITION_COUNT + POSITION_AT('AML')] = 20
    for (let k = 30; k < 60; k++) small.positions[k * POSITION_COUNT + POSITION_AT('AMR')] = 20
    for (let k = 60; k < 80; k++) small.positions[k * POSITION_COUNT + POSITION_AT('DC')] = 20
    const ws = service(small, { catalog: FM26_CATALOG })
    const profile = (position: PositionKey, ipRole: string, oopRole: string): SlotProfile => ({ ip: { position, roleId: ipRole }, oop: { position, roleId: oopRole }, sharePct: 60 })
    const left = profile('AML', 'ip.InsideForward', 'oop.OPWinger')
    const right = profile('AMR', 'ip.InsideForward', 'oop.OPWinger')
    expect(FM26_CATALOG.poolOf(left)).toEqual(['AML', 'AMR'])
    expect(FM26_CATALOG.poolOf(profile('DC', 'ip.CentralDefender', 'oop.OPCentreBack'))).toEqual(['DC'])
    // 좌우 어느 쪽 프로파일이든 같은 열쇠와 같은 기준 분포(왼쪽 30명과 오른쪽 30명이 한 풀)
    expect(FM26_CATALOG.normKey(left)).toBe(FM26_CATALOG.normKey(right))
    const norms = ws.normsFor([left, right])
    expect(Object.keys(norms)).toEqual([FM26_CATALOG.normKey(left)])
    expect(norms[FM26_CATALOG.normKey(left)].n).toBe(60)
    // 중앙 수비는 가운데 포지션 하나라 그 20명뿐이다
    const centre = ws.normsFor([profile('DC', 'ip.CentralDefender', 'oop.OPCentreBack')])
    expect(Object.values(centre)[0].n).toBe(20)
  })

  it('referenceNorms: 점유 시 40개(열쇠 ref:<역할 id>), 비점유 시 39개, 국면을 주지 않으면 79개', () => {
    const ws = service(world, { catalog: FM26_CATALOG, mainTactic: tactic })
    const ip = ws.referenceNorms('ip')
    expect(Object.keys(ip)).toHaveLength(40)
    expect(Object.keys(ip).every((key) => key.startsWith('ref:ip.'))).toBe(true)
    const oop = ws.referenceNorms('oop')
    expect(Object.keys(oop)).toHaveLength(39)
    expect(Object.keys(oop).every((key) => key.startsWith('ref:oop.'))).toBe(true)
    expect(Object.keys(ws.referenceNorms())).toHaveLength(79)
    // 값도 순수한 계산과 같다(참조의 풀은 역할을 고를 수 있는 포지션 전부)
    const pure = computeProfileNorms(world, refSpecs(), female, refSpecs())
    for (const [key, norm] of Object.entries(ip)) expect(differences(norm, pure[key]), key).toEqual([])
  })

  it('가중치를 고치면 캐시 열쇠(풀, 가중치 지문)가 바뀌어 낡은 값을 쓰지 않는다. 고치지 않은 프로파일은 구해 둔 것을 그대로 쓴다', () => {
    let edited: Record<string, Record<string, number>> = {}
    const ws = service(world, { catalog: FM26_CATALOG, mainTactic: tactic, roleWeights: () => edited })
    const centreBack: SlotProfile = { ip: { position: 'DC', roleId: 'ip.CentralDefender' }, oop: { position: 'DC', roleId: 'oop.OPCentreBack' }, sharePct: 60 }
    const keeper: SlotProfile = { ip: { position: 'GK', roleId: 'ip.Goalkeeper' }, oop: { position: 'GK', roleId: 'oop.OPGoalkeeper' }, sharePct: 60 }
    const [cbKey, gkKey] = [FM26_CATALOG.normKey(centreBack), FM26_CATALOG.normKey(keeper)]
    const before = ws.normsFor([centreBack, keeper])
    expect(ws.normsFor([centreBack, keeper])[cbKey]).toBe(before[cbKey])

    expect(weightsKeyOf(effectiveRoleWeights(FM26_CATALOG, 'ip.CentralDefender', {}))).not.toBe(weightsKeyOf(effectiveRoleWeights(FM26_CATALOG, 'ip.CentralDefender', { 'ip.CentralDefender': { marking: 1 } })))
    edited = { 'ip.CentralDefender': { marking: 1, heading: 5 } }
    const after = ws.normsFor([centreBack, keeper])
    // 센터백은 다시 구했고(다른 값) 순수한 계산과 같다. 골키퍼는 구해 둔 객체 그대로다
    expect(after[cbKey]).not.toBe(before[cbKey])
    expect(differences(after[cbKey], before[cbKey]).length).toBeGreaterThan(0)
    const pure = computeProfileNorms(world, [specOf(centreBack, edited)], female, refSpecs(edited))
    expect(differences(after[cbKey], pure[cbKey])).toEqual([])
    expect(after[gkKey]).toBe(before[gkKey])
    // 되돌리면 처음 값과 같다
    edited = {}
    expect(differences(ws.normsFor([centreBack])[cbKey], before[cbKey])).toEqual([])
  })

  it('세이브 안의 값이 바뀌면(값 번호) 구해 둔 것을 버리고, clearScoringCaches도 비운다. 다시 구한 값은 같다', () => {
    const ws = service(world, { catalog: FM26_CATALOG, mainTactic: tactic })
    const profile = tacticProfiles[0]
    const key = FM26_CATALOG.normKey(profile)
    const first = ws.normsFor([profile])[key]
    expect(ws.normsFor([profile])[key]).toBe(first)
    ws.clearScoringCaches()
    const cleared = ws.normsFor([profile])[key]
    expect(cleared).not.toBe(first)
    expect(differences(cleared, first)).toEqual([])
    // 게임이 이름을 알려 주면 값 번호가 늘어 구해 둔 것을 쓰지 않는다
    ws.learnNames('nation', [], [{ id: 1, name: '지어낸 나라' }])
    expect(ws.normsFor([profile])[key]).not.toBe(cleared)
  })

  it('프로파일이 많으면(40개를 넘으면) 열로 구해도 순수한 직접 계산과 같다', () => {
    const ws = service(world, { catalog: FM26_CATALOG, mainTactic: tactic })
    const profiles: SlotProfile[] = []
    const ips = FM26_CATALOG.references('ip')
    const oops = FM26_CATALOG.references('oop')
    for (const ip of ips) {
      for (const oop of oops) {
        const position = ip.positions.find((each) => oop.positions.includes(each))
        if (position) profiles.push({ ip: { position, roleId: ip.roleId }, oop: { position, roleId: oop.roleId }, sharePct: 40 + 10 * (profiles.length % 5) })
        if (profiles.length >= 130) break
      }
      if (profiles.length >= 130) break
    }
    expect(profiles).toHaveLength(130)
    const norms = ws.normsFor(profiles)
    const pure = computeProfileNorms(world, profiles.map((profile) => specOf(profile)), female, refSpecs())
    expect(Object.keys(norms).sort()).toEqual(Object.keys(pure).sort())
    expect(Object.keys(norms).length).toBeGreaterThan(100)
    for (const [key, norm] of Object.entries(norms)) expect(differences(norm, pure[key]), key).toEqual([])
  })

  it('올바르지 않은 프로파일은 건너뛴다(카탈로그에 없는 역할, 모르는 포지션, 0~100 정수가 아닌 비중, 빠진 칸). 죽지 않는다', () => {
    const ws = service(world, { catalog: FM26_CATALOG })
    const good: SlotProfile = { ip: { position: 'DC', roleId: 'ip.CentralDefender' }, oop: { position: 'DC', roleId: 'oop.OPCentreBack' }, sharePct: 60 }
    const bad: unknown[] = [
      { ...good, ip: { position: 'DC', roleId: 'ip.NoSuchRole' } },
      { ...good, oop: { position: 'DC', roleId: 'cb' } },
      { ...good, ip: { position: 'XX', roleId: 'ip.CentralDefender' } },
      { ...good, oop: { position: 'constructor', roleId: 'oop.OPCentreBack' } },
      { ...good, sharePct: 101 },
      { ...good, sharePct: -1 },
      { ...good, sharePct: 33.5 },
      { ...good, sharePct: Number.NaN },
      { ...good, sharePct: '60' },
      { ip: good.ip },
      null,
      42,
      'x',
      {}
    ]
    const norms = ws.normsFor([...bad, good] as SlotProfile[])
    expect(Object.keys(norms)).toEqual([FM26_CATALOG.normKey(good)])
    expect(ws.normsFor(bad as SlotProfile[])).toEqual({})
    expect(ws.normsFor('not a list' as unknown as SlotProfile[])).toEqual({})
    expect(ws.normsFor([])).toEqual({})
  })
})

describe('보조 함수', () => {
  it('풀 열쇠는 순서와 중복과 모르는 이름에 상관없다. 가중치 지문은 점수에 쓰이는 칸만 본다', () => {
    expect(poolKeyOf(['DL', 'DR'])).toBe(poolKeyOf(['DR', 'DL', 'DR']))
    expect(poolKeyOf(['DC', 'nowhere'])).toBe('DC')
    expect(poolKeyOf([])).toBe('')
    expect(weightsKeyOf({ heading: 4, marking: 0, nowhere: 3 })).toBe(weightsKeyOf({ heading: 4 }))
    expect(weightsKeyOf({ heading: 4 })).not.toBe(weightsKeyOf({ heading: 3 }))
  })

  it('옛 14역할의 열쇠는 역할 id, FM26 참조의 열쇠는 ref:<역할 id>다(화면과 본체가 같은 열쇠를 쓴다)', () => {
    expect(LEGACY_CATALOG.references('ip').map((ref) => ref.key)).toEqual(ROLES.map((role) => role.id))
    expect(FM26_CATALOG.references('ip').every((ref) => ref.key === `ref:${ref.roleId}`)).toBe(true)
  })

  it('필드 수: 숙련 15칸과 능력치 54칸', () => {
    expect([POSITION_COUNT, ATTRIBUTE_COUNT]).toEqual([15, 54])
  })
})
