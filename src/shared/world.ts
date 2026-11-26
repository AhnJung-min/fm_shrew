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
  starter: '즉시 전력감',
  rotation: '교체 자원',
  prospect: '유망주',
  free: '자유 계약'
}

export const CATEGORY_HELP: Record<CandidateCategory, string> = {
  all: '조건에 맞는 모든 선수',
  starter: '고른 역할의 점수가 내 팀 주전 이상인 선수',
  rotation: '점수가 내 팀 주전보다는 낮고 두 번째 선수 이상인 선수',
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
  /** 고른 역할의 점수(0~100) */
  score: number
  /** 내 주전과의 점수 차이. 주전이 없으면 null */
  gap: number | null
  categories: CandidateCategory[]
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
}

/** 에디터의 선수 목록 한 줄 */
export interface EditorListItem {
  uid: number
  name: string
  age: number | null
  position: string
  club: string
  ca: number
  pa: number
}

/** 에디터에서 고치는 한 선수의 값 */
export interface EditorPlayer extends EditorListItem {
  /** 포지션 숙련도 15개(1~20), POSITION_KEYS 순서 */
  positions: number[]
  /** 능력치 54개의 저장값(1~100) */
  attributes: number[]
}

/** 한 선수에 대한 수정. 적힌 것만 바꾼다 */
export interface EditorEdit {
  uid: number
  positions?: number[]
  attributes?: number[]
  ca?: number
  pa?: number
}

export interface EditorSaveResult {
  ok: boolean
  message: string
  /** 새로 쓴 세이브 파일 이름 */
  fileName?: string
}
