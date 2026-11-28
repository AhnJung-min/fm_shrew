/**
 * 합성 골든(2단계 U3): 옛 14역할로 낸 결과를 정밀하게(반올림 없이) 얼린 것과 견준다.
 * 세이브 파일이 없어도 `npm test`마다 돈다(지어낸 선수단 줄 30명과 지어낸 세이브 세계 370명 남짓, tests/helpers/syntheticWorld.ts).
 *
 * 무엇을 얼렸나(tests/fixtures/golden/legacy14.json)
 * - 전술 분석(analyseTactic): 포메이션 5개 × 기준 분포(없음·전부·일부) × 역할 가중치(기본·고침), 자리마다 다른 옛 역할로 바꾼 전술 50개, 맞지 않는 역할 id
 * - 주전 배정(buildDepth): 포메이션 5개와 직접 만든 모양, 기준 분포 유무, 후보 수
 * - 최적 역할(bestRoleOf), 정리 후보와 임대 유망주(surplusReport), 주요 능력치(keyAttributesOf, groupKeyAttributes)
 * - 기준 분포(computeRoleNorms), 후보 찾기(WorldService.candidates: 묶음 × 탭 5개 × 뛸 수 있는 선수만 켬·끔, 역할만 고른 찾기, 조건 몇 가지)
 * - 추천 점수와 풀이 글(recommend), 숙련·나이 감점(effectiveScore, effectiveFit), 유형 판정(categoriesOf), 유망주 판정(prospectCheck)
 *
 * 크기가 크면 지문(SHA-256)으로만 적는다: 값을 그대로 둔 곳은 `value`가 있고, 없는 곳은 `sha256`만 있다.
 * 값은 모두 반올림하지 않은 그대로이고, 풀이 글(이유·설명 문장)도 지문에 들어 있다.
 *
 * 이 골든은 옛 14역할로 못 박은 기준이라 2단계 뒤에도 바뀌지 않는다. 엔진을 일부러 고쳐 값이 바뀌는 날에도 이 파일을 새로 쓰지 않는다
 * (다시 쓸 때는 FMB_UPDATE_GOLDEN=1, 옛 엔진으로 만든 파일과 달라지면 그 이유를 커밋 글에 적는다).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { computeRoleNorms } from '../src/main/roleNorms'
import { SEX_FEMALE } from '../src/main/save/world'
import { firstTeamPlayers, surplusReport, type WageScale } from '../src/shared/dashboard'
import { bestRoleOf, bestRolesOf, buildDepth, buildDepthFor, FORMATION_BY_ID, FORMATIONS, type BestRole, type DepthSlot, type Formation } from '../src/shared/depth'
import { groupKeyAttributes, keyAttributesOf, POSITION_GROUPS, profileKeyAttributes, type KeyAttribute, type PositionGroup } from '../src/shared/keyAttributes'
import type { RoleNorms } from '../src/shared/norms'
import { categoriesOf, effectiveFit, effectiveScore, prospectCheck, type CandidateBench, type CandidateCategory, type FitAdjust } from '../src/shared/world'
import { COMPONENT_ORDER, recommend, type RecommendContext, type RecommendInput } from '../src/shared/recommend'
import { LEGACY_CATALOG } from '../src/shared/roleCatalog'
import { ROLE_BY_ID, ROLES } from '../src/shared/roles'
import { analyseTactic, type SlotGroup, type TacticAnalysis } from '../src/shared/tactic'
import { legacyTactic } from '../src/shared/tacticModel'
import type { ColumnInfo, PlayerRow } from '../src/shared/types'
import { diffJson, formatDiff, type Json } from './helpers/baselineDiff'
import { alternativeRoleVariants, exact, exactAnalysis, exactBench, exactCandidates, exactNorm, exactNorms, exactPlayer } from './helpers/exactSnapshot'
import { EDITED_WEIGHTS, groupAsk, partialNorms, roleAsk, SQUAD_COLUMNS, SYNTHETIC_TODAY, syntheticNorms, syntheticService, syntheticSquad, syntheticWorld } from './helpers/syntheticWorld'

const GOLDEN = join(__dirname, 'fixtures', 'golden', 'legacy14.json')
const UPDATE = process.env.FMB_UPDATE_GOLDEN === '1'
const TABS: CandidateCategory[] = ['starter', 'rotation', 'prospect', 'free', 'all']
const TOP = 30
/** 값을 그대로 적을 때 앞쪽 몇 명까지 적는가(나머지는 지문에만 든다) */
const KEPT_ROWS = 10

// ---------- 엔진: 옛 꼴로 부른다(새 꼴은 같은 파일에서 따로 견준다) ----------

export interface AnalyseArgs {
  rows: PlayerRow[]
  columns: ColumnInfo[]
  formation: string
  slotRoles: Record<string, string>
  roleWeights: Record<string, Record<string, number>>
  norms?: RoleNorms
}

type Overrides = Record<string, Record<string, number>>

interface Engine {
  analyse(args: AnalyseArgs): TacticAnalysis
  depth(rows: PlayerRow[], columns: ColumnInfo[], formation: Formation, slotRoles: Record<string, string>, overrides: Overrides, backupCount: number, norms?: RoleNorms): DepthSlot[]
  bestRole(row: PlayerRow, columns: ColumnInfo[], overrides: Overrides): BestRole | null
  surplus(args: Parameters<typeof surplusReport>[0]): ReturnType<typeof surplusReport>
  keyAttributes(roleId: string, overrides: Overrides): KeyAttribute[]
  groupKeyAttributes(group: PositionGroup, overrides: Overrides): KeyAttribute[]
}

/** 옛 꼴: 포메이션 id와 자리별 역할을 그대로 넘긴다(옛 buildDepth, bestRoleOf, analyseTactic의 formation 입력, keyAttributesOf) */
const OLD_ENGINE: Engine = {
  analyse: (args) => analyseTactic({ ...args, today: SYNTHETIC_TODAY })!,
  depth: (rows, columns, formation, slotRoles, overrides, backupCount, norms) => buildDepth(rows, columns, formation, slotRoles, overrides, backupCount, norms),
  bestRole: (row, columns, overrides) => bestRoleOf(row, columns, overrides),
  surplus: (args) => surplusReport(args),
  keyAttributes: (roleId, overrides) => keyAttributesOf(roleId, overrides),
  groupKeyAttributes: (group, overrides) => groupKeyAttributes(group, overrides)
}

/** 새 꼴: 같은 입력을 옛 전술(legacyTactic)과 LEGACY_CATALOG로 새 함수(analyseTactic의 tactic 입력, buildDepthFor, bestRolesOf, profileKeyAttributes)에 넘긴다 */
const NEW_ENGINE: Engine = {
  analyse: (args) => {
    const { formation, slotRoles, ...rest } = args
    return analyseTactic({ ...rest, today: SYNTHETIC_TODAY, tactic: legacyTactic(formation, slotRoles), catalog: LEGACY_CATALOG })!
  },
  depth: (rows, columns, formation, slotRoles, overrides, backupCount, norms) => {
    const registered = FORMATION_BY_ID[formation.id] === formation
    // 포메이션 목록에 없는 모양은 옛 줄 번호(formation.rows)를 새 길로 낼 수 없어(전술은 id로 포메이션을 찾는다) 껍데기(buildDepth)로 부른다
    if (!registered) return buildDepth(rows, columns, formation, slotRoles, overrides, backupCount, norms)
    return buildDepthFor(rows, columns, legacyTactic(formation.id, slotRoles), { catalog: LEGACY_CATALOG, overrides, norms }, backupCount)
  },
  bestRole: (row, columns, overrides) => {
    const both = bestRolesOf(row, columns, { catalog: LEGACY_CATALOG, overrides })
    // 국면이 없는 옛 14역할은 두 국면의 최적 역할이 같다
    expect(both.oop).toEqual(both.ip)
    return both.ip
  },
  surplus: (args) => surplusReport({ ...args, catalog: LEGACY_CATALOG }),
  keyAttributes: (roleId, overrides) => {
    const role = ROLE_BY_ID[roleId]
    const spot = { position: role.positions[0], roleId }
    return profileKeyAttributes(LEGACY_CATALOG, { ip: spot, oop: { ...spot }, sharePct: 100 }, overrides)
  },
  groupKeyAttributes: (group, overrides) => groupKeyAttributes(group, overrides, LEGACY_CATALOG)
}

// ---------- 지문과 부분 적기 ----------

const sha256 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** 값의 지문을 적고, clear가 참이면 값도 그대로 적는다 */
function part(value: Json, clear: boolean): Json {
  return clear ? { sha256: sha256(value), value } : { sha256: sha256(value) }
}

/** 위·아래 두 층까지만 줄을 나눠 적는다(깊은 곳은 한 줄). 골든을 열어 볼 수 있게 하되 줄 수가 폭주하지 않게 한다 */
function pretty(value: Json, depth = 0): string {
  if (depth < 2 && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const lines = Object.entries(value).map(([key, each]) => `${' '.repeat(depth + 1)}${JSON.stringify(key)}: ${pretty(each, depth + 1)}`)
    return `{\n${lines.join(',\n')}\n${' '.repeat(depth)}}`
  }
  return JSON.stringify(value)
}

// ---------- 풀이 글과 요약 ----------

/** 분석 안의 글(이유, 항목 설명, 선수 설명, 이름): 숫자는 exactAnalysis가 맡고 글은 따로 모은다 */
function textsOf(analysis: TacticAnalysis): Json {
  return {
    slots: Object.fromEntries(
      analysis.slots.map((each) => [
        String(each.slot.index),
        {
          label: each.label,
          positionLabel: each.positionLabel,
          roleLabel: each.roleLabel,
          levelLabel: each.levelLabel,
          reason: each.reason,
          factors: each.factors.map((factor) => factor.note),
          options: each.options.map((option) => option.note),
          groupLabel: each.group.label,
          groupReason: each.group.reason
        }
      ])
    ),
    groups: analysis.groups.map((group) => [group.id, group.label, group.roleLabel, group.levelLabel, group.reason]),
    lines: analysis.lines.map((line) => [line.id, line.label])
  }
}

/** 한눈에 보는 요약(지문만 있는 곳에서 어느 자리가 달라졌는지 짐작하게 한다) */
function headlineOf(analysis: TacticAnalysis): Json {
  return {
    formation: { id: analysis.formation.id, label: analysis.formation.label, rows: analysis.formation.rows },
    positions: analysis.slots.map((each) => each.slot.position),
    roles: analysis.slots.map((each) => each.slot.roleId),
    rowOf: analysis.slots.map((each) => each.slot.row),
    starters: analysis.slots.map((each) => each.slot.starter?.idx ?? null),
    groupIds: analysis.groups.map((group) => group.id),
    need: analysis.slots.map((each) => exact(each.need)),
    fitAverage: exact(analysis.fitAverage),
    needAverage: exact(analysis.needAverage)
  }
}

/** 분석 하나: 값(지문, clear이면 그대로도), 글(지문만. 이름이 든 글을 저장소에 그대로 두지 않는다), 요약 */
function analysisEntry(analysis: TacticAnalysis, clear: boolean): Json {
  return { numbers: part(exactAnalysis(analysis), clear), texts: part(textsOf(analysis), false), headline: headlineOf(analysis) }
}

/** 배정 결과 한 벌: 자리마다 주전과 후보 */
function depthJson(slots: DepthSlot[]): Json {
  return slots.map((slot) => ({
    index: slot.index,
    row: slot.row,
    position: slot.position,
    roleId: slot.roleId,
    starter: slot.starter ? exactPlayer(slot.starter) : null,
    backups: slot.backups.map(exactPlayer),
    weak: slot.weak,
    thin: slot.thin
  }))
}

/** 정리 후보와 임대 유망주: 이름과 이유 글은 빼고(글은 지문으로만) 나머지는 반올림 없이 그대로 */
function surplusJson(report: ReturnType<typeof surplusReport>): Json {
  const strip = (row: object): Json => {
    const { name: _name, reason: _reason, ...rest } = JSON.parse(JSON.stringify(row)) as Record<string, Json>
    return rest
  }
  return {
    rows: report.rows.map(strip),
    prospects: report.prospects.map(strip),
    reasons: sha256([...report.rows.map((row) => [row.name, row.reason]), ...report.prospects.map((row) => [row.name, row.reason])])
  }
}

// ---------- 골든을 만든다 ----------

const BAD_ROLE_VARIANTS: Array<{ key: string; slotRoles: Record<string, string> }> = [
  { key: '모르는 역할 id', slotRoles: { '4-2-3-1:2': '없는역할', '4-2-3-1:7': '' } },
  { key: '다른 포지션의 역할', slotRoles: { '4-2-3-1:0': 'cb', '4-2-3-1:6': 'st', '4-2-3-1:10': 'winger' } },
  { key: '다른 포메이션의 칸', slotRoles: { '4-4-2:3': 'dlp', '4-3-3:3': 'dlp' } }
]

/** 직접 만든 포메이션(옛 시험이 쓰는 꼴): 이름이 포메이션 목록에 없다 */
const CUSTOM_FORMATIONS: Formation[] = [
  { id: 'test', label: 'test', rows: [['ST'], ['DC', 'DC']] },
  { id: 'keeper-only', label: 'keeper-only', rows: [['GK']] },
  { id: 'three-up', label: 'three-up', rows: [['AML', 'ST', 'AMR'], ['MC', 'MC', 'DM'], ['DC', 'DC', 'DC'], ['GK']] },
  { id: 'empty', label: 'empty', rows: [] }
]

const NORM_CASES: Array<[string, RoleNorms | undefined]> = [
  ['기준 분포 없음', undefined],
  ['기준 분포 전부', syntheticNorms()],
  ['기준 분포 일부', partialNorms()]
]
const WEIGHT_CASES: Array<[string, Record<string, Record<string, number>>]> = [
  ['기본 가중치', {}],
  ['고친 가중치', EDITED_WEIGHTS]
]

/** 선수단 줄만으로 하는 계산(세이브 없이) */
function squadPart(engine: Engine): Record<string, Json> {
  const rows = syntheticSquad()
  const columns = SQUAD_COLUMNS
  const full = syntheticNorms()
  const keep = (formation: string, norms: string, weights: string): boolean => formation === '4-2-3-1' && norms === '기준 분포 전부' && weights === '기본 가중치'

  // 1) 전술 분석: 포메이션 5개 × 기준 분포 3 × 가중치 2
  const analyses: Record<string, Json> = {}
  for (const formation of FORMATIONS) {
    for (const [normsName, norms] of NORM_CASES) {
      for (const [weightsName, roleWeights] of WEIGHT_CASES) {
        const analysis = engine.analyse({ rows, columns, formation: formation.id, slotRoles: {}, roleWeights, norms })
        analyses[`${formation.id}/${normsName}/${weightsName}`] = analysisEntry(analysis, keep(formation.id, normsName, weightsName))
      }
    }
  }

  // 2) 자리 하나씩 다른 옛 역할로 바꾼 전술(기준 분포 전부, 기본 가중치)과 맞지 않는 역할 id
  const variants: Record<string, Json> = {}
  for (const variant of alternativeRoleVariants(FORMATIONS)) {
    variants[variant.key] = analysisEntry(engine.analyse({ rows, columns, formation: variant.formation, slotRoles: variant.slotRoles, roleWeights: {}, norms: full }), false)
  }
  for (const bad of BAD_ROLE_VARIANTS) {
    variants[bad.key] = analysisEntry(engine.analyse({ rows, columns, formation: '4-2-3-1', slotRoles: bad.slotRoles, roleWeights: {}, norms: full }), false)
  }
  variants['모르는 포메이션'] = analysisEntry(engine.analyse({ rows, columns, formation: '없는포메이션', slotRoles: {}, roleWeights: {}, norms: full }), false)

  // 3) 주전 배정 그 자체
  const depth: Record<string, Json> = {}
  for (const formation of FORMATIONS) {
    for (const [normsName, norms] of NORM_CASES.slice(0, 2)) {
      const slots = depthJson(engine.depth(rows, columns, formation, {}, {}, 2, norms))
      depth[`${formation.id}/${normsName}`] = part(slots, (formation.id === '4-2-3-1' && norms !== undefined) || (formation.id === '3-4-3' && norms === undefined))
    }
  }
  depth['4-2-3-1/후보 0명'] = part(depthJson(engine.depth(rows, columns, FORMATION_BY_ID['4-2-3-1'], {}, {}, 0, full)), false)
  depth['4-2-3-1/후보 1명'] = part(depthJson(engine.depth(rows, columns, FORMATION_BY_ID['4-2-3-1'], {}, {}, 1, full)), false)
  depth['4-2-3-1/후보 4명'] = part(depthJson(engine.depth(rows, columns, FORMATION_BY_ID['4-2-3-1'], {}, {}, 4, full)), false)
  depth['4-4-2/고친 가중치'] = part(depthJson(engine.depth(rows, columns, FORMATION_BY_ID['4-4-2'], { '4-4-2:3': 'dlp', '4-4-2:8': 'bpd' }, EDITED_WEIGHTS, 2, full)), false)
  for (const custom of CUSTOM_FORMATIONS) {
    depth[`직접 만든 ${custom.id}`] = part(depthJson(engine.depth(rows, columns, custom, {}, {}, 2, full)), true)
    depth[`직접 만든 ${custom.id}/선수 없음`] = part(depthJson(engine.depth([], columns, custom, {}, {}, 2, full)), true)
  }
  depth['4-4-2/선수 없음'] = part(depthJson(engine.depth([], columns, FORMATION_BY_ID['4-4-2'], {}, {}, 2)), false)

  // 4) 최적 역할
  const bestRoles: Record<string, Json> = {}
  for (const [weightsName, roleWeights] of WEIGHT_CASES) {
    const found = Object.fromEntries(
      rows.map((row) => {
        const best = engine.bestRole(row, columns, roleWeights)
        return [String(row.idx), best ? { roleId: best.roleId, label: best.label, score: exact(best.score), uncertain: best.uncertain } : null]
      })
    )
    bestRoles[weightsName] = part(found, weightsName === '기본 가중치')
  }
  bestRoles['포지션 열 없음'] = { isNull: engine.bestRole(rows[0], columns.filter((col) => col.field !== 'position'), {}) === null }

  // 5) 정리 후보와 임대 유망주
  const wageModel: WageScale = { a: 9.6, b: 0.012, b2: -0.0008, c1: -0.12, c2: 0.08, s: 0.55 }
  const players = firstTeamPlayers(rows, columns)
  const loanedIn = new Set(rows.filter((row) => row.loan).map((row) => row.idx))
  const surplus: Record<string, Json> = {}
  for (const formation of ['4-2-3-1', '3-5-2']) {
    for (const [normsName, norms] of NORM_CASES.slice(0, 2)) {
      const analysis = engine.analyse({ rows, columns, formation, slotRoles: {}, roleWeights: {}, norms })
      for (const [shown, minScore] of [['기본', undefined], ['모두', 0]] as const) {
        const report = engine.surplus({ players, rows, columns, analysis, roleWeights: {}, norms, wageModel, loanedIn, minScore })
        surplus[`${formation}/${normsName}/${shown}`] = part(surplusJson(report), normsName === '기준 분포 전부' && shown === '기본')
      }
    }
  }
  const noWage = engine.surplus({ players, rows, columns, analysis: engine.analyse({ rows, columns, formation: '4-4-2', slotRoles: {}, roleWeights: EDITED_WEIGHTS, norms: full }), roleWeights: EDITED_WEIGHTS, norms: full, minScore: 0 })
  surplus['4-4-2/주급 모델 없음/고친 가중치'] = part(surplusJson(noWage), false)

  // 6) 주요 능력치
  const keys: Record<string, Json> = {}
  for (const [weightsName, roleWeights] of WEIGHT_CASES) {
    keys[`역할마다/${weightsName}`] = part(Object.fromEntries(ROLES.map((role) => [role.id, engine.keyAttributes(role.id, roleWeights).map((key) => [key.id, key.weight, key.core])])), weightsName === '기본 가중치')
    keys[`포지션 묶음/${weightsName}`] = part(
      Object.fromEntries(POSITION_GROUPS.map((group) => [group.id, engine.groupKeyAttributes(group, roleWeights).map((key) => [key.id, key.weight, key.core])])),
      weightsName === '기본 가중치'
    )
  }
  return { analyses, variants, depth, bestRoles, surplus, keys }
}

/** 한 번의 추천 점수 입력: recommend.test.ts의 꼴(지어낸 값) */
function recommendInput(over: Partial<RecommendInput>): RecommendInput {
  return {
    category: 'all',
    goalkeeper: false,
    roleScore: 71.3,
    roleRating: 20,
    age: 26,
    ca: 140,
    pa: 150,
    value: 6_000_000,
    wage: 60_000,
    contractEnd: 2028 * 1000 + 181,
    squadStatus: 4,
    hasClub: true,
    sellerStature: 138,
    signedWith: null,
    traits: { consistency: 13, injuryProneness: 7, importantMatches: 12, naturalFitness: 14, determination: 15, dirtiness: 6 },
    ...over
  }
}

/** 감점 풀이에서 옛부터 있던 다섯 칸만 적는다(새로 더하는 칸은 골든에 넣지 않는다) */
const fitJson = (fit: FitAdjust): Json => ({ shown: fit.shown, effective: fit.effective, positionPoints: fit.positionPoints, positionSigma: fit.positionSigma, agePoints: fit.agePoints })

/** 숙련·나이·추천 점수의 격자(세이브 없이). 값이 많아 지문만 적고, 풀이 글도 지문에 든다 */
function gridPart(): Record<string, Json> {
  const norm = syntheticNorms().cb
  const bench: CandidateBench = {
    starter: { name: '시험 주전', score: 68.4, ca: 138, age: 33, shownScore: 70.2 },
    backup: { name: '시험 후보', score: 65.1, shownScore: 66.0, age: 30 },
    thin: false
  }
  const context: RecommendContext = {
    starter: bench.starter,
    backup: { score: bench.backup!.score, shownScore: bench.backup!.shownScore },
    today: { year: 2026, day: 3 },
    money: { medianWage: 52_000, topWage: 110_000, medianValue: 4_000_000, topValue: 14_000_000 },
    myStature: 140,
    need: 62,
    norm,
    groupSlots: 2
  }
  const ratings = [null, 1, 5, 9, 10, 12, 14, 15, 16, 19, 20]
  const ages = [null, 18, 24, 31, 35]
  const recommended: Json[] = []
  for (const category of ['all', 'starter', 'rotation', 'prospect', 'free'] as CandidateCategory[]) {
    for (const roleRating of ratings) {
      for (const age of ages) {
        for (const goalkeeper of [false, true]) {
          for (const hasClub of [true, false]) {
            const result = recommend(recommendInput({ category, roleRating, age, goalkeeper, hasClub, roleScore: 60 + ((roleRating ?? 3) % 7) * 2.35 }), context)
            recommended.push({
              total: result.total,
              base: result.base,
              gate: result.gate,
              gateNote: result.gateNote,
              fit: fitJson(result.fit),
              fitNote: result.fitNote,
              components: COMPONENT_ORDER.map((id) => {
                const component = result.components.find((each) => each.id === id)!
                return [component.points, component.max, component.counted, component.assumed, component.note]
              }),
              warnings: result.warnings,
              realism: result.realism
            } as unknown as Json)
          }
        }
      }
    }
  }
  const fits: Json[] = []
  const categories: Json[] = []
  const prospects: Json[] = []
  for (const rating of [null, undefined, ...Array.from({ length: 20 }, (_, i) => i + 1)]) {
    for (const age of [null, undefined, 17, 23, 30, 31, 34, 37]) {
      for (const goalkeeper of [false, true]) {
        fits.push([effectiveScore(71.37, rating, age, norm.sigma, goalkeeper), fitJson(effectiveFit(71.37, rating, age, norm, goalkeeper))])
      }
    }
  }
  for (const rating of [null, 8, 13, 16, 20]) {
    for (const age of [null, 19, 22, 23, 24, 29, 33]) {
      for (const score of [60, 64.9, 66.5, 68.4, 71, 76.2]) {
        for (const hasClub of [true, false]) {
          const player = { score, age, ca: 132, pa: age !== null && age < 24 ? 170 : 134, hasClub, rating }
          categories.push(categoriesOf(player, bench, norm, false) as unknown as Json)
          prospects.push(prospectCheck(player, bench, norm, false) as unknown as Json)
          categories.push(categoriesOf(player, { ...bench, thin: true }, norm, true) as unknown as Json)
          prospects.push(prospectCheck({ ...player, ca: 100 }, { starter: null, backup: null }, norm, true) as unknown as Json)
        }
      }
    }
  }
  return {
    recommend: part(recommended, false),
    fits: part(fits, false),
    categories: part(categories, false),
    prospects: part(prospects, false),
    sizes: { recommend: recommended.length, fits: fits.length, categories: categories.length, prospects: prospects.length }
  }
}

/** 세이브 세계로 하는 계산: 기준 분포, 스쿼드 분석, 후보 찾기 */
function worldPart(engine: Engine, namesDirs: string[]): Record<string, Json> {
  const world = syntheticWorld()
  const female = Uint8Array.from(world.sex, (sex) => (sex === SEX_FEMALE ? 1 : 0))
  const norms: Record<string, Json> = {}
  const direct = computeRoleNorms(world, {}, female)
  norms['기본 가중치'] = part(exactNorms(direct), true)
  norms['고친 가중치'] = part(exactNorms(computeRoleNorms(world, EDITED_WEIGHTS, female)), false)

  const { ws, namesDir } = syntheticService(world)
  namesDirs.push(namesDir)
  const squad = ws.squad()
  expect(squad.ok, squad.message).toBe(true)
  // 기준 분포는 서비스가 주는 것이 위 직접 구한 것과 같다
  expect(JSON.stringify(exactNorms(squad.roleNorms))).toBe(JSON.stringify(exactNorms(direct)))

  const analyses: Record<string, Json> = {}
  const candidates: Record<string, Json> = {}
  let dcGroup: SlotGroup | null = null
  const texts = (result: ReturnType<typeof ws.candidates>): Json =>
    result.rows.slice(0, 5).map((row) => ({
      fitNote: row.recommend.fitNote,
      gateNote: row.recommend.gateNote,
      notes: row.recommend.components.map((component) => component.note),
      warnings: row.recommend.warnings,
      reasons: row.recommend.realism.reasons
    }))
  const listOf = (result: ReturnType<typeof ws.candidates>): Json => ({
    detail: exactCandidates(result, TOP),
    bench: exactBench(result.bench),
    norm: result.norm ? exactNorm(result.norm) : null,
    group: result.group ?? null,
    ok: result.ok,
    texts: texts(result)
  })
  for (const formation of FORMATIONS) {
    const analysis = engine.analyse({ rows: squad.rows, columns: squad.columns, formation: formation.id, slotRoles: {}, roleWeights: {}, norms: squad.roleNorms })
    analyses[formation.id] = analysisEntry(analysis, false)
    if (formation.id === '4-2-3-1') dcGroup = analysis.groups.find((group) => group.position === 'DC') ?? null
    for (const group of analysis.groups) {
      const lists: Record<string, Json> = {}
      for (const category of TABS) {
        for (const widest of [false, true]) lists[`${category}/${widest ? '가장 넓은' : '뛸 수 있는 선수만'}`] = listOf(ws.candidates(groupAsk(group, formation.id, category, widest)))
      }
      const clear = formation.id === '4-2-3-1' && group.position === 'DC'
      // 값을 그대로 적는 두 묶음은 탭 둘만(앞 KEPT_ROWS명), 나머지는 지문으로만
      candidates[`${formation.id}/${group.id}`] = {
        sha256: sha256(lists),
        counts: Object.fromEntries(Object.entries(lists).map(([key, each]) => [key, (each as { detail: { counts: Json; matched: number } }).detail.counts])),
        ...(clear
          ? {
              value: Object.fromEntries(
                ['starter/뛸 수 있는 선수만', 'all/가장 넓은'].map((key) => {
                  const { texts: _texts, ...each } = lists[key] as { detail: { rows: Record<string, Json> }; texts: Json }
                  return [key, { ...each, detail: { ...each.detail, rows: Object.fromEntries(Object.entries(each.detail.rows).slice(0, KEPT_ROWS)) } }]
                })
              )
            }
          : {})
      }
    }
  }

  // 역할만 고른 찾기(전술의 자리를 기준으로 하지 않는다)
  const roleOnly: Record<string, Json> = {}
  for (const role of ROLES) {
    const lists: Record<string, Json> = {}
    for (const category of ['all', 'starter', 'prospect'] as CandidateCategory[]) lists[category] = listOf(ws.candidates(roleAsk(role.id, category)))
    roleOnly[role.id] = part(lists, false)
  }

  // 조건 몇 가지: 이름 찾기, 나이 제한, 계약 만료, 소속 모르는 구단, 뛸 수 없는 선수
  const conditions: Record<string, Json> = {}
  const base = groupAsk(dcGroup!, '4-2-3-1', 'all')
  const variants: Array<[string, Partial<typeof base>]> = [
    ['이름 찾기', { search: '시험 선수 01' }],
    ['나이 제한 22', { maxAge: 22 }],
    ['계약 12개월 안', { expiringWithinMonths: 12 }],
    ['소속 모르는 구단 넣기', { includeUnknownClub: true }],
    ['뛸 수 없는 선수도', { onlyEligible: false }],
    ['모든 조건', { maxAge: 28, expiringWithinMonths: 24, includeUnknownClub: true, onlyEligible: false, search: '시험' }]
  ]
  for (const [name, over] of variants) conditions[name] = part(listOf(ws.candidates({ ...base, ...over })), false)
  // 고친 가중치로 여는 서비스
  const edited = syntheticService(world, EDITED_WEIGHTS)
  namesDirs.push(edited.namesDir)
  const editedAnalysis = engine.analyse({ rows: squad.rows, columns: squad.columns, formation: '4-2-3-1', slotRoles: {}, roleWeights: EDITED_WEIGHTS, norms: edited.ws.roleNorms() ?? undefined })
  conditions['고친 가중치 분석'] = analysisEntry(editedAnalysis, false)
  conditions['고친 가중치 후보 찾기'] = part(listOf(edited.ws.candidates(groupAsk(editedAnalysis.groups.find((group) => group.position === 'DC')!, '4-2-3-1', 'all'))), false)
  return { norms, analyses, candidates, roleOnly, conditions }
}

/** 골든 전체를 만든다 */
export function buildGolden(engine: Engine, namesDirs: string[]): Json {
  return {
    format: 'golden-legacy14',
    note: '옛 14역할로 낸 결과를 반올림 없이 적은 것이다. 값을 그대로 둔 곳은 value가 있고, 나머지는 sha256(JSON 글자의 SHA-256)만 있다. 엔진을 고쳐도 이 파일은 바뀌지 않는다.',
    squad: squadPart(engine),
    grids: gridPart(),
    world: worldPart(engine, namesDirs)
  }
}

// ---------- 시험 ----------

describe('합성 골든(옛 14역할): 옛 꼴로 부른 결과가 얼려 둔 것과 같다', () => {
  const namesDirs: string[] = []
  afterAll(() => {
    for (const dir of namesDirs) rmSync(dir, { recursive: true, force: true })
  })

  it(
    '골든과 차이가 0이다(FMB_UPDATE_GOLDEN=1이면 새로 쓴다)',
    () => {
      const snapshot = JSON.parse(JSON.stringify(buildGolden(OLD_ENGINE, namesDirs))) as Json
      if (UPDATE) {
        mkdirSync(dirname(GOLDEN), { recursive: true })
        writeFileSync(GOLDEN, `${pretty(snapshot)}\n`)
        console.log(`[골든] 새로 썼습니다: ${GOLDEN} (${Math.round(Buffer.byteLength(pretty(snapshot)) / 1024)}KB)`)
        return
      }
      expect(existsSync(GOLDEN), `골든 파일이 없습니다. FMB_UPDATE_GOLDEN=1로 먼저 만드세요: ${GOLDEN}`).toBe(true)
      const lines = diffJson(JSON.parse(readFileSync(GOLDEN, 'utf8')) as Json, snapshot)
      const text = formatDiff(lines)
      console.log(`[골든 대조]\n${text}`)
      expect(lines.length, text).toBe(0)
    },
    120_000
  )

  it(
    '새 꼴(전술과 카탈로그, buildDepthFor, bestRolesOf, profileKeyAttributes)로 부른 결과도 같은 골든과 차이가 0이다',
    () => {
      expect(existsSync(GOLDEN), `골든 파일이 없습니다. FMB_UPDATE_GOLDEN=1로 먼저 만드세요: ${GOLDEN}`).toBe(true)
      const snapshot = JSON.parse(JSON.stringify(buildGolden(NEW_ENGINE, namesDirs))) as Json
      const lines = diffJson(JSON.parse(readFileSync(GOLDEN, 'utf8')) as Json, snapshot)
      const text = formatDiff(lines)
      console.log(`[골든 대조(새 꼴)]\n${text}`)
      expect(lines.length, text).toBe(0)
    },
    120_000
  )

  it('같은 입력으로 두 번 만들면 같다(선수단 줄만, 빠르게)', () => {
    const once = JSON.stringify(squadPart(OLD_ENGINE))
    expect(JSON.stringify(squadPart(OLD_ENGINE))).toBe(once)
  })

  it('골든 파일은 200KB를 넘지 않고, 선수 이름을 그대로 담지 않는다(이름이 든 풀이 글은 지문으로만 있다)', () => {
    if (!existsSync(GOLDEN)) return
    const text = readFileSync(GOLDEN, 'utf8')
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(200 * 1024)
    expect(text).not.toContain('"name"')
    expect(text).not.toContain('시험 선수')
  })

  it('이 골든이 실제로 잡는다: 값 하나를 바꾸면 차이가 나온다', () => {
    const snapshot = JSON.parse(JSON.stringify(squadPart(OLD_ENGINE))) as Record<string, Json>
    const changed = JSON.parse(JSON.stringify(snapshot)) as Record<string, Json>
    const analyses = changed.analyses as Record<string, { headline: { need: number[] } }>
    analyses['4-2-3-1/기준 분포 전부/기본 가중치'].headline.need[0] += 0.1
    expect(diffJson(snapshot as Json, changed as Json).length).toBe(1)
  })
})
