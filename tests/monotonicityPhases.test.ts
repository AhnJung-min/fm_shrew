/**
 * 능력치 단조성(N-04)의 FM26 두 국면 판: 능력치 하나를 한 단계 올리거나 포지션 숙련을 한 단계 올리면 어느 탭에서도 추천 점수와 적합도가 줄지 않는다.
 * 옛 14역할은 tests/world5.test.ts의 N-04 시험이 본다. 여기는 FM26 카탈로그를 직접 넘겨 두 국면(점유 시·비점유 시 역할 둘, 비중)으로 같은 것을 본다.
 *
 * 프로파일
 * - 고를 수 있는 점유 시 역할 40개마다 그 칸의 기본 비점유 시 역할, 고를 수 있는 비점유 시 역할 39개마다 그 칸의 기본 점유 시 역할(두 국면의 포지션은 같다).
 * - 두 국면의 포지션이 다른 셋: 공 소유 시 오른쪽 공격 → 공 미소유 시 오른쪽 미드(AMR→MR), 중앙 미드 → 수비형 미드(MC→DM), 왼쪽 윙백 → 왼쪽 수비(WBL→DL).
 * 비중 40·50·60·70·80, 탭 5개, 사례 3개(21세 소속, 28세 소속, 24세 무소속). 사례마다 후보는 같은 현재·잠재 능력이고 능력치는 4~17의 무작위다.
 * 후보: 기준 하나, 능력치 54개마다 한 단계 올린 것 하나씩, 점유 시 포지션 숙련만 한 단계 올린 것, (두 국면의 포지션이 다를 때) 비점유 시 포지션 숙련만 한 단계 올린 것.
 *
 * 시간: 이 파일은 비중 5개 × 탭 5개를 모두 돈다(6,000번 남짓의 후보 찾기). 60초를 넘으면 비중 50·70은 '전체' 탭만 도는 것으로 줄이고 여기에 적는다(지금은 줄이지 않았다).
 * 쓰는 카탈로그는 FM26 그대로다. 역할마다 그 역할을 올바르게(전술 검사를 막힘 없이 통과해) 놓을 수 있는 첫 프리셋 자리에 놓고, 다른 국면의 역할은 그 칸의 기본 역할로 둔다.
 */
import { rmSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { POSITION_COUNT, ATTRIBUTE_COUNT } from '../src/main/save/reader'
import { NO_TEAM, type SaveWorld } from '../src/main/save/world'
import { FM26_CATALOG } from '../src/shared/catalogFm26'
import { FORMATIONS } from '../src/shared/depth'
import type { PositionKey } from '../src/shared/roles'
import type { CatalogRole } from '../src/shared/roleCatalog'
import type { Phase } from '../src/shared/slotProfile'
import { blockingProblems, cellPosition, presetTactic, slotKindOf, validateTactic, withShare, type Cell, type Tactic, type TacticSet } from '../src/shared/tacticModel'
import { SAVE_ATTRIBUTE_ORDER, type CandidateCategory } from '../src/shared/world'
import { ask, buildWorld, POSITION_AT, serviceOf, type PersonSpec } from './helpers/phaseWorld'
import { seeded } from './helpers/syntheticWorld'

const TABS: CandidateCategory[] = ['all', 'starter', 'rotation', 'prospect', 'free']
const SHARES = [40, 50, 60, 70, 80]
/** 낮을수록 좋은 능력치: 점수에는 이 값이 내려가는 쪽이 "좋아지는" 방향이다(recommend.ts의 LOWER_IS_BETTER) */
const LOWER_IS_BETTER = new Set(['injuryProneness', 'dirtiness'])
const CASES = [
  { age: 21, club: true, seed: 11 },
  { age: 28, club: true, seed: 22 },
  { age: 24, club: false, seed: 33 }
]

interface Profile {
  label: string
  /** 점유 시·비점유 시 포지션 */
  ipPosition: PositionKey
  oopPosition: PositionKey
  /** 전술(비중은 따로 바꾼다)과 이 프로파일의 자리 순번 */
  tactic: Tactic
  index: number
  roleId: string
}

/** 그 역할을 올바르게 놓을 수 있는 첫 프리셋 자리(전술 검사가 막는 문제 없이 통과하는 자리)와 그 전술 */
function placementOf(role: CatalogRole): { tactic: Tactic; index: number; position: PositionKey } {
  const phase = role.phase as Phase
  for (const formation of FORMATIONS) {
    const base = presetTactic(formation.id, FM26_CATALOG, `p-${role.id}`)
    const positions = formation.rows.flat()
    for (let index = 0; index < positions.length; index++) {
      if (!role.positions.includes(positions[index])) continue
      const slots = base.slots.map((slot, at) => (at === index ? { ...slot, [phase]: { ...slot[phase], roleId: role.id } } : slot))
      const tactic: Tactic = { ...base, slots }
      if (blockingProblems(validateTactic(tactic, FM26_CATALOG)).length === 0) return { tactic, index, position: positions[index] }
    }
  }
  throw new Error(`올바르게 놓을 수 있는 자리가 없는 역할: ${role.id}`)
}

/** 모든 프로파일 사례 */
function profiles(): Profile[] {
  const list: Profile[] = []
  for (const role of FM26_CATALOG.roles.filter((each) => each.selectable)) {
    const { tactic, index, position } = placementOf(role)
    list.push({ label: `${role.phase === 'ip' ? '공 소유 시' : '공 미소유 시'} ${role.id}`, ipPosition: position, oopPosition: position, tactic, index, roleId: tactic.slots[index].ip.roleId })
  }
  // 두 국면의 포지션이 다른 셋: 공 미소유 시 칸을 바꾸고 그 칸의 기본 역할을 쓴다
  const cross = (label: string, preset: string, index: number, oopCell: Cell): Profile => {
    const base = presetTactic(preset, FM26_CATALOG, `cross-${label}`)
    const moved: Tactic = { ...base, slots: base.slots.map((slot, at) => (at === index ? { ip: slot.ip, oop: { ...slot.oop, cell: oopCell } } : slot)) }
    const ipPosition = cellPosition(moved.slots[index].ip.cell)!
    const oopPosition = cellPosition(oopCell)!
    const oopRole = FM26_CATALOG.defaultRole(oopPosition, 'oop', slotKindOf(moved, index, 'oop'))
    const tactic: Tactic = { ...moved, slots: moved.slots.map((slot, at) => (at === index ? { ip: slot.ip, oop: { ...slot.oop, roleId: oopRole } } : slot)) }
    return { label, ipPosition, oopPosition, tactic, index, roleId: tactic.slots[index].ip.roleId }
  }
  list.push(cross('AMR→MR', '4-2-3-1', 3, { line: 'M', lane: 'R' }))
  list.push(cross('MC→DM', '4-3-3', 3, { line: 'DM', lane: 'CL' }))
  list.push(cross('WBL→DL', '3-5-2', 4, { line: 'D', lane: 'L' }))
  return list
}

const ALL = profiles()
const namesDirs: string[] = []
afterAll(() => {
  for (const dir of namesDirs) rmSync(dir, { recursive: true, force: true })
})

const names = (cross: boolean): string[] => ['후보-기준', ...SAVE_ATTRIBUTE_ORDER.map((id) => `후보-${id}`), '후보-숙련', ...(cross ? ['후보-비점유숙련'] : [])]

/**
 * 내 팀 1군 14명(모든 자리를 뛸 수 있다)과 팀 하나의 표본 6명, 후보 줄: 기준 하나와 한 단계 좋아진 것들.
 * 후보의 능력치는 4~17 사이 무작위다(위·아래로 한 단계씩 움직일 여지가 있다). 후보는 모두 같은 구단이고 같은 현재·잠재 능력이다.
 */
function worldFor(profile: Profile, index: number, spec: (typeof CASES)[number]): SaveWorld {
  const cross = profile.ipPosition !== profile.oopPosition
  const specs: PersonSpec[] = [
    ...Array.from({ length: 14 }, (_, i): PersonSpec => ({ name: `우리${i + 1}`, team: 100, club: 0, ca: 150 - i, level: 13, status: 3 })),
    ...[160, 158, 156, 154, 152, 150].map((ca, i): PersonSpec => ({ name: `비${i + 1}`, team: 200, club: 1, ca, level: 10 }))
  ]
  for (const name of names(cross)) {
    specs.push(
      spec.club
        ? { name, team: 200, club: 1, ca: 140, pa: 160, age: spec.age, status: 4 }
        : { name, team: NO_TEAM, club: -1, ca: 140, pa: 160, age: spec.age, wage: 0, end: 0 }
    )
  }
  const world = buildWorld(specs)
  for (let k = 0; k < world.count; k++) {
    if (world.teamIds[k] === 100) world.positions.fill(18, k * POSITION_COUNT, (k + 1) * POSITION_COUNT)
  }
  const first = world.names.indexOf('후보-기준')
  const draw = seeded(spec.seed * 1000 + index)
  const base = Array.from({ length: ATTRIBUTE_COUNT }, () => (4 + Math.floor(draw() * 14)) * 5)
  const ip = POSITION_AT(profile.ipPosition)
  const oop = POSITION_AT(profile.oopPosition)
  for (let k = first; k < world.count; k++) {
    world.attributes.set(base, k * ATTRIBUTE_COUNT)
    world.positions.fill(1, k * POSITION_COUNT, (k + 1) * POSITION_COUNT)
    world.positions[k * POSITION_COUNT + ip] = 14
    world.positions[k * POSITION_COUNT + oop] = 14
  }
  SAVE_ATTRIBUTE_ORDER.forEach((id, at) => {
    // 한 단계 = 게임 표시값 1 = 저장값 5
    world.attributes[(first + 1 + at) * ATTRIBUTE_COUNT + at] += LOWER_IS_BETTER.has(id) ? -5 : 5
  })
  const trained = first + 1 + SAVE_ATTRIBUTE_ORDER.length
  world.positions[trained * POSITION_COUNT + ip] = 15
  if (cross) world.positions[(trained + 1) * POSITION_COUNT + oop] = 15
  return world
}

describe('FM26 단조성(두 국면): 능력치 하나, 점유 시 숙련, 비점유 시 숙련을 한 단계 올리면 어느 탭에서도 추천 점수와 적합도가 줄지 않는다', () => {
  it('사례를 만든 전술이 모두 올바르다(막는 문제가 없다): 점유 시 역할 40 + 비점유 시 역할 39 + 포지션이 다른 셋', () => {
    expect(ALL).toHaveLength(40 + 39 + 3)
    for (const profile of ALL) {
      for (const share of SHARES) {
        const problems = blockingProblems(validateTactic({ ...profile.tactic, sharePct: share }, FM26_CATALOG))
        expect(problems.map((problem) => problem.message), `${profile.label} ${share}`).toEqual([])
      }
    }
    // 두 국면의 포지션이 다른 셋은 정말 포지션이 다르다
    const crossed = ALL.filter((profile) => profile.ipPosition !== profile.oopPosition)
    expect(crossed.map((profile) => `${profile.ipPosition}→${profile.oopPosition}`)).toEqual(['AMR→MR', 'MC→DM', 'WBL→DL'])
  })

  it(
    '54개 능력치 + 점유 시 숙련 + (포지션이 다르면) 비점유 시 숙련 × 프로파일 82개 × 비중 5개 × 탭 5개 × 사례 3개: 위반 0건',
    () => {
      let checked = 0
      let raised = 0
      const set = (tactic: Tactic): TacticSet => ({ catalog: 'fm26', tactics: [tactic], mainId: tactic.id })
      for (const spec of CASES) {
        ALL.forEach((profile, profileIndex) => {
          const cross = profile.ipPosition !== profile.oopPosition
          const trainedNames = ['후보-숙련', ...(cross ? ['후보-비점유숙련'] : [])]
          const world = worldFor(profile, profileIndex, spec)
          const made = serviceOf(world, { catalog: FM26_CATALOG, mainTactic: profile.tactic })
          namesDirs.push(made.namesDir)
          for (const share of SHARES) {
            const tactic = withShare(set(profile.tactic), profile.tactic.id, share).tactics[0]
            for (const category of TABS) {
              const result = made.ws.candidates(ask(profile.roleId, { category, onlyEligible: false, search: '후보-', slot: { tactic, index: profile.index } }))
              const where = `${profile.label}/비중 ${share}/${category}/${spec.age}세`
              expect(result.ok, `${where}: ${result.message ?? ''}`).toBe(true)
              expect(result.group, where).toBeTruthy()
              const rowOf = (name: string) => result.rows.find((row) => row.name === name)!
              const base = rowOf('후보-기준')
              expect(base, `${where} 기준`).toBeDefined()
              for (const name of [...SAVE_ATTRIBUTE_ORDER.map((id) => `후보-${id}`), ...trainedNames]) {
                const better = rowOf(name)
                expect(better.recommend.total, `총점 ${where}/${name}`).toBeGreaterThanOrEqual(base.recommend.total)
                expect(better.score, `적합도 ${where}/${name}`).toBeGreaterThanOrEqual(base.score)
                expect(better.recommend.fit.effective, `비교용 적합도 ${where}/${name}`).toBeGreaterThanOrEqual(base.recommend.fit.effective)
                if (better.recommend.total > base.recommend.total) raised++
                checked++
              }
            }
          }
        })
      }
      // 센 개수가 정해진 값이다: 사례 3 × (프로파일 82개: 54 + 숙련 1, 포지션이 다른 셋은 + 1) × 비중 5 × 탭 5
      expect(checked).toBe(CASES.length * (ALL.length * (SAVE_ATTRIBUTE_ORDER.length + 1) + 3) * SHARES.length * TABS.length)
      // 아무것도 안 바뀌는 시험이 아니다: 두 역할에 걸린 능력치와 신뢰성 항목, 숙련은 실제로 총점을 올린다(역할마다 능력치 10개 안팎만 걸려 있다)
      expect(raised).toBeGreaterThan(checked / 10)
    },
    180_000
  )

  it('반대로 부상 빈도(낮을수록 좋음)를 올리면 총점이 줄어든다: 방향 판정이 맞는지 확인한다', () => {
    const profile = ALL[0]
    const world = worldFor(profile, 0, CASES[1])
    const at = SAVE_ATTRIBUTE_ORDER.indexOf('injuryProneness')
    const k = world.names.indexOf('후보-injuryProneness')
    world.attributes[k * ATTRIBUTE_COUNT + at] += 10
    const made = serviceOf(world, { catalog: FM26_CATALOG, mainTactic: profile.tactic })
    namesDirs.push(made.namesDir)
    const result = made.ws.candidates(ask(profile.roleId, { category: 'all', onlyEligible: false, search: '후보-', slot: { tactic: profile.tactic, index: profile.index } }))
    expect(result.rows.find((row) => row.name === '후보-injuryProneness')!.recommend.total).toBeLessThan(result.rows.find((row) => row.name === '후보-기준')!.recommend.total)
  })

  it('숙련을 올린 후보는 두 국면의 포지션이 다른 자리에서 점유 시 숙련만, 비점유 시 숙련만 올라도 감점이 줄어 비교용 적합도가 오른다', () => {
    const profile = ALL.find((each) => each.ipPosition !== each.oopPosition)!
    const world = worldFor(profile, 80, CASES[1])
    const made = serviceOf(world, { catalog: FM26_CATALOG, mainTactic: profile.tactic })
    namesDirs.push(made.namesDir)
    const result = made.ws.candidates(ask(profile.roleId, { category: 'all', onlyEligible: false, search: '후보-', slot: { tactic: profile.tactic, index: profile.index } }))
    const base = result.rows.find((row) => row.name === '후보-기준')!
    for (const name of ['후보-숙련', '후보-비점유숙련']) {
      const better = result.rows.find((row) => row.name === name)!
      expect(better.recommend.fit.effective, name).toBeGreaterThan(base.recommend.fit.effective)
      expect(better.recommend.fit.positionSigma, name).toBeLessThan(base.recommend.fit.positionSigma)
    }
  })
})
