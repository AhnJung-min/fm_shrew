import type { Recommendation, SquadMoney } from './recommend'

/** 세이브 전체(모든 구단의 선수)를 놓고 하는 일: 영입 후보 찾기와 능력치 수정 */

/** 세이브에 능력치 54개가 저장된 순서 */
export const SAVE_ATTRIBUTE_ORDER = [
  'crossing', 'dribbling', 'finishing', 'heading', 'longShots', 'marking', 'offTheBall', 'passing', 'penalty',
  'tackling', 'vision', 'handling', 'aerialReach', 'commandOfArea', 'communication', 'kicking', 'throwing',
  'anticipation', 'decisions', 'oneOnOnes', 'positioning', 'reflexes', 'firstTouch', 'technique', 'leftFoot',
  'rightFoot', 'flair', 'corners', 'teamwork', 'workRate', 'longThrows', 'eccentricity', 'rushingOut', 'punching',
  'acceleration', 'freeKick', 'strength', 'stamina', 'pace', 'jumping', 'leadership', 'dirtiness', 'balance',
  'bravery', 'consistency', 'aggression', 'agility', 'importantMatches', 'injuryProneness', 'versatility',
  'naturalFitness', 'determination', 'composure', 'concentration'
] as const

export type SaveAttributeId = (typeof SAVE_ATTRIBUTE_ORDER)[number]

/** 게임 화면에는 보이지 않는 능력치 */
export const HIDDEN_ATTRIBUTE_LABEL: Partial<Record<SaveAttributeId, string>> = {
  consistency: '일관성',
  importantMatches: '큰 경기',
  injuryProneness: '부상 빈도',
  versatility: '다재다능',
  dirtiness: '비매너 플레이'
}

/** 저장값(1~100)을 게임 표시값(1~20)으로 */
export function shownValue(stored: number): number {
  return Math.min(20, Math.max(1, Math.round(stored / 5)))
}

/** 영입 후보의 유형 */
export type CandidateCategory = 'all' | 'starter' | 'rotation' | 'prospect' | 'free'

export const CATEGORY_LABEL: Record<CandidateCategory, string> = {
  all: '전체',
  starter: '즉시 전력',
  rotation: '로테이션 자원',
  prospect: '유망주',
  free: '자유 계약'
}

export const CATEGORY_HELP: Record<CandidateCategory, string> = {
  all: '조건에 맞는 모든 선수',
  starter: '이 자리(역할)의 적합도가 내 팀 주전 이상인 선수',
  rotation: '적합도가 내 팀 주전보다는 낮고 두 번째 선수 이상인 선수',
  prospect: '21세 이하이고, 잠재 능력이 내 주전의 현재 능력 이상이며 아직 10 넘게 더 클 수 있는 선수',
  free: '소속 구단이 없는 선수'
}

/** 유망주로 보는 나이와 성장 여지 */
export const PROSPECT_MAX_AGE = 21
export const PROSPECT_MIN_ROOM = 10
/** 내 팀에 그 역할의 주전이 없을 때 유망주로 보는 잠재 능력 */
export const PROSPECT_PA_WITHOUT_STARTER = 150
/** 내 팀에 두 번째 선수가 없을 때, 주전보다 이만큼 낮은 점수까지를 교체 자원으로 본다 */
export const ROTATION_BAND = 6

export interface CandidateBench {
  /** 내 팀에서 이 역할 점수가 가장 높은 선수 */
  starter: { name: string; score: number; ca: number } | null
  /** 두 번째 */
  backup: { name: string; score: number } | null
}

/** 한 선수가 어느 유형에 드는지. 여러 유형에 들 수 있다. */
export function categoriesOf(
  player: { score: number; age: number | null; ca: number; pa: number; hasClub: boolean },
  bench: CandidateBench
): CandidateCategory[] {
  const found: CandidateCategory[] = []
  const { starter, backup } = bench
  if (starter) {
    if (player.score >= starter.score) found.push('starter')
    else if (player.score >= (backup ? backup.score : starter.score - ROTATION_BAND)) found.push('rotation')
  }
  const potentialFloor = starter ? starter.ca : PROSPECT_PA_WITHOUT_STARTER
  if (
    player.age !== null &&
    player.age <= PROSPECT_MAX_AGE &&
    player.pa >= potentialFloor &&
    player.pa - player.ca >= PROSPECT_MIN_ROOM
  ) {
    found.push('prospect')
  }
  if (!player.hasClub) found.push('free')
  return found
}

export interface CandidateQuery {
  roleId: string
  category: CandidateCategory
  /** 이 나이 이하만. 제한이 없으면 null */
  maxAge: number | null
  /** 고른 역할의 자리에서 뛸 수 있는 선수만 */
  onlyEligible: boolean
  /** 소속 구단을 알아내지 못한 선수도 넣을지 */
  includeUnknownClub: boolean
  /** 이름에 들어 있는 글자 */
  search: string
  /** 계약이 이 개월 수 안에 끝나는 선수만. 제한이 없으면 null */
  expiringWithinMonths: number | null
  /**
   * 전술의 한 자리를 기준으로 찾을 때: 그 자리의 포메이션·자리별 역할과 자리 순번.
   * 주전·두 번째 선수와 보강 필요도를 모두 이 자리에서 구하고, 역할(roleId)은 자리의 역할로 본다.
   * 없으면 고른 역할(roleId)만으로 찾는다.
   */
  slot?: { formation: string; slotRoles: Record<string, string>; index: number } | null
}

export interface CandidateRow {
  uid: number
  name: string
  age: number | null
  /** 게임 표기("D (RC), WB (R)") */
  position: string
  /** 소속 구단. 없으면 "자유 계약", 알아내지 못했으면 빈 글자 */
  club: string
  ca: number
  pa: number
  /** 세이브에 적힌 기준 몸값(파운드). 모르면 null */
  value: number | null
  /** 세이브에 적힌 주급(파운드). 모르면 null */
  wage: number | null
  /** 세이브에 적힌 계약 만료일. 모르면 null */
  contractEnd: { year: number; month: number; day: number } | null
  /** 계약상 입지("핵심 선수"). 모르면 빈 글자 */
  squadStatus: string
  /** 국적. 나라 이름을 아직 모르면 빈 글자 */
  nation: string
  /** 소속 구단의 고유 번호(엠블럼용). 구단을 알아내지 못했거나 자유 계약이면 null */
  clubUid: number | null
  /** 고른 역할의 적합도(0~100) */
  score: number
  /** 내 주전과의 점수 차이. 주전이 없으면 null */
  gap: number | null
  categories: CandidateCategory[]
  /** 추천 점수(0~100)와 항목별 풀이 */
  recommend: Recommendation
  /** 능력치 54개(게임 표시값 1~20), SAVE_ATTRIBUTE_ORDER 순서 */
  attributes: number[]
}

export interface CandidateResult {
  ok: boolean
  /** 읽지 못한 이유 */
  message?: string
  /** 읽은 세이브 파일 이름 */
  saveName?: string
  bench: CandidateBench
  /** 유형마다 조건(역할·나이·이름)에 맞는 선수 수 */
  counts: Record<CandidateCategory, number>
  /** 보여 주는 줄(점수 순, 많으면 앞에서 자른다) */
  rows: CandidateRow[]
  /** 고른 유형에 드는 선수 수(rows보다 많을 수 있다) */
  matched: number
  /** 자리를 기준으로 찾았을 때 그 자리의 보강 필요도(0~100). 아니면 없다 */
  need?: number | null
  /** 비용 부담을 견준 내 팀의 주급·몸값 수준. 알 수 없으면 null */
  baseline?: SquadMoney | null
}

/**
 * 계약상 입지(세이브에 적힌 값 → 이름). 구단이 그 선수에게 약속한 역할이지 실제 출전 시간이 아니다.
 * 값의 뜻은 공개 해독기 fmsave가 게임 화면과 맞춰 확인해 둔 것을 따랐다.
 */
export const SQUAD_STATUS_LABEL: Record<number, string> = {
  1: '핵심 선수',
  2: '중요 선수',
  3: '주전',
  4: '로테이션',
  5: '교체 카드',
  7: '비주전',
  9: '비상 백업',
  10: '1군 진입 유망주',
  11: '미래 유망주',
  13: '유소년',
  14: 'B팀 주전',
  15: '주전 골키퍼',
  16: '컵 대회 골키퍼',
  17: '국내 컵 골키퍼',
  18: '대륙 컵 골키퍼',
  20: '백업 골키퍼',
  21: '비상 백업 골키퍼'
}

/**
 * 게임이 알려 주는 선수의 시장 정보(영입 후보에 붙인다). 세이브에서는 읽지 못하고, 켜져 있는 게임에 물어 받는다.
 * 게임이 감독에게 보여 주는 그대로라서, 스카우트하지 않은 선수의 몸값은 게임에서처럼 넓은 범위로 나온다.
 */
export interface PlayerMarket {
  uid: number
  /** 게임이 적어 주는 몸값("170억 원 - 185억 원") */
  value?: string
  /** 몸값을 견줄 때 쓰는 수(게임의 기준 통화) */
  valueSort?: number
  /** 게임이 적어 주는 주급("주급 6.5억 원") */
  wage?: string
  wageSort?: number
  /** 계약 만료일. 연·월·일 */
  contractEnd?: { year: number; month: number; day: number }
  nation?: string
  /** 게임이 알려 주는 소속 구단(세이브에서 구단을 알아내지 못한 선수에 쓴다) */
  club?: string
  /** 여자 선수인지 */
  female?: boolean
}

export interface MarketResult {
  /** 게임에 물어볼 수 있었는지 */
  ok: boolean
  /** 물어볼 수 없었던 이유 */
  message?: string
  /** 답을 받은 선수들(게임에서 찾지 못한 선수는 빠진다) */
  players: PlayerMarket[]
}

/** 게임이 적어 준 날짜("2027년/6월/30일", "30/6/2027" 등)에서 연·월·일을 뽑는다. 알아보지 못하면 null */
export function parseGameDate(text: string): { year: number; month: number; day: number } | null {
  const numbers = (text.match(/\d+/g) ?? []).map(Number)
  if (numbers.length !== 3) return null
  const yearAt = numbers.findIndex((value) => value >= 1900)
  if (yearAt !== 0 && yearAt !== 2) return null
  const [month, day] = yearAt === 0 ? [numbers[1], numbers[2]] : [numbers[1], numbers[0]]
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year: numbers[yearAt], month, day }
}

/** 에디터의 선수 목록 한 줄 */
export interface EditorListItem {
  uid: number
  name: string
  age: number | null
  position: string
  club: string
  /** 소속 구단의 고유 번호(엠블럼). 모르면 없다 */
  clubUid?: number | null
  ca: number
  pa: number
}

/** 에디터에서 고치는 한 선수의 값 */
export interface EditorPlayer extends EditorListItem {
  /** 포지션 숙련도 15개(1~20), POSITION_KEYS 순서 */
  positions: number[]
  /** 능력치 54개의 저장값(1~100) */
  attributes: number[]
  /** 값을 어디서 읽었는지: 켜져 있는 게임의 지금 값인지, 마지막으로 저장한 세이브의 값인지 */
  source: 'game' | 'save'
  /** 세이브의 값을 보여 줄 때 그 이유 */
  sourceNote?: string
}

/** 한 선수에 대한 수정. 적힌 것만 바꾼다 */
export interface EditorEdit {
  uid: number
  positions?: number[]
  attributes?: number[]
  ca?: number
  pa?: number
}

export interface EditorApplyResult {
  ok: boolean
  message: string
}

const whole = (values: number[], length: number, min: number, max: number): boolean =>
  values.length === length && values.every((value) => Number.isInteger(value) && value >= min && value <= max)

/** 고칠 값이 범위 안인지 본다. 문제가 있으면 그 이유를 돌려준다. */
export function checkEdit(edit: EditorEdit): string | null {
  if (!Number.isInteger(edit.uid) || edit.uid <= 0) return '선수를 알아볼 수 없습니다.'
  if (edit.positions && !whole(edit.positions, 15, 1, 20)) return '포지션 숙련도는 1~20이어야 합니다.'
  if (edit.attributes && !whole(edit.attributes, SAVE_ATTRIBUTE_ORDER.length, 1, 100)) return '능력치 값이 범위를 벗어났습니다.'
  for (const value of [edit.ca, edit.pa]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 200)) return '현재·잠재 능력은 1~200이어야 합니다.'
  }
  if (edit.ca !== undefined && edit.pa !== undefined && edit.ca > edit.pa) return '현재 능력이 잠재 능력보다 클 수 없습니다.'
  return null
}

/** 선수 정보 화면의 능력치 한 칸(게임 표시값 1~20) */
export interface ProfileAttribute {
  id: string
  label: string
  group: 'technical' | 'mental' | 'physical' | 'goalkeeping'
  value: number
}

/** 선수 한 명의 정보 화면에 필요한 모든 것 */
export interface PlayerProfile {
  uid: number
  name: string
  age: number | null
  /** 생년월일. 모르면 null */
  birth: { year: number; month: number; day: number } | null
  /** 게임 표기("D (RC), WB (R)") */
  position: string
  /** 포지션 숙련도 15개(1~20), POSITION_KEYS 순서 */
  positions: number[]
  goalkeeper: boolean
  ca: number
  pa: number
  /** 구단 이름. 소속이 없으면 "자유 계약", 모르면 빈 글자 */
  club: string
  /** 소속 구단의 고유 번호(엠블럼). 모르면 null */
  clubUid: number | null
  nation: string
  /** 몸값. 모르면 빈 글자 */
  value: string
  /** 주급. 모르면 빈 글자 */
  wage: string
  /** 몸값·주급의 출처: 켜져 있는 게임이 알려 준 금액(원)인지, 세이브에 적힌 기준 금액(파운드)인지 */
  moneyFrom: 'game' | 'save'
  contractEnd: { year: number; month: number; day: number } | null
  squadStatus: string
  /** 왼발·오른발 능력(1~20) */
  foot: { left: number; right: number }
  /** 보이는 능력치. 기술(골키퍼는 골키퍼) → 정신 → 신체 순 */
  attributes: ProfileAttribute[]
  /** 게임 화면에는 안 보이는 능력치 */
  hidden: Array<{ id: string; label: string; value: number }>
  /** 능력치와 능력을 어디서 읽었는지: 켜져 있는 게임의 지금 값인지, 세이브에 적힌 값인지 */
  source: 'game' | 'save'
  sourceNote?: string
}
