/**
 * 전술 추천 탐색(2단계 U8, A-20): 지금 전술과 프리셋 5개를 시작점으로 자리마다 주전에게 가장 맞는 (공 소유 시, 공 미소유 시) 역할 짝을 찾아
 * 순위로 견주고, 지금 전술의 자리별 제안을 낸다. 지어낸 선수단 56명과 고정 기준 분포로 돈다(세이브와 게임을 읽지 않는다).
 *
 * 받아들이는 조건: 1위의 목적 값은 지금 전술 이상이다, 두 번 돌려도 깊게 같고 선수 줄 순서를 섞어도 같다, 정해진 횟수 안에서 멈춘다,
 * 자리별 제안의 이득은 따로 구한 목적 값의 차이와 같다. 그 밖에 짝 고르기의 규칙(동점이면 지금 짝, 그다음 카탈로그 순서, 사용자 역할 제외),
 * 기준 분포를 빠짐없이 받는 것, 게임에서 확인 전인 역할을 세는 것, 옛 14역할 카탈로그에서도 도는 것을 본다.
 */
import { describe, expect, it } from 'vitest'
import { FM26_CATALOG } from '../src/shared/catalogFm26'
import { buildDepthFor, depthObjective } from '../src/shared/depth'
import { K, withLedger } from '../src/shared/ledger'
import { SEARCH_MAX_ROUNDS, TACTIC_NAME_MAX } from '../src/shared/limits'
import { FALLBACK_NORM, type RoleNorms } from '../src/shared/norms'
import { LEGACY_CATALOG, withCustomRoles, type CatalogRole, type CustomRole, type Evidence, type RoleCatalog } from '../src/shared/roleCatalog'
import type { PositionKey } from '../src/shared/roles'
import type { Phase, SlotProfile, Weights } from '../src/shared/slotProfile'
import { blockingProblems, cellPosition, legacyTactic, PRESET_IDS, presetTactic, profileOf, slotKindOf, validateTactic, type Lane, type Line, type Tactic } from '../src/shared/tacticModel'
import { improveStart, RECOMMEND_NOTE, searchTactics, searchTacticsSteps, type SearchInput } from '../src/shared/tacticSearch'
import { fixedNorms, flatNorms, SEARCH_COLUMNS, searchSquad, soloSquad } from './helpers/searchSquad'

const catalog = FM26_CATALOG
const squad = searchSquad()

function input(over: Partial<SearchInput> = {}): SearchInput {
  const cat = over.catalog ?? catalog
  return {
    rows: squad,
    columns: SEARCH_COLUMNS,
    catalog: cat,
    overrides: {},
    current: presetTactic('4-2-3-1', cat),
    presets: PRESET_IDS.map((id) => presetTactic(id, cat)),
    normsFor: fixedNorms(cat),
    maxRounds: SEARCH_MAX_ROUNDS,
    ...over
  }
}

const profilesOf = (tactic: Tactic): SlotProfile[] => tactic.slots.map((_, index) => profileOf(tactic, index))

/** 탐색과 따로, 배정 엔진에 고정 기준 분포를 직접 줘서 구한 목적 값(후보 선수 2명까지 붙여 구해 후보 수가 값에 영향이 없다는 것도 함께 본다) */
function objectiveOf(tactic: Tactic, cat: RoleCatalog = catalog, rows = squad, norms?: RoleNorms) {
  const used = norms ?? fixedNorms(cat)(profilesOf(tactic))
  return depthObjective(buildDepthFor(rows, SEARCH_COLUMNS, tactic, { catalog: cat, overrides: {}, norms: used }, 2))
}

/** 같은 모양인가(이름·번호·출처는 보지 않는다): 자리마다 두 국면의 칸과 역할, 비중 */
const shapeOf = (tactic: Tactic): unknown => [tactic.sharePct, tactic.slots.map((slot) => [slot.ip.cell, slot.ip.roleId, slot.oop.cell, slot.oop.roleId])]

describe('순위: 지금 전술도 목록에 있고, 1위의 목적 값은 지금 전술 이상이다', () => {
  const currents: Array<[string, Tactic]> = [
    ['4-2-3-1 기본', presetTactic('4-2-3-1', catalog)],
    ['3-5-2 기본', presetTactic('3-5-2', catalog)],
    ['4-3-3 비중 40', { ...presetTactic('4-3-3', catalog), sharePct: 40 }],
    ['4-4-2 비중 100', { ...presetTactic('4-4-2', catalog), sharePct: 100 }],
    ['3-4-3 비중 0', { ...presetTactic('3-4-3', catalog), sharePct: 0 }]
  ]

  it.each(currents)('%s', (_name, current) => {
    const out = searchTactics(input({ current }))
    const now = out.ranked.filter((candidate) => candidate.current)
    expect(now).toHaveLength(1)
    // 지금 전술은 바꾸지 않은 모습 그대로 들어가고, 목적 값은 엔진으로 따로 구한 값과 끝자리까지 같다
    expect(now[0].tactic).toBe(current)
    expect(now[0].objective).toBe(objectiveOf(current).objective)
    // 1위는 지금 전술 이상이고, 목적 값이 큰 순서다
    expect(out.ranked[0].objective).toBeGreaterThanOrEqual(now[0].objective)
    for (let at = 1; at < out.ranked.length; at++) expect(out.ranked[at - 1].objective).toBeGreaterThanOrEqual(out.ranked[at].objective)
    // 같은 모양의 전술은 한 번만 나온다
    const shapes = out.ranked.map((candidate) => JSON.stringify(shapeOf(candidate.tactic)))
    expect(new Set(shapes).size).toBe(shapes.length)
  })

  it('나머지 후보는 저장할 수 있는 전술이고, 목적 값·채운 자리·주전 전력 합이 엔진으로 따로 구한 값과 같다', () => {
    const current = presetTactic('4-2-3-1', catalog)
    const out = searchTactics(input({ current }))
    expect(out.ranked.length).toBeGreaterThan(1)
    const ids = new Set<string>()
    for (const candidate of out.ranked) {
      const { tactic } = candidate
      expect(blockingProblems(validateTactic(tactic, catalog)), tactic.name).toEqual([])
      const check = objectiveOf(tactic)
      expect({ objective: candidate.objective, strength: candidate.strength, filled: candidate.filled, temporary: candidate.temporary }, tactic.name).toEqual(check)
      expect(Array.from(tactic.name).length).toBeLessThanOrEqual(TACTIC_NAME_MAX)
      if (candidate.current) continue
      expect(tactic.id).toMatch(/^search:/)
      expect(tactic.source).toBe('user')
      expect(tactic.catalog).toBe('fm26')
      expect(tactic.sharePct).toBe(current.sharePct)
      expect(ids.has(tactic.id)).toBe(false)
      ids.add(tactic.id)
    }
  })

  it('역할 짝만 바뀐다: 자리 수, 자리마다 두 국면의 칸, 비중은 시작 전술 그대로다', () => {
    const current = presetTactic('3-5-2', catalog)
    const out = searchTactics(input({ current }))
    const fromCurrent = out.ranked.find((candidate) => candidate.tactic.id === 'search:current')
    // 이 선수단과 고정 기준 분포에서는 지금 전술의 역할도 나아진다
    expect(fromCurrent).toBeDefined()
    expect(fromCurrent!.objective).toBeGreaterThan(out.ranked.find((candidate) => candidate.current)!.objective)
    expect(fromCurrent!.tactic.slots.map((slot) => [slot.ip.cell, slot.oop.cell])).toEqual(current.slots.map((slot) => [slot.ip.cell, slot.oop.cell]))
    expect(fromCurrent!.tactic.slots.some((slot, index) => slot.ip.roleId !== current.slots[index].ip.roleId || slot.oop.roleId !== current.slots[index].oop.roleId)).toBe(true)
    expect(fromCurrent!.tactic.name).toBe(`${current.name} (추천 역할)`)
    expect(fromCurrent!.tactic.preset).toBe(current.preset)
  })

  it('지금 전술의 이름이 길어도 추천 이름은 이름 한도 안이다', () => {
    const long = { ...presetTactic('4-4-2', catalog), name: '가'.repeat(TACTIC_NAME_MAX) }
    const out = searchTactics(input({ current: long }))
    for (const candidate of out.ranked) expect(Array.from(candidate.tactic.name).length).toBeLessThanOrEqual(TACTIC_NAME_MAX)
  })

  it('지금 전술이 프리셋과 같은 모양이면 그 프리셋은 한 번만 돌린다(시작점이 하나 줄어든다)', () => {
    const steps = searchTacticsSteps(input({ current: presetTactic('4-4-2', catalog) }))
    const seen: number[] = []
    let step = steps.next()
    while (!step.done) {
      expect(step.value.total).toBe(PRESET_IDS.length)
      seen.push(step.value.done)
      step = steps.next()
    }
    expect(seen).toEqual([1, 2, 3, 4, 5])
  })

  it('고정 문구', () => {
    expect(RECOMMEND_NOTE).toBe('선수에게 맞는 전술이라는 뜻이지, 강한 전술이라는 뜻은 아닙니다.')
  })
})

describe('같은 입력은 늘 같은 결과이고, 선수 줄 순서에 기대지 않는다', () => {
  it('두 번 돌려도 깊게 같다', () => {
    expect(searchTactics(input())).toEqual(searchTactics(input()))
  })

  it('선수 줄 순서를 섞거나 뒤집어도 같다(배정이 선수 번호 순으로 정한다)', () => {
    const base = searchTactics(input())
    expect(searchTactics(input({ rows: searchSquad(31, true) }))).toEqual(base)
    expect(searchTactics(input({ rows: [...squad].reverse() }))).toEqual(base)
  })

  it('기준 분포를 시작점마다 받는 것이든 한 번에 받는 것이든 같은 열쇠는 같은 값이라 결과가 같다', () => {
    const per = fixedNorms(catalog)
    const lazy = (profiles: SlotProfile[]): RoleNorms => per(profiles.slice().reverse())
    expect(searchTactics(input({ normsFor: lazy }))).toEqual(searchTactics(input()))
  })

  it('시작점마다 양보할 수 있게 진행을 내놓고, 끝에 내놓는 결과는 한 번에 끝까지 돌린 것과 같다', () => {
    // 프리셋과 모양이 같은 지금 전술(기본 4-2-3-1)은 그 프리셋과 한 번만 돌아 시작점이 5개이고, 한 자리 역할이 다르면 6개다
    const base = presetTactic('4-2-3-1', catalog)
    const other = catalog.choicesAt('ST', 'ip', 'ST.single').find((choice) => choice.roleId !== base.slots[0].ip.roleId)!.roleId
    const custom: Tactic = { ...base, slots: base.slots.map((slot, at) => (at === 0 ? { ...slot, ip: { ...slot.ip, roleId: other } } : slot)) }
    const steps = searchTacticsSteps(input({ current: custom }))
    const progress: Array<{ done: number; total: number }> = []
    let step = steps.next()
    while (!step.done) {
      progress.push(step.value)
      step = steps.next()
    }
    expect(progress.map((each) => each.done)).toEqual(progress.map((_, at) => at + 1))
    expect(progress.every((each) => each.total === progress.length)).toBe(true)
    expect(progress).toHaveLength(1 + PRESET_IDS.length)
    expect(step.value).toEqual(searchTactics(input({ current: custom })))
  })

  it('입력을 바꾸지 않는다', () => {
    const args = input()
    const before = JSON.stringify([args.current, args.presets, args.rows.map((row) => [row.idx, row.ratings])])
    searchTactics(args)
    expect(JSON.stringify([args.current, args.presets, args.rows.map((row) => [row.idx, row.ratings])])).toBe(before)
  })

  it('선수가 없어도 던지지 않는다: 채운 자리 0, 제안 없음', () => {
    const out = searchTactics(input({ rows: [] }))
    expect(out.suggestions).toEqual([])
    expect(out.ranked[0].filled).toBe(0)
    expect(out.ranked.find((candidate) => candidate.current)).toBeDefined()
  })
})

describe('정해진 횟수 안에서 멈춘다', () => {
  const current = presetTactic('4-2-3-1', catalog)

  it.each([0, 1, 2, 3, SEARCH_MAX_ROUNDS])('최대 %i번: 다시 배정해 본 횟수가 그 안이고, 목적 값은 시작 이상이다', (maxRounds) => {
    for (const start of [current, ...PRESET_IDS.map((id) => presetTactic(id, catalog))]) {
      const run = improveStart(input({ maxRounds }), start)
      expect(run.rounds).toBeLessThanOrEqual(maxRounds)
      expect(run.objective).toBeGreaterThanOrEqual(run.startObjective)
      if (maxRounds === 0) {
        expect(run.rounds).toBe(0)
        expect(shapeOf(run.tactic)).toEqual(shapeOf(start))
      }
    }
  })

  it('횟수를 늘리면 목적 값은 줄지 않는다', () => {
    const values = [0, 1, 2, 3, 6, SEARCH_MAX_ROUNDS].map((maxRounds) => improveStart(input({ maxRounds }), current).objective)
    for (let at = 1; at < values.length; at++) expect(values[at]).toBeGreaterThanOrEqual(values[at - 1])
    expect(values[values.length - 1]).toBeGreaterThan(values[0])
  })

  it('횟수가 넉넉하면 목적 값이 더 오르지 않을 때 스스로 멈춘다: 끝난 전술에서 다시 돌려도 오르지 않는다', () => {
    const run = improveStart(input({ maxRounds: 1000 }), current)
    expect(run.rounds).toBeLessThan(1000)
    expect(run.rounds).toBeLessThanOrEqual(SEARCH_MAX_ROUNDS)
    const again = improveStart(input({ maxRounds: 1000 }), run.tactic)
    expect(again.objective).toBe(run.objective)
    expect(shapeOf(again.tactic)).toEqual(shapeOf(run.tactic))
  })

  it('음수·소수·숫자가 아닌 횟수에도 던지지 않는다(음수와 숫자가 아닌 값은 0번, 소수는 내림)', () => {
    expect(improveStart(input({ maxRounds: -3 }), current).rounds).toBe(0)
    expect(improveStart(input({ maxRounds: Number.NaN }), current).rounds).toBe(0)
    expect(improveStart(input({ maxRounds: 1.9 }), current).rounds).toBeLessThanOrEqual(1)
  })
})

describe('자리별 제안: 이득은 그 자리 짝만 바꿔 다시 배정한 목적 값의 차이다', () => {
  const current = presetTactic('4-2-3-1', catalog)

  it('모든 제안의 이득이 따로 구한 목적 값의 차이와 같고, 문턱 이상이며, 이득이 큰 순이다', () => {
    const { suggestions } = searchTactics(input({ current }))
    expect(suggestions.length).toBeGreaterThan(0)
    const before = objectiveOf(current)
    for (const suggestion of suggestions) {
      const slot = current.slots[suggestion.index]
      // 그 자리의 짝만 바꾼 전술
      const swapped: Tactic = {
        ...current,
        slots: current.slots.map((each, index) =>
          index === suggestion.index ? { ip: { cell: each.ip.cell, roleId: suggestion.to.ip.roleId }, oop: { cell: each.oop.cell, roleId: suggestion.to.oop.roleId } } : each
        )
      }
      expect(suggestion.gain).toBe(objectiveOf(swapped).objective - before.objective)
      expect(suggestion.gain).toBeGreaterThanOrEqual(K.ROLE_SWAP_MIN_GAIN)
      expect(suggestion.from).toEqual(profileOf(current, suggestion.index))
      expect(suggestion.from.ip.roleId).toBe(slot.ip.roleId)
      expect(suggestion.to.ip.position).toBe(suggestion.from.ip.position)
      expect(suggestion.to.oop.position).toBe(suggestion.from.oop.position)
      expect(suggestion.to.sharePct).toBe(suggestion.from.sharePct)
      expect([suggestion.to.ip.roleId, suggestion.to.oop.roleId]).not.toEqual([suggestion.from.ip.roleId, suggestion.from.oop.roleId])
      expect(suggestion.label.length).toBeGreaterThan(0)
    }
    for (let at = 1; at < suggestions.length; at++) expect(suggestions[at - 1].gain).toBeGreaterThanOrEqual(suggestions[at].gain)
    expect(new Set(suggestions.map((suggestion) => suggestion.index)).size).toBe(suggestions.length)
  })

  it('문턱(ROLE_SWAP_MIN_GAIN)을 넘기면 제안이 없고, 문턱을 낮추면 제안이 늘어난다', () => {
    const normal = searchTactics(input({ current })).suggestions
    expect(withLedger({ ROLE_SWAP_MIN_GAIN: 1e9 }, () => searchTactics(input({ current })).suggestions)).toEqual([])
    const wide = withLedger({ ROLE_SWAP_MIN_GAIN: -1e9 }, () => searchTactics(input({ current })).suggestions)
    expect(wide.length).toBeGreaterThanOrEqual(normal.length)
    // 문턱을 낮춰도 이득이 문턱을 넘는 제안은 그대로 들어 있다
    for (const suggestion of normal) expect(wide.some((each) => each.index === suggestion.index && each.gain === suggestion.gain)).toBe(true)
  })

  it('주전이 없는 자리(선수가 없는 경우)에는 제안이 없다', () => {
    expect(searchTactics(input({ current, rows: [] })).suggestions).toEqual([])
  })

  it('자리 이름은 전술판과 같은 꼴이다: 같은 점유 시 포지션의 자리가 둘이면 번호를 붙이고, 하나면 붙이지 않는다', () => {
    const wide = withLedger({ ROLE_SWAP_MIN_GAIN: -1e9 }, () => searchTactics(input({ current })).suggestions)
    const labels = new Map(wide.map((suggestion) => [suggestion.index, suggestion.label]))
    // 4-2-3-1의 자리 순서(옛 포메이션 순서): 0 최전방, 1 왼쪽 공격, 2 공격형 미드, 3 오른쪽 공격, 4·5 수비형 미드 둘, 6 왼쪽 수비, 7·8 중앙 수비 둘, 9 오른쪽 수비, 10 골키퍼
    const expected: Record<number, string> = { 0: '최전방', 1: '왼쪽 공격', 2: '공격형 미드', 3: '오른쪽 공격', 4: '수비형 미드 1', 5: '수비형 미드 2', 6: '왼쪽 수비', 7: '중앙 수비 1', 8: '중앙 수비 2', 9: '오른쪽 수비', 10: '골키퍼' }
    expect(labels.size).toBeGreaterThan(3)
    for (const [index, label] of labels) expect(label).toBe(expected[index])
  })

  it('확인 전 표시: 제안한 짝의 두 역할 가운데 하나라도 그 칸 종류 목록에서 근거가 inferred·unknown이면 참이다', () => {
    const wide = withLedger({ ROLE_SWAP_MIN_GAIN: -1e9 }, () => searchTactics(input({ current })).suggestions)
    expect(wide.length).toBeGreaterThan(0)
    for (const suggestion of wide) {
      const expected = (['ip', 'oop'] as const).some((phase) => {
        const side = suggestion.to[phase]
        const choice = catalog.choicesAt(side.position, phase, slotKindOf(current, suggestion.index, phase)).find((each) => each.roleId === side.roleId)
        return choice !== undefined && (choice.evidence === 'inferred' || choice.evidence === 'unknown')
      })
      expect(suggestion.unconfirmed, suggestion.label).toBe(expected)
    }
  })
})

describe('짝 고르기: 포지션이 모두 다른 전술과 포지션마다 한 명인 선수단(배정이 하나로 정해져 값을 손으로 견줄 수 있다)', () => {
  const CELLS: Array<[Line, Lane]> = [['GK', 'C'], ['D', 'L'], ['D', 'C'], ['D', 'R'], ['DM', 'C'], ['M', 'L'], ['M', 'C'], ['M', 'R'], ['AM', 'L'], ['AM', 'R'], ['ST', 'C']]
  const distinct: Tactic = (() => {
    const tactic: Tactic = {
      id: 'distinct',
      name: '시험 전술',
      preset: null,
      sharePct: 60,
      source: 'user',
      catalog: 'fm26',
      slots: CELLS.map(([line, lane]) => ({ ip: { cell: { line, lane }, roleId: '' }, oop: { cell: { line, lane }, roleId: '' } }))
    }
    tactic.slots.forEach((slot, index) => {
      for (const phase of ['ip', 'oop'] as const) slot[phase].roleId = catalog.defaultRole(cellPosition(slot[phase].cell)!, phase, slotKindOf(tactic, index, phase))
    })
    return tactic
  })()
  const positions = distinct.slots.map((slot) => cellPosition(slot.ip.cell)!)
  const solo = soloSquad(positions)

  /** 전술의 모든 자리에서 고를 수 있는 짝(사용자 역할 제외)의 프로파일까지 담은 기준 분포 */
  const allNorms = (): RoleNorms => {
    const profiles: SlotProfile[] = []
    distinct.slots.forEach((_, index) => {
      const ips = catalog.choicesAt(positions[index], 'ip', slotKindOf(distinct, index, 'ip'))
      const oops = catalog.choicesAt(positions[index], 'oop', slotKindOf(distinct, index, 'oop'))
      for (const ip of ips) for (const oop of oops) profiles.push({ ip: { position: positions[index], roleId: ip.roleId }, oop: { position: positions[index], roleId: oop.roleId }, sharePct: 60 })
    })
    return fixedNorms(catalog)(profiles)
  }

  it('전술이 올바르고, 선수마다 자기 자리의 주전이다', () => {
    expect(blockingProblems(validateTactic(distinct, catalog))).toEqual([])
    const depth = buildDepthFor(solo, SEARCH_COLUMNS, distinct, { catalog, overrides: {}, norms: allNorms() }, 0)
    expect(depth.map((slot) => slot.starter?.idx)).toEqual(solo.map((row) => row.idx))
  })

  it('자리마다 주전의 z가 가장 큰 짝을 고른다(동점이면 지금 짝, 그다음 카탈로그 순서). 이득은 그 z의 차이다', () => {
    const norms = allNorms()
    const ctx = { catalog, overrides: {}, norms }
    const zOf = (tactic: Tactic, index: number): number => buildDepthFor(solo, SEARCH_COLUMNS, tactic, ctx, 0)[index].starter!.z!
    const swap = (tactic: Tactic, index: number, ip: string, oop: string): Tactic => ({
      ...tactic,
      slots: tactic.slots.map((slot, at) => (at === index ? { ip: { cell: slot.ip.cell, roleId: ip }, oop: { cell: slot.oop.cell, roleId: oop } } : slot))
    })
    const out = withLedger({ ROLE_SWAP_MIN_GAIN: -1e9 }, () => searchTactics({ ...input({ current: distinct, presets: [], rows: solo }), normsFor: () => norms }))
    let checked = 0
    distinct.slots.forEach((slot, index) => {
      const now = { ip: slot.ip.roleId, oop: slot.oop.roleId }
      let best = { ...now }
      let bestZ = zOf(distinct, index)
      const ips = catalog.choicesAt(positions[index], 'ip', slotKindOf(distinct, index, 'ip')).filter((choice) => choice.evidence !== 'user')
      const oops = catalog.choicesAt(positions[index], 'oop', slotKindOf(distinct, index, 'oop')).filter((choice) => choice.evidence !== 'user')
      for (const ip of ips) {
        for (const oop of oops) {
          if (ip.roleId === now.ip && oop.roleId === now.oop) continue
          const z = zOf(swap(distinct, index, ip.roleId, oop.roleId), index)
          if (z > bestZ) {
            best = { ip: ip.roleId, oop: oop.roleId }
            bestZ = z
          }
        }
      }
      const suggestion = out.suggestions.find((each) => each.index === index)
      if (best.ip === now.ip && best.oop === now.oop) {
        expect(suggestion, `${index}번째 자리는 이미 최선`).toBeUndefined()
        return
      }
      checked++
      expect(suggestion, `${index}번째 자리`).toBeDefined()
      expect({ ip: suggestion!.to.ip.roleId, oop: suggestion!.to.oop.roleId }).toEqual(best)
      expect(suggestion!.gain).toBeCloseTo(bestZ - zOf(distinct, index), 9)
    })
    // 시험이 아무것도 견주지 않은 채 통과하지 않게
    expect(checked).toBeGreaterThanOrEqual(5)
  })

  it('한 시작점의 결과는 자리마다 이 값으로 고른 짝이고, 목적 값은 시작보다 엄격히 크다', () => {
    const norms = allNorms()
    const run = improveStart({ ...input({ current: distinct, presets: [], rows: solo }), normsFor: () => norms }, distinct)
    expect(run.objective).toBeGreaterThan(run.startObjective)
    // 배정이 하나로 정해져 한 번에 모든 자리가 최선이 된다: 두 번째 시도는 바뀔 것이 없다
    expect(run.rounds).toBeLessThanOrEqual(2)
    expect(run.objective).toBe(depthObjective(buildDepthFor(solo, SEARCH_COLUMNS, run.tactic, { catalog, overrides: {}, norms }, 2)).objective)
  })

  it('끝난 전술에서는 더 나은 짝이 없어 제안이 하나도 없다(문턱을 아주 낮춰도)', () => {
    const norms = allNorms()
    const args = { ...input({ current: distinct, presets: [], rows: solo }), normsFor: () => norms }
    const settled = improveStart(args, distinct).tactic
    const out = withLedger({ ROLE_SWAP_MIN_GAIN: -1e9 }, () => searchTactics({ ...args, current: settled }))
    expect(out.suggestions).toEqual([])
    // 지금 전술이 이미 최선이면 짝을 바꾼 후보는 지금 전술과 같은 모양이라 목록에 따로 나오지 않는다
    expect(out.ranked).toHaveLength(1)
    expect(out.ranked[0].current).toBe(true)
  })
})

describe('기준 분포를 빠짐없이 받는다', () => {
  it('시작점마다 한 번씩, 그 시작점의 후보 짝을 한꺼번에 받고, 이미 받은 열쇠는 다시 받지 않는다', () => {
    const calls: string[][] = []
    const args = input({ normsFor: fixedNorms(catalog, calls) })
    searchTactics(args)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.length).toBeLessThanOrEqual(PRESET_IDS.length + 1)
    for (const keys of calls) expect(new Set(keys).size).toBe(keys.length)
    const all = calls.flat()
    expect(new Set(all).size).toBe(all.length)
  })

  it('나온 모든 전술(지금 전술 포함)의 자리 열쇠가 받은 열쇠 안에 있다', () => {
    const calls: string[][] = []
    const out = searchTactics(input({ normsFor: fixedNorms(catalog, calls) }))
    const requested = new Set(calls.flat())
    for (const candidate of out.ranked) {
      for (const profile of profilesOf(candidate.tactic)) expect(requested.has(catalog.normKey(profile)), catalog.normKey(profile)).toBe(true)
    }
  })

  it('받지 못한 열쇠는 고정 기준으로 채운다: 빈 답과 고정 기준을 직접 준 답의 결과가 같고, 점수와 z가 섞여 견주어지지 않는다', () => {
    const fallback = (profiles: SlotProfile[]): RoleNorms =>
      Object.fromEntries(profiles.map((profile) => [catalog.normKey(profile), { mu: FALLBACK_NORM.mu, sigma: FALLBACK_NORM.sigma, beta: FALLBACK_NORM.beta, n: 0, caRef: FALLBACK_NORM.caRef }]))
    const empty = searchTactics(input({ normsFor: () => ({}) }))
    expect(empty).toEqual(searchTactics(input({ normsFor: fallback })))
    // 한쪽 절반만 주면 나머지 절반은 고정 기준이다
    const half = (profiles: SlotProfile[]): RoleNorms => {
      const given = fixedNorms(catalog)(profiles)
      return Object.fromEntries(Object.entries(given).filter((_, at) => at % 2 === 0))
    }
    const mixed = searchTactics(input({ normsFor: half }))
    const explicit = (profiles: SlotProfile[]): RoleNorms => {
      const given = fixedNorms(catalog)(profiles)
      const filled = fallback(profiles)
      return Object.fromEntries(Object.keys(given).map((key, at) => [key, at % 2 === 0 ? given[key] : filled[key]]))
    }
    expect(mixed).toEqual(searchTactics(input({ normsFor: explicit })))
    // 모든 목적 값이 z 크기(자리당 1000 안팎에 z)다. 점수(50~90)가 섞여 들어갔다면 자리당 1000을 한참 넘거나 모자란다
    for (const candidate of empty.ranked) expect(Math.abs(candidate.objective - (candidate.filled - candidate.temporary) * 1000 - candidate.temporary * 700 - candidate.strength)).toBeLessThan(1e-6)
  })

  it('받은 기준 분포가 없는 채로 돌려도 던지지 않는다(받은 값이 비어 오는 경우)', () => {
    expect(() => searchTactics(input({ normsFor: () => undefined as unknown as RoleNorms }))).not.toThrow()
  })
})

describe('게임에서 확인하지 못한 역할: 후보에 넣되 센다. 사용자 역할은 후보에서 뺀다', () => {
  /** 칸 종류 목록의 근거로 센 기대값(시험이 따로 센다) */
  function expectedUnconfirmed(tactic: Tactic, cat: RoleCatalog): number {
    let count = 0
    tactic.slots.forEach((slot, index) => {
      const flagged = (['ip', 'oop'] as const).some((phase) => {
        const position = cellPosition(slot[phase].cell)!
        const choice = cat.choicesAt(position, phase, slotKindOf(tactic, index, phase)).find((each) => each.roleId === slot[phase].roleId)
        return choice ? choice.evidence === 'inferred' || choice.evidence === 'unknown' : !slot[phase].roleId.startsWith('user.')
      })
      if (flagged) count++
    })
    return count
  }

  it('후보마다 확인 전 역할이 든 자리 수를 담는다', () => {
    const out = searchTactics(input())
    for (const candidate of out.ranked) expect(candidate.unconfirmed, candidate.tactic.name).toBe(expectedUnconfirmed(candidate.tactic, catalog))
    // 칸 종류의 목록 가운데 게임에서 확인 전인 것이 있으니(U4 자료) 센 값이 0보다 큰 후보가 있다
    expect(out.ranked.some((candidate) => candidate.unconfirmed > 0)).toBe(true)
  })

  it('옛 14역할은 근거가 앱이 정한 목록(app)이라 확인 전으로 세지 않는다', () => {
    const current = legacyTactic('4-2-3-1', {})
    const out = searchTactics(input({ catalog: LEGACY_CATALOG, current, presets: PRESET_IDS.map((id) => presetTactic(id, LEGACY_CATALOG)), normsFor: flatNorms(LEGACY_CATALOG) }))
    for (const candidate of out.ranked) expect(candidate.unconfirmed).toBe(0)
    for (const suggestion of out.suggestions) expect(suggestion.unconfirmed).toBe(false)
  })

  /** 사용자 역할이 든 프로파일은 기준 분포의 평균을 mu로, 나머지는 58로 주는 기준 분포 */
  const userNorms =
    (cat: RoleCatalog, mu: number) =>
    (profiles: SlotProfile[]): RoleNorms =>
      Object.fromEntries(
        profiles.map((profile) => [cat.normKey(profile), { mu: profile.ip.roleId.startsWith('user.') || profile.oop.roleId.startsWith('user.') ? mu : 58, sigma: 4, beta: 0.25, n: 300, caRef: 110 }])
      )
  const OUTFIELD: PositionKey[] = ['DC', 'DL', 'DR', 'DM', 'MC', 'ML', 'MR', 'AML', 'AMC', 'AMR', 'ST']
  const hasUserRole = (tactic: Tactic): boolean => tactic.slots.some((slot) => slot.ip.roleId.startsWith('user.') || slot.oop.roleId.startsWith('user.'))

  it('사용자 역할은 어느 자리의 후보에도 오르지 않는다(후보가 될 수 있다면 기준 분포의 평균이 아주 낮아 모든 자리에서 먼저 골랐을 것이다)', () => {
    const weights: Record<string, number> = { finishing: 5, passing: 5 }
    const customs: CustomRole[] = [
      { id: 'user.가', phase: 'ip', name: '시험 공 소유 시 역할', positions: OUTFIELD, weights },
      { id: 'user.나', phase: 'oop', name: '시험 공 미소유 시 역할', positions: OUTFIELD, weights }
    ]
    const withUser = withCustomRoles(catalog, customs)
    // 목록에는 사용자 역할이 근거 user로 들어 있다
    expect(withUser.choicesAt('ST', 'ip', 'ST.pair')).toContainEqual({ roleId: 'user.가', evidence: 'user' })
    const presets = PRESET_IDS.map((id) => presetTactic(id, withUser))
    const out = searchTactics(input({ catalog: withUser, current: presetTactic('4-4-2', withUser), presets, normsFor: userNorms(withUser, -500) }))
    for (const candidate of out.ranked) expect(hasUserRole(candidate.tactic), candidate.tactic.name).toBe(false)
    for (const suggestion of out.suggestions) expect([suggestion.to.ip.roleId, suggestion.to.oop.roleId].some((roleId) => roleId.startsWith('user.'))).toBe(false)
  })

  it('지금 전술에 든 사용자 역할은 지금 짝으로 비교되어, 더 나은 짝이 있을 때만 바뀐다', () => {
    const custom: CustomRole[] = [{ id: 'user.마무리', phase: 'ip', name: '시험 마무리 역할', positions: ['ST'], weights: { finishing: 5, offTheBall: 5 } }]
    const withUser = withCustomRoles(catalog, custom)
    const base = presetTactic('4-4-2', withUser)
    const index = base.slots.findIndex((slot) => cellPosition(slot.ip.cell) === 'ST')
    const current: Tactic = { ...base, slots: base.slots.map((slot, at) => (at === index ? { ...slot, ip: { ...slot.ip, roleId: 'user.마무리' } } : slot)) }
    expect(blockingProblems(validateTactic(current, withUser))).toEqual([])
    const roleAt = (tactic: Tactic): string => tactic.slots[index].ip.roleId
    // 사용자 역할 짝의 평균이 아주 낮으면(z가 아주 크면) 지금 짝이 이긴다. 아주 높으면 다른 짝으로 바뀐다. 사용자 역할로는 어느 쪽으로도 새로 바꾸지 않는다
    for (const [mu, keeps] of [[-500, true], [500, false]] as const) {
      const out = searchTactics(input({ catalog: withUser, current, presets: [], normsFor: userNorms(withUser, mu) }))
      const now = out.ranked.find((candidate) => candidate.current)!
      expect(now.tactic).toBe(current)
      expect(now.unconfirmed).toBe(expectedUnconfirmed(current, withUser))
      const changed = out.ranked.find((candidate) => candidate.tactic.id === 'search:current')
      if (keeps) expect(changed === undefined || roleAt(changed.tactic) === 'user.마무리', `평균 ${mu}`).toBe(true)
      else expect(changed && roleAt(changed.tactic), `평균 ${mu}`).not.toBe('user.마무리')
      for (const candidate of out.ranked) {
        if (candidate.current) continue
        const users = candidate.tactic.slots.flatMap((slot, at) => [slot.ip.roleId, slot.oop.roleId].filter((roleId) => roleId.startsWith('user.')).map(() => at))
        expect(users.every((at) => at === index)).toBe(true)
      }
    }
  })
})

describe('옛 14역할 카탈로그에서도 돈다(두 국면이 같은 역할이라 짝이 같은 역할 둘이다)', () => {
  const current = legacyTactic('4-2-3-1', {})
  const legacyInput = (): SearchInput => input({ catalog: LEGACY_CATALOG, current, presets: PRESET_IDS.map((id) => presetTactic(id, LEGACY_CATALOG)), normsFor: flatNorms(LEGACY_CATALOG) })

  it('1위는 지금 전술 이상이고 결정적이다', () => {
    const out = searchTactics(legacyInput())
    expect(out.ranked[0].objective).toBeGreaterThanOrEqual(out.ranked.find((candidate) => candidate.current)!.objective)
    expect(searchTactics(legacyInput())).toEqual(out)
  })

  it('역할은 두 국면이 늘 같다(국면이 없는 역할은 짝으로 갈라지지 않는다)', () => {
    const out = searchTactics(legacyInput())
    for (const candidate of out.ranked) for (const slot of candidate.tactic.slots) expect(slot.oop.roleId).toBe(slot.ip.roleId)
    for (const suggestion of out.suggestions) expect(suggestion.to.oop.roleId).toBe(suggestion.to.ip.roleId)
  })
})

// ---------- 작은 가짜 카탈로그: 동점 규칙과 확인 전 표시를 손으로 본다 ----------

interface FakeRole {
  id: string
  phase: Phase
  weights: Weights
  evidence?: Evidence
  goalkeeper?: boolean
}

/** 골키퍼와 최전방 둘뿐인 카탈로그. 역할마다 근거를 정할 수 있고, 같은 가중치의 역할(a와 a2, x와 x2)로 동점을 만든다 */
function fakeCatalog(defs: FakeRole[]): RoleCatalog {
  const roles: CatalogRole[] = defs.map((def) => ({ id: def.id, phase: def.phase, label: def.id, positions: def.goalkeeper ? ['GK'] : ['ST'], selectable: true, goalkeeper: def.goalkeeper === true }))
  const choices = (position: PositionKey, phase: Phase) => defs.filter((def) => def.phase === phase && (position === 'GK') === (def.goalkeeper === true)).map((def) => ({ roleId: def.id, evidence: def.evidence ?? ('game' as Evidence) }))
  return {
    id: 'fm26',
    dataVersion: 'test',
    roles,
    role: (id) => roles.find((role) => role.id === id),
    roleByGameId: () => undefined,
    baseWeights: (id) => defs.find((def) => def.id === id)?.weights ?? {},
    baseTags: () => ({}),
    choicesAt: choices,
    defaultRole: (position, phase) => choices(position, phase)[0].roleId,
    poolOf: (profile) => [profile.ip.position],
    normKey: (profile) => `${profile.ip.position}|${profile.ip.roleId}|${profile.oop.roleId}|${profile.sharePct}`,
    references: () => [],
    referenceOf: () => undefined,
    legacyMap: () => ({})
  }
}

const FAKE_DEFS: FakeRole[] = [
  { id: 'ip.keeper', phase: 'ip', weights: { handling: 4, reflexes: 2 }, goalkeeper: true },
  { id: 'oop.keeper', phase: 'oop', weights: { handling: 3, reflexes: 3 }, goalkeeper: true },
  { id: 'ip.weak', phase: 'ip', weights: { passing: 4, vision: 2 } },
  { id: 'ip.a', phase: 'ip', weights: { finishing: 4, dribbling: 2 } },
  { id: 'ip.a2', phase: 'ip', weights: { finishing: 4, dribbling: 2 } },
  { id: 'oop.weak', phase: 'oop', weights: { stamina: 4, pace: 2 } },
  { id: 'oop.x', phase: 'oop', weights: { tackling: 4, marking: 2 } },
  { id: 'oop.x2', phase: 'oop', weights: { tackling: 4, marking: 2 } }
]

describe('짝 고르기의 동점 규칙과 확인 전 표시(작은 가짜 카탈로그)', () => {
  const fake = fakeCatalog(FAKE_DEFS)
  // 골키퍼 한 명과 최전방 한 명. 최전방은 마무리(finishing, dribbling)와 수비(tackling, marking)에 강하고 패스(passing)·지구력(stamina)에는 약하다
  const players = soloSquad(['GK', 'ST'])
  const column = (field: string): string => SEARCH_COLUMNS.find((col) => col.field === field)!.header
  const forward = {
    ...players[1],
    cells: {
      ...players[1].cells,
      [column('finishing')]: { raw: '18', num: 18 },
      [column('dribbling')]: { raw: '16', num: 16 },
      [column('tackling')]: { raw: '15', num: 15 },
      [column('marking')]: { raw: '15', num: 15 },
      [column('passing')]: { raw: '6', num: 6 },
      [column('vision')]: { raw: '6', num: 6 },
      [column('stamina')]: { raw: '7', num: 7 },
      [column('pace')]: { raw: '7', num: 7 }
    }
  }
  const rows = [players[0], forward]
  const tactic = (ip: string, oop: string): Tactic => ({
    id: 't',
    name: '시험 전술',
    preset: null,
    sharePct: 60,
    source: 'user',
    catalog: 'fm26',
    slots: [
      { ip: { cell: { line: 'GK', lane: 'C' }, roleId: 'ip.keeper' }, oop: { cell: { line: 'GK', lane: 'C' }, roleId: 'oop.keeper' } },
      { ip: { cell: { line: 'ST', lane: 'C' }, roleId: ip }, oop: { cell: { line: 'ST', lane: 'C' }, roleId: oop } }
    ]
  })
  const run = (current: Tactic, over: Partial<SearchInput> = {}) => searchTactics({ rows, columns: SEARCH_COLUMNS, catalog: fake, overrides: {}, current, presets: [], normsFor: flatNorms(fake), maxRounds: SEARCH_MAX_ROUNDS, ...over })
  const pairOf = (result: Tactic): string => `${result.slots[1].ip.roleId}/${result.slots[1].oop.roleId}`

  it('주전에게 가장 맞는 짝으로 바뀐다: 약한 짝(패스, 지구력)에서 마무리와 수비 짝으로. 같은 가중치의 짝 사이에서는 카탈로그 순서가 앞선 것(a, x)이다', () => {
    const out = run(tactic('ip.weak', 'oop.weak'))
    const better = out.ranked.find((candidate) => candidate.tactic.id === 'search:current')!
    expect(pairOf(better.tactic)).toBe('ip.a/oop.x')
    expect(better.objective).toBeGreaterThan(out.ranked.find((candidate) => candidate.current)!.objective)
    expect(out.ranked[0]).toBe(better)
    expect(out.suggestions).toHaveLength(1)
    expect(out.suggestions[0]).toMatchObject({ index: 1, from: { ip: { roleId: 'ip.weak' }, oop: { roleId: 'oop.weak' } }, to: { ip: { roleId: 'ip.a' }, oop: { roleId: 'oop.x' } }, unconfirmed: false })
    // 이득은 두 목적 값의 차이다
    expect(out.suggestions[0].gain).toBe(better.objective - out.ranked.find((candidate) => candidate.current)!.objective)
  })

  it('동점이면 지금 짝이 이긴다: 지금 짝이 같은 가중치의 다른 역할(a2, x2)이어도 바꾸지 않는다', () => {
    const out = run(tactic('ip.a2', 'oop.x2'))
    expect(out.suggestions).toEqual([])
    expect(out.ranked).toHaveLength(1)
    expect(out.ranked[0].current).toBe(true)
    expect(out.ranked[0].tactic.slots[1].ip.roleId).toBe('ip.a2')
    // 지금 짝보다 나은 짝이 있으면, 값이 같은 짝들 사이에서는 카탈로그 순서가 앞선 짝이 이긴다(a와 a2는 같은 값이라 a)
    const better = run(tactic('ip.a2', 'oop.weak')).ranked.find((candidate) => candidate.tactic.id === 'search:current')!
    expect(pairOf(better.tactic)).toBe('ip.a/oop.x')
  })

  it('확인 전인 역할로 바뀌면 제안과 후보에 표시된다', () => {
    const withDoubt = fakeCatalog(FAKE_DEFS.map((def) => (def.id === 'ip.a' ? { ...def, evidence: 'inferred' as Evidence } : def.id === 'oop.x' ? { ...def, evidence: 'unknown' as Evidence } : def)))
    const out = run(tactic('ip.weak', 'oop.weak'), { catalog: withDoubt, normsFor: flatNorms(withDoubt) })
    expect(out.suggestions[0].unconfirmed).toBe(true)
    const better = out.ranked.find((candidate) => candidate.tactic.id === 'search:current')!
    expect(better.unconfirmed).toBe(1)
    expect(out.ranked.find((candidate) => candidate.current)!.unconfirmed).toBe(0)
  })

  it('목록에 없는 역할(앱이 모르는 짝)이 지금 전술에 있으면 확인 전으로 센다', () => {
    // 지금 전술의 ip.weak가 이 카탈로그의 목록(ip.a, ip.a2)에 없다. 던지지 않고 센다
    const withoutWeak = fakeCatalog(FAKE_DEFS.filter((def) => def.id !== 'ip.weak'))
    const out = run(tactic('ip.weak', 'oop.weak'), { catalog: withoutWeak, normsFor: flatNorms(withoutWeak) })
    expect(out.ranked.find((candidate) => candidate.current)!.unconfirmed).toBe(1)
  })

  it('기준 분포가 열쇠마다 다르면 z가 가장 큰 짝을 고른다(점수가 같은 짝들 가운데 평균이 낮은 기준의 짝)', () => {
    // a2와 x2를 함께 쓰는 짝의 평균만 낮게 잡는다: 가중치가 같아 점수는 같은데 z는 그 짝이 가장 크다(카탈로그 순서가 앞선 a와 x가 아니라)
    const skewed = (profiles: SlotProfile[]): RoleNorms =>
      Object.fromEntries(profiles.map((profile) => [fake.normKey(profile), { mu: profile.ip.roleId === 'ip.a2' && profile.oop.roleId === 'oop.x2' ? 40 : 60, sigma: 4, beta: 0.25, n: 300, caRef: 110 }]))
    const out = run(tactic('ip.weak', 'oop.weak'), { normsFor: skewed })
    const better = out.ranked.find((candidate) => candidate.tactic.id === 'search:current')!
    expect(pairOf(better.tactic)).toBe('ip.a2/oop.x2')
  })
})
