import { describe, expect, it } from 'vitest'
import { FM26_CATALOG } from '../src/shared/catalogFm26'
import { buildDepth, FORMATION_BY_ID, FORMATIONS } from '../src/shared/depth'
import { TACTIC_NAME_MAX, TACTIC_SLOTS, TACTICS_PER_SAVE } from '../src/shared/limits'
import { LEGACY_CATALOG, prepareProfile, withCustomRoles, type CustomRole, type RoleCatalog } from '../src/shared/roleCatalog'
import { DEFAULT_ROLE, prepareRole, ROLES, type PositionKey } from '../src/shared/roles'
import { groupIdOf, shareLabel } from '../src/shared/slotProfile'
import {
  addTactic,
  canonicalOrder,
  cellPosition,
  copyTactic,
  currentSet,
  layoutRows,
  legacySlotRolePatch,
  legacyTactic,
  presetTactic,
  PRESET_IDS,
  profileOf,
  removeTactic,
  renameTactic,
  resolveMainTactic,
  saveKeyOf,
  setMainTactic,
  sharePctOf,
  slotKindOf,
  validateTactic,
  validateTacticSet,
  withPreset,
  withShare,
  withSlotRole,
  type Cell,
  type Lane,
  type Line,
  type Tactic,
  type TacticSet
} from '../src/shared/tacticModel'
import type { Settings } from '../src/shared/types'

const POSITIONS = Object.keys(DEFAULT_ROLE) as PositionKey[]

/** 깊게 얼린다: 고치는 함수가 입력을 바꾸면 TypeError로 걸린다 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** 전술을 복사해 고친다(시험용) */
function mutated(tactic: Tactic, edit: (copy: Tactic) => void): Tactic {
  const copy = structuredClone(tactic)
  edit(copy)
  return copy
}

const codesOf = (problems: Array<{ code: string }>): string[] => problems.map((problem) => problem.code)

const settingsOf = (patch: Partial<Settings> = {}): Settings => ({
  saveDir: 'C:\\세이브',
  activeSave: '',
  saveTeams: {},
  density: 'compact',
  theme: 'blue',
  formation: '4-2-3-1',
  slotRoles: {},
  roleWeights: {},
  talkModel: 'claude-sonnet-5-5',
  talkEffort: 'medium',
  talkStats: { requests: 0, inputTokens: 0, outputTokens: 0 },
  matchPairs: [],
  keepRunning: true,
  backupEnabled: true,
  backupKeep: 3,
  ...patch
})

/** 사용자가 고친 역할 가중치의 예(센터백의 대인 마크 5, 태클 끔, 침착성 3 / 스트라이커의 골 결정력 1) */
const EDITED_WEIGHTS = { cb: { marking: 5, tackling: 0, composure: 3 }, st: { finishing: 1 } }

/** FM26 카탈로그의 자료가 비어 있는 동안, 옛 역할을 그대로 쓰되 번호만 fm26인 시험용 카탈로그 */
const FAKE_FM26: RoleCatalog = { ...LEGACY_CATALOG, id: 'fm26' }

const positionsOf = (tactic: Tactic, phase: 'ip' | 'oop' = 'ip'): Array<PositionKey | null> => tactic.slots.map((slot) => cellPosition(slot[phase].cell))
const preset = (id: string, catalog: RoleCatalog = LEGACY_CATALOG, tacticId?: string): Tactic => presetTactic(id, catalog, tacticId)

/** 비점유 시에 4-2-3-1의 측면 공격 둘이 미드 줄 측면으로 내려오는 전술(점유 시 칸은 그대로) */
const droppingWingers = (): Tactic =>
  mutated(preset('4-2-3-1'), (copy) => {
    copy.slots[1].oop.cell = { line: 'M', lane: 'L' }
    copy.slots[3].oop.cell = { line: 'M', lane: 'R' }
  })

describe('칸과 포지션', () => {
  it('줄과 칸에서 포지션이 나온다(좌우는 넓은 포지션, 가운데 칸 CL·C·CR은 가운데 포지션)', () => {
    const expected: Record<Line, Record<Lane, PositionKey | null>> = {
      GK: { L: null, CL: null, C: 'GK', CR: null, R: null },
      D: { L: 'DL', CL: 'DC', C: 'DC', CR: 'DC', R: 'DR' },
      DM: { L: 'WBL', CL: 'DM', C: 'DM', CR: 'DM', R: 'WBR' },
      M: { L: 'ML', CL: 'MC', C: 'MC', CR: 'MC', R: 'MR' },
      AM: { L: 'AML', CL: 'AMC', C: 'AMC', CR: 'AMC', R: 'AMR' },
      ST: { L: null, CL: 'ST', C: 'ST', CR: 'ST', R: null }
    }
    for (const line of Object.keys(expected) as Line[]) {
      for (const lane of Object.keys(expected[line]) as Lane[]) expect(cellPosition({ line, lane }), `${line}/${lane}`).toBe(expected[line][lane])
    }
    expect(cellPosition({ line: '없는줄' as Line, lane: 'C' })).toBeNull()
    expect(cellPosition({ line: 'D', lane: '없는칸' as Lane })).toBeNull()
    expect(cellPosition(undefined as unknown as Cell)).toBeNull()
  })

  it('칸 종류는 같은 줄의 가운데 칸 수에서 나온다(예: 4-4-2의 MC.pair, 3-5-2의 DC.trio.side·DC.trio.centre·DM.single, 4-2-3-1의 DM.pair·AMC.single)', () => {
    const kinds = (id: string, phase: 'ip' | 'oop' = 'ip'): string[] => {
      const tactic = preset(id)
      return tactic.slots.map((_, index) => slotKindOf(tactic, index, phase))
    }
    expect(kinds('4-4-2')).toEqual(['ST.pair', 'ST.pair', 'ML', 'MC.pair', 'MC.pair', 'MR', 'DL', 'DC.pair', 'DC.pair', 'DR', 'GK'])
    expect(kinds('3-5-2')).toEqual(['ST.pair', 'ST.pair', 'MC.pair', 'MC.pair', 'WBL', 'DM.single', 'WBR', 'DC.trio.side', 'DC.trio.centre', 'DC.trio.side', 'GK'])
    expect(kinds('4-2-3-1')).toEqual(['ST.single', 'AML', 'AMC.single', 'AMR', 'DM.pair', 'DM.pair', 'DL', 'DC.pair', 'DC.pair', 'DR', 'GK'])
    expect(kinds('4-3-3')).toEqual(['ST.single', 'AML', 'AMR', 'MC.pair', 'MC.pair', 'DM.single', 'DL', 'DC.pair', 'DC.pair', 'DR', 'GK'])
    expect(kinds('3-4-3')).toEqual(['AML', 'ST.single', 'AMR', 'MC.pair', 'MC.pair', 'WBL', 'WBR', 'DC.trio.side', 'DC.trio.centre', 'DC.trio.side', 'GK'])
    expect(kinds('4-4-2', 'oop')).toEqual(kinds('4-4-2'))
  })

  it('칸 종류는 국면마다 따로 센다(점유 시와 비점유 시 칸이 달라도 서로 섞이지 않는다)', () => {
    // 비점유 시에 공격 줄 셋이 미드 줄로 내려온다: AML→ML, AMC→MC, AMR→MR
    const tactic = mutated(droppingWingers(), (copy) => (copy.slots[2].oop.cell = { line: 'M', lane: 'C' }))
    expect([1, 2, 3].map((index) => slotKindOf(tactic, index, 'ip'))).toEqual(['AML', 'AMC.single', 'AMR'])
    expect([1, 2, 3].map((index) => slotKindOf(tactic, index, 'oop'))).toEqual(['ML', 'MC.single', 'MR'])
    expect(positionsOf(tactic, 'oop').slice(0, 4)).toEqual(['ST', 'ML', 'MC', 'MR'])
    // 올바르지 않은 칸과 없는 자리는 칸 종류가 없다
    expect(slotKindOf(mutated(tactic, (copy) => (copy.slots[0].ip.cell = { line: 'ST', lane: 'L' })), 0, 'ip')).toBe('')
    expect(slotKindOf(tactic, 99, 'ip')).toBe('')
  })

  it('프리셋 5개의 칸 배치: 위에서 아래로 줄마다 자리 순번이다. 3-4-3은 측면 공격 둘(공격 줄)과 최전방(최전방 줄)이 다른 줄이다', () => {
    const rows = (id: string): number[][] => layoutRows(preset(id), 'ip')
    expect(rows('4-2-3-1')).toEqual([[0], [1, 2, 3], [4, 5], [6, 7, 8, 9], [10]])
    expect(rows('4-3-3')).toEqual([[0], [1, 2], [3, 4], [5], [6, 7, 8, 9], [10]])
    expect(rows('4-4-2')).toEqual([[0, 1], [2, 3, 4, 5], [6, 7, 8, 9], [10]])
    expect(rows('3-5-2')).toEqual([[0, 1], [2, 3], [4, 5, 6], [7, 8, 9], [10]])
    expect(rows('3-4-3')).toEqual([[1], [0, 2], [3, 4], [5, 6], [7, 8, 9], [10]])
    // 모든 프리셋에서 자리 11개가 한 번씩 나온다
    for (const id of PRESET_IDS) expect(rows(id).flat().sort((a, b) => a - b)).toEqual([...Array(TACTIC_SLOTS).keys()])
  })

  it('layoutRows는 국면마다 그 국면의 칸으로 배치한다', () => {
    const tactic = droppingWingers()
    expect(layoutRows(tactic, 'ip')).toEqual([[0], [1, 2, 3], [4, 5], [6, 7, 8, 9], [10]])
    // 비점유 시: 공격 줄에는 가운데 하나만 남고, 미드 줄에 왼쪽·오른쪽 측면이 생긴다
    expect(layoutRows(tactic, 'oop')).toEqual([[0], [2], [1, 3], [4, 5], [6, 7, 8, 9], [10]])
    expect(slotKindOf(tactic, 1, 'oop')).toBe('ML')
    expect(slotKindOf(tactic, 3, 'oop')).toBe('MR')
    expect(slotKindOf(tactic, 2, 'oop')).toBe('AMC.single')
  })
})

describe('프리셋과 옛 설정에서 전술 만들기', () => {
  it('프리셋 5개의 자리 순서·포지션이 옛 FORMATIONS와 같고, 두 국면이 같은 칸·같은 기본 역할이며, 비중은 적지 않는다', () => {
    expect(PRESET_IDS).toEqual(['4-2-3-1', '4-3-3', '4-4-2', '3-5-2', '3-4-3'])
    expect(PRESET_IDS).toEqual(FORMATIONS.map((formation) => formation.id))
    for (const id of PRESET_IDS) {
      const tactic = preset(id)
      const expected = FORMATION_BY_ID[id].rows.flat()
      expect(tactic.slots).toHaveLength(TACTIC_SLOTS)
      expect(positionsOf(tactic, 'ip')).toEqual(expected)
      expect(positionsOf(tactic, 'oop')).toEqual(expected)
      expect(tactic.slots.map((slot) => slot.ip.roleId)).toEqual(expected.map((position) => DEFAULT_ROLE[position]))
      expect(tactic.slots.map((slot) => slot.oop.roleId)).toEqual(expected.map((position) => DEFAULT_ROLE[position]))
      expect(tactic).toMatchObject({ id: `preset:${id}`, name: id, preset: id, sharePct: null, source: 'preset', catalog: 'legacy14' })
      expect(validateTactic(tactic, LEGACY_CATALOG), id).toEqual([])
      // 두 국면의 칸은 같은 값이지만 같은 객체는 아니다(한쪽을 고쳐도 다른 쪽이 따라 바뀌지 않는다)
      expect(tactic.slots[0].ip.cell).toEqual(tactic.slots[0].oop.cell)
      expect(tactic.slots[0].ip.cell).not.toBe(tactic.slots[0].oop.cell)
    }
    expect(preset('4-3-3', LEGACY_CATALOG, 'mine').id).toBe('mine')
    expect(presetTactic('없는 프리셋', LEGACY_CATALOG).preset).toBe(FORMATIONS[0].id)
    expect(presetTactic('constructor', LEGACY_CATALOG).preset).toBe(FORMATIONS[0].id)
    expect(presetTactic('4-3-3', FAKE_FM26).catalog).toBe('fm26')
  })

  it('legacyTactic의 자리·역할이 지금 buildDepth의 slots와 같다(프리셋 5개 × 자리마다 옛 역할 14개 전부 × 틀린 id × 다른 포지션 역할)', () => {
    const roleIds = [...ROLES.map((role) => role.id), '없는 역할', '']
    let compared = 0
    for (const formation of FORMATIONS) {
      const count = formation.rows.flat().length
      for (let index = 0; index < count; index++) {
        for (const roleId of roleIds) {
          const slotRoles = { [`${formation.id}:${index}`]: roleId }
          const slots = buildDepth([], [], formation, slotRoles, {})
          const tactic = legacyTactic(formation.id, slotRoles)
          const where = `${formation.id}:${index}=${roleId}`
          expect(positionsOf(tactic, 'ip'), where).toEqual(slots.map((slot) => slot.position))
          expect(tactic.slots.map((slot) => slot.ip.roleId), where).toEqual(slots.map((slot) => slot.roleId))
          // 자리 묶음 id와 기준 분포 열쇠도 옛 것(`포지션:역할`, 역할 id)과 같다
          const profiles = tactic.slots.map((_, i) => profileOf(tactic, i))
          expect(profiles.map(groupIdOf), where).toEqual(slots.map((slot) => `${slot.position}:${slot.roleId}`))
          expect(profiles.map((profile) => LEGACY_CATALOG.normKey(profile)), where).toEqual(slots.map((slot) => slot.roleId))
          // 자리마다 준비한 가중치가 옛 prepareRole과 같다(사용자가 고친 가중치 포함)
          expect(profiles.map((profile) => prepareProfile(LEGACY_CATALOG, profile, EDITED_WEIGHTS)), where).toEqual(slots.map((slot) => prepareRole(slot.roleId, EDITED_WEIGHTS)))
          compared++
        }
      }
    }
    expect(compared).toBe(FORMATIONS.reduce((total, formation) => total + formation.rows.flat().length, 0) * roleIds.length)
    // 자리마다 다른 역할을 한꺼번에 골라도 같다(고를 수 없는 역할이 섞여 있다)
    const mixed: Record<string, string> = {}
    FORMATIONS[3].rows.flat().forEach((_, index) => (mixed[`3-5-2:${index}`] = ROLES[(index * 5 + 3) % ROLES.length].id))
    expect(legacyTactic('3-5-2', mixed).slots.map((slot) => slot.ip.roleId)).toEqual(buildDepth([], [], FORMATION_BY_ID['3-5-2'], mixed, {}).map((slot) => slot.roleId))
  })

  it('legacyTactic: 두 국면이 같은 칸·같은 역할, 비중 100, 출처 legacy이고 검사를 통과한다. 모르는 포메이션은 맨 앞 포메이션이다', () => {
    for (const formation of FORMATIONS) {
      const tactic = legacyTactic(formation.id, {})
      expect(tactic).toMatchObject({ id: `legacy:${formation.id}`, name: formation.label, preset: formation.id, sharePct: 100, source: 'legacy', catalog: 'legacy14' })
      for (const slot of tactic.slots) {
        expect(slot.oop).toEqual(slot.ip)
        expect(slot.oop.cell).not.toBe(slot.ip.cell)
      }
      expect(validateTactic(tactic, LEGACY_CATALOG), formation.id).toEqual([])
      expect(tactic.slots.map((slot) => slot.ip.roleId)).toEqual(formation.rows.flat().map((position) => DEFAULT_ROLE[position]))
      // 프리셋과 자리 순서·칸이 같다
      expect(tactic.slots.map((slot) => slot.ip.cell)).toEqual(preset(formation.id).slots.map((slot) => slot.ip.cell))
    }
    // 열쇠는 실제로 쓴 포메이션(맨 앞)의 id로 만든다
    expect(legacyTactic('없는 포메이션', { '4-2-3-1:4': 'dlp' }).slots[4].ip.roleId).toBe('dlp')
    expect(legacyTactic('없는 포메이션', { '없는 포메이션:4': 'dlp' }).slots[4].ip.roleId).toBe('dm')
    expect(legacyTactic('없는 포메이션', {}).preset).toBe(FORMATIONS[0].id)
    // 상속된 이름(constructor)이 역할이나 포메이션 id로 와도 죽지 않는다
    expect(legacyTactic('constructor', { '4-2-3-1:4': 'constructor', '4-2-3-1:5': '__proto__' }).slots.slice(4, 6).map((slot) => slot.ip.roleId)).toEqual(['dm', 'dm'])
  })

  it('옛 분석의 화면 줄(DepthSlot.row)과 legacyTactic의 칸 배치(layoutRows)는 3-4-3만 다르다(옛 결과를 그대로 내려면 옛 포메이션의 줄을 쓴다)', () => {
    const rowsFromLayout = (tactic: Tactic): number[] => {
      const rows = new Array<number>(tactic.slots.length)
      layoutRows(tactic, 'ip').forEach((line, row) => line.forEach((index) => (rows[index] = row)))
      return rows
    }
    for (const formation of FORMATIONS) {
      const old = buildDepth([], [], formation, {}, {}).map((slot) => slot.row)
      const layout = rowsFromLayout(legacyTactic(formation.id, {}))
      if (formation.id === '3-4-3') {
        // 옛 줄은 측면 공격 둘과 최전방이 한 줄(0), 칸 배치는 최전방이 맨 위 줄(0), 측면 공격이 다음 줄(1)이다
        expect(old).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3, 3, 4])
        expect(layout).toEqual([1, 0, 1, 2, 2, 3, 3, 4, 4, 4, 5])
      } else {
        expect(layout, formation.id).toEqual(old)
      }
    }
  })

  it('canonicalOrder: 점유 시 줄 위(공격) → 아래, 칸 왼쪽 → 오른쪽. 프리셋은 3-4-3만 다르다', () => {
    for (const id of ['4-2-3-1', '4-3-3', '4-4-2', '3-5-2']) expect(canonicalOrder(preset(id)).slots, id).toEqual(preset(id).slots)
    expect(positionsOf(preset('3-4-3'))).toEqual(['AML', 'ST', 'AMR', 'MC', 'MC', 'WBL', 'WBR', 'DC', 'DC', 'DC', 'GK'])
    expect(positionsOf(canonicalOrder(preset('3-4-3')))).toEqual(['ST', 'AML', 'AMR', 'MC', 'MC', 'WBL', 'WBR', 'DC', 'DC', 'DC', 'GK'])
    // 섞어 놓아도 같은 순서가 나오고, 한 번 더 해도 같다
    for (const id of PRESET_IDS) {
      const shuffled: Tactic = { ...preset(id), slots: [...preset(id).slots].reverse() }
      expect(canonicalOrder(shuffled)).toEqual(canonicalOrder(preset(id)))
      expect(canonicalOrder(canonicalOrder(shuffled))).toEqual(canonicalOrder(shuffled))
    }
    // 입력을 바꾸지 않는다
    const frozen = deepFreeze(preset('3-4-3'))
    expect(canonicalOrder(frozen).slots).toHaveLength(TACTIC_SLOTS)
  })

  it('sharePctOf와 profileOf: 비중을 적지 않으면 대장 기본값, 프로파일은 두 국면의 포지션·역할과 비중이다', () => {
    const tactic = droppingWingers()
    expect(sharePctOf(tactic)).toBe(60)
    expect(sharePctOf({ ...tactic, sharePct: 70 })).toBe(70)
    expect(sharePctOf({ ...tactic, sharePct: 0 })).toBe(0)
    expect(profileOf(tactic, 1)).toEqual({ ip: { position: 'AML', roleId: 'if' }, oop: { position: 'ML', roleId: 'if' }, sharePct: 60 })
    expect(profileOf({ ...tactic, sharePct: 40 }, 7).sharePct).toBe(40)
    // 칸이 올바르지 않으면 다른 국면의 포지션으로 버틴다
    const broken = mutated(tactic, (copy) => (copy.slots[0].oop.cell = { line: 'ST', lane: 'L' }))
    expect(profileOf(broken, 0).oop.position).toBe('ST')
  })

  it('shareLabel(60)은 "공 소유 시 60 : 공 미소유 시 40"', () => {
    expect(shareLabel(60)).toBe('공 소유 시 60 : 공 미소유 시 40')
  })
})

describe('validateTactic: 저장하기 전 검사', () => {
  const custom = (id: string, phase: 'ip' | 'oop', positions: PositionKey[]): CustomRole => ({ id, phase, name: `사용자 ${id}`, positions, weights: { passing: 4 } })

  it('프리셋 5개와 옛 전술은 통과한다', () => {
    for (const id of PRESET_IDS) {
      expect(validateTactic(preset(id), LEGACY_CATALOG)).toEqual([])
      expect(validateTactic(legacyTactic(id, {}), LEGACY_CATALOG)).toEqual([])
    }
  })

  it('골키퍼 칸이 국면마다 정확히 하나여야 한다(0개, 2개 거절)', () => {
    const none = mutated(preset('4-2-3-1'), (copy) => (copy.slots[10].ip.cell = { line: 'ST', lane: 'CL' }))
    expect(validateTactic(none, LEGACY_CATALOG)).toContainEqual(expect.objectContaining({ code: 'goalkeeper', phase: 'ip' }))
    expect(validateTactic(none, LEGACY_CATALOG).some((problem) => problem.code === 'goalkeeper' && problem.phase === 'oop')).toBe(false)
    const two = mutated(preset('4-2-3-1'), (copy) => (copy.slots[7].oop.cell = { line: 'GK', lane: 'C' }))
    const codes = validateTactic(two, LEGACY_CATALOG)
    expect(codes).toContainEqual(expect.objectContaining({ code: 'goalkeeper', phase: 'oop' }))
    expect(codes).toContainEqual(expect.objectContaining({ code: 'overlap', phase: 'oop', index: 10 }))
  })

  it('골키퍼 자리는 두 국면 모두 골키퍼 칸이어야 한다(국면마다 골키퍼 칸이 하나씩이어도 자리가 다르면 거절)', () => {
    // 4-2-3-1의 10번 자리(골키퍼)와 7번 자리(중앙 수비)가 한 국면에서 칸과 역할을 맞바꾼다. 국면마다 따로 보면 골키퍼 칸 수, 역할과 칸, 겹침이 모두 맞다
    const swap = (phase: 'ip' | 'oop'): Tactic =>
      mutated(preset('4-2-3-1'), (copy) => {
        const keeper = copy.slots[10][phase]
        copy.slots[10][phase] = copy.slots[7][phase]
        copy.slots[7][phase] = keeper
      })
    for (const phase of ['ip', 'oop'] as const) {
      const other = phase === 'ip' ? 'oop' : 'ip'
      const tactic = swap(phase)
      expect(positionsOf(tactic, phase)[7], phase).toBe('GK')
      expect(positionsOf(tactic, other)[10], phase).toBe('GK')
      expect(tactic.slots[7][phase].roleId, phase).toBe('gk')
      expect(tactic.slots[10][phase].roleId, phase).toBe('cb')
      const problems = validateTactic(tactic, LEGACY_CATALOG)
      expect(problems.map((problem) => [problem.code, problem.index]), phase).toEqual([['goalkeeper', 7], ['goalkeeper', 10]])
      expect(problems[0].phase, phase).toBeUndefined()
      expect(problems[0].message, phase).toContain('8번째 자리')
      expect(problems[1].message, phase).toContain('11번째 자리')
      // 저장해 둔 묶음에 이런 전술이 있으면 분석을 돌릴 수 없는 것으로 보아 쓰지 않는다
      const set = { catalog: 'fm26', tactics: [{ ...tactic, catalog: 'fm26' as const }], mainId: tactic.id } satisfies TacticSet
      expect(resolveMainTactic(settingsOf({ formation: '3-5-2', tacticsDefault: set }), null, FAKE_FM26).id).toBe('preset:3-5-2')
    }
    // 두 국면 모두 같은 자리가 골키퍼이면 통과한다
    expect(validateTactic(preset('4-2-3-1'), LEGACY_CATALOG)).toEqual([])
    // 칸이 올바르지 않은 자리는 칸 문제(와 그 국면의 골키퍼 칸 수)로만 알리고, 골키퍼 자리 검사는 겹쳐 알리지 않는다
    const brokenCell = mutated(preset('4-2-3-1'), (copy) => (copy.slots[10].oop.cell = { line: 'ST', lane: 'L' }))
    expect(validateTactic(brokenCell, LEGACY_CATALOG).filter((problem) => problem.code === 'goalkeeper')).toEqual([expect.objectContaining({ phase: 'oop' })])
  })

  it('자리는 11개여야 한다(10개, 12개 거절)', () => {
    const base = preset('4-3-3')
    expect(codesOf(validateTactic({ ...base, slots: base.slots.slice(0, 10) }, LEGACY_CATALOG))).toContain('slotCount')
    expect(codesOf(validateTactic({ ...base, slots: [...base.slots, base.slots[0]] }, LEGACY_CATALOG))).toContain('slotCount')
    expect(codesOf(validateTactic({ ...base, slots: [] }, LEGACY_CATALOG))).toContain('slotCount')
  })

  it('한 국면에서 같은 칸에 자리 둘은 거절하고, 올바르지 않은 칸도 거절한다', () => {
    const overlap = mutated(preset('4-4-2'), (copy) => (copy.slots[2].ip.cell = { ...copy.slots[3].ip.cell }))
    expect(validateTactic(overlap, LEGACY_CATALOG)).toContainEqual(expect.objectContaining({ code: 'overlap', phase: 'ip', index: 3 }))
    // 점유 시와 비점유 시에 서로 다른 자리가 같은 칸을 쓰는 것은 괜찮다(국면마다 따로 센다)
    const swapped = mutated(preset('4-4-2'), (copy) => {
      const [a, b] = [copy.slots[3].oop.cell, copy.slots[4].oop.cell]
      copy.slots[3].oop.cell = b
      copy.slots[4].oop.cell = a
    })
    expect(validateTactic(swapped, LEGACY_CATALOG)).toEqual([])
    for (const cell of [{ line: 'ST', lane: 'L' }, { line: 'GK', lane: 'R' }, { line: '없는줄', lane: 'C' }, { line: 'D', lane: 'X' }, null]) {
      const bad = mutated(preset('4-4-2'), (copy) => ((copy.slots[0].oop as { cell: unknown }).cell = cell))
      expect(validateTactic(bad, LEGACY_CATALOG), JSON.stringify(cell)).toContainEqual(expect.objectContaining({ code: 'cell', phase: 'oop', index: 0 }))
    }
  })

  it('역할은 카탈로그에 있어야 하고, 그 국면에 쓸 수 있어야 한다(국면이 다른 역할 거절)', () => {
    const catalog = withCustomRoles(LEGACY_CATALOG, [custom('user.ip', 'ip', ['DC']), custom('user.oop', 'oop', ['DC'])])
    const base = preset('4-2-3-1')
    expect(validateTactic(mutated(base, (copy) => (copy.slots[7].ip.roleId = 'user.ip')), catalog)).toEqual([])
    expect(validateTactic(mutated(base, (copy) => (copy.slots[7].oop.roleId = 'user.oop')), catalog)).toEqual([])
    // 점유 시 전용 역할을 비점유 시에, 비점유 시 전용 역할을 점유 시에
    expect(validateTactic(mutated(base, (copy) => (copy.slots[7].oop.roleId = 'user.ip')), catalog)).toContainEqual(expect.objectContaining({ code: 'rolePhase', phase: 'oop', index: 7 }))
    expect(validateTactic(mutated(base, (copy) => (copy.slots[7].ip.roleId = 'user.oop')), catalog)).toContainEqual(expect.objectContaining({ code: 'rolePhase', phase: 'ip', index: 7 }))
    // 사용자 역할이 없는 카탈로그나 없는 역할 번호
    expect(codesOf(validateTactic(mutated(base, (copy) => (copy.slots[7].ip.roleId = 'user.ip')), LEGACY_CATALOG))).toContain('roleMissing')
    expect(codesOf(validateTactic(mutated(base, (copy) => (copy.slots[7].ip.roleId = '없는 역할')), LEGACY_CATALOG))).toContain('roleMissing')
  })

  it('그 칸에서 고를 수 없는 역할은 거절하고, 골키퍼 역할은 골키퍼 칸에만 놓을 수 있다', () => {
    const base = preset('4-2-3-1')
    // 중앙 수비(DC.pair) 자리에 윙어, 풀백(DL) 자리에 스트라이커
    expect(validateTactic(mutated(base, (copy) => (copy.slots[7].ip.roleId = 'winger')), LEGACY_CATALOG)).toContainEqual(expect.objectContaining({ code: 'roleChoice', phase: 'ip', index: 7 }))
    expect(codesOf(validateTactic(mutated(base, (copy) => (copy.slots[6].oop.roleId = 'st')), LEGACY_CATALOG))).toContain('roleChoice')
    // 고를 수 있는 다른 역할은 통과한다
    expect(validateTactic(mutated(base, (copy) => (copy.slots[7].ip.roleId = 'bpd')), LEGACY_CATALOG)).toEqual([])
    expect(validateTactic(mutated(base, (copy) => (copy.slots[4].oop.roleId = 'dlp')), LEGACY_CATALOG)).toEqual([])
    expect(validateTactic(mutated(base, (copy) => (copy.slots[7].ip.roleId = 'gk')), LEGACY_CATALOG)).toContainEqual(expect.objectContaining({ code: 'goalkeeperRole', index: 7 }))
    expect(validateTactic(mutated(base, (copy) => (copy.slots[10].oop.roleId = 'cb')), LEGACY_CATALOG)).toContainEqual(expect.objectContaining({ code: 'goalkeeperRole', phase: 'oop', index: 10 }))
  })

  it('비중은 null이거나 0~100 정수여야 한다(101, -1, 1.5 거절)', () => {
    const base = preset('4-2-3-1')
    for (const share of [null, 0, 1, 60, 99, 100]) expect(validateTactic({ ...base, sharePct: share }, LEGACY_CATALOG), `${share}`).toEqual([])
    for (const share of [101, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '60', undefined]) {
      expect(codesOf(validateTactic({ ...base, sharePct: share as number }, LEGACY_CATALOG)), `${String(share)}`).toEqual(['share'])
    }
  })

  it('이름은 1~40글자여야 한다(너무 길거나 빈 이름 거절)', () => {
    const base = preset('4-2-3-1')
    expect(validateTactic({ ...base, name: '가'.repeat(TACTIC_NAME_MAX) }, LEGACY_CATALOG)).toEqual([])
    expect(codesOf(validateTactic({ ...base, name: '가'.repeat(TACTIC_NAME_MAX + 1) }, LEGACY_CATALOG))).toEqual(['name'])
    for (const name of ['', '   ', undefined]) expect(codesOf(validateTactic({ ...base, name: name as string }, LEGACY_CATALOG)), `${String(name)}`).toEqual(['name'])
  })

  it('전술의 카탈로그가 지금 쓰는 카탈로그와 다르거나 출처가 이상하면 거절한다', () => {
    expect(codesOf(validateTactic(preset('4-4-2'), FAKE_FM26))).toContain('catalog')
    expect(codesOf(validateTactic({ ...preset('4-4-2'), source: '몰라' as never }, LEGACY_CATALOG))).toEqual(['source'])
    expect(codesOf(validateTactic({ ...preset('4-4-2'), id: '' }, LEGACY_CATALOG))).toEqual(['id'])
  })

  it('모양이 틀린 입력에도 죽지 않는다', () => {
    for (const garbage of [null, undefined, 7, 'x', {}, { slots: 'x' }, { slots: [null] }, { slots: [{}] }]) {
      expect(() => validateTactic(garbage as never, LEGACY_CATALOG), JSON.stringify(garbage)).not.toThrow()
      expect(validateTactic(garbage as never, LEGACY_CATALOG).length, JSON.stringify(garbage)).toBeGreaterThan(0)
    }
    // FM26 카탈로그로 옛 역할 번호를 가진 전술을 검사해도(자료를 채우기 전이나 뒤나) 죽지 않고 역할을 찾지 못한다고 답한다
    expect(codesOf(validateTactic({ ...preset('4-4-2'), catalog: 'fm26' }, FM26_CATALOG))).toContain('roleMissing')
  })
})

describe('validateTacticSet와 묶음을 고치는 순수 함수', () => {
  const makeSet = (): TacticSet => ({ catalog: 'legacy14', tactics: [preset('4-2-3-1', LEGACY_CATALOG, 'a')], mainId: 'a' })
  const third = (): TacticSet => addTactic(addTactic(makeSet(), preset('4-3-3', LEGACY_CATALOG, 'b')), preset('4-4-2', LEGACY_CATALOG, 'c'))

  it('전술 1~3개, 번호가 겹치지 않음, 주 전술이 묶음 안, 같은 카탈로그일 때만 통과한다', () => {
    expect(validateTacticSet(makeSet(), LEGACY_CATALOG)).toEqual([])
    expect(validateTacticSet(third(), LEGACY_CATALOG)).toEqual([])
    expect(third().tactics).toHaveLength(TACTICS_PER_SAVE)
    const four = { ...third(), tactics: [...third().tactics, preset('3-5-2', LEGACY_CATALOG, 'd')] }
    expect(codesOf(validateTacticSet(four, LEGACY_CATALOG))).toEqual(['tacticCount'])
    expect(codesOf(validateTacticSet({ ...makeSet(), tactics: [] }, LEGACY_CATALOG))).toEqual(expect.arrayContaining(['tacticCount', 'mainId']))
    expect(codesOf(validateTacticSet({ ...third(), tactics: [preset('4-4-2', LEGACY_CATALOG, 'a'), preset('4-3-3', LEGACY_CATALOG, 'a')], mainId: 'a' }, LEGACY_CATALOG))).toEqual(['duplicateId'])
    expect(codesOf(validateTacticSet({ ...makeSet(), mainId: '없는 전술' }, LEGACY_CATALOG))).toEqual(['mainId'])
    expect(codesOf(validateTacticSet({ ...makeSet(), catalog: 'fm26' }, LEGACY_CATALOG))).toEqual(['catalog'])
  })

  it('전술 안의 문제는 전술 이름을 붙여 알린다. 모양이 틀린 입력에도 죽지 않는다', () => {
    const broken = { ...makeSet(), tactics: [mutated(preset('4-2-3-1', LEGACY_CATALOG, 'a'), (copy) => (copy.slots[7].ip.roleId = 'winger'))] }
    const problems = validateTacticSet(broken, LEGACY_CATALOG)
    expect(codesOf(problems)).toEqual(['roleChoice'])
    expect(problems[0].message.startsWith('“4-2-3-1” ')).toBe(true)
    for (const garbage of [null, undefined, {}, { tactics: 'x' }, { tactics: [null], mainId: 'a' }]) {
      expect(() => validateTacticSet(garbage as never, LEGACY_CATALOG)).not.toThrow()
      expect(validateTacticSet(garbage as never, LEGACY_CATALOG).length).toBeGreaterThan(0)
    }
  })

  it('고치는 함수는 입력을 바꾸지 않는다(깊게 얼린 입력에 모두 불러 본다)', () => {
    const frozen = deepFreeze(third())
    const copy = structuredClone(frozen)
    const results = [
      withSlotRole(frozen, 'a', 7, 'ip', 'bpd'),
      withShare(frozen, 'b', 70),
      withPreset(frozen, 'a', '3-5-2', LEGACY_CATALOG),
      addTactic(frozen, preset('3-4-3', LEGACY_CATALOG, 'z')),
      removeTactic(frozen, 'a'),
      renameTactic(frozen, 'c', ' 새 이름 '),
      setMainTactic(frozen, 'c'),
      copyTactic(frozen, 'a', 'z', '복사')
    ]
    expect(frozen).toEqual(copy)
    expect(results).toHaveLength(8)
  })

  it('withSlotRole: 그 전술의 그 자리의 그 국면 역할만 바뀐다', () => {
    const set = third()
    const next = withSlotRole(set, 'b', 7, 'oop', 'bpd')
    expect(next.tactics[1].slots[7].oop.roleId).toBe('bpd')
    expect(next.tactics[1].slots[7].ip.roleId).toBe('cb')
    expect(next.tactics[1].slots[6]).toBe(set.tactics[1].slots[6])
    expect(next.tactics[0]).toBe(set.tactics[0])
    expect(next.tactics[2]).toBe(set.tactics[2])
    expect(validateTacticSet(next, LEGACY_CATALOG)).toEqual([])
    // 없는 전술, 없는 자리, 이상한 국면은 그대로 돌려준다
    expect(withSlotRole(set, '없는 전술', 0, 'ip', 'bpd')).toBe(set)
    expect(withSlotRole(set, 'a', 99, 'ip', 'bpd').tactics[0]).toBe(set.tactics[0])
    expect(withSlotRole(set, 'a', 0, '몰라' as never, 'bpd').tactics[0]).toBe(set.tactics[0])
  })

  it('withShare: 비중을 바꾸거나 null로 되돌린다', () => {
    const next = withShare(third(), 'a', 70)
    expect(next.tactics[0].sharePct).toBe(70)
    expect(withShare(next, 'a', null).tactics[0].sharePct).toBeNull()
    expect(withShare(third(), '없는 전술', 70).tactics.map((tactic) => tactic.sharePct)).toEqual([null, null, null])
  })

  it('withPreset: 자리와 역할을 새 프리셋의 기본으로 바꾸고 번호·비중은 지킨다. 이름은 프리셋 이름 그대로였을 때만 따라 바뀐다', () => {
    const set = withShare(third(), 'a', 70)
    const next = withPreset(set, 'a', '3-5-2', LEGACY_CATALOG)
    expect(next.tactics[0]).toMatchObject({ id: 'a', name: '3-5-2', preset: '3-5-2', sharePct: 70, source: 'preset' })
    expect(positionsOf(next.tactics[0])).toEqual(FORMATION_BY_ID['3-5-2'].rows.flat())
    expect(validateTacticSet(next, LEGACY_CATALOG)).toEqual([])
    // 사용자가 이름을 바꿔 두었으면 지킨다
    const renamed = renameTactic(set, 'a', '내 전술')
    expect(withPreset(renamed, 'a', '4-4-2', LEGACY_CATALOG).tactics[0].name).toBe('내 전술')
    // 모르는 프리셋과 없는 전술은 그대로 둔다
    expect(withPreset(set, 'a', '9-9-9', LEGACY_CATALOG)).toBe(set)
    expect(withPreset(set, '없는 전술', '4-4-2', LEGACY_CATALOG)).toBe(set)
  })

  it('addTactic: 3개까지. 4개째와 같은 번호는 더하지 않고 그대로 돌려준다', () => {
    const set = makeSet()
    const two = addTactic(set, preset('4-3-3', LEGACY_CATALOG, 'b'))
    expect(two.tactics.map((tactic) => tactic.id)).toEqual(['a', 'b'])
    expect(addTactic(two, preset('4-4-2', LEGACY_CATALOG, 'b'))).toBe(two)
    const full = addTactic(two, preset('4-4-2', LEGACY_CATALOG, 'c'))
    expect(full.tactics).toHaveLength(TACTICS_PER_SAVE)
    expect(addTactic(full, preset('3-5-2', LEGACY_CATALOG, 'd'))).toBe(full)
    expect(full.mainId).toBe('a')
  })

  it('removeTactic: 마지막 하나는 지우지 않고, 주 전술을 지우면 남은 첫 전술이 주 전술이 된다', () => {
    const set = third()
    expect(removeTactic(set, 'b').tactics.map((tactic) => tactic.id)).toEqual(['a', 'c'])
    expect(removeTactic(set, 'b').mainId).toBe('a')
    const main = removeTactic(set, 'a')
    expect(main.tactics.map((tactic) => tactic.id)).toEqual(['b', 'c'])
    expect(main.mainId).toBe('b')
    expect(removeTactic(set, '없는 전술')).toBe(set)
    const one = removeTactic(removeTactic(set, 'b'), 'c')
    expect(one.tactics.map((tactic) => tactic.id)).toEqual(['a'])
    expect(removeTactic(one, 'a')).toBe(one)
    // 지운 뒤에도 주 전술은 묶음 안에 있다
    for (const id of ['a', 'b', 'c']) expect(removeTactic(set, id).tactics.some((tactic) => tactic.id === removeTactic(set, id).mainId)).toBe(true)
  })

  it('renameTactic, setMainTactic, copyTactic', () => {
    const set = third()
    expect(renameTactic(set, 'b', '  측면 공격  ').tactics[1].name).toBe('측면 공격')
    expect(renameTactic(set, '없는 전술', '이름')).toBe(set)
    expect(setMainTactic(set, 'c').mainId).toBe('c')
    expect(setMainTactic(set, '없는 전술')).toBe(set)
    const two = removeTactic(set, 'c')
    const copied = copyTactic(two, 'a', 'z', '  4-2-3-1 복사 ')
    expect(copied.tactics.map((tactic) => [tactic.id, tactic.name])).toEqual([['a', '4-2-3-1'], ['b', '4-3-3'], ['z', '4-2-3-1 복사']])
    expect(copied.tactics[2].slots).toEqual(set.tactics[0].slots)
    expect(copied.tactics[2].slots).not.toBe(set.tactics[0].slots)
    expect(copied.tactics[2]).toMatchObject({ preset: '4-2-3-1', source: 'preset', sharePct: null })
    // 3개가 찼거나 번호가 겹치거나 없는 전술이면 더하지 않는다
    expect(copyTactic(set, 'a', 'z', '복사')).toBe(set)
    expect(copyTactic(two, 'a', 'b', '복사')).toBe(two)
    expect(copyTactic(two, '없는 전술', 'z', '복사')).toBe(two)
  })
})

describe('저장 열쇠와 주 전술 고르기', () => {
  it('saveKeyOf: 세이브 파일 이름(saveTeams와 같은 열쇠)', () => {
    expect(saveKeyOf('C:\\세이브\\가온 시티 2025.fm')).toBe('가온 시티 2025.fm')
    expect(saveKeyOf('C:/세이브/가온 시티 2025.fm')).toBe('가온 시티 2025.fm')
    expect(saveKeyOf('/home/me/games/a.fm')).toBe('a.fm')
    expect(saveKeyOf('a.fm')).toBe('a.fm')
    for (const none of [null, undefined, '', 'C:\\세이브\\', 7 as never]) expect(saveKeyOf(none), String(none)).toBeNull()
  })

  it('옛 카탈로그의 resolveMainTactic은 legacyTactic(formation, slotRoles)이고, 저장해 둔 전술은 보지 않는다', () => {
    const slotRoles = { '4-3-3:7': 'bpd', '4-3-3:9': 'wb' }
    const settings = settingsOf({ formation: '4-3-3', slotRoles, tactics: { 'a.fm': { catalog: 'fm26', tactics: [preset('4-4-2', FAKE_FM26, 'x')], mainId: 'x' } } })
    expect(resolveMainTactic(settings, 'a.fm', LEGACY_CATALOG)).toEqual(legacyTactic('4-3-3', slotRoles))
    expect(resolveMainTactic(settings, null, LEGACY_CATALOG)).toEqual(legacyTactic('4-3-3', slotRoles))
    expect(currentSet(settings, 'a.fm', LEGACY_CATALOG)).toEqual({ catalog: 'legacy14', tactics: [legacyTactic('4-3-3', slotRoles)], mainId: 'legacy:4-3-3' })
    // 모르는 포메이션도 옛 분석처럼 맨 앞 포메이션이다
    expect(resolveMainTactic(settingsOf({ formation: '없는 포메이션' }), null, LEGACY_CATALOG)).toEqual(legacyTactic('4-2-3-1', {}))
  })

  it('FM26이면 그 세이브 묶음 → 기본 묶음 → 옛 포메이션의 프리셋 순서로 고른다', () => {
    const own = { catalog: 'fm26', tactics: [preset('4-4-2', FAKE_FM26, 'own1'), preset('3-5-2', FAKE_FM26, 'own2')], mainId: 'own2' } satisfies TacticSet
    const fallback = { catalog: 'fm26', tactics: [preset('4-3-3', FAKE_FM26, 'def')], mainId: 'def' } satisfies TacticSet
    const settings = settingsOf({ formation: '3-4-3', tactics: { 'a.fm': own }, tacticsDefault: fallback })
    expect(resolveMainTactic(settings, 'a.fm', FAKE_FM26).id).toBe('own2')
    expect(currentSet(settings, 'a.fm', FAKE_FM26)).toBe(own)
    // 묶음이 없는 세이브와 세이브를 모를 때는 기본 묶음
    expect(resolveMainTactic(settings, 'b.fm', FAKE_FM26).id).toBe('def')
    expect(resolveMainTactic(settings, null, FAKE_FM26).id).toBe('def')
    // 아무것도 없으면 옛 포메이션의 프리셋
    const none = resolveMainTactic(settingsOf({ formation: '3-4-3' }), 'a.fm', FAKE_FM26)
    expect(none).toEqual(preset('3-4-3', FAKE_FM26))
    expect(currentSet(settingsOf({ formation: '3-4-3' }), null, FAKE_FM26)).toEqual({ catalog: 'fm26', tactics: [none], mainId: none.id })
    // 주 전술 번호가 가리키는 전술을 고르고, 상속된 이름(constructor)이 세이브 이름이어도 죽지 않는다
    expect(resolveMainTactic(settingsOf({ tacticsDefault: fallback }), 'constructor', FAKE_FM26).id).toBe('def')
  })

  it('저장해 둔 묶음이 다른 카탈로그 것이거나 분석을 돌릴 수 없게 깨졌으면 쓰지 않는다', () => {
    const wrongCatalog = { catalog: 'legacy14', tactics: [preset('4-4-2', LEGACY_CATALOG, 'x')], mainId: 'x' } satisfies TacticSet
    expect(resolveMainTactic(settingsOf({ tacticsDefault: wrongCatalog }), null, FAKE_FM26)).toEqual(preset('4-2-3-1', FAKE_FM26))
    const tenSlots = mutated(preset('4-4-2', FAKE_FM26, 'x'), (copy) => copy.slots.pop())
    expect(resolveMainTactic(settingsOf({ tacticsDefault: { catalog: 'fm26', tactics: [tenSlots], mainId: 'x' } }), null, FAKE_FM26).id).toBe('preset:4-2-3-1')
    const lostMain = { catalog: 'fm26', tactics: [preset('4-4-2', FAKE_FM26, 'x')], mainId: '없는 전술' } satisfies TacticSet
    expect(resolveMainTactic(settingsOf({ tacticsDefault: lostMain }), null, FAKE_FM26).id).toBe('preset:4-2-3-1')
    // 역할을 그 칸에서 고를 수 없는 것쯤은 점수를 계산할 수 있으므로 저장해 둔 전술을 그대로 쓴다
    const oddRole = mutated(preset('4-4-2', FAKE_FM26, 'x'), (copy) => (copy.slots[7].ip.roleId = 'winger'))
    expect(resolveMainTactic(settingsOf({ tacticsDefault: { catalog: 'fm26', tactics: [oddRole], mainId: 'x' } }), null, FAKE_FM26)).toEqual(oddRole)
    // 모양이 아예 틀려도 죽지 않는다
    expect(() => resolveMainTactic(settingsOf({ tacticsDefault: { catalog: 'fm26', tactics: 'x' } as never }), null, FAKE_FM26)).not.toThrow()
  })

  it('그 세이브의 묶음을 쓸 수 없으면 기본 묶음을, 그것도 쓸 수 없으면 프리셋을 쓴다(세이브 묶음 → 기본 묶음 → 프리셋)', () => {
    const tenSlots = { catalog: 'fm26', tactics: [mutated(preset('4-4-2', FAKE_FM26, 'bad'), (copy) => copy.slots.pop())], mainId: 'bad' } satisfies TacticSet
    const wrongCatalog = { catalog: 'legacy14', tactics: [preset('4-4-2', LEGACY_CATALOG, 'old')], mainId: 'old' } satisfies TacticSet
    const lostMain = { catalog: 'fm26', tactics: [preset('4-4-2', FAKE_FM26, 'x')], mainId: '없는 전술' } satisfies TacticSet
    const empty = { catalog: 'fm26', tactics: [], mainId: 'x' } satisfies TacticSet
    const fallback = { catalog: 'fm26', tactics: [preset('4-3-3', FAKE_FM26, 'def')], mainId: 'def' } satisfies TacticSet
    const healthy = { catalog: 'fm26', tactics: [preset('4-4-2', FAKE_FM26, 'own')], mainId: 'own' } satisfies TacticSet
    for (const [name, own] of Object.entries({ tenSlots, wrongCatalog, lostMain, empty, nothing: null as never, text: 'x' as never })) {
      const settings = settingsOf({ formation: '3-5-2', tactics: { 'a.fm': own }, tacticsDefault: fallback })
      expect(currentSet(settings, 'a.fm', FAKE_FM26), name).toBe(fallback)
      // 기본 묶음도 쓸 수 없거나 없으면 옛 포메이션의 프리셋이다
      expect(resolveMainTactic({ ...settings, tacticsDefault: tenSlots }, 'a.fm', FAKE_FM26), name).toEqual(preset('3-5-2', FAKE_FM26))
      expect(resolveMainTactic({ ...settings, tacticsDefault: undefined }, 'a.fm', FAKE_FM26), name).toEqual(preset('3-5-2', FAKE_FM26))
    }
    // 멀쩡한 세이브 묶음은 기본 묶음보다 먼저다
    expect(currentSet(settingsOf({ tactics: { 'a.fm': healthy }, tacticsDefault: fallback }), 'a.fm', FAKE_FM26)).toBe(healthy)
    // 다른 세이브의 묶음이 깨져 있어도 이 세이브에는 상관없다
    expect(currentSet(settingsOf({ tactics: { 'a.fm': tenSlots }, tacticsDefault: fallback }), 'b.fm', FAKE_FM26)).toBe(fallback)
  })

  it('legacySlotRolePatch: 옛 화면이 하던 대로 slotRoles의 `포메이션:순번` 칸을 고치는 조각이다', () => {
    const settings = settingsOf({ formation: '4-3-3', slotRoles: { '4-3-3:3': 'dlp' } })
    const patch = legacySlotRolePatch(settings, '4-3-3', 7, 'bpd')
    expect(patch).toEqual({ slotRoles: { '4-3-3:3': 'dlp', '4-3-3:7': 'bpd' } })
    // 입력 설정은 그대로이고, 조각을 적용하면 주 전술에 반영된다
    expect(settings.slotRoles).toEqual({ '4-3-3:3': 'dlp' })
    const after = { ...settings, ...patch }
    const tactic = resolveMainTactic(after, null, LEGACY_CATALOG)
    expect(tactic.slots[7].ip.roleId).toBe('bpd')
    expect(tactic.slots[3].ip.roleId).toBe('dlp')
    // 모르는 포메이션이나 없는 자리는 아무것도 바꾸지 않는다
    expect(legacySlotRolePatch(settings, '없는 포메이션', 0, 'cb')).toEqual({})
    expect(legacySlotRolePatch(settings, 'constructor', 0, 'cb')).toEqual({})
    for (const index of [-1, 11, 1.5, Number.NaN]) expect(legacySlotRolePatch(settings, '4-3-3', index, 'cb'), `${index}`).toEqual({})
  })

  it('프리셋이 쓰는 칸은 모두 앱의 포지션이 되고, 전술은 JSON으로 저장했다 읽어도 같다', () => {
    const seen = new Set<PositionKey>()
    for (const id of PRESET_IDS) for (const position of positionsOf(preset(id))) seen.add(position!)
    expect(seen.size).toBeGreaterThan(10)
    expect([...seen].every((position) => POSITIONS.includes(position))).toBe(true)
    for (const id of PRESET_IDS) {
      const tactic = preset(id)
      expect(JSON.parse(JSON.stringify(tactic))).toEqual(tactic)
    }
  })
})
