import { buildDepth, FORMATION_BY_ID, FORMATIONS, type DepthSlot, type Formation } from './depth'
import { parsePositions } from './positions'
import { attributesOf, effectiveWeights, ROLE_BY_ID, scoreRole, type AttributeValue, type PositionKey } from './roles'
import type { ColumnInfo, PlayerRow } from './types'

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
 * 알 수 없는 위험(계약 만료일을 모름 등)은 빼고 나머지 가중치를 합이 100이 되게 다시 나눈다.
 * 주전이 없는 자리는 무조건 100이다.
 *
 * - 주전 전력 45: 보강이 필요한 가장 큰 이유는 주전이 약한 것이다.
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
  quality: '주전의 적합도가 우리 팀 주전들의 평균보다, 그리고 절대 수준(70점)보다 얼마나 낮은가.',
  depth: '이 자리를 뛸 수 있는 후보가 몇 명이고, 첫 후보가 주전과 얼마나 차이 나는가.',
  age: '주전이 31세 이상(골키퍼는 34세 이상)이면 곧 내려갈 것으로 봅니다.',
  contract: '주전의 계약이 12개월 안에 끝나는가. 가까울수록 위험합니다.'
}

/** 주전 전력: 팀 주전 평균과의 차이(상대)와 절대 수준을 섞는다. 상대가 60%, 절대가 40% */
export const QUALITY_RELATIVE_SHARE = 0.6
/** 평균과 같으면 0.3, 평균보다 10.5점 낮으면 1. 평균보다 4.5점 높으면 0 */
export const QUALITY_RELATIVE_BASE = 0.3
export const QUALITY_RELATIVE_SPAN = 15
/** 절대 기준: 70점 이상이면 문제 없고, 40점 이하면 최대 */
export const QUALITY_ABSOLUTE_GOOD = 70
export const QUALITY_ABSOLUTE_SPAN = 30
/** 후보가 없으면 1, 한 명이면 0.5, 두 명 이상이면 0. 첫 후보가 주전보다 5점 넘게 낮으면 그 차이도 반영(20점 낮으면 최대 0.8) */
export const DEPTH_COUNT_RISK = [1, 0.5, 0] as const
export const DEPTH_GAP_FREE = 5
export const DEPTH_GAP_SPAN = 15
export const DEPTH_GAP_MAX = 0.8
/** 주전 나이: 시작 나이에서 0.4, 한 해마다 0.15씩 올라 시작+4세에서 1 */
export const AGE_RISK_START = 31
export const AGE_RISK_START_GOALKEEPER = 34
export const AGE_RISK_BASE = 0.4
export const AGE_RISK_STEP = 0.15
/** 주전 계약: 12개월 이내면 0.3에서 시작해 만료 직전 1. 이미 끝났으면 1 */
export const CONTRACT_RISK_DAYS = 365
export const CONTRACT_RISK_BASE = 0.3
/**
 * 후계자: 23세 이하 내 선수가 이 자리를 뛸 수 있고 적합도가 주전보다 10점 넘게 낮지 않으면,
 * 주전 나이·계약 위험을 절반으로 줄인다(곧 빠져도 이어받을 사람이 있다).
 */
export const SUCCESSOR_MAX_AGE = 23
export const SUCCESSOR_MAX_GAP = 10
export const SUCCESSOR_RELIEF = 0.5

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
  /** 이 위험이 더할 수 있는 최대값. 알 수 없어 뺀 위험은 0이고, 구한 것들의 합이 100이다 */
  max: number
  counted: boolean
  note: string
}

export interface SquadOption {
  idx: number
  name: string
  /** 이 자리 역할의 적합도 */
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

export interface SlotAnalysis {
  slot: DepthSlot
  /** "중앙 수비 1"처럼 같은 자리가 둘 이상이면 번호를 붙인 이름 */
  label: string
  positionLabel: string
  roleLabel: string
  starterScore: number | null
  /** 주전의 현재 능력(1~200) */
  starterCa: number | null
  backupScore: number | null
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
  /** 주전 적합도 평균. 주전이 없으면 null */
  fitAverage: number | null
  needAverage: number
}

export interface TacticAnalysis {
  formation: Formation
  /** 포메이션 순서(왼쪽·위에서 오른쪽·아래로) */
  slots: SlotAnalysis[]
  /** 보강 필요도가 높은 순 */
  byNeed: SlotAnalysis[]
  lines: LineSummary[]
  /** 주전들의 적합도 평균. 주전이 하나도 없으면 null */
  fitAverage: number | null
  needAverage: number
  /** 수비·미드필더·공격 가운데 가장 강한 줄과 가장 약한 줄(줄이 둘 미만이면 null) */
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
}

interface Person {
  row: PlayerRow
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
  const slots = buildDepth(rows, columns, formation, input.slotRoles, roleWeights)

  const people: Person[] = rows.map((row) => ({
    row,
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

    const { need, factors, reason } = needOf({
      slot,
      average: fitAverage,
      starterPerson: starter ? personOf.get(starter.idx) : undefined,
      successor: scored.find(
        ({ person, score }) =>
          person.row.idx !== starter?.idx &&
          person.age !== null &&
          person.age <= SUCCESSOR_MAX_AGE &&
          person.positions.includes(slot.position) &&
          starter !== null &&
          score >= starter.score - SUCCESSOR_MAX_GAP
      ),
      today
    })
    const level = needLevel(need)
    return {
      slot,
      label,
      positionLabel,
      roleLabel: ROLE_BY_ID[slot.roleId]?.label ?? slot.roleId,
      starterScore: starter?.score ?? null,
      starterCa: starter ? (personOf.get(starter.idx)?.ca ?? null) : null,
      backupScore: slot.backups[0]?.score ?? null,
      eligible,
      need,
      level: level.id,
      levelLabel: level.label,
      factors,
      reason,
      options
    }
  })

  const byNeed = [...analysed].sort((a, b) => b.need - a.need || a.slot.index - b.slot.index)
  const lines = LINE_ORDER.map((id): LineSummary | null => {
    const inLine = analysed.filter((each) => LINE_OF[each.slot.position] === id)
    if (inLine.length === 0) return null
    const scores = inLine.filter((each) => each.starterScore !== null).map((each) => each.starterScore!)
    return {
      id,
      label: LINE_LABEL[id],
      slots: inLine.length,
      fitAverage: scores.length > 0 ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      needAverage: round1(inLine.reduce((sum, each) => sum + each.need, 0) / inLine.length)
    }
  }).filter((line): line is LineSummary => line !== null)

  const field = lines.filter((line) => line.id !== 'goalkeeper' && line.fitAverage !== null)
  const ranked = [...field].sort((a, b) => b.fitAverage! - a.fitAverage!)
  return {
    formation,
    slots: analysed,
    byNeed,
    lines,
    fitAverage,
    needAverage: round1(analysed.reduce((sum, each) => sum + each.need, 0) / Math.max(1, analysed.length)),
    strongest: ranked.length >= 2 ? ranked[0] : null,
    weakest: ranked.length >= 2 ? ranked[ranked.length - 1] : null
  }
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
  average: number | null
  starterPerson: Person | undefined
  successor: { person: Person; score: number } | undefined
  today: Ymd | undefined
}): { need: number; factors: NeedFactor[]; reason: string } {
  const { slot, average, starterPerson, successor, today } = args
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
        note: id === 'quality' ? '주전이 없는 자리는 보강 필요도를 100으로 봅니다.' : '주전이 없어 따지지 않았습니다.'
      }))
    }
  }

  const relief = successor ? SUCCESSOR_RELIEF : 1
  const reliefNote = successor ? ` 다만 ${successor.person.row.name}(${successor.person.age}세)이 이어받을 수 있어 위험을 절반으로 줄였습니다.` : ''
  const risks: Record<NeedFactorId, { risk: number | null; note: string; phrase: string }> = {
    quality: { risk: 0, note: '', phrase: '' },
    depth: { risk: 0, note: '', phrase: '' },
    age: { risk: null, note: '', phrase: '' },
    contract: { risk: null, note: '', phrase: '' }
  }

  // 주전 전력
  const relative = average === null ? 0 : clamp01(QUALITY_RELATIVE_BASE + (average - starter.score) / QUALITY_RELATIVE_SPAN)
  const absolute = clamp01((QUALITY_ABSOLUTE_GOOD - starter.score) / QUALITY_ABSOLUTE_SPAN)
  risks.quality.risk = QUALITY_RELATIVE_SHARE * relative + (1 - QUALITY_RELATIVE_SHARE) * absolute
  const below = average === null ? 0 : Math.round((average - starter.score) * 10) / 10
  risks.quality.note =
    average === null
      ? `주전 ${starter.name}의 적합도는 ${starter.score}점입니다(70점 이상이면 문제 없음).`
      : `주전 ${starter.name}의 적합도 ${starter.score}점은 팀 주전 평균(${average}점)보다 ${Math.abs(below)}점 ${below > 0 ? '낮고' : '높고'}, 기준 70점보다 ${starter.score >= 70 ? '높습니다' : '낮습니다'}.`
  risks.quality.phrase =
    below > 0
      ? `주전 ${starter.name}의 적합도가 ${starter.score}점으로 팀 평균보다 ${below}점 낮습니다`
      : `주전 ${starter.name}의 적합도가 ${starter.score}점으로 기준(70점)에 못 미칩니다`

  // 후보 두께
  const backups = slot.backups.length
  const countRisk = DEPTH_COUNT_RISK[Math.min(backups, DEPTH_COUNT_RISK.length - 1)]
  const gapRisk =
    backups > 0 ? DEPTH_GAP_MAX * clamp01((starter.score - slot.backups[0].score - DEPTH_GAP_FREE) / DEPTH_GAP_SPAN) : 0
  risks.depth.risk = Math.max(countRisk, gapRisk)
  risks.depth.note =
    backups === 0
      ? '이 자리를 뛸 수 있는 후보가 없습니다.'
      : backups === 1
        ? `후보가 ${slot.backups[0].name} 한 명뿐입니다(${slot.backups[0].score.toFixed(1)}점).`
        : `후보가 ${backups}명 이상입니다(첫 후보 ${slot.backups[0].name} ${slot.backups[0].score.toFixed(1)}점).`
  if (gapRisk > countRisk && backups > 0) {
    risks.depth.note += ` 첫 후보가 주전보다 ${(starter.score - slot.backups[0].score).toFixed(1)}점 낮습니다.`
  }
  risks.depth.phrase =
    backups === 0
      ? '이 자리를 대신할 후보가 없습니다'
      : countRisk >= gapRisk
        ? `후보가 ${slot.backups[0].name} 한 명뿐입니다`
        : `첫 후보 ${slot.backups[0].name}의 적합도가 주전보다 ${(starter.score - slot.backups[0].score).toFixed(1)}점 낮습니다`

  // 주전 나이
  if (starterPerson?.age !== null && starterPerson?.age !== undefined) {
    const age = starterPerson.age
    const start = slot.position === 'GK' ? AGE_RISK_START_GOALKEEPER : AGE_RISK_START
    const raw = age >= start ? clamp01(AGE_RISK_BASE + AGE_RISK_STEP * (age - start)) : 0
    risks.age.risk = raw * relief
    risks.age.note =
      raw === 0
        ? `주전 ${starter.name}은 ${age}세로 아직 나이 위험이 없습니다(${start}세부터 따짐).`
        : `주전 ${starter.name}이 ${age}세입니다(${start}세부터 위험으로 봄).${reliefNote}`
    risks.age.phrase = raw === 0 ? '' : `주전 ${starter.name}이 ${age}세입니다`
  } else {
    risks.age.note = '주전의 나이를 알 수 없어 이 항목은 반영하지 않았습니다.'
  }

  // 주전 계약
  if (starterPerson?.contractEnd && today) {
    const days = daysBetween(today, starterPerson.contractEnd)
    const raw = days > CONTRACT_RISK_DAYS ? 0 : days < 0 ? 1 : CONTRACT_RISK_BASE + (1 - CONTRACT_RISK_BASE) * (1 - days / CONTRACT_RISK_DAYS)
    risks.contract.risk = raw * relief
    const months = Math.round(days / 30.44)
    risks.contract.note =
      raw === 0
        ? `주전 ${starter.name}의 계약은 12개월 넘게 남았습니다.`
        : `주전 ${starter.name}의 계약이 ${days < 31 ? `${Math.max(0, days)}일` : `${months}개월`} 남았습니다.${reliefNote}`
    risks.contract.phrase = raw === 0 ? '' : `주전 ${starter.name}의 계약이 ${days < 31 ? `${Math.max(0, days)}일` : `${months}개월`} 남았습니다`
  } else {
    risks.contract.note = '주전의 계약 만료일을 알 수 없어 이 항목은 반영하지 않았습니다.'
  }

  let counted = 0
  for (const id of ids) if (risks[id].risk !== null) counted += NEED_FACTOR_WEIGHTS[id]
  const scale = 100 / counted
  let need = 0
  const factors = ids.map((id): NeedFactor => {
    const { risk, note } = risks[id]
    const max = risk === null ? 0 : NEED_FACTOR_WEIGHTS[id] * scale
    const points = risk === null ? 0 : risk * max
    need += points
    return { id, label: NEED_FACTOR_LABEL[id], points: round1(points), max: round1(max), counted: risk !== null, note }
  })
  need = round1(Math.min(100, Math.max(0, need)))

  // 이유: 점수를 가장 많이 더한 두 가지 가운데 5점 넘는 것
  const top = ids
    .map((id, i) => ({ phrase: risks[id].phrase, points: factors[i].points }))
    .filter((each) => each.points >= 5 && each.phrase)
    .sort((a, b) => b.points - a.points)
    .slice(0, 2)
  const reason = top.length > 0 ? `${top.map((each) => each.phrase).join(', ')}.` : '눈에 띄는 문제가 없습니다.'
  return { need, factors, reason }
}

/** 고른 자리의 비교 기준(영입 후보가 주전·두 번째 선수와 견주는 값) */
export function slotBench(
  analysis: TacticAnalysis,
  slotIndex: number
): { starter: { name: string; score: number; ca: number } | null; backup: { name: string; score: number } | null } | null {
  const found = analysis.slots[slotIndex]
  if (!found) return null
  const { starter, backups } = found.slot
  return {
    starter: starter ? { name: starter.name, score: starter.score, ca: found.starterCa ?? 0 } : null,
    backup: backups[0] ? { name: backups[0].name, score: backups[0].score } : null
  }
}
