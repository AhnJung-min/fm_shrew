import { buildDepthFor, depthObjective, slotRatingsOf, type DepthSlot } from './depth'
import { K } from './ledger'
import { TACTIC_NAME_MAX } from './limits'
import { FALLBACK_NORM, normOf, zOf, type RoleNorm, type RoleNorms } from './norms'
import { profileWeights, type Evidence, type RoleCatalog, type RoleOverrides } from './roleCatalog'
import { attributesOf, scoreRole, type AttributeValue, type PositionKey } from './roles'
import { mixedPenaltySigma, type Phase, type SlotProfile, type Weights } from './slotProfile'
import { POSITION_LABEL, type Ymd } from './tactic'
import type { SlotSuggestion, TacticCandidate } from './tacticApi'
import { profileOf, sharePctOf, slotKindOf, type Tactic } from './tacticModel'
import type { ColumnInfo, PlayerRow } from './types'

/**
 * 전술 추천 탐색(A-20): 내 선수단에 맞는 자리 역할을 찾고, 지금 전술과 프리셋 전술을 순위로 견준다. 순수 계산이다(세이브와 게임을 읽지 않는다).
 *
 * 한 시작점(지금 전술, 프리셋 하나)에서 이렇게 한다. 자리의 칸(포지션)은 그대로 두고 역할 짝(공 소유 시 역할, 공 미소유 시 역할)만 바꾼다.
 *   1. 배정(buildDepthFor)으로 자리마다 주전을 정한다.
 *   2. 자리마다 그 주전에게 z_eff가 가장 큰 역할 짝을 고른다(그 칸 종류의 목록 안에서. 동점이면 지금 짝, 그다음 카탈로그 순서).
 *   3. 짝을 바꾼 전술로 다시 배정한다. 배정의 목적 값(depthObjective)이 엄격히 오를 때만 받아들이고 되풀이한다. 최대 maxRounds번이고, 오르지 않으면 멈춘다.
 * 순위는 목적 값이다(채운 자리가 먼저, 그다음 주전 전력 합). 지금 전술은 바꾸지 않은 모습으로도 목록에 들어가고 그 시작점의 결과가 늘 그 이상이라서,
 * 1위의 목적 값은 언제나 지금 전술 이상이다. 같은 입력이면 늘 같은 결과이고, 선수 줄의 순서를 섞어도 같다(배정이 선수 번호 순으로 정한다).
 *
 * 지금 전술의 자리별 제안(P1)은 같은 계산에서 나온다: 그 자리의 짝만 바꿔 다시 배정한 목적 값이 ROLE_SWAP_MIN_GAIN 이상 오르는 것.
 * 제안의 이득(gain)은 두 목적 값의 차이 그대로다(채운 자리 수가 같으면 주전 전력 합의 차이다).
 *
 * 게임에서 확인하지 못한 역할(근거가 inferred·unknown)도 후보에 넣되 센다(unconfirmed). 사용자 역할(근거 user)은 후보에서 뺀다.
 * 기준 분포는 시작점마다 그 시작점의 모든 후보 짝을 한꺼번에 normsFor로 받는다. 받지 못한 열쇠는 고정 기준(FALLBACK_NORM)으로 채워서
 * 어떤 짝은 z로, 어떤 짝은 점수 그대로 견주게 되는 일이 없게 한다.
 */

/** 전술 추천 결과 위에 늘 고정해 보이는 말(순위를 "강한 전술"이라는 뜻으로 읽지 않게) */
export const RECOMMEND_NOTE = '선수에게 맞는 전술이라는 뜻이지, 강한 전술이라는 뜻은 아닙니다.'

export interface SearchInput {
  rows: PlayerRow[]
  columns: ColumnInfo[]
  /** 게임 속 오늘. 지금의 배정은 나이를 보지 않아 쓰지 않지만, 호출하는 쪽이 모양을 바꾸지 않아도 되게 받아 둔다 */
  today?: Ymd
  catalog: RoleCatalog
  overrides: RoleOverrides
  /** 지금 전술 */
  current: Tactic
  /** 프리셋 전술들(지금 전술의 비중으로 바꿔서 시작점으로 쓴다) */
  presets: Tactic[]
  /** 프로파일마다 기준 분포(열쇠 = 카탈로그의 normKey). 시작점마다 한 번 부른다 */
  normsFor(profiles: SlotProfile[]): RoleNorms
  /** 한 시작점에서 짝을 바꿔 다시 배정하는 최대 횟수(SEARCH_MAX_ROUNDS) */
  maxRounds: number
}

export interface SearchOutput {
  ranked: TacticCandidate[]
  suggestions: SlotSuggestion[]
}

/** 시작점 하나를 끝낼 때마다 알리는 진행 */
export interface SearchProgress {
  done: number
  total: number
}

/** 한 자리에서 고르는 역할 짝 */
interface Pair {
  ip: string
  oop: string
}

/** 시작 전술의 한 자리: 칸의 포지션과 고를 수 있는 짝 전부(카탈로그 순서, 사용자 역할 제외) */
interface SlotPlan {
  ipPosition: PositionKey
  oopPosition: PositionKey
  pairs: Pair[]
}

interface PlayerData {
  attrs: Record<string, AttributeValue>
  ratings: readonly number[] | undefined
}

interface Objective {
  objective: number
  strength: number
  filled: number
  temporary: number
}

interface Session {
  input: SearchInput
  maxRounds: number
  players: Map<number, PlayerData>
  norms: RoleNorms
  weights: Map<string, Weights>
}

/** 시작점 하나를 끝까지 돌린 결과 */
export interface StartRun {
  /** 끝난 전술(시작 전술에서 짝만 바뀐 것. 바뀐 것이 없으면 시작 전술과 같은 모양) */
  tactic: Tactic
  /** 시작 전술의 목적 값 */
  startObjective: number
  /** 끝난 전술의 목적 값(시작 이상) */
  objective: number
  /** 짝을 바꿔 다시 배정해 본 횟수(받아들이지 않은 마지막 시도도 센다. maxRounds 이하) */
  rounds: number
}

interface RunDetail extends StartRun {
  plans: SlotPlan[]
  startDepth: DepthSlot[]
  start: Objective
  end: Objective
}

// ---------- 준비 ----------

function openSession(input: SearchInput): Session {
  const players = new Map<number, PlayerData>()
  for (const row of input.rows) players.set(row.idx, { attrs: attributesOf(row, input.columns), ratings: row.ratings })
  return {
    input,
    maxRounds: Number.isNaN(input.maxRounds) ? 0 : Math.max(0, Math.floor(input.maxRounds)),
    players,
    norms: {},
    weights: new Map()
  }
}

/** 기준 분포를 받지 못한 프로파일에 쓰는 고정 기준(norms.ts의 FALLBACK_NORM과 같은 값을 받아 적은 평범한 객체) */
function plainFallback(): RoleNorm {
  return { mu: FALLBACK_NORM.mu, sigma: FALLBACK_NORM.sigma, beta: FALLBACK_NORM.beta, n: 0, caRef: FALLBACK_NORM.caRef }
}

/** 아직 없는 프로파일의 기준 분포를 한꺼번에 받는다. 받지 못한 것은 고정 기준으로 채운다 */
function ensureNorms(session: Session, profiles: SlotProfile[]): void {
  const { catalog, normsFor } = session.input
  const wanted = new Map<string, SlotProfile>()
  for (const profile of profiles) {
    const key = catalog.normKey(profile)
    if (!Object.hasOwn(session.norms, key) && !wanted.has(key)) wanted.set(key, profile)
  }
  if (wanted.size === 0) return
  const got = normsFor([...wanted.values()]) ?? {}
  for (const key of wanted.keys()) session.norms[key] = Object.hasOwn(got, key) && got[key] ? got[key] : plainFallback()
}

/**
 * 한 자리에서 고를 수 있는 짝 전부(공 소유 시 역할이 바깥 차례, 공 미소유 시 역할이 안쪽 차례). 칸의 포지션과 칸 종류는 시작 전술의 것이고,
 * 근거가 user인 역할(사용자 역할)은 뺀다. 국면이 없는 역할(옛 14역할, phase 'both')은 두 국면이 같은 역할이어야 해서 같은 역할끼리만 짝이 된다.
 */
function plansOf(catalog: RoleCatalog, tactic: Tactic): SlotPlan[] {
  const single = (roleId: string): boolean => catalog.role(roleId)?.phase === 'both'
  return tactic.slots.map((_, index): SlotPlan => {
    const base = profileOf(tactic, index)
    const roles = (position: PositionKey, phase: Phase): string[] =>
      catalog
        .choicesAt(position, phase, slotKindOf(tactic, index, phase))
        .filter((choice) => choice.evidence !== 'user')
        .map((choice) => choice.roleId)
    const ips = roles(base.ip.position, 'ip')
    const oops = roles(base.oop.position, 'oop')
    const pairs = ips.flatMap((ip) => oops.filter((oop) => ip === oop || !(single(ip) && single(oop))).map((oop): Pair => ({ ip, oop })))
    return { ipPosition: base.ip.position, oopPosition: base.oop.position, pairs }
  })
}

const profileFor = (plan: SlotPlan, pair: Pair, sharePct: number): SlotProfile => ({
  ip: { position: plan.ipPosition, roleId: pair.ip },
  oop: { position: plan.oopPosition, roleId: pair.oop },
  sharePct
})

/** 한 시작 전술이 부를 프로파일 전부: 지금 짝과 고를 수 있는 모든 짝 */
function startProfiles(tactic: Tactic, plans: SlotPlan[]): SlotProfile[] {
  const sharePct = sharePctOf(tactic)
  const profiles: SlotProfile[] = []
  tactic.slots.forEach((_, index) => {
    profiles.push(profileOf(tactic, index))
    for (const pair of plans[index].pairs) profiles.push(profileFor(plans[index], pair, sharePct))
  })
  return profiles
}

// ---------- 배정과 짝 고르기 ----------

function depthOf(session: Session, tactic: Tactic): DepthSlot[] {
  const { rows, columns, catalog, overrides } = session.input
  // 후보(backups)는 목적 값에 들어가지 않아 0으로 둔다
  return buildDepthFor(rows, columns, tactic, { catalog, overrides, norms: session.norms }, 0)
}

function weightsOf(session: Session, profile: SlotProfile): Weights {
  const key = `${profile.ip.roleId}|${profile.oop.roleId}|${profile.sharePct}`
  let weights = session.weights.get(key)
  if (!weights) {
    weights = profileWeights(session.input.catalog, profile, session.input.overrides)
    session.weights.set(key, weights)
  }
  return weights
}

/**
 * 한 선수가 이 프로파일의 자리에서 갖는 배정 값. buildDepthFor가 주전 배정에 쓰는 값과 같은 식이다:
 * 적합도 - 기준 분포의 표준편차 × 두 숙련을 비중으로 섞은 감점이 effScore이고, 기준 분포가 있으면 그 z, 없으면 effScore 그대로다.
 * 이 프로파일로 적합도를 낼 수 없는 선수(능력치가 모자람)는 null이다.
 */
function valueOf(session: Session, player: PlayerData, profile: SlotProfile): number | null {
  const result = scoreRole(player.attrs, weightsOf(session, profile))
  if (!result) return null
  const key = session.input.catalog.normKey(profile)
  const known = Object.hasOwn(session.norms, key) ? normOf(session.norms, key) : null
  const ratings = slotRatingsOf(player.ratings, profile)
  const effective = result.score - (known ?? FALLBACK_NORM).sigma * mixedPenaltySigma(ratings.ip, ratings.oop, ratings.sharePct)
  return known ? zOf(known, effective) : effective
}

/**
 * 한 선수에게 가장 맞는 짝. 지금 짝보다 엄격히 큰 값을 내는 짝만 이기고(동점이면 지금 짝, 그다음 카탈로그 순서), 그런 짝이 없으면 null이다.
 */
function bestPairFor(session: Session, plan: SlotPlan, now: Pair, sharePct: number, playerIdx: number): Pair | null {
  const player = session.players.get(playerIdx)
  if (!player) return null
  let best: Pair | null = null
  // 지금 짝으로 점수가 나지 않는 주전은 있을 수 없다(주전이 되려면 점수가 나야 한다). 그래도 있다면 어떤 짝이든 낫다
  let bestValue = valueOf(session, player, profileFor(plan, now, sharePct)) ?? -Infinity
  for (const pair of plan.pairs) {
    if (pair.ip === now.ip && pair.oop === now.oop) continue
    const value = valueOf(session, player, profileFor(plan, pair, sharePct))
    if (value !== null && value > bestValue) {
      best = pair
      bestValue = value
    }
  }
  return best
}

/** 한 자리의 짝만 바꾼 전술(입력은 바뀌지 않는다) */
function withPair(tactic: Tactic, index: number, pair: Pair): Tactic {
  const slots = tactic.slots.slice()
  const slot = slots[index]
  slots[index] = { ip: { cell: { ...slot.ip.cell }, roleId: pair.ip }, oop: { cell: { ...slot.oop.cell }, roleId: pair.oop } }
  return { ...tactic, slots }
}

/** 자리마다 주전에게 가장 맞는 짝으로 바꾼 전술. 바뀐 자리가 없으면 null */
function improvePairs(session: Session, tactic: Tactic, plans: SlotPlan[], depth: DepthSlot[]): Tactic | null {
  const sharePct = sharePctOf(tactic)
  let changed = false
  const slots = tactic.slots.map((slot, index) => {
    const starter = depth[index]?.starter
    const best = starter ? bestPairFor(session, plans[index], { ip: slot.ip.roleId, oop: slot.oop.roleId }, sharePct, starter.idx) : null
    if (!best) return slot
    changed = true
    return { ip: { cell: { ...slot.ip.cell }, roleId: best.ip }, oop: { cell: { ...slot.oop.cell }, roleId: best.oop } }
  })
  return changed ? { ...tactic, slots } : null
}

/** 시작점 하나를 끝까지 돌린다: 배정 → 짝 고르기 → 다시 배정, 목적 값이 엄격히 오를 때만 되풀이(최대 maxRounds번) */
function runStart(session: Session, start: Tactic): RunDetail {
  const plans = plansOf(session.input.catalog, start)
  ensureNorms(session, startProfiles(start, plans))
  const startDepth = depthOf(session, start)
  const first = depthObjective(startDepth)
  let tactic = start
  let depth = startDepth
  let score = first
  let rounds = 0
  while (rounds < session.maxRounds) {
    const next = improvePairs(session, tactic, plans, depth)
    if (!next) break
    rounds++
    const nextDepth = depthOf(session, next)
    const nextScore = depthObjective(nextDepth)
    if (!(nextScore.objective > score.objective)) break
    tactic = next
    depth = nextDepth
    score = nextScore
  }
  return { tactic, startObjective: first.objective, objective: score.objective, rounds, plans, startDepth, start: first, end: score }
}

/**
 * 시작점 하나만 돌려 본다(시험과 도구용). 짝을 바꿔 다시 배정해 본 횟수(rounds)와 시작·끝 목적 값을 돌려준다.
 * 지금 전술과 프리셋을 함께 견주는 것은 searchTactics가 한다.
 */
export function improveStart(input: SearchInput, start: Tactic): StartRun {
  const { tactic, startObjective, objective, rounds } = runStart(openSession(input), start)
  return { tactic, startObjective, objective, rounds }
}

// ---------- 확인 전 표시 ----------

const UNCONFIRMED: ReadonlySet<Evidence> = new Set<Evidence>(['inferred', 'unknown'])

/**
 * 이 칸 종류·국면의 목록에서 이 역할의 근거가 게임에서 확인 전(inferred, unknown)인가. 목록에 없는 역할은 확인 전으로 본다
 * (앱이 아는 목록이 게임과 다르다는 뜻이다. 사용자 역할('user.' 번호)은 확인할 게임 자료가 없어 세지 않는다).
 * 옛 14역할(근거 app)은 게임 확인과 상관없는 앱의 목록이라 세지 않는다.
 */
function isUnconfirmed(catalog: RoleCatalog, position: PositionKey, phase: Phase, kind: string, roleId: string): boolean {
  const found = catalog.choicesAt(position, phase, kind).find((choice) => choice.roleId === roleId)
  if (found) return UNCONFIRMED.has(found.evidence)
  return !roleId.startsWith('user.')
}

/** 두 국면 가운데 어느 한 역할이라도 게임에서 확인 전인 자리의 수 */
function unconfirmedSlots(catalog: RoleCatalog, tactic: Tactic): number {
  let count = 0
  tactic.slots.forEach((slot, index) => {
    const profile = profileOf(tactic, index)
    const ip = isUnconfirmed(catalog, profile.ip.position, 'ip', slotKindOf(tactic, index, 'ip'), slot.ip.roleId)
    const oop = isUnconfirmed(catalog, profile.oop.position, 'oop', slotKindOf(tactic, index, 'oop'), slot.oop.roleId)
    if (ip || oop) count++
  })
  return count
}

// ---------- 결과 만들기 ----------

/** 같은 모양(칸, 역할, 비중)의 전술인가를 가르는 열쇠. 이름과 번호는 보지 않는다 */
const shapeKey = (tactic: Tactic): string =>
  JSON.stringify([tactic.sharePct, tactic.slots.map((slot) => [slot.ip.cell.line, slot.ip.cell.lane, slot.ip.roleId, slot.oop.cell.line, slot.oop.cell.lane, slot.oop.roleId])])

const fitName = (name: string): string => Array.from(name).slice(0, TACTIC_NAME_MAX).join('')

/** 추천으로 나온 전술의 번호와 이름(사용자가 저장하기 전의 초안이라 출처는 user) */
const asRecommended = (tactic: Tactic, id: string, name: string): Tactic => ({ ...tactic, id, name: fitName(name), source: 'user' })

/** 같은 점유 시 포지션의 자리가 둘 이상이면 번호를 붙인 자리 이름(전술판의 자리 이름과 같다. 예: "중앙 수비 1") */
function slotLabels(tactic: Tactic): string[] {
  const positions = tactic.slots.map((_, index) => profileOf(tactic, index).ip.position)
  const total = new Map<PositionKey, number>()
  for (const position of positions) total.set(position, (total.get(position) ?? 0) + 1)
  const seen = new Map<PositionKey, number>()
  return positions.map((position) => {
    const nth = (seen.get(position) ?? 0) + 1
    seen.set(position, nth)
    const name = POSITION_LABEL[position] ?? position
    return (total.get(position) ?? 1) > 1 ? `${name} ${nth}` : name
  })
}

/** 지금 전술의 자리별 제안: 그 자리 짝만 주전에게 가장 맞는 짝으로 바꿔 다시 배정한 목적 값이 ROLE_SWAP_MIN_GAIN 이상 오르는 것(이득 큰 순) */
function suggestionsOf(session: Session, current: Tactic, run: RunDetail): SlotSuggestion[] {
  const { catalog } = session.input
  const sharePct = sharePctOf(current)
  const labels = slotLabels(current)
  const found: SlotSuggestion[] = []
  current.slots.forEach((slot, index) => {
    const starter = run.startDepth[index]?.starter
    if (!starter) return
    const plan = run.plans[index]
    const best = bestPairFor(session, plan, { ip: slot.ip.roleId, oop: slot.oop.roleId }, sharePct, starter.idx)
    if (!best) return
    const after = depthObjective(depthOf(session, withPair(current, index, best)))
    const gain = after.objective - run.start.objective
    if (!(gain >= K.ROLE_SWAP_MIN_GAIN)) return
    const base = profileOf(current, index)
    found.push({
      index,
      label: labels[index],
      from: base,
      to: profileFor(plan, best, sharePct),
      gain,
      unconfirmed:
        isUnconfirmed(catalog, plan.ipPosition, 'ip', slotKindOf(current, index, 'ip'), best.ip) || isUnconfirmed(catalog, plan.oopPosition, 'oop', slotKindOf(current, index, 'oop'), best.oop)
    })
  })
  return found.sort((a, b) => b.gain - a.gain || a.index - b.index)
}

interface Start {
  tactic: Tactic
  current: boolean
  id: string
  name: string
}

/** 시작점들: 지금 전술을 먼저, 그다음 프리셋(지금 전술의 비중으로). 같은 모양의 시작점은 한 번만 돌린다 */
function startsOf(input: SearchInput): Start[] {
  const starts: Start[] = []
  const seen = new Set<string>()
  const add = (start: Start): void => {
    const key = shapeKey(start.tactic)
    if (seen.has(key)) return
    seen.add(key)
    starts.push(start)
  }
  add({ tactic: input.current, current: true, id: 'search:current', name: `${input.current.name} (추천 역할)` })
  for (const preset of input.presets) add({ tactic: { ...preset, sharePct: input.current.sharePct }, current: false, id: `search:${preset.preset ?? preset.id}`, name: preset.name })
  return starts
}

/**
 * 전술 추천 탐색을 시작점 하나씩 돌린다. 시작점 하나를 끝낼 때마다 진행을 내놓아서 부르는 쪽이 사이에 다른 일(이벤트 루프)에 양보할 수 있다.
 * 다 돌리면 순위와 지금 전술의 자리별 제안을 돌려준다(generator의 반환값).
 */
export function* searchTacticsSteps(input: SearchInput): Generator<SearchProgress, SearchOutput, void> {
  const session = openSession(input)
  const starts = startsOf(input)
  const candidates: Array<{ candidate: TacticCandidate; order: number }> = []
  const seen = new Set<string>()
  const push = (tactic: Tactic, score: Objective, current: boolean): void => {
    const key = shapeKey(tactic)
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({
      candidate: { tactic, objective: score.objective, strength: score.strength, filled: score.filled, temporary: score.temporary, current, unconfirmed: unconfirmedSlots(input.catalog, tactic) },
      order: candidates.length
    })
  }
  let suggestions: SlotSuggestion[] = []
  for (const [at, start] of starts.entries()) {
    const run = runStart(session, start.tactic)
    if (start.current) {
      // 지금 전술은 바꾸지 않은 모습으로 비교 기준이 되고, 짝을 바꾼 모습은 추천이다
      push(input.current, run.start, true)
      suggestions = suggestionsOf(session, input.current, run)
    }
    push(asRecommended(run.tactic, start.id, start.name), run.end, false)
    yield { done: at + 1, total: starts.length }
  }
  const ranked = candidates.sort((a, b) => b.candidate.objective - a.candidate.objective || Number(b.candidate.current) - Number(a.candidate.current) || a.order - b.order).map((each) => each.candidate)
  return { ranked, suggestions }
}

/** 전술 추천 탐색(한 번에 끝까지). 양보가 필요한 호출은 searchTacticsSteps를 쓴다 */
export function searchTactics(input: SearchInput): SearchOutput {
  const steps = searchTacticsSteps(input)
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
  }
}
