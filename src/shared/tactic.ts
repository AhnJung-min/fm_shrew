import { buildDepth, FORMATION_BY_ID, FORMATIONS, type DepthPlayer, type DepthSlot, type Formation } from './depth'
import { joinClauses, withJosa } from './korean'
import { FALLBACK_NORM, normOf, zOf, zWords, type RoleNorm, type RoleNorms } from './norms'
import { parsePositions, posPenaltySigma, ratingAt, RATING_UNKNOWN_ASSUMED } from './positions'
import { attributesOf, effectiveWeights, ROLE_BY_ID, scoreRole, type AttributeValue, type PositionKey } from './roles'
import type { ColumnInfo, PlayerRow } from './types'
import { agingDrop, AGING_START_AGE, AGING_START_AGE_GOALKEEPER, type CandidateBench } from './world'

/**
 * 전술 분석: 고른 포메이션과 자리별 역할(settings.formation, settings.slotRoles)을 기준으로
 * 자리마다 "보강 필요도"를 구하고, 내 선수 가운데 누가 그 자리에 맞는지 줄 세운다.
 *
 * 전술판, 스쿼드 진단, 영입 후보가 모두 이 결과 하나를 쓴다. 주전·후보는 buildDepth가 정하고,
 * 적합도는 roles.ts의 scoreRole 하나로 나온다. 이 모듈은 순수 계산만 한다.
 */

export const POSITION_LABEL: Record<string, string> = {
  GK: '골키퍼', DL: '왼쪽 수비', DC: '중앙 수비', DR: '오른쪽 수비', WBL: '왼쪽 윙백', WBR: '오른쪽 윙백',
  DM: '수비형 미드', ML: '왼쪽 미드', MC: '중앙 미드', MR: '오른쪽 미드',
  AML: '왼쪽 공격', AMC: '공격형 미드', AMR: '오른쪽 공격', ST: '최전방'
}

export interface Ymd {
  year: number
  month: number
  day: number
}

/** 20270630 꼴의 수를 날짜로. 날짜가 아니면 null */
export function dateFromNumber(value: number | null | undefined): Ymd | null {
  if (value === null || value === undefined || !Number.isInteger(value) || value < 19000101) return null
  const year = Math.floor(value / 10000)
  const month = Math.floor(value / 100) % 100
  const day = value % 100
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

const DAY_MS = 86_400_000
/** 두 날짜 사이의 일수. 뒤가 늦으면 양수 */
export function daysBetween(from: Ymd, to: Ymd): number {
  return Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / DAY_MS)
}

// ---------- 보강 필요도 ----------

/**
 * 보강 필요도(0~100) = 네 가지 위험의 가중 평균 × 100. 각 위험은 0(문제없음)~1(매우 큼).
 * 알 수 없는 위험(계약 만료일을 모름 등)은 빼지 않고 보통 수준(UNKNOWN_RISK)으로 계산한다
 * (빼고 나머지를 다시 나누면 모르는 값이 있는 자리의 필요도가 부풀려진다. 검토 1회차).
 * 주전이 없는 자리는 무조건 100이다.
 *
 * - 주전 전력 45: 보강이 필요한 가장 큰 이유는 주전이 약한 것이다. 약한지는 그 역할의 기준 분포(shared/norms.ts)로 잰다.
 * - 후보 두께 25: 한 명이 다치거나 빠지면 바로 구멍이 난다.
 * - 주전 나이 15, 주전 계약 15: 곧 사라질 주전은 지금 약하지 않아도 미리 준비해야 한다.
 */
export const NEED_FACTOR_WEIGHTS = { quality: 45, depth: 25, age: 15, contract: 15 } as const
export type NeedFactorId = keyof typeof NEED_FACTOR_WEIGHTS

export const NEED_FACTOR_LABEL: Record<NeedFactorId, string> = {
  quality: '주전 전력',
  depth: '후보 두께',
  age: '주전 나이',
  contract: '주전 계약'
}

export const NEED_FACTOR_HELP: Record<NeedFactorId, string> = {
  quality: '주전의 적합도가 같은 역할의 상위권 선수들(평균 μ점)에 견줘 얼마나 낮은가. 역할마다 점수 눈금이 달라 표준편차로 재고, 주전의 포지션 숙련이 20보다 낮으면 그만큼 뺀 점수로 봅니다.',
  depth: '이 자리를 뛸 수 있는 후보가 몇 명이고, 첫 후보가 주전과 얼마나 차이 나는가.',
  age: '주전이 31세 이상(골키퍼는 34세 이상)이면 곧 내려갈 것으로 봅니다.',
  contract: '주전의 계약이 12개월 안에 끝나는가. 가까울수록 위험합니다.'
}

/** 주전 전력 위험 = clamp01((1 - z_eff) / 3): z_eff +1 이상이면 0, 0이면 0.33, -1이면 0.67, -2 이하면 1 (z_eff = 포지션 숙련 감점을 뺀 적합도의 z) */
export const QUALITY_Z_GOOD = 1
export const QUALITY_Z_SPAN = 3
/** 후보가 없으면 1, 한 명이면 0.5, 두 명 이상이면 0 */
export const DEPTH_COUNT_RISK = [1, 0.5, 0] as const
/**
 * 첫 후보가 주전보다 표준편차의 1.2배(DEPTH_GAP_FREE_SIGMAS)까지 낮은 것은 무료이고, 거기서 3.6σ(DEPTH_GAP_SPAN_SIGMAS) 더 벌어지면 최대(0.8).
 * (σ 4점인 역할에서는 예전의 5점·15점 고정값과 같다. 역할마다 σ가 2.8~5.9로 달라 σ로 바꿨다.)
 */
export const DEPTH_GAP_FREE_SIGMAS = 1.2
export const DEPTH_GAP_SPAN_SIGMAS = 3.6
export const DEPTH_GAP_MAX = 0.8
/** 주전 나이: 시작 나이에서 0.4, 한 해마다 0.15씩 올라 시작+4세에서 1 */
export const AGE_RISK_START = AGING_START_AGE
export const AGE_RISK_START_GOALKEEPER = AGING_START_AGE_GOALKEEPER
export const AGE_RISK_BASE = 0.4
export const AGE_RISK_STEP = 0.15
/** 주전 계약: 12개월 이내면 0.3에서 시작해 만료 직전 1. 이미 끝났으면 1 */
export const CONTRACT_RISK_DAYS = 365
export const CONTRACT_RISK_BASE = 0.3
/** 나이나 계약을 알 수 없을 때 위험으로 두는 값(추정: 알려진 주전들의 평균 위험이 0.15쯤) */
export const UNKNOWN_RISK = 0.15
/**
 * 후계자: 23세 이하 내 선수가 이 자리를 뛸 수 있고(숙련 15 이상) 적합도가 주전보다 2.5σ 넘게 낮지 않으면,
 * 주전 나이·계약 위험을 절반으로 줄인다(곧 빠져도 이어받을 사람이 있다).
 */
export const SUCCESSOR_MAX_AGE = 23
export const SUCCESSOR_MAX_GAP_SIGMAS = 2.5
export const SUCCESSOR_RELIEF = 0.5
/** 이유 문장에 올리려면 그 항목이 필요도에 이만큼(점) 이상 더해야 한다 */
export const REASON_MIN_POINTS = 5

/** 필요도 등급 경계: 이상이면 그 등급 */
export const NEED_LEVELS: Array<{ min: number; id: NeedLevelId; label: string }> = [
  { min: 55, id: 'urgent', label: '시급' },
  { min: 30, id: 'recommended', label: '보강 권장' },
  { min: 12, id: 'normal', label: '보통' },
  { min: 0, id: 'fine', label: '충분' }
]
export type NeedLevelId = 'urgent' | 'recommended' | 'normal' | 'fine'

export function needLevel(need: number): { id: NeedLevelId; label: string } {
  const level = NEED_LEVELS.find((each) => need >= each.min) ?? NEED_LEVELS[NEED_LEVELS.length - 1]
  return { id: level.id, label: level.label }
}

export interface NeedFactor {
  id: NeedFactorId
  label: string
  /** 이 위험이 더한 보강 필요도(소수 첫째 자리) */
  points: number
  /** 이 위험이 더할 수 있는 최대값(가중치). 주전이 없는 자리에서는 따지지 않은 항목이 0이고 합이 100이다 */
  max: number
  /** 점수에 들어갔는지(주전이 없는 자리의 나머지 항목만 false) */
  counted: boolean
  /** 값을 몰라 보통 위험(UNKNOWN_RISK)으로 계산했는지 */
  assumed: boolean
  note: string
}

export interface SquadOption {
  idx: number
  name: string
  /** 이 자리 역할의 적합도(화면에 보이는 값) */
  score: number
  uncertain: boolean
  age: number | null
  ca: number | null
  /** 이 자리 주전인지, 다른 자리 주전인지, 주전이 아닌지 */
  role: 'starter' | 'elsewhere' | 'bench'
  /** 다른 자리 주전이면 그 자리 이름 */
  elsewhere: string | null
  /** 이 자리(포지션)를 뛸 수 있다고 적혀 있는지 */
  playable: boolean
  /** 한 문장 설명 */
  note: string
}

/**
 * 같은 포지션·같은 역할의 자리들(예: 4-2-3-1의 중앙 수비 두 자리). 영입이 바꾸는 것은 그 가운데 가장 약한 주전이라,
 * 영입 후보는 자리 번호가 아니라 그룹 기준으로 판정한다(어느 자리를 골라도 같은 결과).
 */
export interface SlotGroup {
  id: string
  position: PositionKey
  roleId: string
  roleLabel: string
  /** "중앙 수비 (2자리)". 같은 포지션에 역할이 다른 그룹이 있으면 "최전방(타깃맨)"처럼 역할을 붙인다 */
  label: string
  /** 그룹에 든 자리의 순번들(포메이션 순서) */
  slots: number[]
  /** 자리들의 보강 필요도 가운데 최대(0~100) */
  need: number
  level: NeedLevelId
  levelLabel: string
  /** 필요도가 가장 큰 자리의 이유 */
  reason: string
  /**
   * 영입 후보가 견주는 기준. starter는 그룹 주전들 가운데 (숙련 감점과 나이 하락을 반영한) 적합도가 가장 낮은 선수이고,
   * 그룹에 주전이 없는 자리가 하나라도 있으면 null이다. backup은 그룹 자리들의 첫 후보 가운데 (숙련 감점을 뺀) 적합도가 가장 높은 선수.
   */
  bench: CandidateBench
}

export interface SlotAnalysis {
  slot: DepthSlot
  /** "중앙 수비 1"처럼 같은 자리가 둘 이상이면 번호를 붙인 이름 */
  label: string
  positionLabel: string
  roleLabel: string
  /** 같은 포지션·같은 역할의 자리들 */
  group: SlotGroup
  starterScore: number | null
  /** 주전의 포지션 숙련 감점을 뺀 적합도(숙련 20이면 starterScore와 같다) */
  starterEff: number | null
  /** 주전의 그 자리 포지션 숙련(1~20) */
  starterRating: number | null
  /** 주전 적합도(숙련 감점을 뺀 값, z_eff)가 이 역할 기준에서 평균보다 표준편차의 몇 배 위인가 */
  starterZ: number | null
  /** 주전의 현재 능력(1~200) */
  starterCa: number | null
  /** 주전의 나이 */
  starterAge: number | null
  /** 이 자리 역할의 기준 분포. 영입 후보가 같은 눈금을 쓴다 */
  norm: RoleNorm
  /** 기준 분포가 실제 세이브에서 구한 것인지(world), 구하지 못해 대신한 값인지(fallback) */
  normSource: 'world' | 'fallback'
  backupScore: number | null
  /** 첫 후보의 숙련 감점을 뺀 적합도 */
  backupEff: number | null
  /** 이 자리를 뛸 수 있는 내 선수 수(주전 포함) */
  eligible: number
  need: number
  level: NeedLevelId
  levelLabel: string
  factors: NeedFactor[]
  /** 한 문장 이유 */
  reason: string
  /** 이 자리 역할에 적합한 내 선수들(적합도 순) */
  options: SquadOption[]
}

export type LineId = 'goalkeeper' | 'defence' | 'midfield' | 'attack'

export interface LineSummary {
  id: LineId
  label: string
  slots: number
  /** 주전 적합도 평균(화면의 점수). 역할마다 눈금이 달라 줄끼리 견주는 데는 쓰지 않고 참고로만 보여 준다. 주전이 없으면 null */
  fitAverage: number | null
  /** 주전 z_eff의 평균: 줄의 주전이 각자 역할의 상위권 평균보다 표준편차의 몇 배 위인가. 줄끼리의 비교(가장 강한·약한 줄)는 이 값으로 한다. 주전이 없으면 null */
  zAverage: number | null
  needAverage: number
}

export interface TacticAnalysis {
  formation: Formation
  /** 포메이션 순서(왼쪽·위에서 오른쪽·아래로) */
  slots: SlotAnalysis[]
  /** 보강 필요도가 높은 순 */
  byNeed: SlotAnalysis[]
  /** 같은 포지션·같은 역할의 자리 묶음(포메이션 순서) */
  groups: SlotGroup[]
  /** 그룹을 보강 필요도(그룹 최대)가 높은 순으로 */
  groupsByNeed: SlotGroup[]
  lines: LineSummary[]
  /** 주전들의 적합도 평균. 주전이 하나도 없으면 null */
  fitAverage: number | null
  needAverage: number
  /** 수비·미드필더·공격 가운데 가장 강한 줄과 가장 약한 줄(주전 z_eff 평균 기준, 줄이 둘 미만이면 null) */
  strongest: LineSummary | null
  weakest: LineSummary | null
}

const LINE_OF: Record<PositionKey, LineId> = {
  GK: 'goalkeeper',
  DL: 'defence', DC: 'defence', DR: 'defence',
  WBL: 'midfield', WBR: 'midfield', DM: 'midfield', ML: 'midfield', MC: 'midfield', MR: 'midfield',
  AML: 'attack', AMC: 'attack', AMR: 'attack', ST: 'attack'
}
const LINE_LABEL: Record<LineId, string> = { goalkeeper: '골키퍼', defence: '수비', midfield: '미드필드', attack: '공격' }
const LINE_ORDER: LineId[] = ['goalkeeper', 'defence', 'midfield', 'attack']
/** 내 선수 가운데 한 자리에서 보여 주는 최대 인원 */
export const MAX_OPTIONS = 6

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
const round1 = (x: number): number => Math.round(x * 10) / 10

export interface TacticInput {
  rows: PlayerRow[]
  columns: ColumnInfo[]
  /** 세이브가 알려 주는 게임 속 오늘. 모르면 계약 위험은 빼고 계산한다 */
  today?: Ymd
  formation: string
  slotRoles: Record<string, string>
  roleWeights: Record<string, Record<string, number>>
  /** 역할별 기준 분포(WorldService가 세이브에서 구한 것, SquadResult.roleNorms). 없으면 우리 팀 주전 평균과 표준편차 4로 대신한다 */
  norms?: RoleNorms
}

interface Person {
  row: PlayerRow
  ratings: number[] | undefined
  positions: string[]
  attrs: Record<string, AttributeValue>
  age: number | null
  ca: number | null
  contractEnd: Ymd | null
}

/** 전술 분석. 선수의 능력치나 포지션 열이 없으면 null */
export function analyseTactic(input: TacticInput): TacticAnalysis | null {
  const { rows, columns, today, roleWeights } = input
  const header = (field: string): string | undefined => columns.find((col) => col.field === field)?.header
  const positionHeader = header('position')
  if (!positionHeader || !columns.some((col) => col.isAttr)) return null
  const ageHeader = header('age')
  const caHeader = header('ability')
  const endHeader = header('contractEnd')

  const formation = FORMATION_BY_ID[input.formation] ?? FORMATIONS[0]
  const slots = buildDepth(rows, columns, formation, input.slotRoles, roleWeights, 2, input.norms)

  const people: Person[] = rows.map((row) => ({
    row,
    ratings: row.ratings,
    positions: parsePositions(row.cells[positionHeader]?.raw ?? ''),
    attrs: attributesOf(row, columns),
    age: ageHeader ? (row.cells[ageHeader]?.num ?? null) : null,
    ca: caHeader ? (row.cells[caHeader]?.num ?? null) : null,
    contractEnd: endHeader ? dateFromNumber(row.cells[endHeader]?.num) : null
  }))
  const personOf = new Map(people.map((person) => [person.row.idx, person]))
  const slotOfStarter = new Map<number, DepthSlot>()
  for (const slot of slots) if (slot.starter) slotOfStarter.set(slot.starter.idx, slot)

  const starterScores = slots.filter((slot) => slot.starter).map((slot) => slot.starter!.score)
  const fitAverage = starterScores.length > 0 ? round1(starterScores.reduce((a, b) => a + b, 0) / starterScores.length) : null
  // 기준 분포를 못 받은 역할은 "우리 팀 주전 평균, 표준편차 4"로 대신한다(옛 호출·미리보기)
  const fallbackNorm: RoleNorm = { ...FALLBACK_NORM, mu: fitAverage ?? FALLBACK_NORM.mu }

  // 같은 자리가 둘 이상이면 번호를 붙인다
  const count = new Map<PositionKey, number>()
  for (const slot of slots) count.set(slot.position, (count.get(slot.position) ?? 0) + 1)
  const seen = new Map<PositionKey, number>()

  const analysed = slots.map((slot): SlotAnalysis => {
    const nth = (seen.get(slot.position) ?? 0) + 1
    seen.set(slot.position, nth)
    const positionLabel = POSITION_LABEL[slot.position]
    const label = (count.get(slot.position) ?? 1) > 1 ? `${positionLabel} ${nth}` : positionLabel
    const weights = effectiveWeights(slot.roleId, roleWeights)
    const known = input.norms?.[slot.roleId]
    const norm = known ? normOf(input.norms, slot.roleId) : fallbackNorm
    const normSource = known ? 'world' : 'fallback'

    // 내 선수 모두의 이 역할 적합도
    const scored: Array<{ person: Person; score: number; uncertain: boolean }> = []
    for (const person of people) {
      const result = scoreRole(person.attrs, weights)
      if (result) scored.push({ person, score: result.score, uncertain: result.uncertain })
    }
    scored.sort((a, b) => b.score - a.score || a.person.row.name.localeCompare(b.person.row.name, 'ko'))
    const eligible = people.filter((person) => person.positions.includes(slot.position)).length

    const starter = slot.starter
    // 위쪽 몇 명에 주전이 없으면(다른 자리에서 더 높은 점수로 뽑힌 선수들이 앞서는 경우) 맨 아래를 주전으로 바꿔 항상 보이게 한다
    let shown = scored.slice(0, MAX_OPTIONS)
    const own = starter ? scored.find((each) => each.person.row.idx === starter.idx) : undefined
    if (own && !shown.includes(own)) shown = [...shown.slice(0, MAX_OPTIONS - 1), own]
    const options = shown.map(({ person, score, uncertain }): SquadOption => {
      const mine = starter?.idx === person.row.idx
      const other = slotOfStarter.get(person.row.idx)
      const playable = person.positions.includes(slot.position)
      const role: SquadOption['role'] = mine ? 'starter' : other ? 'elsewhere' : 'bench'
      const elsewhere = !mine && other ? POSITION_LABEL[other.position] : null
      return {
        idx: person.row.idx,
        name: person.row.name,
        score,
        uncertain,
        age: person.age,
        ca: person.ca,
        role,
        elsewhere,
        playable,
        note: optionNote({ name: person.row.name, score, role, elsewhere, playable }, starter)
      }
    })

    // 후계자: 23세 이하이고 이 자리를 뛸 수 있는 내 선수 가운데, 숙련 감점을 뺀 적합도가 주전(같은 방식으로 뺀 값)에 크게 뒤지지 않는 선수
    const successor = starter
      ? scored.find(({ person, score }) => {
          if (person.row.idx === starter.idx || person.age === null || person.age > SUCCESSOR_MAX_AGE || !person.positions.includes(slot.position)) return false
          const rating = ratingAt(person.ratings, slot.position) ?? RATING_UNKNOWN_ASSUMED
          return score - norm.sigma * posPenaltySigma(rating) >= starter.effScore - SUCCESSOR_MAX_GAP_SIGMAS * norm.sigma
        })
      : undefined
    const { need, factors, reason } = needOf({
      slot,
      norm,
      normSource,
      starterPerson: starter ? personOf.get(starter.idx) : undefined,
      successor,
      today
    })
    const level = needLevel(need)
    return {
      slot,
      label,
      positionLabel,
      roleLabel: ROLE_BY_ID[slot.roleId]?.label ?? slot.roleId,
      // group은 아래에서 자리들을 묶은 뒤 채운다
      group: undefined as unknown as SlotGroup,
      starterScore: starter?.score ?? null,
      starterEff: starter?.effScore ?? null,
      starterRating: starter?.rating ?? null,
      starterZ: starter ? zOf(norm, starter.effScore) : null,
      starterAge: starter ? (personOf.get(starter.idx)?.age ?? null) : null,
      norm,
      normSource,
      starterCa: starter ? (personOf.get(starter.idx)?.ca ?? null) : null,
      backupScore: slot.backups[0]?.score ?? null,
      backupEff: slot.backups[0]?.effScore ?? null,
      eligible,
      need,
      level: level.id,
      levelLabel: level.label,
      factors,
      reason,
      options
    }
  })

  const groups = buildGroups(analysed)
  for (const each of analysed) each.group = groups.find((group) => group.slots.includes(each.slot.index))!

  const byNeed = [...analysed].sort((a, b) => b.need - a.need || a.slot.index - b.slot.index)
  const groupsByNeed = [...groups].sort((a, b) => b.need - a.need || a.slots[0] - b.slots[0])
  const lines = LINE_ORDER.map((id): LineSummary | null => {
    const inLine = analysed.filter((each) => LINE_OF[each.slot.position] === id)
    if (inLine.length === 0) return null
    const scores = inLine.filter((each) => each.starterScore !== null).map((each) => each.starterScore!)
    const zs = inLine.filter((each) => each.starterZ !== null).map((each) => each.starterZ!)
    return {
      id,
      label: LINE_LABEL[id],
      slots: inLine.length,
      fitAverage: scores.length > 0 ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      zAverage: zs.length > 0 ? zs.reduce((a, b) => a + b, 0) / zs.length : null,
      needAverage: round1(inLine.reduce((sum, each) => sum + each.need, 0) / inLine.length)
    }
  }).filter((line): line is LineSummary => line !== null)

  // 가장 강한·약한 줄은 역할 눈금이 다른 점수 평균이 아니라 z_eff 평균으로 고른다(검토 2회차)
  const field = lines.filter((line) => line.id !== 'goalkeeper' && line.zAverage !== null)
  const ranked = [...field].sort((a, b) => b.zAverage! - a.zAverage!)
  return {
    formation,
    slots: analysed,
    byNeed,
    groups,
    groupsByNeed,
    lines,
    fitAverage,
    needAverage: round1(analysed.reduce((sum, each) => sum + each.need, 0) / Math.max(1, analysed.length)),
    strongest: ranked.length >= 2 ? ranked[0] : null,
    weakest: ranked.length >= 2 ? ranked[ranked.length - 1] : null
  }
}

/**
 * 같은 포지션·같은 역할의 자리들을 한 그룹으로 묶는다(포메이션 순서). 영입이 바꾸는 것은 그룹의 가장 약한 주전이라,
 *   a_i      = f_eff,i - 나이 하락(i)                  (i = 그룹의 주전. 하락은 31세부터, 골키퍼 34세부터 해마다 1점)
 *   anchor_G = min a_i → 그 주전이 비교 기준 주전(CA 문턱도 그 주전의 CA)
 *   backup_G = 그룹 자리들의 첫 후보 가운데 f_eff가 가장 높은 선수
 *   need_G   = 그룹 자리들의 보강 필요도 가운데 최대
 * 그룹의 자리 하나라도 주전이 없으면 비교 기준 주전은 없다(null: 그 자리는 누가 와도 채워진다).
 */
function buildGroups(analysed: SlotAnalysis[]): SlotGroup[] {
  const byKey = new Map<string, SlotAnalysis[]>()
  for (const each of analysed) {
    const key = `${each.slot.position}:${each.slot.roleId}`
    byKey.set(key, [...(byKey.get(key) ?? []), each])
  }
  const groupsOfPosition = new Map<PositionKey, number>()
  for (const members of byKey.values()) {
    const position = members[0].slot.position
    groupsOfPosition.set(position, (groupsOfPosition.get(position) ?? 0) + 1)
  }
  return [...byKey.entries()]
    .map(([id, members]): SlotGroup => {
      const first = members[0]
      const { position, roleId } = first.slot
      const goalkeeper = position === 'GK'
      const mostNeeded = members.reduce((best, each) => (each.need > best.need ? each : best), first)
      const level = needLevel(mostNeeded.need)
      const emptySlot = members.some((each) => !each.slot.starter)
      let weakest: SlotAnalysis | null = null
      if (!emptySlot) {
        let weakestValue = Infinity
        for (const each of members) {
          const value = each.starterEff! - agingDrop(each.starterAge, goalkeeper)
          if (value < weakestValue) {
            weakestValue = value
            weakest = each
          }
        }
      }
      let backup: DepthPlayer | null = null
      for (const each of members) {
        const next = each.slot.backups[0]
        if (next && (!backup || next.effScore > backup.effScore)) backup = next
      }
      const bench: CandidateBench = {
        starter: weakest
          ? { name: weakest.slot.starter!.name, score: weakest.starterEff!, ca: weakest.starterCa ?? 0, age: weakest.starterAge, shownScore: weakest.starterScore! }
          : null,
        backup: backup ? { name: backup.name, score: backup.effScore, shownScore: backup.score } : null
      }
      const roleLabel = first.roleLabel
      const base = (groupsOfPosition.get(position) ?? 1) > 1 ? `${first.positionLabel}(${roleLabel})` : first.positionLabel
      return {
        id,
        position,
        roleId,
        roleLabel,
        label: members.length > 1 ? `${base} (${members.length}자리)` : base,
        slots: members.map((each) => each.slot.index),
        need: mostNeeded.need,
        level: level.id,
        levelLabel: level.label,
        reason: mostNeeded.reason,
        bench
      }
    })
    .sort((a, b) => a.slots[0] - b.slots[0])
}

function optionNote(
  option: { name: string; score: number; role: SquadOption['role']; elsewhere: string | null; playable: boolean },
  starter: DepthSlot['starter']
): string {
  if (option.role === 'starter') return '지금 이 자리의 주전입니다.'
  const where = option.role === 'elsewhere' ? `지금은 ${option.elsewhere} 자리 주전이지만` : '지금은 주전이 아니지만'
  const caution = option.playable ? '' : ' 다만 이 자리 숙련도가 낮아 실제로는 어색할 수 있습니다.'
  if (!starter) return `${where} 이 자리 역할 적합도가 ${option.score}점입니다.${caution}`
  const delta = Math.round((option.score - starter.score) * 10) / 10
  if (delta > 0) return `${where} 이 역할 적합도 ${option.score}점으로 이 자리 주전(${starter.name}, ${starter.score}점)보다 ${delta}점 높습니다.${caution}`
  return `${where} 이 역할 적합도는 ${option.score}점으로 주전보다 ${Math.abs(delta)}점 낮습니다.${caution}`
}

function needOf(args: {
  slot: DepthSlot
  norm: RoleNorm
  normSource: 'world' | 'fallback'
  starterPerson: Person | undefined
  successor: { person: Person; score: number } | undefined
  today: Ymd | undefined
}): { need: number; factors: NeedFactor[]; reason: string } {
  const { slot, norm, normSource, starterPerson, successor, today } = args
  const starter = slot.starter
  const ids = Object.keys(NEED_FACTOR_WEIGHTS) as NeedFactorId[]

  if (!starter) {
    return {
      need: 100,
      reason: '이 자리를 뛸 수 있는 선수가 없습니다.',
      factors: ids.map((id) => ({
        id,
        label: NEED_FACTOR_LABEL[id],
        points: id === 'quality' ? 100 : 0,
        max: id === 'quality' ? 100 : 0,
        counted: id === 'quality',
        assumed: false,
        note: id === 'quality' ? '주전이 없는 자리는 보강 필요도를 100으로 봅니다.' : '주전이 없어 따지지 않았습니다.'
      }))
    }
  }

  const relief = successor ? SUCCESSOR_RELIEF : 1
  const reliefNote = successor
    ? ` 다만 ${successor.person.row.name}(${successor.person.age}세)${josaOf(successor.person.row.name, '이/가')} 이어받을 수 있어 위험을 절반으로 줄였습니다.`
    : ''
  const risks: Record<NeedFactorId, { risk: number; assumed: boolean; note: string; phrase: string }> = {
    quality: { risk: 0, assumed: false, note: '', phrase: '' },
    depth: { risk: 0, assumed: false, note: '', phrase: '' },
    age: { risk: UNKNOWN_RISK, assumed: true, note: '', phrase: '' },
    contract: { risk: UNKNOWN_RISK, assumed: true, note: '', phrase: '' }
  }
  const name = starter.name
  const unknownNote = '알 수 없어 보통 수준으로 보았습니다.'

  // 주전 전력: z가 낮을수록 위험
  const eff = starter.effScore
  const z = zOf(norm, eff)
  risks.quality.risk = clamp01((QUALITY_Z_GOOD - z) / QUALITY_Z_SPAN)
  const base = normSource === 'world' ? '같은 역할 상위권 선수들의 평균' : '우리 팀 주전들의 평균'
  const penalty = starter.score - eff > 0.05 ? ` 포지션 숙련이 ${starter.rating}이라 적합도 ${starter.score}점에서 ${round1(starter.score - eff)}점(${round1(posPenaltySigma(starter.rating) * 100) / 100} 표준편차) 빼고 견주었습니다.` : ''
  risks.quality.note = `주전 ${name}의 적합도 ${round1(eff)}점은 ${base}(${round1(norm.mu)}점)보다 ${Math.abs(round1(eff - norm.mu))}점 ${eff >= norm.mu ? '높고' : '낮고'}, 이 역할의 보통 점수 차이(표준편차 ${round1(norm.sigma)}점)로 보면 ${zWords(z)}.${penalty}`
  risks.quality.phrase = `주전 ${name}의 적합도(${round1(eff)}점)는 ${normSource === 'world' ? '이 역할 상위권' : '팀 주전'} 평균(${round1(norm.mu)}점)보다 ${eff >= norm.mu ? '조금 높은 수준입니다' : z >= -1 ? '조금 낮습니다' : '크게 낮습니다'}`

  // 후보 두께
  const backups = slot.backups.length
  const countRisk = DEPTH_COUNT_RISK[Math.min(backups, DEPTH_COUNT_RISK.length - 1)]
  const gap = backups > 0 ? starter.effScore - slot.backups[0].effScore : 0
  const gapRisk = backups > 0 ? DEPTH_GAP_MAX * clamp01((gap / norm.sigma - DEPTH_GAP_FREE_SIGMAS) / DEPTH_GAP_SPAN_SIGMAS) : 0
  risks.depth.risk = Math.max(countRisk, gapRisk)
  risks.depth.note =
    backups === 0
      ? '이 자리를 뛸 수 있는 후보가 없습니다.'
      : backups === 1
        ? `후보가 ${slot.backups[0].name} 한 명뿐입니다(${slot.backups[0].score.toFixed(1)}점).`
        : `후보가 ${backups}명 이상입니다(첫 후보 ${slot.backups[0].name} ${slot.backups[0].score.toFixed(1)}점).`
  if (gapRisk > countRisk && backups > 0) risks.depth.note += ` 첫 후보가 주전보다 ${gap.toFixed(1)}점 낮습니다.`
  risks.depth.phrase =
    backups === 0
      ? '이 자리를 대신할 후보가 없습니다'
      : countRisk >= gapRisk
        ? `후보가 ${slot.backups[0].name} 한 명뿐입니다`
        : `첫 후보 ${slot.backups[0].name}의 적합도가 주전보다 ${gap.toFixed(1)}점 낮습니다`

  // 주전 나이
  if (starterPerson?.age !== null && starterPerson?.age !== undefined) {
    const age = starterPerson.age
    const start = slot.position === 'GK' ? AGE_RISK_START_GOALKEEPER : AGE_RISK_START
    const raw = age >= start ? clamp01(AGE_RISK_BASE + AGE_RISK_STEP * (age - start)) : 0
    risks.age.risk = raw * relief
    risks.age.assumed = false
    risks.age.note =
      raw === 0
        ? `주전 ${withJosa(name, '은/는')} ${age}세로 아직 나이 위험이 없습니다(${start}세부터 따짐).`
        : `주전 ${withJosa(name, '이/가')} ${age}세입니다(${start}세부터 위험으로 봄).${reliefNote}`
    risks.age.phrase = raw === 0 ? '' : `주전 ${withJosa(name, '이/가')} ${age}세입니다`
  } else {
    risks.age.note = `주전의 나이를 ${unknownNote}`
  }

  // 주전 계약
  if (starterPerson?.contractEnd && today) {
    const days = daysBetween(today, starterPerson.contractEnd)
    const raw = days > CONTRACT_RISK_DAYS ? 0 : days < 0 ? 1 : CONTRACT_RISK_BASE + (1 - CONTRACT_RISK_BASE) * (1 - days / CONTRACT_RISK_DAYS)
    risks.contract.risk = raw * relief
    risks.contract.assumed = false
    const left = days < 31 ? `${Math.max(0, days)}일` : `${Math.round(days / 30.44)}개월`
    risks.contract.note = raw === 0 ? `주전 ${name}의 계약은 12개월 넘게 남았습니다.` : `주전 ${name}의 계약이 ${left} 남았습니다.${reliefNote}`
    risks.contract.phrase = raw === 0 ? '' : `주전 ${name}의 계약이 ${left} 남았습니다`
  } else {
    risks.contract.note = `주전의 계약 만료일을 ${unknownNote}`
  }

  let need = 0
  const factors = ids.map((id): NeedFactor => {
    const { risk, assumed, note } = risks[id]
    const max = NEED_FACTOR_WEIGHTS[id]
    const points = risk * max
    need += points
    return { id, label: NEED_FACTOR_LABEL[id], points: round1(points), max, counted: true, assumed, note }
  })
  need = round1(Math.min(100, Math.max(0, need)))

  // 이유: 점수를 가장 많이 더한 두 가지 가운데 REASON_MIN_POINTS점 이상인 것(알 수 없어 보통으로 둔 항목은 이유로 쓰지 않는다)
  const top = ids
    .map((id, i) => ({ phrase: risks[id].phrase, points: factors[i].points, assumed: risks[id].assumed }))
    .filter((each) => each.points >= REASON_MIN_POINTS && each.phrase && !each.assumed)
    .sort((a, b) => b.points - a.points)
    .slice(0, 2)
  const reason = top.length > 0 ? joinClauses(top.map((each) => each.phrase)) : '눈에 띄는 문제가 없습니다.'
  return { need, factors, reason }
}

/** 이름 뒤에 붙는 조사만 */
const josaOf = (word: string, pair: '이/가'): string => withJosa(word, pair).slice(word.length)

/** 고른 자리의 비교 기준(영입 후보가 주전·두 번째 선수와 견주는 값). 같은 포지션·역할의 자리는 같은 그룹 값이다 */
export function slotBench(analysis: TacticAnalysis, slotIndex: number): CandidateBench | null {
  return analysis.slots[slotIndex]?.group.bench ?? null
}
