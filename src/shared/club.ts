/**
 * 대시보드의 "구단 프로필·시설·재정"과 "선수단 건강·경기력".
 * 세이브에는 없는 값이라 켜져 있는 게임에 물어 받는다(게임 안 플러그인의 /club, /health).
 * 이 파일은 플러그인이 돌려준 글자를 화면에 보여 줄 모양으로 바꾸는 순수한 함수들이다(tests/club.test.ts).
 *
 * 값은 게임이 보여 주는 글자를 그대로 쓰고, 정렬이나 막대에 쓸 숫자만 따로 읽는다. 게임에서 읽지 못한 값은 null이다.
 */
import { formatWon, WON_PER_POUND } from './playerView'

/** 게임 안 플러그인(0.11.0 이상)이 /club, /health에서 돌려주는 기록 하나: 항목 이름 → 게임의 글자 */
export type GameFields = Record<string, string | number | undefined>

/** 플러그인의 응답: 기록들, 항목마다 값이 온 경로(확인용), 게임이 받지 않아 청하지 않은 후보 경로 */
export interface PluginAnswer {
  records: GameFields[]
  paths: Record<string, string>
  skipped: string[]
}

export function parsePluginAnswer(text: string): PluginAnswer | null {
  try {
    const raw = JSON.parse(text) as Partial<PluginAnswer> | null
    if (!raw || !Array.isArray(raw.records)) return null
    const records = raw.records.filter((each): each is GameFields => typeof each === 'object' && each !== null)
    const paths = raw.paths && typeof raw.paths === 'object' ? raw.paths : {}
    return { records, paths, skipped: Array.isArray(raw.skipped) ? raw.skipped.map(String) : [] }
  } catch {
    return null
  }
}

// ── 글자 읽기 ──────────────────────────────────────────

/** 게임의 글자에서 꼬리표를 떼고 다듬는다. 비었거나 "없음"을 뜻하는 줄표뿐이면 null */
export function cleanText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const text = String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' || /^[-–—?]+$/.test(text) || text === 'null' ? null : text
}

/** "1,234", "12.5", "£1.2M", "92%"에서 첫 숫자를 읽는다. K·M·B가 바로 붙어 있으면 곱한다. 숫자가 없으면 null */
export function numberOf(value: unknown): number | null {
  const text = cleanText(value)
  if (text === null) return null
  const found = /(-?\d[\d,]*(?:\.\d+)?)([KkMmBb](?![A-Za-z]))?/.exec(text)
  if (!found) return null
  const base = Number(found[1].replace(/,/g, ''))
  if (!Number.isFinite(base)) return null
  const unit = found[2]?.toUpperCase()
  return unit === 'K' ? base * 1e3 : unit === 'M' ? base * 1e6 : unit === 'B' ? base * 1e9 : base
}

/** "True"·"False" 같은 글자를 참·거짓으로. 알 수 없으면 null */
export function yesNo(value: unknown): boolean | null {
  const text = cleanText(value)?.toLowerCase()
  if (text === undefined) return null
  if (['true', '1', 'yes', 'y', '예', '참'].includes(text)) return true
  if (['false', '0', 'no', 'n', '아니오', '거짓'].includes(text)) return false
  return null
}

/**
 * 컨디션·경기 감각을 0~100(%)으로. 게임 안의 값은 0~10000이고 화면에는 %로 나온다.
 * 글자에 %가 있으면 그 숫자를 쓰고, 아니면 원래 값을 읽는다(100을 넘으면 만 분율로 본다).
 */
export function percentOf(raw: unknown, shown?: unknown): number | null {
  const shownText = cleanText(shown)
  if (shownText !== null && shownText.includes('%')) {
    const percent = numberOf(shownText)
    if (percent !== null) return Math.max(0, Math.min(100, Math.round(percent)))
  }
  const value = numberOf(raw)
  if (value === null) return null
  const percent = value > 100 ? value / 100 : value > 0 && value < 1 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(percent)))
}

/** 숫자만으로 된 글자인지(게임이 단위 없이 돌려준 금액) */
function isPlainNumber(text: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(text)
}

/** 게임이 단위 없이 돌려준 금액(기준 통화인 파운드로 본다)을 원화로 바꿔 짧게 적는다 */
export function poundsText(value: number): string {
  return formatWon(value * WON_PER_POUND)
}

// ── 구단 ───────────────────────────────────────────────

export interface ClubProfile {
  teamName: string | null
  clubName: string | null
  /** 지금 속한 리그(디비전) 이름 */
  division: string | null
  /** 리그 순위(게임이 보여 주는 글자) */
  leaguePosition: string | null
  stadium: string | null
  /** 경기장 수용 인원(게임의 글자) */
  capacity: string | null
  averageAttendance: string | null
  seasonTickets: string | null
  /** 창단 연도 */
  founded: string | null
}

export type FacilityId = 'training' | 'youthFacilities' | 'youthCoaching' | 'youthRecruitment'

export interface FacilityItem {
  id: FacilityId
  label: string
  /** 게임이 보여 주는 등급 글자("우수" 등) 또는 값 그대로. 읽지 못했으면 null */
  text: string | null
  /** 막대로 그릴 수 있는 숫자(별 개수 등). 모르면 null */
  level: { value: number; max: number } | null
}

export type FinanceId = 'transferBudget' | 'wageBudget' | 'wageSpend' | 'wageRemaining' | 'balance'

export interface FinanceItem {
  id: FinanceId
  label: string
  /** 게임이 보여 주는 글자. 읽지 못했으면 null */
  text: string | null
  /** 게임이 단위 없이 숫자만 돌려줘 앱이 파운드로 적은 값인지 */
  converted: boolean
  /** 정렬·비교에 쓸 숫자. 모르면 null */
  sort: number | null
  /** 게임이 덧붙인 말(재정 상태 등) */
  note?: string | null
}

/** 별(또는 등급) 숫자를 막대 길이로. 5 이하면 별 5개 기준, 10 이하면 10, 그 위는 20 기준으로 본다 */
export function levelOf(raw: unknown): { value: number; max: number } | null {
  const value = numberOf(raw)
  if (value === null || value < 0) return null
  const max = value <= 5 ? 5 : value <= 10 ? 10 : 20
  return value > max ? null : { value, max }
}

const FACILITIES: Array<{ id: FacilityId; label: string; text: string; stars: string }> = [
  { id: 'training', label: '훈련 시설', text: 'training', stars: 'trainingStars' },
  { id: 'youthFacilities', label: '유소년 시설', text: 'youthFacilities', stars: 'youthFacilitiesStars' },
  { id: 'youthCoaching', label: '유소년 코칭', text: 'youthCoaching', stars: 'youthCoachingStars' },
  { id: 'youthRecruitment', label: '유소년 영입', text: 'youthRecruitment', stars: 'youthRecruitmentStars' }
]

export function facilitiesOf(fields: GameFields | null): FacilityItem[] {
  return FACILITIES.map((facility) => {
    const text = cleanText(fields?.[facility.text])
    const stars = fields?.[facility.stars]
    // 별 숫자가 없으면, 글자 자체가 숫자일 때(유소년 코칭 단계 등) 그것을 막대로 쓴다
    const level = levelOf(stars) ?? (text !== null && isPlainNumber(text) ? levelOf(text) : null)
    return { id: facility.id, label: facility.label, text: text ?? (level ? String(level.value) : null), level }
  })
}

function moneyOf(shown: unknown, raw: unknown, label: string, id: FinanceId, prefix = ''): FinanceItem {
  const display = cleanText(shown)
  const plain = cleanText(raw)
  const sort = numberOf(raw) ?? numberOf(shown)
  if (display !== null) return { id, label, text: display, converted: false, sort }
  if (plain === null) return { id, label, text: null, converted: false, sort: null }
  if (isPlainNumber(plain)) return { id, label, text: `${prefix}${poundsText(Number(plain))}`, converted: true, sort }
  return { id, label, text: plain, converted: false, sort }
}

/** 숫자만으로 된 글자는 천 단위 쉼표를 넣는다(60400 → 60,400) */
function grouped(text: string | null): string | null {
  return text !== null && /^\d+$/.test(text) ? Number(text).toLocaleString('en-US') : text
}

/** 게임의 수용 인원 글자("6.1276만석 전부 좌석")를 읽기 쉽게("61,276석, 전부 좌석") */
export function capacityText(text: string | null): string | null {
  if (text === null) return null
  const match = text.match(/^([\d.]+)\s*만\s*석?\s*(.*)$/)
  if (!match) return grouped(text)
  const seats = Math.round(Number(match[1]) * 10_000).toLocaleString('en-US')
  return match[2] ? `${seats}석, ${match[2]}` : `${seats}석`
}

export function financesOf(fields: GameFields | null): FinanceItem[] {
  const f = fields ?? {}
  return [
    moneyOf(undefined, f.transferBudget, '이적 예산', 'transferBudget'),
    // 임금 예산은 게임에서 주급 기준이다(같은 응답의 지출·남은 예산 글자가 "주급 …"으로 온다)
    moneyOf(undefined, f.wageBudget, '임금 예산', 'wageBudget', '주급 '),
    moneyOf(f.wageSpendText, f.wageSpend, '지금 쓰는 임금', 'wageSpend'),
    moneyOf(f.wageRemainingText, f.wageRemaining, '남은 임금 예산', 'wageRemaining'),
    { ...moneyOf(undefined, f.balance, '구단 잔고', 'balance'), note: cleanText(f.balanceStatus) }
  ]
}

export function profileOf(fields: GameFields | null): ClubProfile {
  const f = fields ?? {}
  return {
    teamName: cleanText(f.name),
    clubName: cleanText(f.club),
    division: cleanText(f.division),
    leaguePosition: cleanText(f.leaguePosition),
    stadium: cleanText(f.stadium),
    capacity: capacityText(cleanText(f.capacity)),
    averageAttendance: grouped(cleanText(f.averageAttendance)),
    seasonTickets: grouped(cleanText(f.seasonTickets)),
    founded: cleanText(f.founded)
  }
}

// ── 선수단 ─────────────────────────────────────────────

/** 세이브에서 읽은 1군 선수 */
export interface RosterPlayer {
  uid: number
  name: string
  position: string
}

export interface PlayerHealth {
  uid: number
  name: string
  position: string
  /** 게임이 이 선수에 대해 답했는지(못 찾은 선수는 false이고 나머지는 모두 비어 있다) */
  read: boolean
  injured: boolean
  /** 부상 이름(게임의 글자). 부상은 맞는데 이름을 읽지 못했으면 null */
  injury: string | null
  /** 복귀까지(게임의 글자 또는 "N일") */
  injuryReturn: string | null
  /** 복귀까지 남은 일수(정렬용) */
  injuryDays: number | null
  suspended: boolean
  suspension: string | null
  /** 0~100(%) */
  condition: number | null
  conditionText: string | null
  sharpness: number | null
  sharpnessText: string | null
  morale: number | null
  moraleText: string | null
  appearances: number | null
  goals: number | null
  assists: number | null
  /** 이번 시즌 평균 평점 */
  rating: number | null
  /** 가장 최근 경기 평점 */
  lastRating: number | null
}

/** "없음"을 뜻하는 말(징계 글자가 이것이면 징계가 아니다) */
const NOTHING = /^(0|none|no ban|n\/a|없음|해당 없음|-)$/i

/**
 * 징계 중인지, 그리고 보여 줄 글자.
 * 켜진 게임에서 확인(2026-11-27): 징계가 없는 선수도 게임은 이유 -1과 기본 기간 글자("1경기", "2경기")를 돌려준다.
 * 그래서 이유가 -1이면 기간 글자와 상관없이 징계가 아니다. 이유가 숫자(게임 안의 번호)면 글자로는 보여 주지 않는다.
 */
export function suspensionOf(fields: GameFields): { suspended: boolean; text: string | null } {
  const left = cleanText(fields.banLeft)
  const reason = cleanText(fields.banReason)
  if (reason !== null && /^-1$/.test(reason)) return { suspended: false, text: null }
  const reasonText = reason !== null && !isPlainNumber(reason) ? reason : null
  if (left !== null) {
    const count = isPlainNumber(left) ? Number(left) : null
    const suspended = count !== null ? count > 0 : !NOTHING.test(left)
    return { suspended, text: suspended ? [reasonText, count !== null ? `${count}경기 남음` : left].filter(Boolean).join(', ') || null : null }
  }
  if (reason !== null && !NOTHING.test(reason)) return { suspended: true, text: reason }
  return { suspended: false, text: null }
}

export function playerHealthOf(player: RosterPlayer, fields: GameFields | undefined): PlayerHealth {
  const empty: PlayerHealth = {
    ...player,
    read: false,
    injured: false,
    injury: null,
    injuryReturn: null,
    injuryDays: null,
    suspended: false,
    suspension: null,
    condition: null,
    conditionText: null,
    sharpness: null,
    sharpnessText: null,
    morale: null,
    moraleText: null,
    appearances: null,
    goals: null,
    assists: null,
    rating: null,
    lastRating: null
  }
  if (!fields) return empty
  const injury = cleanText(fields.injuryName)
  const days = numberOf(fields.injuryDays)
  const injured = yesNo(fields.injured) ?? injury !== null
  const ban = suspensionOf(fields)
  const rating = numberOf(fields.rating)
  const last = numberOf(fields.lastRating) ?? numberOf(fields.formRating)
  return {
    ...empty,
    read: true,
    injured,
    injury: injured ? injury : null,
    injuryReturn: injured ? (cleanText(fields.injuryDuration) ?? (days !== null && days > 0 ? `${days}일` : null)) : null,
    injuryDays: injured && days !== null && days > 0 ? days : null,
    suspended: ban.suspended,
    suspension: ban.text,
    condition: percentOf(fields.condition, fields.conditionText),
    conditionText: cleanText(fields.conditionText),
    sharpness: percentOf(fields.sharpness, fields.sharpnessText),
    sharpnessText: cleanText(fields.sharpnessText),
    morale: numberOf(fields.morale),
    moraleText: cleanText(fields.moraleText),
    appearances: numberOf(fields.appearances),
    goals: numberOf(fields.goals),
    assists: numberOf(fields.assists),
    rating: rating !== null && rating > 0 ? rating : null,
    lastRating: last !== null && last > 0 ? last : null
  }
}

/** 이 값보다 낮으면 "낮은 선수"로 모아 보여 준다(%) */
export const LOW_CONDITION = 85
export const LOW_SHARPNESS = 80
/** 평점 비교에 넣으려면 이번 시즌 이만큼은 뛰었어야 한다(출전 수를 모르면 평점만 본다) */
export const MIN_APPEARANCES_FOR_FORM = 3

export interface SquadReport {
  /** 게임이 답한 선수 수 */
  answered: number
  injured: PlayerHealth[]
  suspended: PlayerHealth[]
  lowCondition: PlayerHealth[]
  lowSharpness: PlayerHealth[]
  /** 사기가 낮은 순 */
  lowMorale: PlayerHealth[]
  bestForm: PlayerHealth[]
  worstForm: PlayerHealth[]
}

function lowest(players: PlayerHealth[], by: (player: PlayerHealth) => number | null, below: number, max: number): PlayerHealth[] {
  return players
    .filter((player) => !player.injured && (by(player) ?? Infinity) < below)
    .sort((a, b) => (by(a) as number) - (by(b) as number))
    .slice(0, max)
}

export function squadReport(players: PlayerHealth[]): SquadReport {
  const answered = players.filter((player) => player.read)
  const injured = answered
    .filter((player) => player.injured)
    // 오래 걸리는 부상이 위로(일수를 모르면 아래)
    .sort((a, b) => (b.injuryDays ?? -1) - (a.injuryDays ?? -1) || a.name.localeCompare(b.name, 'ko'))
  const suspended = answered.filter((player) => player.suspended)
  const withMorale = answered.filter((player) => player.morale !== null)
  const rated = answered
    .filter((player) => player.rating !== null && (player.appearances === null || player.appearances >= MIN_APPEARANCES_FOR_FORM))
    .sort((a, b) => (b.rating as number) - (a.rating as number))
  const spread = rated.length >= 6
  return {
    answered: answered.length,
    injured,
    suspended,
    lowCondition: lowest(answered, (player) => player.condition, LOW_CONDITION, 5),
    lowSharpness: lowest(answered, (player) => player.sharpness, LOW_SHARPNESS, 5),
    // 사기는 단위를 몰라 기준선을 두지 않고, 가장 낮은 세 명만 보여 준다
    lowMorale:
      withMorale.length >= 4
        ? [...withMorale].sort((a, b) => (a.morale as number) - (b.morale as number)).slice(0, 3)
        : [],
    bestForm: spread ? rated.slice(0, 3) : [],
    worstForm: spread ? rated.slice(-3).reverse() : []
  }
}

// ── 앱이 화면에 주는 것 ────────────────────────────────

export type ClubOffReason = 'off' | 'old' | 'notLoaded' | 'noSave' | 'noTeam' | 'otherTeam' | 'noAnswer'

export interface ClubSnapshot {
  ok: boolean
  /** ok가 아닐 때 화면에 그대로 보여 줄 한 줄 */
  message?: string
  reason?: ClubOffReason
  /** 게임에서 읽은 시각(ISO). 못 읽었으면 null */
  readAt: string | null
  profile: ClubProfile | null
  facilities: FacilityItem[]
  finances: FinanceItem[]
  players: PlayerHealth[]
  report: SquadReport | null
  /** 게임이 알려 준 값의 경로(어느 항목을 어디서 읽었는지, 확인용) */
  paths: Record<string, string>
}

export function emptySnapshot(reason: ClubOffReason, message: string): ClubSnapshot {
  return { ok: false, reason, message, readAt: null, profile: null, facilities: [], finances: [], players: [], report: null, paths: {} }
}

export function buildSnapshot(input: {
  club: PluginAnswer | null
  health: PluginAnswer | null
  roster: RosterPlayer[]
  readAt: string
}): ClubSnapshot {
  const fields = input.club?.records[0] ?? null
  const byUid = new Map<number, GameFields>()
  for (const record of input.health?.records ?? []) {
    const uid = numberOf(record.uid)
    if (uid !== null) byUid.set(uid, record)
  }
  const players = input.roster.map((player) => playerHealthOf(player, byUid.get(player.uid)))
  return {
    ok: true,
    readAt: input.readAt,
    profile: profileOf(fields),
    facilities: facilitiesOf(fields),
    finances: financesOf(fields),
    players,
    report: squadReport(players),
    paths: { ...(input.club?.paths ?? {}), ...(input.health?.paths ?? {}) }
  }
}

/** 1군 선수 목록 가운데 한 번에 게임에 물을 수 있는 선수 수(플러그인의 PersonInfo.MaxPeople) */
export const HEALTH_PER_REQUEST = 30
