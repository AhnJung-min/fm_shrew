/**
 * 프로파일로 찾는 영입 후보와 대시보드(2단계 U5).
 * (가) 옛 14역할: 새 꼴 질의({ tactic, index })가 옛 꼴 질의({ formation, slotRoles, index })와 줄·점수·등급까지 같다.
 * (나) FM26: 자격과 10 미만 곱셈 보정은 점유 시 숙련만, 감점은 두 국면의 숙련을 비중으로 섞은 값이고, 점수는 두 역할을 섞은 가중치로 낸다.
 *      묶음의 어느 자리를 골라도 결과가 같고, 받은 전술은 다시 검사하며, 역할만 고르면 참조 프로파일(역할 하나)로 찾는다.
 * (다) 대시보드는 주 전술로 계산하고 영입 카드에 전술 번호를 싣는다.
 * 세이브 파일 없이 지어낸 세계로 돈다. 선수와 구단 이름은 모두 지어낸 것이다.
 */
import { rmSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { DashboardService } from '../src/main/dashboardService'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from '../src/main/save/reader'
import { NO_TEAM, type SaveWorld } from '../src/main/save/world'
import { FM26_CATALOG } from '../src/shared/catalogFm26'
import { FORMATIONS } from '../src/shared/depth'
import { K } from '../src/shared/ledger'
import { lowGate, posPenaltySigma } from '../src/shared/positions'
import { LEGACY_CATALOG, prepareProfile, referenceSpec } from '../src/shared/roleCatalog'
import { savedRoleScore } from '../src/shared/roles'
import { mixedPenaltySigma } from '../src/shared/slotProfile'
import { analyseTactic } from '../src/shared/tactic'
import { legacyTactic, presetTactic, profileOf, type Tactic } from '../src/shared/tacticModel'
import { categoriesOf, SAVE_ATTRIBUTE_ORDER, type CandidateCategory, type CandidateQuery } from '../src/shared/world'
import { alternativeRoleVariants } from './helpers/exactSnapshot'
import { ask, buildWorld, POSITION_AT, serviceOf, type PersonSpec } from './helpers/phaseWorld'
import { groupAsk, SYNTHETIC_TODAY, syntheticService, syntheticWorld } from './helpers/syntheticWorld'

const TABS: CandidateCategory[] = ['starter', 'rotation', 'prospect', 'free', 'all']
const namesDirs: string[] = []
afterAll(() => {
  for (const dir of namesDirs) rmSync(dir, { recursive: true, force: true })
})

describe('옛 14역할: 새 꼴 질의({ tactic, index })는 옛 꼴 질의와 줄·점수·등급까지 같다', () => {
  const world = syntheticWorld()
  const made = syntheticService(world)
  namesDirs.push(made.namesDir)
  const ws = made.ws
  const squad = ws.squad()

  it('포메이션 5개 × 자리 묶음 × 유형 탭 5개 × (뛸 수 있는 선수만 켬·가장 넓은 조건)', () => {
    let checked = 0
    for (const formation of FORMATIONS) {
      const analysis = analyseTactic({ rows: squad.rows, columns: squad.columns, today: SYNTHETIC_TODAY, formation: formation.id, slotRoles: {}, roleWeights: {}, norms: squad.roleNorms })!
      const tactic = legacyTactic(formation.id, {})
      for (const group of analysis.groups) {
        for (const category of TABS) {
          for (const widest of [false, true]) {
            const old = groupAsk(group, formation.id, category, widest)
            const result = ws.candidates({ ...old, slot: { tactic, index: group.slots[0] } })
            expect(result.ok).toBe(true)
            expect(result, `${formation.id}/${group.id}/${category}/${widest}`).toEqual(ws.candidates(old))
            checked++
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(300)
  })

  it('자리 하나씩 다른 옛 역할로 바꾼 전술도 같다(고른 역할이 자리 역할이 된다)', () => {
    const variants = alternativeRoleVariants(FORMATIONS)
    expect(variants.length).toBeGreaterThan(30)
    for (const variant of variants) {
      const index = Number(Object.keys(variant.slotRoles)[0].split(':')[1])
      const analysis = analyseTactic({ rows: squad.rows, columns: squad.columns, today: SYNTHETIC_TODAY, formation: variant.formation, slotRoles: variant.slotRoles, roleWeights: {}, norms: squad.roleNorms })!
      const group = analysis.groups.find((each) => each.slots.includes(index))!
      const old = groupAsk(group, variant.formation, 'all')
      old.slot = { formation: variant.formation, slotRoles: variant.slotRoles, index }
      const result = ws.candidates({ ...old, slot: { tactic: legacyTactic(variant.formation, variant.slotRoles), index } })
      expect(result.ok).toBe(true)
      expect(result, variant.key).toEqual(ws.candidates(old))
    }
  })

  it('역할만 고른 찾기도 같다(참조 프로파일 = 옛 역할 하나): 옛 역할 14개 전부', () => {
    for (const roleId of ['gk', 'cb', 'bpd', 'fb', 'wb', 'dm', 'dlp', 'b2b', 'ap', 'am', 'winger', 'if', 'st', 'tm']) {
      const result = ws.candidates(ask(roleId, { category: 'all' }))
      expect(result.ok, roleId).toBe(true)
      expect(result.norm, roleId).toEqual(ws.roleNorms()![roleId])
    }
    expect(ws.candidates(ask('nothing')).ok).toBe(false)
    expect(ws.candidates(ask('nothing')).message).toBe('알 수 없는 역할입니다.')
  })

  it('옛 카탈로그에서는 받은 전술도 다시 검사한다: 다른 카탈로그의 전술이나 모양이 틀린 전술은 찾지 않는다', () => {
    const fm26 = presetTactic('4-2-3-1', FM26_CATALOG)
    const wrongCatalog = ws.candidates(ask('cb', { slot: { tactic: fm26, index: 0 } }))
    expect(wrongCatalog.ok).toBe(false)
    expect(wrongCatalog.message).toContain('이 전술로는 후보를 찾을 수 없습니다.')
    const short: Tactic = { ...legacyTactic('4-2-3-1', {}), slots: legacyTactic('4-2-3-1', {}).slots.slice(0, 10) }
    expect(ws.candidates(ask('cb', { slot: { tactic: short, index: 0 } })).ok).toBe(false)
  })
})

// ---------- FM26: 두 국면의 포지션이 다른 자리 ----------

/** 4-2-3-1의 오른쪽 공격 자리(3번)를 "공 소유 시 오른쪽 공격(AMR), 공 미소유 시 오른쪽 미드(MR)"로 바꾼 전술. 비중은 60 */
function crossTactic(sharePct: number | null = 60): Tactic {
  const base = presetTactic('4-2-3-1', FM26_CATALOG, 'cross')
  const slots = base.slots.map((slot, index) =>
    index === 3 ? { ip: { cell: { line: 'AM' as const, lane: 'R' as const }, roleId: 'ip.InsideForward' }, oop: { cell: { line: 'M' as const, lane: 'R' as const }, roleId: 'oop.OPWideMidfielder' } } : slot
  )
  return { ...base, slots, sharePct }
}

const AMR = POSITION_AT('AMR')
const MR = POSITION_AT('MR')

/** 후보 선수 하나: [이름, 공 소유 시 포지션(AMR) 숙련, 공 미소유 시 포지션(MR) 숙련, 능력치 수준] */
const CANDIDATES: Array<[string, number, number, number]> = [
  ['후보 가', 20, 12, 14],
  ['후보 나', 12, 20, 14],
  ['후보 다', 20, 1, 14],
  ['후보 라', 20, 20, 14],
  ['후보 마', 16, 16, 14],
  ['후보 바', 8, 20, 14],
  ['후보 사', 20, 12, 16]
]

function crossWorld(): SaveWorld {
  const specs: PersonSpec[] = [
    ...Array.from({ length: 14 }, (_, i): PersonSpec => ({ name: `우리 ${i + 1}`, team: 100, club: 0, ca: 150 - i, level: 13, status: 3 })),
    // 이 자리의 기준 분포를 만드는 표본: 오른쪽 공격을 뛰는 선수 40명(능력치 수준이 조금씩 다르다)
    ...Array.from({ length: 40 }, (_, i): PersonSpec => ({ name: `표본 ${i + 1}`, team: 200 + 100 * (i % 3), club: 1 + (i % 3), ca: 130 + (i % 12), level: 8 + (i % 8) })),
    ...CANDIDATES.map(([name, , , level]): PersonSpec => ({ name, team: 200, club: 1, ca: 140, pa: 150, age: 27, level, status: 4 }))
  ]
  const world = buildWorld(specs)
  for (let k = 0; k < world.count; k++) {
    if (world.teamIds[k] === 100) world.positions.fill(18, k * POSITION_COUNT, (k + 1) * POSITION_COUNT)
  }
  for (let i = 0; i < 40; i++) world.positions[(14 + i) * POSITION_COUNT + AMR] = 18
  const ipKeys = Object.keys(FM26_CATALOG.baseWeights('ip.InsideForward'))
  const oopKeys = Object.keys(FM26_CATALOG.baseWeights('oop.OPWideMidfielder')).filter((id) => !ipKeys.includes(id))
  CANDIDATES.forEach(([, ip, oop], i) => {
    const k = 14 + 40 + i
    world.positions[k * POSITION_COUNT + AMR] = ip
    world.positions[k * POSITION_COUNT + MR] = oop
    // 점유 시 역할(안쪽 공격수)에 걸린 능력치는 높고 공 미소유 시 역할(측면 미드)에만 걸린 능력치는 낮다: 두 역할을 섞으면 점유 시 역할만 볼 때와 점수가 다르다
    for (const id of ipKeys) world.attributes[k * ATTRIBUTE_COUNT + SAVE_ATTRIBUTE_ORDER.indexOf(id as (typeof SAVE_ATTRIBUTE_ORDER)[number])] = 18 * 5
    for (const id of oopKeys) world.attributes[k * ATTRIBUTE_COUNT + SAVE_ATTRIBUTE_ORDER.indexOf(id as (typeof SAVE_ATTRIBUTE_ORDER)[number])] = (CANDIDATES[i][3] - 8) * 5
  })
  return world
}

describe('FM26: 자리 프로파일로 찾는다(공 소유 시 오른쪽 공격 + 공 미소유 시 오른쪽 미드, 비중 60)', () => {
  const world = crossWorld()
  const tactic = crossTactic()
  const made = serviceOf(world, { catalog: FM26_CATALOG, mainTactic: tactic })
  namesDirs.push(made.namesDir)
  const ws = made.ws
  const profile = profileOf(tactic, 3)
  const indexOf = (name: string): number => world.names.indexOf(name)
  // 이름에 "후보"가 든 선수는 유형 자격이 없어도 보인다(자격과 상관없이 점수와 감점을 볼 수 있다). 뛸 수 있는 선수만 거르는 조건은 그대로 적용된다
  const query = (over: Partial<CandidateQuery> = {}): CandidateQuery => ask('ip.InsideForward', { slot: { tactic, index: 3 }, search: '후보', ...over })
  const rowOf = (result: ReturnType<typeof ws.candidates>, name: string) => result.rows.find((row) => row.name === name)

  it('전술이 올바르고(검사 통과), 자리 3의 프로파일은 두 국면의 포지션과 역할과 비중이다', () => {
    expect(profile).toEqual({ ip: { position: 'AMR', roleId: 'ip.InsideForward' }, oop: { position: 'MR', roleId: 'oop.OPWideMidfielder' }, sharePct: 60 })
  })

  it('자격은 점유 시 포지션 숙련만 본다: 공 소유 시 숙련 15 이상이면(공 미소유 시 숙련이 1이어도) 후보에 들고, 공 소유 시 숙련이 낮으면 공 미소유 시 숙련이 높아도 빠진다', () => {
    const names = ws.candidates(query()).rows.map((row) => row.name)
    for (const name of ['후보 가', '후보 다', '후보 라', '후보 마', '후보 사']) expect(names, name).toContain(name)
    for (const name of ['후보 나', '후보 바']) expect(names, name).not.toContain(name)
    // 가장 넓은 조건(뛸 수 있는 선수만 끔)이면 모두 나온다
    const wide = ws.candidates(query({ onlyEligible: false })).rows.map((row) => row.name)
    for (const [name] of CANDIDATES) expect(wide).toContain(name)
  })

  it('감점은 두 숙련을 비중으로 섞은 값이다: mixedPenaltySigma(점유 시 숙련, 공 미소유 시 숙련, 60)', () => {
    const result = ws.candidates(query({ onlyEligible: false }))
    for (const [name, ip, oop] of CANDIDATES) {
      const fit = rowOf(result, name)!.recommend.fit
      expect(fit.positionSigma, name).toBe(mixedPenaltySigma(ip, oop, 60))
      expect([fit.ipRating, fit.oopRating], name).toEqual([ip, oop])
    }
    // 공 소유 시 20·공 미소유 시 1인 선수는 0.4 × 공 미소유 시 숙련 1의 감점만큼 깎인다(공 소유 시 숙련 20은 감점 0)
    expect(rowOf(result, '후보 다')!.recommend.fit.positionSigma).toBe((60 * 0 + 40 * posPenaltySigma(1)) / 100)
  })

  it('기준 분포는 그 자리 프로파일의 것이고(쓰는 카탈로그의 열쇠), 비교 기준은 내 팀의 가장 약한 주전이다', () => {
    const result = ws.candidates(query())
    expect(result.norm).toEqual(ws.normsFor([profile])[FM26_CATALOG.normKey(profile)])
    expect(result.norm!.n).toBeGreaterThan(0)
    expect(result.bench.starter).not.toBeNull()
    expect(result.bench.starter!.name).toMatch(/^우리 /)
    expect(result.group).toEqual({ label: '오른쪽 공격', slots: 1 })
    expect(result.need).toBeGreaterThanOrEqual(0)
  })

  it('유형(즉시 전력·로테이션·유망주) 판정도 같은 섞은 감점으로 한다: 점유 시 숙련만 보면 달라지는 선수가 있다', () => {
    const result = ws.candidates(query({ onlyEligible: false }))
    let different = 0
    for (const [name, ip, oop] of CANDIDATES) {
      const row = rowOf(result, name)!
      const player = { score: row.score, age: row.age, ca: row.ca, pa: row.pa, hasClub: true }
      expect(row.categories, name).toEqual(categoriesOf({ ...player, rating: { ip, oop, sharePct: 60 } }, result.bench, result.norm!, false))
      if (JSON.stringify(row.categories) !== JSON.stringify(categoriesOf({ ...player, rating: ip }, result.bench, result.norm!, false))) different++
    }
    expect(different).toBeGreaterThan(0)
  })

  it('10 미만 곱셈 보정(lowGate)은 점유 시 숙련만 본다: 공 소유 시 20·공 미소유 시 1이면 보정 없음, 공 소유 시 8이면 공 미소유 시 20이어도 보정이 걸린다', () => {
    const result = ws.candidates(query({ onlyEligible: false }))
    expect(rowOf(result, '후보 다')!.recommend.gate).toBe(1)
    expect(rowOf(result, '후보 바')!.recommend.gate).toBe(lowGate(8))
    expect(lowGate(8)).toBeLessThan(1)
    expect(rowOf(result, '후보 나')!.recommend.gate).toBe(lowGate(12))
  })

  it('점수는 두 역할을 섞은 가중치로 낸다(roles.ts의 savedRoleScore 하나): 같은 능력치 수준이면 같은 점수이고, 값은 프로파일 가중치로 직접 센 것과 같다', () => {
    const result = ws.candidates(query({ onlyEligible: false }))
    const prepared = prepareProfile(FM26_CATALOG, profile, {})
    for (const [name] of CANDIDATES) {
      const k = indexOf(name)
      expect(rowOf(result, name)!.score, name).toBe(savedRoleScore(world.attributes, k * ATTRIBUTE_COUNT, prepared))
    }
    // 점유 시 역할만 봤을 때(비중 100)와 값이 다르다: 두 역할을 섞었다는 뜻이다
    const ipOnly = prepareProfile(FM26_CATALOG, { ...profile, sharePct: 100 }, {})
    const k = indexOf('후보 가')
    expect(savedRoleScore(world.attributes, k * ATTRIBUTE_COUNT, ipOnly)).not.toBe(savedRoleScore(world.attributes, k * ATTRIBUTE_COUNT, prepared))
    // 능력치 수준이 높은 선수가 점수도 높다
    expect(rowOf(result, '후보 사')!.score).toBeGreaterThan(rowOf(result, '후보 가')!.score)
  })

  it('비중이 가득(100)이면 점유 시 역할과 점유 시 숙련만, 비중이 없음(null)이면 대장의 기본값(60)을 쓴다', () => {
    const full = serviceOf(world, { catalog: FM26_CATALOG, mainTactic: crossTactic(100) })
    namesDirs.push(full.namesDir)
    const result = full.ws.candidates(ask('ip.InsideForward', { slot: { tactic: crossTactic(100), index: 3 }, search: '후보', onlyEligible: false }))
    expect(rowOf(result, '후보 다')!.recommend.fit.positionSigma).toBe(posPenaltySigma(20))
    expect(rowOf(result, '후보 나')!.recommend.fit.positionSigma).toBe(posPenaltySigma(12))
    expect(rowOf(result, '후보 가')!.score).toBe(savedRoleScore(world.attributes, indexOf('후보 가') * ATTRIBUTE_COUNT, prepareProfile(FM26_CATALOG, { ...profile, sharePct: 100 }, {})))
    // null은 60과 같다
    expect(ws.candidates(ask('ip.InsideForward', { slot: { tactic: crossTactic(null), index: 3 }, search: '후보' }))).toEqual(ws.candidates(query()))
    expect(K.IP_SHARE_DEFAULT).toBe(0.6)
  })

  it('두 국면의 포지션이 같은 자리는 숙련 하나로 센다: 점유 시 숙련이 곧 감점 숙련이다', () => {
    // 3번 자리를 공 소유 시·공 미소유 시 모두 오른쪽 공격(AMR)으로 둔다
    const same = presetTactic('4-2-3-1', FM26_CATALOG, 'same')
    const result = ws.candidates(ask('ip.InsideForward', { slot: { tactic: same, index: 3 }, search: '후보', onlyEligible: false }))
    expect(result.ok).toBe(true)
    const row = rowOf(result, '후보 가')!
    expect(row.recommend.fit.positionSigma).toBe(posPenaltySigma(20))
    expect(row.recommend.fit.ipRating).toBe(row.recommend.fit.oopRating)
  })

  it('같은 프로파일의 자리(중앙 수비 둘)는 한 묶음이라 어느 자리를 골라도 결과가 같다', () => {
    const four231 = presetTactic('4-2-3-1', FM26_CATALOG)
    const first = ws.candidates(ask('ip.CentralDefender', { slot: { tactic: four231, index: 7 } }))
    const second = ws.candidates(ask('ip.CentralDefender', { slot: { tactic: four231, index: 8 } }))
    expect(first.ok).toBe(true)
    expect(first.group).toEqual({ label: '중앙 수비 (2자리)', slots: 2 })
    expect(second).toEqual(first)
    // 수비형 미드 둘도 같다
    expect(ws.candidates(ask('x', { slot: { tactic: four231, index: 4 } }))).toEqual(ws.candidates(ask('x', { slot: { tactic: four231, index: 5 } })))
  })

  it('받은 전술은 다시 검사한다: 자리가 모자라거나 다른 카탈로그의 전술이거나 역할이 틀리면 찾지 않고 까닭을 준다', () => {
    const short: Tactic = { ...tactic, slots: tactic.slots.slice(0, 10) }
    const wrongCatalog = legacyTactic('4-2-3-1', {})
    const wrongRole: Tactic = { ...tactic, slots: tactic.slots.map((slot, i) => (i === 7 ? { ...slot, ip: { ...slot.ip, roleId: 'ip.Goalkeeper' } } : slot)) }
    const nameless: Tactic = { ...tactic, name: '' }
    for (const bad of [short, wrongCatalog, wrongRole, nameless]) {
      const result = ws.candidates(query({ slot: { tactic: bad, index: 3 } }))
      expect(result.ok).toBe(false)
      expect(result.message).toContain('이 전술로는 후보를 찾을 수 없습니다.')
      expect(result.rows).toEqual([])
    }
    // 화면이 보낸 엉뚱한 값(모양이 틀린 전술)에도 죽지 않는다
    const garbage = ws.candidates(query({ slot: { tactic: { id: 'x' } as unknown as Tactic, index: 0 } }))
    expect(garbage.ok).toBe(false)
  })

  it('포메이션과 자리별 역할로 고른 옛 꼴 질의는 FM26 카탈로그에서 받지 않는다(옛 14역할 id가 이 카탈로그에 없다)', () => {
    const result = ws.candidates(ask('cb', { slot: { formation: '4-2-3-1', slotRoles: {}, index: 7 } }))
    expect(result.ok).toBe(false)
    expect(result.message).toContain('옛 14역할')
  })

  it('자리 번호가 범위 밖이면 고른 역할만으로 찾는다(옛 꼴과 같다)', () => {
    const result = ws.candidates(query({ slot: { tactic, index: 99 } }))
    expect(result.ok).toBe(true)
    expect(result.group).toBeNull()
  })

  it('역할만 고르면 참조 프로파일(역할 하나, 풀 = 그 역할을 고를 수 있는 포지션 전부)로 찾는다: 기준 분포는 참조의 것이다', () => {
    const result = ws.candidates(ask('ip.InsideForward', { onlyEligible: true }))
    expect(result.ok).toBe(true)
    expect(result.group).toBeNull()
    const reference = FM26_CATALOG.referenceOf('ip.InsideForward')!
    expect(reference.positions).toContain('AMR')
    expect(result.norm).toEqual(ws.referenceNorms('ip')[reference.key])
    // 이 역할을 고를 수 있는 포지션 가운데 한 곳이라도 숙련 15 이상이면 후보다
    expect(result.rows.map((row) => row.name)).toContain('후보 가')
    // 점수는 역할 하나의 가중치(참조)로 낸다
    const spec = referenceSpec(FM26_CATALOG, reference, {})
    const k = indexOf('후보 가')
    expect(rowOf(result, '후보 가')!.score).toBe(savedRoleScore(world.attributes, k * ATTRIBUTE_COUNT, prepareProfile(FM26_CATALOG, { ip: { position: 'AMR', roleId: 'ip.InsideForward' }, oop: { position: 'AMR', roleId: 'ip.InsideForward' }, sharePct: 100 }, {})))
    expect(spec.weights).toEqual(FM26_CATALOG.baseWeights('ip.InsideForward'))
    // 비점유 시 역할도 고를 수 있고(별점 대조와 같은 참조), 없는 역할이나 고를 수 없는 역할은 알 수 없는 역할이다
    expect(ws.candidates(ask('oop.OPWideMidfielder')).ok).toBe(true)
    expect(ws.candidates(ask('ip.NoSuchRole')).message).toBe('알 수 없는 역할입니다.')
    const unselectable = FM26_CATALOG.roles.find((role) => !role.selectable)!
    expect(ws.candidates(ask(unselectable.id)).message).toBe('알 수 없는 역할입니다.')
  })

  it('내 팀이 없거나 세이브가 막혀 있으면 지금처럼 이유와 함께 빈 결과다', () => {
    const noTeam = buildWorld([{ name: '표본', team: 200, club: 1, ca: 140 }])
    noTeam.teamId = undefined
    const lost = serviceOf(noTeam, { catalog: FM26_CATALOG })
    namesDirs.push(lost.namesDir)
    const result = lost.ws.candidates(query())
    expect(result.ok).toBe(false)
    expect(result.rows).toEqual([])
  })
})

// ---------- 대시보드 ----------

describe('대시보드는 주 전술로 계산하고, 영입 카드에 전술 번호를 싣는다(FM26)', () => {
  /** 크로스 세계에 내 팀의 정리 후보를 더한다: 전술에 뛸 자리가 없는 선수(왼쪽 윙백 숙련만 높고 능력은 낮은 고령 선수) */
  function dashboardWorld(): SaveWorld {
    const specs: PersonSpec[] = [
      ...Array.from({ length: 14 }, (_, i): PersonSpec => ({ name: `우리 ${i + 1}`, team: 100, club: 0, ca: 150 - i, level: 13, status: 3 })),
      ...Array.from({ length: 4 }, (_, i): PersonSpec => ({ name: `정리 ${i + 1}`, team: 100, club: 0, ca: 90, level: 5, age: 34, status: 5, wage: 90_000 })),
      ...Array.from({ length: 40 }, (_, i): PersonSpec => ({ name: `표본 ${i + 1}`, team: 200 + 100 * (i % 3), club: 1 + (i % 3), ca: 130 + (i % 12), level: 8 + (i % 8) })),
      ...CANDIDATES.map(([name, , , level]): PersonSpec => ({ name, team: 200, club: 1, ca: 140, pa: 150, age: 27, level, status: 4 })),
      { name: '자유 선수', team: NO_TEAM, club: -1, ca: 140, level: 14, wage: 0, end: 0 }
    ]
    const world = buildWorld(specs)
    for (let k = 0; k < 14; k++) world.positions.fill(18, k * POSITION_COUNT, (k + 1) * POSITION_COUNT)
    // 정리 후보 넷: 이 전술에 없는 왼쪽 윙백(WBL)만 뛴다
    for (let k = 14; k < 18; k++) world.positions[k * POSITION_COUNT + POSITION_AT('WBL')] = 18
    // 다른 구단의 선수(표본과 후보)는 어느 자리에서든 뛸 수 있다: 가장 급한 자리가 어디든 영입 후보가 나온다
    for (let k = 18; k < world.count; k++) world.positions.fill(18, k * POSITION_COUNT, (k + 1) * POSITION_COUNT)
    return world
  }

  const tactic = crossTactic()
  const world = dashboardWorld()
  const made = serviceOf(world, { catalog: FM26_CATALOG, mainTactic: tactic })
  namesDirs.push(made.namesDir)
  const dash = new DashboardService({
    world: made.ws,
    season: { season: async () => ({ ok: false, recent: [], upcoming: [] }) } as never,
    settings: () => ({ tactic, catalog: FM26_CATALOG, roleWeights: {} }),
    namesDir: made.namesDir
  })

  it('계산이 끝까지 돈다(분석을 만든 카탈로그를 정리 후보 계산에 넘긴다). 전술 번호와 점유 시 포지션 이름이 영입 카드에 실린다', async () => {
    const data = await dash.dashboard()
    expect(data.ok, data.message).toBe(true)
    expect(data.surplus.ok).toBe(true)
    expect(data.recommend.ok).toBe(true)
    const slot = data.recommend.slot!
    expect(slot.tacticId).toBe('cross')
    expect(slot.formation).toBe('4-2-3-1')
    expect(data.recommend.rows.length).toBeGreaterThan(0)
    // 영입 후보는 그 자리의 프로파일로 찾은 것이다: 같은 자리를 { tactic, index }로 물은 것과 같은 선수가 앞선다
    const direct = made.ws.candidates({ roleId: 'x', category: 'starter', maxAge: null, onlyEligible: true, includeUnknownClub: false, search: '', expiringWithinMonths: null, slot: { tactic, index: slot.index } })
    const best = direct.rows.filter((row) => !row.recommend.realism.low)[0] ?? direct.rows[0]
    expect(data.recommend.rows.map((row) => row.uid)).toContain(best.uid)
  })

  it('전술에 뛸 자리가 없는 선수는 참조 프로파일(점유 시 역할)의 기준 분포로 "가장 맞는 역할"을 잰다', async () => {
    const data = await dash.dashboard()
    const noSlot = data.surplus.rows.filter((row) => row.fit === 'noSlot')
    expect(noSlot.length).toBeGreaterThan(0)
    // 가장 맞는 역할의 이름은 FM26 점유 시 역할의 이름이다(옛 14역할 이름이 아니다)
    const labels = new Set(FM26_CATALOG.references('ip').map((ref) => ref.label))
    for (const row of noSlot) expect(labels.has(row.bestRole ?? ''), row.bestRole ?? '').toBe(true)
  })

  it('같은 입력이면 계산해 둔 것을 쓰고, 전술이 바뀌면 다시 계산한다', async () => {
    const first = dash.dashboard()
    expect(dash.dashboard()).toBe(first)
    let current: Tactic = tactic
    const second = new DashboardService({
      world: made.ws,
      season: { season: async () => ({ ok: false, recent: [], upcoming: [] }) } as never,
      settings: () => ({ tactic: current, catalog: FM26_CATALOG, roleWeights: {} }),
      namesDir: made.namesDir
    })
    const before = second.dashboard()
    expect(second.dashboard()).toBe(before)
    current = { ...tactic, sharePct: 40 }
    expect(second.dashboard()).not.toBe(before)
    current = { ...tactic, id: 'other' }
    const renamed = await second.dashboard()
    expect(renamed.recommend.slot?.tacticId).toBe('other')
  })

  it('옛 14역할은 지금 그대로다: 옛 설정 꼴(포메이션, 자리별 역할)도 새 꼴(주 전술과 옛 카탈로그)도 같은 대시보드를 준다', async () => {
    const synthetic = syntheticWorld()
    const legacy = syntheticService(synthetic)
    namesDirs.push(legacy.namesDir)
    const season = { season: async () => ({ ok: false, recent: [], upcoming: [] }) } as never
    const oldForm = await new DashboardService({ world: legacy.ws, season, settings: () => ({ formation: '4-3-3', slotRoles: { '4-3-3:7': 'bpd' }, roleWeights: {} }), namesDir: legacy.namesDir }).dashboard()
    const newForm = await new DashboardService({
      world: legacy.ws,
      season,
      settings: () => ({ tactic: legacyTactic('4-3-3', { '4-3-3:7': 'bpd' }), catalog: LEGACY_CATALOG, roleWeights: {} }),
      namesDir: legacy.namesDir
    }).dashboard()
    expect(oldForm.ok, oldForm.message).toBe(true)
    expect(newForm).toEqual(oldForm)
    expect(oldForm.recommend.slot?.tacticId).toBe('legacy:4-3-3')
  })
})
