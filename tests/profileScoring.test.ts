/**
 * 자리 프로파일 위의 계산 엔진(2단계 U3): 두 국면(점유 시·비점유 시)의 포지션·역할과 비중이 있는 자리에서 배정, 필요도, 후보 판정, 묶음, 줄 요약이 맞는지.
 * 가짜 카탈로그(국면마다 역할 둘, 골키퍼 역할 하나씩)로 손 계산한 값과 견준다. 옛 14역할과 같은 결과는 tests/golden.test.ts가 본다.
 * 정리 후보와 임대 유망주(뛸 자리가 있는 경로와 없는 경로), 후계자, "이 자리에 맞는 내 선수" 목록, 포지션 묶음 보기의 주요 능력치처럼
 * 두 국면이 다를 때만 새로 생기는 계산도 여기서 본다(옛 14역할은 두 국면이 같아 골든과 기준 결과가 이 차이를 보지 못한다).
 * 참조 프로파일(자리가 없는 선수)의 기준 분포 열쇠는 옛 카탈로그처럼 역할 id가 아니라 `ref:<역할 id>`다.
 *
 * 손 계산의 바탕(합성 가중치): 점유 시 역할의 가중치 합 sIp, 비점유 시 역할의 가중치 합 sOop, 비중 s(0~100 정수)일 때
 *   w_i = s · wIp_i · sOop + (100 - s) · wOop_i · sIp,   적합도 = Σ w_i·a_i / Σ w_i / 20 × 100
 * 이것은 "점유 시 평균 · s% + 비점유 시 평균 · (100 - s)%"와 같다(각 역할의 평균은 자기 가중치 합으로 나눈 가중 평균).
 * 선수와 구단 이름은 모두 지어낸 것이다.
 */
import { describe, expect, it } from 'vitest'
import { bestRolesOf, buildDepth, buildDepthFor, depthObjective, FORMATION_BY_ID, shapeOfTactic, slotRatingsOf } from '../src/shared/depth'
import { recommendSlotOf, surplusReport, type FirstTeamPlayer } from '../src/shared/dashboard'
import { groupKeyAttributes, keyAttributesOf, POSITION_GROUPS, profileKeyAttributes } from '../src/shared/keyAttributes'
import { K } from '../src/shared/ledger'
import { posPenaltySigma, POSITION_KEYS } from '../src/shared/positions'
import { fitNoteOf, recommend, type RecommendContext, type RecommendInput } from '../src/shared/recommend'
import { LEGACY_CATALOG, profileWeights, type CatalogRole, type ReferenceProfile, type RoleCatalog } from '../src/shared/roleCatalog'
import type { PositionKey } from '../src/shared/roles'
import { groupIdOf, mixedPenaltySigma, type SlotProfile } from '../src/shared/slotProfile'
import { analyseTactic, type TacticAnalysis } from '../src/shared/tactic'
import { legacyTactic, presetTactic, type Lane, type Line, type Tactic } from '../src/shared/tacticModel'
import type { CellValue, ColumnInfo, PlayerRow } from '../src/shared/types'
import { categoriesOf, effectiveFit, effectiveScore, isTacticSlot, prospectCheck, rotationWindowOf, type CandidateBench } from '../src/shared/world'
import { seeded, SQUAD_COLUMNS, syntheticSquad } from './helpers/syntheticWorld'

// ---------- 가짜 카탈로그: 국면마다 역할 둘 ----------

type Weights = Record<string, number>
const ROLE_DEFS: Array<{ id: string; phase: 'ip' | 'oop'; label: string; positions: PositionKey[]; weights: Weights; goalkeeper?: boolean }> = [
  { id: 'ip.keeper', phase: 'ip', label: '점유 골키퍼', positions: ['GK'], weights: { handling: 4, reflexes: 2 }, goalkeeper: true },
  { id: 'oop.keeper', phase: 'oop', label: '비점유 골키퍼', positions: ['GK'], weights: { handling: 3, reflexes: 3 }, goalkeeper: true },
  { id: 'ip.back', phase: 'ip', label: '점유 수비', positions: ['DC', 'DL', 'DR', 'WBL', 'WBR'], weights: { tackling: 3, marking: 3, heading: 2 } },
  { id: 'ip.runner', phase: 'ip', label: '점유 측면', positions: ['WBL', 'WBR', 'ML', 'MR', 'AML', 'AMR'], weights: { pace: 4, stamina: 2, crossing: 2 } },
  { id: 'ip.maker', phase: 'ip', label: '점유 조율', positions: ['DM', 'MC', 'AMC'], weights: { passing: 4, vision: 2 } },
  { id: 'ip.finisher', phase: 'ip', label: '점유 마무리', positions: ['AML', 'AMC', 'AMR', 'ST'], weights: { finishing: 4, dribbling: 2 } },
  { id: 'oop.stopper', phase: 'oop', label: '비점유 압박', positions: ['DC', 'DL', 'DR', 'WBL', 'WBR', 'DM', 'MC', 'ML', 'MR', 'AMC', 'ST'], weights: { tackling: 4, marking: 2, stamina: 2 } },
  { id: 'oop.cover', phase: 'oop', label: '비점유 커버', positions: ['DC', 'DL', 'DR', 'WBL', 'WBR', 'DM', 'MC', 'ML', 'MR', 'AML', 'AMC', 'AMR', 'ST'], weights: { stamina: 4, pace: 1, marking: 1 } }
]
const FAKE_ROLES: CatalogRole[] = ROLE_DEFS.map((def) => ({ id: def.id, phase: def.phase, label: def.label, positions: def.positions, selectable: true, goalkeeper: def.goalkeeper === true }))
/** 참조 프로파일(역할 하나, 비중 100): 열쇠는 `ref:<역할 id>`다(FM26 카탈로그와 같은 꼴. 옛 14역할처럼 역할 id가 곧 열쇠가 아니다) */
const FAKE_REFERENCES: ReferenceProfile[] = FAKE_ROLES.map((role) => ({ key: `ref:${role.id}`, roleId: role.id, phase: role.phase, label: role.label, positions: role.positions, goalkeeper: role.goalkeeper }))
const FAKE: RoleCatalog = {
  id: 'fm26',
  dataVersion: 'test',
  roles: FAKE_ROLES,
  role: (id) => FAKE_ROLES.find((each) => each.id === id),
  roleByGameId: () => undefined,
  baseWeights: (id) => ROLE_DEFS.find((def) => def.id === id)?.weights ?? {},
  baseTags: () => ({}),
  choicesAt: (position, phase) => FAKE_ROLES.filter((each) => each.phase === phase && each.positions.includes(position)).map((each) => ({ roleId: each.id, evidence: 'app' as const })),
  defaultRole: (position, phase) => FAKE_ROLES.find((each) => each.phase === phase && each.positions.includes(position))!.id,
  poolOf: (profile) => [profile.ip.position],
  normKey: (profile) => `${profile.ip.position}|${profile.ip.roleId}|${profile.oop.roleId}|${profile.sharePct}`,
  references: (phase) => FAKE_REFERENCES.filter((ref) => phase === undefined || ref.phase === phase),
  referenceOf: (roleId) => FAKE_REFERENCES.find((ref) => ref.roleId === roleId),
  legacyMap: () => ({})
}

// ---------- 선수와 전술을 만드는 도구 ----------

const ATTRIBUTE_IDS = ['handling', 'reflexes', 'tackling', 'marking', 'heading', 'pace', 'stamina', 'crossing', 'passing', 'vision', 'finishing', 'dribbling']
const info = (header: string, field: string): ColumnInfo => ({ header, field, group: 'info', short: header, label: header, isAttr: false, numeric: field !== 'name' && field !== 'position' })
const COLUMNS: ColumnInfo[] = [
  info('이름', 'name'),
  info('포지션', 'position'),
  info('나이', 'age'),
  info('현재 능력', 'ability'),
  info('계약 만료', 'contractEnd'),
  ...ATTRIBUTE_IDS.map((id): ColumnInfo => ({ header: id, field: id, group: 'technical', short: id, label: id, isAttr: true, numeric: true }))
]
const num = (value: number): CellValue => ({ raw: String(value), num: value })

type RatingKey = (typeof POSITION_KEYS)[number]
interface Spec {
  name: string
  /** 게임 표기("AM (R)") */
  position: string
  /** 안 적은 능력치의 값 */
  level?: number
  levels?: Weights
  age?: number
  ca?: number
  /** 포지션 숙련. 안 적은 자리는 1이고, 이 칸 자체가 없으면 숙련 숫자를 모르는 줄이다 */
  ratings?: Partial<Record<RatingKey, number>>
}

let counter = 1
function player(spec: Spec): PlayerRow {
  const cells: Record<string, CellValue> = {
    이름: { raw: spec.name, num: null },
    포지션: { raw: spec.position, num: null },
    나이: num(spec.age ?? 26),
    '현재 능력': num(spec.ca ?? 120),
    '계약 만료': num(20290630)
  }
  for (const id of ATTRIBUTE_IDS) cells[id] = num(spec.levels?.[id] ?? spec.level ?? 10)
  const ratings = spec.ratings ? POSITION_KEYS.map((key) => spec.ratings![key] ?? 1) : undefined
  return { idx: counter++, name: spec.name, cells, ...(ratings ? { ratings } : {}) }
}

type Spot = [Line, Lane, string]
/** 전술 하나: 자리마다 [점유 시 칸과 역할, 비점유 시 칸과 역할]. 자리 수는 따지지 않는다 */
function tacticOf(slots: Array<[Spot, Spot]>, sharePct: number | null = 60, id = 't'): Tactic {
  return {
    id,
    name: '시험 전술',
    preset: null,
    sharePct,
    source: 'user',
    catalog: 'fm26',
    slots: slots.map(([ip, oop]) => ({ ip: { cell: { line: ip[0], lane: ip[1] }, roleId: ip[2] }, oop: { cell: { line: oop[0], lane: oop[1] }, roleId: oop[2] } }))
  }
}

const context = (norms?: Record<string, { mu: number; sigma: number }>) => ({
  catalog: FAKE,
  overrides: {},
  norms: norms ? Object.fromEntries(Object.entries(norms).map(([key, value]) => [key, { ...value, beta: 0.25, n: 300, caRef: 100 }])) : undefined
})
const TODAY = { year: 2026, month: 7, day: 1 }
const analyse = (rows: PlayerRow[], tactic: Tactic, norms?: Record<string, { mu: number; sigma: number }>): TacticAnalysis =>
  analyseTactic({ rows, columns: COLUMNS, today: TODAY, tactic, catalog: FAKE, roleWeights: {}, norms: context(norms).norms })!

const AMC_SLOT: [Spot, Spot] = [['AM', 'C', 'ip.finisher'], ['AM', 'C', 'oop.stopper']]
const AMR_TO_MR: [Spot, Spot] = [['AM', 'R', 'ip.finisher'], ['M', 'R', 'oop.stopper']]

// ---------- 합성 가중치와 배정 ----------

describe('합성 가중치로 낸 적합도와 배정: 비중에 따라 같은 선수가 다르게 보인다(손 계산)', () => {
  // 가: 점유 시 역할(마무리)에 강하고 비점유 시 역할(압박)에 약하다. 나: 반대
  const ga = player({ name: '시험 선수 가', position: 'AM (C)', levels: { finishing: 18, dribbling: 18, tackling: 6, marking: 6, stamina: 6 }, ratings: { AMC: 20 } })
  const na = player({ name: '시험 선수 나', position: 'AM (C)', levels: { finishing: 10, dribbling: 10, tackling: 20, marking: 20, stamina: 20 }, ratings: { AMC: 20 } })
  const profile = (sharePct: number): SlotProfile => ({ ip: { position: 'AMC', roleId: 'ip.finisher' }, oop: { position: 'AMC', roleId: 'oop.stopper' }, sharePct })

  it('비중 60의 합성 가중치는 s · wIp · sOop + (100 - s) · wOop · sIp이다(합 6, 8이라 마무리 1920·960, 압박 960·480·480)', () => {
    expect(profileWeights(FAKE, profile(60), {})).toEqual({ finishing: 60 * 4 * 8, dribbling: 60 * 2 * 8, tackling: 40 * 4 * 6, marking: 40 * 2 * 6, stamina: 40 * 2 * 6 })
  })

  it('비중 60에서 점유 시 평균 18·비점유 시 평균 6인 선수는 0.6·18 + 0.4·6 = 13.2라 66점, 반대인 선수는 0.6·10 + 0.4·20 = 14라 70점이다', () => {
    const slots = buildDepthFor([ga, na], COLUMNS, tacticOf([AMC_SLOT], 60), context())
    expect(slots[0].starter).toMatchObject({ idx: na.idx, score: 70 })
    expect(slots[0].backups[0]).toMatchObject({ idx: ga.idx, score: 66 })
  })

  it('비중 100이면 점유 시 역할만(18이라 90점, 10이라 50점), 비중 0이면 비점유 시 역할만(6이라 30점, 20이라 100점), 비중 40이면 0.4·18 + 0.6·6 = 10.8이라 54점, 0.4·10 + 0.6·20 = 16이라 80점이다', () => {
    const pick = (sharePct: number) => buildDepthFor([ga, na], COLUMNS, tacticOf([AMC_SLOT], sharePct), context())[0]
    expect([pick(100).starter?.idx, pick(100).starter?.score, pick(100).backups[0].score]).toEqual([ga.idx, 90, 50])
    expect([pick(0).starter?.idx, pick(0).starter?.score, pick(0).backups[0].score]).toEqual([na.idx, 100, 30])
    expect([pick(40).starter?.idx, pick(40).starter?.score, pick(40).backups[0].score]).toEqual([na.idx, 80, 54])
  })

  it('전술의 비중을 적지 않으면(null) 대장의 기본값(IP_SHARE_DEFAULT)을 읽는다', () => {
    const slots = buildDepthFor([ga, na], COLUMNS, tacticOf([AMC_SLOT], null), context())
    expect(slots[0].profile.sharePct).toBe(Math.round(K.IP_SHARE_DEFAULT * 100))
    expect(slots[0].starter?.score).toBe(70)
  })

  it('분석 결과가 자리 프로파일을 싣는다: 두 국면의 포지션·역할, 비중, 역할 이름, 카탈로그', () => {
    const analysis = analyse([ga, na], tacticOf([AMC_SLOT], 60))
    const slot = analysis.slots[0]
    expect(slot.profile).toEqual(profile(60))
    expect([slot.slot.position, slot.slot.roleId, slot.slot.oopPosition, slot.slot.oopRoleId]).toEqual(['AMC', 'ip.finisher', 'AMC', 'oop.stopper'])
    expect([slot.roleLabel, slot.oopRoleLabel, slot.positionLabel, slot.oopPositionLabel]).toEqual(['점유 마무리', '비점유 압박', '공격형 미드', '공격형 미드'])
    expect([analysis.sharePct, analysis.catalogId, slot.starterScore]).toEqual([60, 'fm26', 70])
  })

  it('"이 자리에 맞는 내 선수" 목록은 합성 가중치의 점수 순이다(점유 시 역할만 보면 순서가 거꾸로다)', () => {
    // 점유 시 역할(마무리)만 보면 가 90점·나 50점이라 가가 앞서지만, 비중 60의 합성 가중치로는 나 70점·가 66점이다
    const options = analyse([ga, na], tacticOf([AMC_SLOT], 60)).slots[0].options
    expect(options.map((each) => [each.idx, each.score, each.role, each.playable])).toEqual([
      [na.idx, 70, 'starter', true],
      [ga.idx, 66, 'bench', true]
    ])
    expect(options[1].note).toBe('지금은 주전이 아니지만 이 역할 적합도는 66점으로 주전보다 4점 낮습니다.')
    // 비중 100이면 점유 시 역할 그대로(가 90점, 나 50점), 비중 0이면 비점유 시 역할 그대로(나 100점, 가 30점)
    expect(analyse([ga, na], tacticOf([AMC_SLOT], 100)).slots[0].options.map((each) => [each.idx, each.score])).toEqual([[ga.idx, 90], [na.idx, 50]])
    expect(analyse([ga, na], tacticOf([AMC_SLOT], 0)).slots[0].options.map((each) => [each.idx, each.score])).toEqual([[na.idx, 100], [ga.idx, 30]])
  })
})

// ---------- 필요도 ----------

describe('보강 필요도: 주전 전력은 그 자리 프로파일의 기준 분포로 잰다(손 계산)', () => {
  const ga = player({ name: '시험 선수 가', position: 'AM (C)', levels: { finishing: 18, dribbling: 18, tackling: 6, marking: 6, stamina: 6 }, ratings: { AMC: 20 } })
  const na = player({ name: '시험 선수 나', position: 'AM (C)', levels: { finishing: 10, dribbling: 10, tackling: 20, marking: 20, stamina: 20 }, ratings: { AMC: 20 } })
  const tactic = tacticOf([AMC_SLOT], 60)
  const key = FAKE.normKey({ ip: { position: 'AMC', roleId: 'ip.finisher' }, oop: { position: 'AMC', roleId: 'oop.stopper' }, sharePct: 60 })

  it('주전(70점)이 이 프로파일의 평균 72점·점수 차이 2점보다 한 단계 아래면 z는 -1이고, 주전 전력 위험은 (1 + 1) / 3이다', () => {
    expect(key).toBe('AMC|ip.finisher|oop.stopper|60')
    const analysis = analyse([ga, na], tactic, { [key]: { mu: 72, sigma: 2 } })
    const slot = analysis.slots[0]
    expect(slot.normSource).toBe('world')
    expect(slot.starterZ).toBe(-1)
    const risk = Math.min(1, Math.max(0, (K.QUALITY_Z_GOOD - -1) / K.QUALITY_Z_SPAN))
    const quality = slot.factors.find((factor) => factor.id === 'quality')!
    expect(quality.points).toBe(Math.round(risk * K.NEED_FACTOR_WEIGHTS.quality * 10) / 10)
    expect(quality.points).toBeCloseTo((2 / 3) * 45, 1)
    expect(slot.slot.starter?.z).toBe(-1)
  })

  it('기준 분포가 점유 시 역할의 id만 열쇠로 와도(옛 열쇠) 이 프로파일의 것이 아니라서 고정 기준으로 대신한다', () => {
    const analysis = analyse([ga, na], tactic, { 'ip.finisher': { mu: 72, sigma: 2 } })
    expect(analysis.slots[0].normSource).toBe('fallback')
    expect(analysis.slots[0].norm.sigma).toBe(K.FALLBACK_SIGMA)
  })

  it('열쇠에 비중이 들어 있어서 비중이 다르면 기준 분포도 다르다', () => {
    const other = analyse([ga, na], tacticOf([AMC_SLOT], 50), { [key]: { mu: 72, sigma: 2 } })
    expect(other.slots[0].normSource).toBe('fallback')
  })
})

// ---------- 숙련 감점 섞기와 자격 ----------

describe('숙련: 자격은 점유 시 포지션만, 감점은 두 국면의 숙련을 섞는다(AMR → MR 자리)', () => {
  const same = { levels: { finishing: 14, dribbling: 14, tackling: 12, marking: 12, stamina: 12 } }
  const sigma = 3
  const norms = { [FAKE.normKey({ ip: { position: 'AMR', roleId: 'ip.finisher' }, oop: { position: 'MR', roleId: 'oop.stopper' }, sharePct: 60 })]: { mu: 60, sigma } }
  const tactic = tacticOf([AMR_TO_MR], 60)
  const slotOf = (rows: PlayerRow[]) => buildDepthFor(rows, COLUMNS, tactic, context(norms))[0]

  it('비점유 시 숙련만 낮은 선수의 effScore는 섞은 감점만큼 낮다: σ · (0.6 · p(20) + 0.4 · p(12)) = 3 · 0.52', () => {
    const high = player({ name: '시험 선수 다', position: 'AM (R)', ...same, ratings: { AMR: 20, MR: 20 } })
    const low = player({ name: '시험 선수 라', position: 'AM (R)', ...same, ratings: { AMR: 20, MR: 12 } })
    const slot = slotOf([high, low])
    const [first, second] = [slot.starter!, slot.backups[0]]
    expect(first.idx).toBe(high.idx)
    expect(first.score).toBe(second.score)
    expect(first.effScore).toBe(first.score)
    expect(posPenaltySigma(12)).toBeCloseTo(1.3, 10)
    expect(first.effScore - second.effScore).toBeCloseTo(sigma * (0.6 * 0 + 0.4 * 1.3), 10)
    expect(second).toMatchObject({ rating: 20, oopRating: 12 })
    expect(second.penaltySigma).toBeCloseTo(0.52, 10)
    expect(first.penaltySigma).toBe(0)
  })

  it('점유 시 숙련만 낮은 선수(12)는 감점이 0.6 · p(12)이고, 두 국면의 포지션이 같으면 섞지 않고 지금 감점 그대로다', () => {
    expect(mixedPenaltySigma(12, 20, 60)).toBeCloseTo(0.6 * 1.3, 10)
    expect(mixedPenaltySigma(12, 12, 60)).toBe(posPenaltySigma(12))
    expect(mixedPenaltySigma(12, 1, 100)).toBe(posPenaltySigma(12))
  })

  it('AMR 20·MR 12는 주전 자격(감점만 섞임), MR 20·AMR 12는 임시 주전만, AMR 20·MR 1은 자격이 있다', () => {
    const natural = player({ name: '시험 선수 마', position: 'AM (R)', ...same, ratings: { AMR: 20, MR: 12 } })
    const wrongSide = player({ name: '시험 선수 바', position: 'M (R)', ...same, ratings: { MR: 20, AMR: 12 } })
    const noOop = player({ name: '시험 선수 사', position: 'AM (R)', ...same, ratings: { AMR: 20, MR: 1 } })
    const tooLow = player({ name: '시험 선수 아', position: 'M (R)', ...same, ratings: { MR: 20, AMR: 9 } })

    expect(slotOf([natural]).starter).toMatchObject({ idx: natural.idx, temporary: false, rating: 20, oopRating: 12 })
    // 점유 시 숙련 12(10~14)라 임시 주전만 될 수 있다
    expect(slotOf([wrongSide]).starter).toMatchObject({ idx: wrongSide.idx, temporary: true, rating: 12, oopRating: 20 })
    expect(slotOf([wrongSide]).starter!.penaltySigma).toBeCloseTo(0.6 * 1.3, 10)
    // 비점유 시 숙련이 1이어도 점유 시 숙련 20이라 자격이 있다
    expect(slotOf([noOop]).starter).toMatchObject({ idx: noOop.idx, temporary: false, rating: 20, oopRating: 1 })
    expect(slotOf([noOop]).starter!.penaltySigma).toBeCloseTo(0.4 * 6.4, 10)
    // 점유 시 숙련이 10 미만이면 비점유 시 숙련이 20이어도 뛸 수 없다
    expect(slotOf([tooLow]).starter).toBeNull()
    // 자격이 있는 선수가 있으면 임시 주전은 밀리고 후보에도 오르지 않는다
    const both = slotOf([wrongSide, natural])
    expect(both.starter?.idx).toBe(natural.idx)
    expect(both.backups).toEqual([])
  })

  it('숙련 숫자를 모르는 줄은 두 국면 모두 20으로 보고, 뛸 수 있다고 적힌 자리만 뛴다', () => {
    const unknown = player({ name: '시험 선수 자', position: 'AM (R)', ...same })
    const slot = slotOf([unknown])
    expect(slot.starter).toMatchObject({ idx: unknown.idx, rating: 20, oopRating: 20, penaltySigma: 0, temporary: false })
    expect(slotRatingsOf(undefined, slot.profile)).toEqual({ ip: 20, oop: 20, sharePct: 60 })
    expect(slotRatingsOf([...POSITION_KEYS].map((key) => (key === 'AMR' ? 17 : key === 'MR' ? 9 : 1)), slot.profile)).toEqual({ ip: 17, oop: 9, sharePct: 60 })
    expect(slotOf([player({ name: '시험 선수 차', position: 'M (R)', ...same })]).starter).toBeNull()
  })

  it('추천 점수: 곱셈 보정(lowGate)은 점유 시 숙련만 본다(AMR 20·MR 1이면 보정 없음), 감점은 섞인다', () => {
    const input = (over: Partial<RecommendInput>): RecommendInput => ({
      category: 'all',
      goalkeeper: false,
      roleScore: 70,
      roleRating: 20,
      age: 26,
      ca: 140,
      pa: 142,
      value: 5_000_000,
      wage: 50_000,
      contractEnd: 2028 * 1000 + 181,
      squadStatus: 4,
      hasClub: true,
      traits: { consistency: 12, injuryProneness: 8, importantMatches: 12, naturalFitness: 12, determination: 12, dirtiness: 8 },
      ...over
    })
    const ctx: RecommendContext = {
      starter: { name: '시험 주전', score: 68, ca: 135, age: 27 },
      backup: { score: 64 },
      today: { year: 2026, day: 3 },
      money: { medianWage: 40_000, topWage: 90_000, medianValue: 3_000_000, topValue: 10_000_000 },
      norm: { mu: 60, sigma: 3, beta: 0.25, n: 300, caRef: 100 }
    }
    const plain = recommend(input({}), ctx)
    const mixed = recommend(input({ oopRating: 1, sharePct: 60 }), ctx)
    expect(mixed.gate).toBe(1)
    expect(mixed.gateNote).toBe('')
    expect(mixed.fit.positionSigma).toBeCloseTo(0.4 * 6.4, 10)
    expect(mixed.fit.positionPoints).toBeCloseTo(3 * 0.4 * 6.4, 10)
    expect(mixed.fit.effective).toBeCloseTo(70 - 3 * 0.4 * 6.4, 10)
    expect(mixed.total).toBeLessThan(plain.total)
    // 점유 시 숙련이 9면 (비점유 시 숙련이 20이어도) 곱셈 보정이 걸린다: 0.1 + 0.1 · (9 - 1) = 0.9
    const gated = recommend(input({ roleRating: 9, oopRating: 20, sharePct: 60 }), ctx)
    expect(gated.gate).toBeCloseTo(0.9, 10)
    expect(gated.gateNote).toContain('×0.9')
    // 비점유 시 숙련이 없거나 비중이 100이면 지금과 같다
    expect(recommend(input({ oopRating: 1 }), ctx)).toEqual(plain)
    expect(recommend(input({ oopRating: 1, sharePct: 100 }), ctx)).toEqual(plain)
    expect(recommend(input({ roleRating: 16 }), ctx)).toEqual(recommend(input({ roleRating: 16, oopRating: 16, sharePct: 60 }), ctx))
  })

  it('풀이 글: 두 숙련이 다를 때만 두 숙련을 적고, 같으면 지금 글 그대로다', () => {
    const norm = { mu: 60, sigma: 3.15, beta: 0.25, n: 300, caRef: 100 }
    const different = effectiveFit(70, { ip: 16, oop: 12, sharePct: 60 }, 26, norm)
    // 3.15 · (0.6 · 0.32 + 0.4 · 1.3) = 2.2428
    expect(different.positionPoints).toBeCloseTo(3.15 * (0.6 * 0.32 + 0.4 * 1.3), 10)
    expect(fitNoteOf(different, 16, 26)).toContain('점유 시 포지션 숙련 16, 비점유 시 12라 적합도에서 2.2점 뺐습니다')
    const alike = effectiveFit(70, { ip: 16, oop: 16, sharePct: 60 }, 26, norm)
    expect(fitNoteOf(alike, 16, 26)).toBe(fitNoteOf(effectiveFit(70, 16, 26, norm), 16, 26))
    expect(fitNoteOf(alike, 16, 26)).toContain('포지션 숙련 16이라 적합도에서 1.0점 뺐습니다')
    expect(alike).toMatchObject({ ipRating: 16, oopRating: 16 })
    expect(different).toMatchObject({ ipRating: 16, oopRating: 12 })
    expect(effectiveFit(70, null, 26, norm).ipRating).toBeUndefined()
  })

  it('숫자 하나는 지금 뜻 그대로: 두 숙련이 같거나 비중이 100이면 effectiveScore가 Object.is로 같다', () => {
    for (let rating = 1; rating <= 20; rating++) {
      for (const age of [null, 24, 33]) {
        const plain = effectiveScore(71.37, rating, age, 3.4)
        expect(Object.is(effectiveScore(71.37, { ip: rating, oop: rating, sharePct: 60 }, age, 3.4), plain)).toBe(true)
        expect(Object.is(effectiveScore(71.37, { ip: rating, oop: 3, sharePct: 100 }, age, 3.4), plain)).toBe(true)
      }
    }
  })

  it('두 국면의 숙련은 각각 올라가면 감점이 줄거나 같다(점유 시 숙련, 비점유 시 숙련 모두)', () => {
    for (const sharePct of [1, 25, 40, 60, 75, 99]) {
      for (let rating = 1; rating < 20; rating++) {
        for (let other = 1; other <= 20; other++) {
          expect(mixedPenaltySigma(rating + 1, other, sharePct)).toBeLessThanOrEqual(mixedPenaltySigma(rating, other, sharePct))
          expect(mixedPenaltySigma(other, rating + 1, sharePct)).toBeLessThanOrEqual(mixedPenaltySigma(other, rating, sharePct))
        }
      }
    }
  })
})

// ---------- 후보 판정 ----------

describe('후보 판정: 비교용 적합도에 섞은 감점이 들어가 유형이 달라진다', () => {
  const sigma = 4
  const norm = { mu: 60, sigma, beta: 0.25, n: 300, caRef: 100 }
  const bench: CandidateBench = { starter: { name: '시험 주전', score: 70, ca: 140, age: 26, shownScore: 70 }, backup: null, thin: false }
  const base = { score: 70.5, age: 26, ca: 140, pa: 142, hasClub: true }

  it('같은 적합도 70.5점인 후보가 숙련 20·20이면 즉시 전력, 점유 시 20·비점유 시 12(비중 60)면 4 · 0.52 = 2.08점이 빠져 로테이션이다', () => {
    const line = 70 - K.STARTER_TOLERANCE_SIGMAS * sigma
    expect(70.5).toBeGreaterThanOrEqual(line)
    expect(categoriesOf({ ...base, rating: 20 }, bench, norm)).toEqual(['starter'])
    expect(categoriesOf({ ...base, rating: { ip: 20, oop: 20, sharePct: 60 } }, bench, norm)).toEqual(['starter'])
    const mixedFit = effectiveScore(70.5, { ip: 20, oop: 12, sharePct: 60 }, 26, sigma)
    expect(mixedFit).toBeCloseTo(70.5 - 2.08, 10)
    expect(mixedFit).toBeLessThan(line)
    const window = rotationWindowOf(bench, norm)
    expect(mixedFit).toBeGreaterThanOrEqual(window.floor)
    expect(categoriesOf({ ...base, rating: { ip: 20, oop: 12, sharePct: 60 } }, bench, norm)).toEqual(['rotation'])
  })
})

// ---------- 후계자 ----------

/** 오른쪽 공격(점유 시) → 오른쪽 미드(비점유 시) 자리(비중 60)의 기준 분포 열쇠 */
const AMR_MR_KEY = FAKE.normKey({ ip: { position: 'AMR', roleId: 'ip.finisher' }, oop: { position: 'MR', roleId: 'oop.stopper' }, sharePct: 60 })

describe('후계자: 23세 이하가 점유 시 포지션을 뛰고, 두 숙련을 섞은 감점을 빼고도 주전에 크게 뒤지지 않으면 이어받을 수 있다(AMR → MR 자리)', () => {
  // 기준 분포 σ 4. 주전은 75점(숙련 20·20이라 감점 없음)이라 문턱은 75 - 2.5 · 4 = 65점이다. 후계 후보는 합성 점수 70점
  const norms = { [AMR_MR_KEY]: { mu: 60, sigma: 4 } }
  const starter = player({ name: '시험 주전', position: 'AM (R)', level: 15, age: 33, ratings: { AMR: 20, MR: 20 } })
  const withKid = (ratings: Partial<Record<RatingKey, number>>) => {
    const kid = player({ name: '시험 후계', position: 'AM (R)', level: 14, age: 21, ratings })
    const slot = analyse([starter, kid], tacticOf([AMR_TO_MR], 60), norms).slots[0]
    return { slot, age: slot.factors.find((factor) => factor.id === 'age')! }
  }

  it('두 숙련이 20이면 감점 없이 70점이라 문턱(65점)을 넘어 후계자가 되고, 주전(33세)의 나이 위험이 절반이 된다', () => {
    const found = withKid({ AMR: 20, MR: 20 })
    expect(found.slot.starterEff).toBe(75)
    expect(found.age.note).toContain('시험 후계(21세)가 이어받을 수 있어 위험을 절반으로 줄였습니다')
    const missing = withKid({ AMR: 20, MR: 1 })
    expect(missing.age.note).not.toContain('이어받을 수 있어')
    expect(found.age.points).toBeLessThan(missing.age.points)
    expect(found.age.points).toBeCloseTo(missing.age.points * K.SUCCESSOR_RELIEF, 0)
    expect(found.slot.need).toBeLessThan(missing.slot.need)
  })

  it('비점유 시 숙련만 낮아도 섞은 감점이 빠진다: 점유 시 20이어도 비점유 시 숙련 1이면 70 - 4 · 0.4 · 6.4 = 59.76점이라 문턱 밖이다(점유 시 숙련만 보면 70점이라 후계자가 된다)', () => {
    expect(withKid({ AMR: 20, MR: 1 }).age.note).not.toContain('이어받을 수 있어')
    // 경계: 비점유 시 숙련 8은 70 - 4 · 0.4 · 2.9 = 65.36점이라 넘고, 7은 70 - 4 · 0.4 · 3.4 = 64.56점이라 못 미친다
    const edge = (oop: number): boolean => withKid({ AMR: 20, MR: oop }).age.note.includes('이어받을 수 있어')
    expect([edge(8), edge(7)]).toEqual([true, false])
  })
})

// ---------- 정리 후보와 임대 유망주 ----------

describe('정리 후보와 임대 유망주: 자리 경로는 그 자리 프로파일(합성 가중치, 섞은 감점)로, 자리 없는 경로는 점유 시 참조 프로파일로 본다(AMR → MR 자리)', () => {
  // 기준 분포 σ 4. 합성 가중치(비중 60)의 점수는 마무리 평균 F, 압박 평균 T일 때 5 · (0.6F + 0.4T)다
  const sigma = 4
  const tactic = tacticOf([AMR_TO_MR], 60)
  const norms = {
    [AMR_MR_KEY]: { mu: 60, sigma },
    // 참조 프로파일의 기준 분포(열쇠는 `ref:<역할 id>`). 비점유 시 역할의 참조는 점유 시 참조를 돌 때 쓰이지 않는다: 쓰이면 압박에 강한 선수의 z가 아주 크게 나온다
    'ref:ip.finisher': { mu: 60, sigma },
    'ref:oop.stopper': { mu: 20, sigma: 2 }
  }
  // 주전 75점(숙련 20·20), 첫 후보 67점 = 5 · (0.6 · 14 + 0.4 · 12.5)
  const starter = player({ name: '시험 주전', position: 'AM (R)', level: 15, ratings: { AMR: 20, MR: 20 } })
  const backup = player({ name: '시험 후보', position: 'AM (R)', levels: { finishing: 14, dribbling: 14, tackling: 12, marking: 12, stamina: 14 }, ratings: { AMR: 20, MR: 20 } })
  // 합성 66점 = 5 · (0.6 · 18 + 0.4 · 6). 점유 시 역할(마무리)만 보면 90점이다
  const spare = (name: string, ratings: Partial<Record<RatingKey, number>>, over: Partial<Spec> = {}): PlayerRow =>
    player({ name, position: 'AM (R)', levels: { finishing: 18, dribbling: 18, tackling: 6, marking: 6, stamina: 6 }, ratings, age: 27, ...over })

  const firstTeam = (rows: PlayerRow[], pa: Record<number, number>): FirstTeamPlayer[] =>
    rows.map((row) => ({
      uid: row.idx,
      name: row.name,
      age: row.cells['나이'].num,
      position: row.cells['포지션'].raw,
      ca: row.cells['현재 능력'].num,
      pa: pa[row.idx] ?? row.cells['현재 능력'].num,
      wage: null,
      contractEnd: null
    }))
  /** 정리 후보와 임대 유망주. pa는 선수 번호 → 잠재 능력(안 적으면 현재 능력과 같아 클 여지가 없다) */
  const run = (rows: PlayerRow[], pa: Record<number, number> = {}) => {
    const analysis = analyse(rows, tactic, norms)
    const result = surplusReport({ players: firstTeam(rows, pa), rows, columns: COLUMNS, analysis, roleWeights: {}, catalog: FAKE, norms: context(norms).norms, minScore: 0 })
    return { analysis, ...result }
  }

  it('자리 경로의 격차는 합성 가중치 점수에서 두 숙련을 섞은 감점을 뺀 값으로 잰다: 점유 시 20·비점유 시 12는 66 - 4 · 0.52 = 63.92점이라 첫 후보(67점)와 3.08점 차이다', () => {
    const mixed = spare('시험 선수 가', { AMR: 20, MR: 12 })
    const alike = spare('시험 선수 나', { AMR: 20, MR: 20 })
    const sixteen = spare('시험 선수 다', { AMR: 16, MR: 16 })
    const { analysis, rows } = run([starter, backup, mixed, alike, sixteen])
    expect(analysis.slots[0].starterScore).toBe(75)
    expect(analysis.slots[0].slot.backups[0]).toMatchObject({ name: '시험 후보', effScore: 67 })
    const rowOf = (name: string) => rows.find((each) => each.name === name)!

    // 두 숙련이 다르면 섞은 감점(4 · 0.52 = 2.08점)을 빼고, 풀이 글에 두 숙련을 적는다
    expect(rowOf('시험 선수 가')).toMatchObject({ fit: 'slot', slotLabel: '오른쪽 공격', fitGap: 3.1, fitGapSigma: 0.8 })
    expect(rowOf('시험 선수 가').reason).toContain('가장 가까운 오른쪽 공격 자리에서도 첫 후보 시험 후보보다 적합도가 3.1점(이 역할의 보통 점수 차이의 약 0.8배) 낮')
    expect(rowOf('시험 선수 가').reason).toContain('그 자리 포지션 숙련(점유 시 20, 비점유 시 12)에 따라 2.1점 뺐')
    // 두 숙련이 20으로 같으면 감점이 없어 격차는 67 - 66 = 1점이고, 숙련 문장이 없다
    expect(rowOf('시험 선수 나')).toMatchObject({ fit: 'slot', fitGap: 1 })
    expect(rowOf('시험 선수 나').reason).not.toContain('포지션 숙련')
    // 두 숙련이 16으로 같으면 섞지 않고 지금 문장 그대로다: 4 · 0.32 = 1.28점을 빼 격차 2.28점
    expect(rowOf('시험 선수 다')).toMatchObject({ fit: 'slot', fitGap: 2.3 })
    expect(rowOf('시험 선수 다').reason).toContain('그 자리 포지션 숙련이 16이라 1.3점 뺐')
    expect(rowOf('시험 선수 다').reason).not.toContain('점유 시 16')
  })

  it('임대 유망주도 같은 감점을 쓴다: 20세(현재 능력 86, 잠재 150)가 점유 시 20·비점유 시 12면 63.92 + 9.12 = 73.04점이라 기준선(74.0점)에 못 미치고, 20·20이면 75.12점이라 넘는다', () => {
    const mixed = spare('시험 유망주 가', { AMR: 20, MR: 12 }, { age: 20, ca: 86 })
    const alike = spare('시험 유망주 나', { AMR: 20, MR: 20 }, { age: 20, ca: 86 })
    const { analysis, rows, prospects } = run([starter, backup, mixed, alike], { [mixed.idx]: 150, [alike.idx]: 150 })
    // 기준선: 주전 75점 - 0.25 · 4 = 74.0점. 성장 이득: 0.25 · 0.57 · 64 = 9.12점
    expect(prospects.map((each) => each.name)).toEqual(['시험 유망주 나'])
    expect(prospects[0]).toMatchObject({ room: 64, gain: 9.1 })
    expect(prospects[0].reason).toContain('20세, 현재 능력 86에 잠재 능력 150으로 64만큼 더 큽니다. 다 크면 적합도가 약 9.1점 오를 것으로 봅니다.')
    const lost = rows.find((each) => each.name === '시험 유망주 가')!
    expect(lost.reason).toContain('클 여지(+9.1점)는 있지만 다 커도 오른쪽 공격 자리 기준(74.0점)에 못 미칩니다(예상 73.0점).')
    // 같은 판정을 후보 찾기도 쓴다(prospectCheck): 두 숙련을 주면 같은 결과다
    const { group, norm } = analysis.slots[0]
    const asked = (rating: { ip: number; oop: number; sharePct: number }) => prospectCheck({ score: 66, age: 20, ca: 86, pa: 150, rating }, group.bench, norm)
    expect(asked({ ip: 20, oop: 12, sharePct: 60 }).margin).toBeCloseTo(73.04 - 74, 6)
    expect(asked({ ip: 20, oop: 20, sharePct: 60 }).margin).toBeCloseTo(75.12 - 74, 6)
  })

  it('전술에 뛸 자리가 없는 선수는 점유 시 참조 프로파일(열쇠 ref:…)의 기준 분포로 가장 맞는 역할을 찾는다', () => {
    // 최전방만 뛰는 선수: 이 전술(오른쪽 공격 한 자리)에는 뛸 자리가 없다. 마무리 평균 12라 참조 점수 60점(z 0), 압박 평균 18이라 비점유 시 참조로 보면 z가 35나 된다
    const striker = player({ name: '시험 공격수', position: 'ST (C)', age: 28, levels: { finishing: 12, dribbling: 12, tackling: 18, marking: 18, stamina: 18 }, ratings: { ST: 20 } })
    const { analysis, rows } = run([starter, backup, striker])
    const row = rows.find((each) => each.name === '시험 공격수')!
    // 가장 약한 주전의 z는 (75 - 60) / 4 = 3.75라 격차 3.75 + 0.5가 FIT_GAP_SIGMAS(3)를 넘어 적합도 위험이 가득이다
    expect(analysis.slots[0].starterZ).toBe(3.75)
    expect(row).toMatchObject({ fit: 'noSlot', bestRole: '점유 마무리', slotLabel: null, fitGap: null })
    expect(row.parts.fit).toBe(50)
    expect(row.reason).toContain('가장 잘 맞는 역할(점유 마무리)')
  })

  it('전술에 뛸 자리가 없는 어린 선수의 임대 유망주 판정도 점유 시 참조 프로파일의 기준 분포를 쓴다', () => {
    // 둘 다 19세, 현재 능력 100에 잠재 160: 성장 이득 0.25 · 0.635 · 60 = 9.525점. 가장 약한 주전의 z는 3.75라 기준선은 3.75 - 0.25 = 3.5σ다
    // 다는 마무리 평균 16이라 참조 점수 80점: (80 + 9.525 - 60) / 4 = 7.38σ라 넘는다
    const strong = player({ name: '시험 유망주 다', position: 'ST (C)', age: 19, ca: 100, level: 10, levels: { finishing: 16, dribbling: 16 }, ratings: { ST: 20 } })
    // 라는 마무리 평균 8이라 참조 점수 40점: (40 + 9.525 - 60) / 4 = -2.62σ라 못 미친다. 압박 평균이 18이라 비점유 시 참조(평균 20·σ 2)로 보면 넘어 버린다
    const weak = player({
      name: '시험 유망주 라',
      position: 'ST (C)',
      age: 19,
      ca: 100,
      level: 10,
      levels: { finishing: 8, dribbling: 8, tackling: 18, marking: 18, stamina: 18 },
      ratings: { ST: 20 }
    })
    const { prospects, rows } = run([starter, backup, strong, weak], { [strong.idx]: 160, [weak.idx]: 160 })
    expect(prospects.map((each) => each.name)).toEqual(['시험 유망주 다'])
    expect(prospects[0].reason).toContain('19세, 현재 능력 100에 잠재 능력 160으로 60만큼 더 큽니다. 다 크면 적합도가 약 9.5점 오를 것으로 봅니다.')
    expect(rows.find((each) => each.name === '시험 유망주 라')!.reason).toContain('클 여지(+9.5점)는 있지만 다 커도 지금 전술의 가장 약한 주전 수준에 못 미칩니다.')
  })
})

// ---------- 묶음, 줄, 순서 ----------

describe('스리백·윙백 둘(오른쪽·왼쪽)·투톱·공격형 미드·한쪽 측면: 묶음과 줄 요약, 줄 순서를 섞어도 결과가 같다', () => {
  // 점유 시: 중앙 수비 셋, 윙백 둘, 중앙 미드 하나, 공격형 미드, 오른쪽 공격, 투톱. 비점유 시: 윙백은 수비로 내려가 다섯이 되고 오른쪽 공격은 오른쪽 미드로 내려온다
  const SLOTS: Array<[Spot, Spot]> = [
    [['GK', 'C', 'ip.keeper'], ['GK', 'C', 'oop.keeper']],
    [['D', 'CL', 'ip.back'], ['D', 'CL', 'oop.stopper']],
    [['D', 'C', 'ip.back'], ['D', 'C', 'oop.stopper']],
    [['D', 'CR', 'ip.back'], ['D', 'CR', 'oop.stopper']],
    [['DM', 'L', 'ip.runner'], ['D', 'L', 'oop.stopper']],
    [['DM', 'R', 'ip.runner'], ['D', 'R', 'oop.stopper']],
    [['M', 'C', 'ip.maker'], ['M', 'C', 'oop.cover']],
    [['AM', 'C', 'ip.maker'], ['AM', 'C', 'oop.cover']],
    [['AM', 'R', 'ip.finisher'], ['M', 'R', 'oop.cover']],
    [['ST', 'CL', 'ip.finisher'], ['ST', 'CL', 'oop.stopper']],
    [['ST', 'CR', 'ip.finisher'], ['ST', 'CR', 'oop.cover']]
  ]
  const tactic = tacticOf(SLOTS, 60)

  // 포지션마다 선수 둘~다섯. 능력치는 정해진 씨앗에서 뽑아 같은 점수가 나올 일이 없다
  const draw = seeded(11)
  const NATURAL: Array<[string, RatingKey, number]> = [
    ['GK', 'GK', 2],
    ['D (C)', 'DC', 5],
    ['WB (L)', 'WBL', 2],
    ['WB (R)', 'WBR', 2],
    ['M (C)', 'MC', 3],
    ['AM (C)', 'AMC', 2],
    ['AM (R)', 'AMR', 2],
    ['ST (C)', 'ST', 3]
  ]
  const rows: PlayerRow[] = NATURAL.flatMap(([text, key, count]) =>
    Array.from({ length: count }, (_, i) =>
      player({
        name: `시험 선수 ${key}${i + 1}`,
        position: text,
        levels: Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, 5 + Math.floor(draw() * 13)])),
        ratings: { [key]: 20 }
      })
    )
  )
  const norms = Object.fromEntries(SLOTS.map((_, i) => [FAKE.normKey(profileAt(tactic, i)), { mu: 58 + (i % 3), sigma: 3 + (i % 2) * 0.5 }]))

  function profileAt(of: Tactic, index: number): SlotProfile {
    const slot = of.slots[index]
    const position = (cell: { line: Line; lane: Lane }): PositionKey => {
      const at: Record<Line, [PositionKey | null, PositionKey, PositionKey | null]> = {
        GK: [null, 'GK', null],
        D: ['DL', 'DC', 'DR'],
        DM: ['WBL', 'DM', 'WBR'],
        M: ['ML', 'MC', 'MR'],
        AM: ['AML', 'AMC', 'AMR'],
        ST: [null, 'ST', null]
      }
      return (cell.lane === 'L' ? at[cell.line][0] : cell.lane === 'R' ? at[cell.line][2] : at[cell.line][1])!
    }
    return { ip: { position: position(slot.ip.cell), roleId: slot.ip.roleId }, oop: { position: position(slot.oop.cell), roleId: slot.oop.roleId }, sharePct: 60 }
  }

  const analysis = analyse(rows, tactic, norms)

  it('자리마다 점유 시 포지션이 자리 이름이고, 한 선수는 한 자리다', () => {
    expect(analysis.slots.map((each) => each.slot.position)).toEqual(['GK', 'DC', 'DC', 'DC', 'WBL', 'WBR', 'MC', 'AMC', 'AMR', 'ST', 'ST'])
    expect(analysis.slots.map((each) => each.slot.oopPosition)).toEqual(['GK', 'DC', 'DC', 'DC', 'DL', 'DR', 'MC', 'AMC', 'MR', 'ST', 'ST'])
    const starters = analysis.slots.map((each) => each.slot.starter?.idx)
    expect(starters.every((idx) => idx !== undefined)).toBe(true)
    expect(new Set(starters).size).toBe(11)
  })

  it('묶음: 같은 프로파일만 한 묶음이다(두 국면 포지션이 다른 자리는 다른 묶음). 중앙 수비 셋은 한 묶음, 투톱은 비점유 시 역할이 달라 둘', () => {
    expect(analysis.groups.map((group) => group.id)).toEqual([
      'GK:ip.keeper~GK:oop.keeper',
      'DC:ip.back~DC:oop.stopper',
      'WBL:ip.runner~DL:oop.stopper',
      'WBR:ip.runner~DR:oop.stopper',
      'MC:ip.maker~MC:oop.cover',
      'AMC:ip.maker~AMC:oop.cover',
      'AMR:ip.finisher~MR:oop.cover',
      'ST:ip.finisher~ST:oop.stopper',
      'ST:ip.finisher~ST:oop.cover'
    ])
    expect(analysis.groups.map((group) => group.slots)).toEqual([[0], [1, 2, 3], [4], [5], [6], [7], [8], [9], [10]])
    for (const group of analysis.groups) expect(groupIdOf(group.profile)).toBe(group.id)
    // 두 국면의 포지션이 다른 자리(오른쪽 윙백·왼쪽 윙백·오른쪽 공격)는 같은 점유 시 포지션·역할이어도 비점유 시 포지션이 다르면 다른 묶음이다
    const sameIp = analyse(rows, tacticOf([[['AM', 'R', 'ip.finisher'], ['M', 'R', 'oop.cover']], [['AM', 'L', 'ip.finisher'], ['AM', 'L', 'oop.cover']], [['AM', 'R', 'ip.finisher'], ['AM', 'R', 'oop.cover']]], 60))
    expect(sameIp.groups.map((group) => group.id)).toEqual(['AMR:ip.finisher~MR:oop.cover', 'AML:ip.finisher~AML:oop.cover', 'AMR:ip.finisher~AMR:oop.cover'])
  })

  it('묶음 이름: 같은 점유 시 포지션에 묶음이 여럿이면 점유 시 역할을, 점유 시 역할까지 같으면 비점유 시 포지션과 역할도 붙인다', () => {
    expect(analysis.groups.map((group) => group.label)).toEqual([
      '골키퍼',
      '중앙 수비 (3자리)',
      '왼쪽 윙백',
      '오른쪽 윙백',
      '중앙 미드',
      '공격형 미드',
      '오른쪽 공격',
      '최전방(점유 마무리, 비점유 시 최전방 비점유 압박)',
      '최전방(점유 마무리, 비점유 시 최전방 비점유 커버)'
    ])
    // 점유 시 포지션이 같은 묶음 둘이 점유 시 역할이 다르면 역할만 붙인다
    const twoRoles = analyse(rows, tacticOf([[['AM', 'R', 'ip.finisher'], ['AM', 'R', 'oop.cover']], [['AM', 'C', 'ip.maker'], ['AM', 'C', 'oop.cover']], [['AM', 'C', 'ip.finisher'], ['AM', 'C', 'oop.cover']]], 60))
    expect(twoRoles.groups.map((group) => group.label)).toEqual(['오른쪽 공격', '공격형 미드(점유 조율)', '공격형 미드(점유 마무리)'])
    // 오른쪽 공격(점유 시)이지만 비점유 시 오른쪽 미드로 내려오는 묶음과 그대로 있는 묶음은 점유 시 역할이 같아 비점유 시를 붙여 가른다
    const droppingAndStaying = analyse(rows, tacticOf([[['AM', 'R', 'ip.finisher'], ['M', 'R', 'oop.cover']], [['AM', 'R', 'ip.finisher'], ['AM', 'R', 'oop.cover']]], 60))
    expect(droppingAndStaying.groups.map((group) => group.label)).toEqual(['오른쪽 공격(점유 마무리, 비점유 시 오른쪽 미드 비점유 커버)', '오른쪽 공격(점유 마무리, 비점유 시 오른쪽 공격 비점유 커버)'])
  })

  it('줄 요약은 점유 시 포지션으로 센다: 윙백은 비점유 시 수비로 내려와도 미드필드, 오른쪽 공격은 비점유 시 미드로 내려와도 공격', () => {
    expect(analysis.lines.map((line) => [line.id, line.slots])).toEqual([
      ['goalkeeper', 1],
      ['defence', 3],
      ['midfield', 3],
      ['attack', 4]
    ])
    // 주전 z 평균은 그 줄 주전들의 z_eff 평균이다
    const zOf = (ids: number[]): number => ids.map((i) => analysis.slots[i].starterZ!).reduce((a, b) => a + b, 0) / ids.length
    expect(analysis.lines.find((line) => line.id === 'midfield')!.zAverage).toBeCloseTo(zOf([4, 5, 6]), 10)
    expect(analysis.lines.find((line) => line.id === 'attack')!.zAverage).toBeCloseTo(zOf([7, 8, 9, 10]), 10)
  })

  it('화면 줄: 옛 전술이 아니므로 점유 시 칸 배치(위 → 아래, 줄 안은 왼쪽 → 오른쪽)의 줄이다', () => {
    expect(analysis.formation.rows).toEqual([['ST', 'ST'], ['AMC', 'AMR'], ['MC'], ['WBL', 'WBR'], ['DC', 'DC', 'DC'], ['GK']])
    expect(analysis.slots.map((each) => each.slot.row)).toEqual([5, 4, 4, 4, 3, 3, 2, 1, 1, 0, 0])
    expect([analysis.formation.id, analysis.formation.label]).toEqual(['t', '시험 전술'])
    expect(shapeOfTactic(tactic).rowOf).toEqual(analysis.slots.map((each) => each.slot.row))
  })

  it('전술의 자리 순서(줄 순서)를 섞어도 묶음마다 같은 주전들, 같은 필요도와 비교 기준, 같은 줄 요약이 나온다(같은 프로파일의 자리끼리는 어느 선수가 어느 칸인지만 달라질 수 있다)', () => {
    const draws = seeded(5)
    const startersByGroup = (result: TacticAnalysis) =>
      Object.fromEntries(result.groups.map((group) => [group.id, group.slots.map((index) => result.slots[index].slot.starter?.idx).sort((a, b) => a! - b!)]))
    for (let round = 0; round < 6; round++) {
      const order = SLOTS.map((_, i) => i)
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(draws() * (i + 1))
        ;[order[i], order[j]] = [order[j], order[i]]
      }
      const shuffled = analyse(rows, { ...tactic, slots: order.map((i) => tactic.slots[i]) }, norms)
      expect(startersByGroup(shuffled)).toEqual(startersByGroup(analysis))
      // 묶음에 자리가 하나뿐이면 칸마다 값이 그대로 같다
      order.forEach((original, now) => {
        if (analysis.slots[original].group.slots.length !== 1) return
        expect(shuffled.slots[now].slot.starter?.idx, `칸 ${original}`).toBe(analysis.slots[original].slot.starter?.idx)
        expect(shuffled.slots[now].need, `필요도 ${original}`).toBe(analysis.slots[original].need)
        expect(shuffled.slots[now].starterZ, `z ${original}`).toBe(analysis.slots[original].starterZ)
        expect(shuffled.slots[now].group.id).toBe(analysis.slots[original].group.id)
      })
      const byId = (result: TacticAnalysis) => Object.fromEntries(result.groups.map((group) => [group.id, [group.label, group.slots.length, group.need, group.bench.starter?.name ?? null, group.bench.backup?.name ?? null]]))
      expect(byId(shuffled)).toEqual(byId(analysis))
      expect(shuffled.lines.map((line) => [line.id, line.slots, line.fitAverage, line.needAverage])).toEqual(analysis.lines.map((line) => [line.id, line.slots, line.fitAverage, line.needAverage]))
      for (const line of shuffled.lines) expect(line.zAverage).toBeCloseTo(analysis.lines.find((each) => each.id === line.id)!.zAverage!, 10)
      expect(shuffled.fitAverage).toBe(analysis.fitAverage)
    }
  })

  it('배정의 목적 값: 자리를 채운 몫(숙련 15 이상이면 1000)에 z_eff를 더한 합이고, 채운 자리 수와 임시 주전 수가 함께 나온다', () => {
    const slots = analysis.slots.map((each) => each.slot)
    const result = depthObjective(slots)
    const zs = slots.map((slot) => slot.starter!.z!)
    expect(result.filled).toBe(11)
    expect(result.temporary).toBe(0)
    expect(result.strength).toBeCloseTo(zs.reduce((a, b) => a + b, 0), 10)
    expect(result.objective).toBeCloseTo(11 * 1000 + result.strength, 10)
    // 주전이 모자라면 자리를 못 채운 만큼 1000이 빠져 채운 자리가 많은 전술이 먼저다
    const missing = buildDepthFor(rows.filter((row) => !row.name.includes('ST')), COLUMNS, tactic, context(norms))
    const fewer = depthObjective(missing)
    expect(fewer.filled).toBe(9)
    expect(fewer.objective).toBeLessThan(result.objective - 1000)
    // 임시 주전은 700이다
    const temporary = buildDepthFor([player({ name: '시험 선수 임시', position: 'M (R)', level: 12, ratings: { MR: 20, AMR: 12 } })], COLUMNS, tacticOf([AMR_TO_MR], 60), context())
    expect(depthObjective(temporary)).toMatchObject({ filled: 1, temporary: 1 })
    expect(depthObjective(temporary).objective).toBeCloseTo(K.TEMPORARY_BONUS + depthObjective(temporary).strength, 10)
    expect(depthObjective([])).toEqual({ objective: 0, strength: 0, filled: 0, temporary: 0 })
  })
})

// ---------- 옛 전술의 줄, 최적 역할, 주요 능력치 ----------

describe('옛 전술의 화면 줄은 옛 포메이션 그대로이고, 새 전술(프리셋)은 칸 배치다', () => {
  const squad = syntheticSquad()
  const ctx = { catalog: LEGACY_CATALOG, overrides: {} }

  it('3-4-3만 다르다: 옛 줄은 측면 공격 둘과 최전방이 한 줄(공격 줄)이고, 칸 배치는 공격 줄과 최전방 줄로 나뉜다', () => {
    for (const formation of Object.values(FORMATION_BY_ID)) {
      const old = buildDepthFor(squad, SQUAD_COLUMNS, legacyTactic(formation.id, {}), ctx).map((slot) => slot.row)
      expect(old, formation.id).toEqual(buildDepth(squad, SQUAD_COLUMNS, formation, {}, {}).map((slot) => slot.row))
      expect(old, formation.id).toEqual(formation.rows.flatMap((line, row) => line.map(() => row)))
      const fresh = buildDepthFor(squad, SQUAD_COLUMNS, presetTactic(formation.id, LEGACY_CATALOG), ctx).map((slot) => slot.row)
      if (formation.id === '3-4-3') expect(fresh).not.toEqual(old)
      else expect(fresh, formation.id).toEqual(old)
    }
    const legacy = analyseTactic({ rows: squad, columns: SQUAD_COLUMNS, today: TODAY, tactic: legacyTactic('3-4-3', {}), catalog: LEGACY_CATALOG, roleWeights: {} })!
    const preset = analyseTactic({ rows: squad, columns: SQUAD_COLUMNS, today: TODAY, tactic: presetTactic('3-4-3', LEGACY_CATALOG), catalog: LEGACY_CATALOG, roleWeights: {} })!
    expect(legacy.formation).toBe(FORMATION_BY_ID['3-4-3'])
    expect(legacy.formation.rows[0]).toEqual(['AML', 'ST', 'AMR'])
    expect(preset.formation.rows).toEqual([['ST'], ['AML', 'AMR'], ['MC', 'MC'], ['WBL', 'WBR'], ['DC', 'DC', 'DC'], ['GK']])
    // 줄 번호가 formation.rows의 줄이고, 같은 선수들이 같은 자리 순서로 주전이 된다
    expect(preset.slots.map((each) => each.slot.starter?.idx)).toEqual(legacy.slots.map((each) => each.slot.starter?.idx))
  })

  it('자리를 기준으로 찾는 요청의 두 꼴을 가른다(옛 꼴은 포메이션과 자리별 역할, 새 꼴은 전술)', () => {
    expect(isTacticSlot({ formation: '4-4-2', slotRoles: {}, index: 3 })).toBe(false)
    expect(isTacticSlot({ tactic: legacyTactic('4-4-2', {}), index: 3 })).toBe(true)
  })

  it('옛 꼴로 부른 분석은 옛 전술과 옛 카탈로그를 싣는다', () => {
    const analysis = analyseTactic({ rows: squad, columns: SQUAD_COLUMNS, today: TODAY, formation: '4-4-2', slotRoles: { '4-4-2:3': 'dlp' }, roleWeights: {} })!
    expect(analysis.formation).toBe(FORMATION_BY_ID['4-4-2'])
    expect([analysis.catalogId, analysis.sharePct, analysis.tactic.source, analysis.tactic.id]).toEqual(['legacy14', 100, 'legacy', 'legacy:4-4-2'])
    expect(analysis.slots[3].slot.roleId).toBe('dlp')
    expect(analysis.slots[3].oopRoleLabel).toBe(analysis.slots[3].roleLabel)
    expect(analysis.slots[3].oopPositionLabel).toBe(analysis.slots[3].positionLabel)
    expect(analysis.slots[3].starterOopRating).toBe(analysis.slots[3].starterRating)
    const found = recommendSlotOf(analysis.formation.id, analysis.slots[3])
    expect(found.tacticId).toBe('legacy:4-4-2')
    expect(recommendSlotOf(analysis.formation.id, analysis.slots[3], analysis.tactic.id).tacticId).toBe(analysis.tactic.id)
  })
})

describe('최적 역할과 주요 능력치: 국면마다 하나씩, 합성 가중치에서 무거운 것부터', () => {
  it('최적 역할은 뛸 수 있는 포지션에서 고를 수 있는 역할 가운데 적합도가 가장 높은 것을 국면마다 하나씩이다(손 계산)', () => {
    // 점유 시: 마무리(18·18 → 90점), 조율(8·8 → 40점). 비점유 시: 압박(16·14·12 → 72.5점), 커버(12·10·14 → 60점)
    const row = player({ name: '시험 선수 파', position: 'AM (C)', levels: { finishing: 18, dribbling: 18, passing: 8, vision: 8, tackling: 16, marking: 14, stamina: 12, pace: 10 } })
    const best = bestRolesOf(row, COLUMNS, { catalog: FAKE, overrides: {} })
    expect(best.ip).toEqual({ roleId: 'ip.finisher', label: '점유 마무리', score: 90, uncertain: false })
    expect(best.oop).toEqual({ roleId: 'oop.stopper', label: '비점유 압박', score: 72.5, uncertain: false })
    // 사용자가 고친 가중치가 최적 역할을 바꾼다: 압박이 주력 하나(10이라 50점)만 보게 하면 커버(60점)가 앞선다. 점유 시 쪽은 그대로다
    const edited = bestRolesOf(row, COLUMNS, { catalog: FAKE, overrides: { 'oop.stopper': { tackling: 0, marking: 0, stamina: 0, pace: 1 } } })
    expect(edited.oop).toMatchObject({ roleId: 'oop.cover', score: 60 })
    expect(edited.ip).toEqual(best.ip)
    // 뛸 수 있는 포지션이 없거나 포지션 열이 없으면 둘 다 null이다
    expect(bestRolesOf(player({ name: '시험 선수 하', position: '' }), COLUMNS, { catalog: FAKE, overrides: {} })).toEqual({ ip: null, oop: null })
    expect(bestRolesOf(row, COLUMNS.filter((col) => col.field !== 'position'), { catalog: FAKE, overrides: {} })).toEqual({ ip: null, oop: null })
  })

  it('주요 능력치: 섞은 표를 역할의 눈금(0~5)으로 되돌려 적고, 섞지 않으면 그 역할의 값 그대로다(옛 keyAttributesOf와 같다)', () => {
    const at = (sharePct: number): SlotProfile => ({ ip: { position: 'AMC', roleId: 'ip.finisher' }, oop: { position: 'AMC', roleId: 'oop.stopper' }, sharePct })
    // 비중 60: 합성 가중치 1920·960·960·480·480 × (6.8 / 4800) = 2.72, 1.36, 1.36, 0.68, 0.68. 같으면 게임 화면 순서(드리블, 태클 / 대인 방어, 지구력)
    expect(profileKeyAttributes(FAKE, at(60), {})).toEqual([
      { id: 'finishing', weight: 2.7, core: false },
      { id: 'dribbling', weight: 1.4, core: false },
      { id: 'tackling', weight: 1.4, core: false },
      { id: 'marking', weight: 0.7, core: false },
      { id: 'stamina', weight: 0.7, core: false }
    ])
    // 비중 100은 점유 시 역할 그대로(4와 2), 비중 0은 비점유 시 역할 그대로
    expect(profileKeyAttributes(FAKE, at(100), {})).toEqual([
      { id: 'finishing', weight: 4, core: true },
      { id: 'dribbling', weight: 2, core: false }
    ])
    expect(profileKeyAttributes(FAKE, at(0), {}).map((key) => [key.id, key.weight])).toEqual([['tackling', 4], ['marking', 2], ['stamina', 2]])
    // 두 국면의 역할이 같으면 섞지 않는다: 옛 역할 하나의 keyAttributesOf와 같다
    const centre: SlotProfile = { ip: { position: 'DC', roleId: 'cb' }, oop: { position: 'DC', roleId: 'cb' }, sharePct: 60 }
    expect(profileKeyAttributes(LEGACY_CATALOG, centre, {})).toEqual(keyAttributesOf('cb', {}))
    const edited = { cb: { marking: 5, tackling: 0 } }
    expect(profileKeyAttributes(LEGACY_CATALOG, centre, edited)).toEqual(keyAttributesOf('cb', edited))
  })

  it('포지션 묶음 보기의 주요 능력치: 그 묶음에서 고를 수 있는 점유 시 역할만 평균한다(비점유 시 역할과 못 고르는 역할은 넣지 않는다)', () => {
    const group = (id: string) => POSITION_GROUPS.find((each) => each.id === id)!
    // 골키퍼: 점유 시 골키퍼(손 4·반사신경 2)만 센다. 비점유 시 골키퍼(3·3)까지 평균하면 3.5·2.5가 된다
    expect(groupKeyAttributes(group('gk'), {}, FAKE)).toEqual([
      { id: 'handling', weight: 4, core: true },
      { id: 'reflexes', weight: 2, core: false }
    ])
    // 수비: 점유 시 수비(DC·DL·DR·WBL·WBR)와 점유 시 측면(WBL·WBR 포함) 둘의 평균이다. 태클 (3 + 0) / 2 = 1.5, 속력 (0 + 4) / 2 = 2라 기준(2)을 넘는 것은 속력뿐이다
    // 비점유 시 역할 둘까지 네 역할로 평균하면 지구력 (0 + 2 + 2 + 4) / 4 = 2만 남아 다른 능력치가 된다
    expect(groupKeyAttributes(group('def'), {}, FAKE)).toEqual([{ id: 'pace', weight: 2, core: false }])
    // 사용자가 고친 가중치가 평균에 들어간다: 점유 시 측면의 속력을 0으로 낮추면 평균 0이라 기준을 넘는 능력치가 없다
    expect(groupKeyAttributes(group('def'), { 'ip.runner': { pace: 0 } }, FAKE)).toEqual([])
    // 고를 수 없는 역할(selectable이 거짓)은 평균에 넣지 않는다
    const hidden: CatalogRole = { id: 'ip.hidden', phase: 'ip', label: '숨은 골키퍼', positions: ['GK'], selectable: false, goalkeeper: true }
    const withHidden: RoleCatalog = { ...FAKE, roles: [...FAKE.roles, hidden], baseWeights: (id) => (id === 'ip.hidden' ? { handling: 5 } : FAKE.baseWeights(id)) }
    expect(groupKeyAttributes(group('gk'), {}, withHidden)).toEqual(groupKeyAttributes(group('gk'), {}, FAKE))
  })
})
