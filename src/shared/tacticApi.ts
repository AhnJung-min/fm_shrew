import type { RoleNorms } from './norms'
import type { Phase, SlotProfile } from './slotProfile'
import type { Tactic, TacticProblem } from './tacticModel'
import type { Settings } from './types'

/**
 * 2단계 새 창구(화면 ↔ 본체)가 주고받는 결과 타입, 본체만 쓰는 설정 열쇠, 이전 기록 타입, 아직 채우지 않은 창구가 돌려주는 글.
 * 창구 이름(Api 메서드)과 채널 이름은 TACTIC_CHANNELS에 모아 두고, preload와 본체(tacticIpc.ts)와 미리보기 목업이 같은 이름을 쓰는지는
 * tests/phase2Contract.test.ts가 본다. 이 모듈은 타입과 작은 순수 함수뿐이다.
 */

// ---------- 본체만 쓰는 설정 열쇠 ----------

/**
 * 본체가 소유한 설정 열쇠. 화면이 보내는 settings:set의 patch에서는 이 열쇠를 버린다(오래된 설정 객체를 통째로 보내
 * 전술이 사라지는 일을 막는다). 화면은 전용 창구(tacticsSave, customRolesSave, migrationAck)로만 쓰고, 본체가 검사한 뒤 쓴다.
 */
export const MAIN_OWNED_KEYS: readonly (keyof Settings)[] = ['tactics', 'tacticsDefault', 'customRoles', 'migration', 'settingsVersion', 'settingsProblem']

/** 화면의 patch에서 본체 소유 열쇠를 뺀 것. 객체가 아니면 빈 patch다 */
export function dropMainOwned(patch: Partial<Settings>): Partial<Settings> {
  if (!patch || typeof patch !== 'object') return {}
  const kept: Partial<Settings> = { ...patch }
  for (const key of MAIN_OWNED_KEYS) delete kept[key]
  return kept
}

// ---------- 창구 이름 ----------

/** 새 창구: 화면(Api)의 메서드 이름 → IPC 채널 이름 */
export const TACTIC_CHANNELS = {
  tacticsSave: 'tactics:save',
  worldNorms: 'world:norms',
  tacticImport: 'tactics:import',
  tacticRecommend: 'tactics:recommend',
  customRolesSave: 'roles:saveCustom',
  roleBundleExport: 'roles:export',
  roleBundlePreview: 'roles:preview',
  roleBundleApply: 'roles:apply',
  roleStarCheck: 'roles:stars',
  migrationAck: 'settings:ackMigration'
} as const

// ---------- 결과 타입 ----------

export interface SimpleResult {
  ok: boolean
  message?: string
  /** 바뀐 설정(본체가 쓴 뒤의 것). 화면은 이것으로 자기 설정을 바꾼다(lib/settingsBus.ts) */
  settings?: Settings
}

export interface TacticSaveResult extends SimpleResult {
  /** 저장하지 못한 까닭들(검사에 걸린 것). 저장했으면 빈 목록 */
  problems: TacticProblem[]
}

export interface NormsResult {
  ok: boolean
  message?: string
  /** 프로파일마다 기준 분포(열쇠 = 카탈로그의 normKey) */
  norms: RoleNorms
}

export interface TacticImportResult {
  ok: boolean
  message: string
  /** 게임에서 읽은 전술 초안(저장하지 않았다) */
  draft?: Tactic
  /** 읽다가 만난 문제들 */
  problems: string[]
  /** 앱이 모르는 게임 값(포지션·역할 비트) */
  unknownBits: string[]
  gameName?: string
  formationName?: string
  elapsedMs?: number
}

export interface TacticCandidate {
  tactic: Tactic
  /** 순위를 매기는 목적 값(채운 자리가 먼저, 그다음 주전 전력 합) */
  objective: number
  /** 주전 전력 합(주전 11명이 같은 자리 상위권 평균보다 얼마나 나은지를 더한 값) */
  strength: number
  filled: number
  temporary: number
  /** 지금 전술인가 */
  current: boolean
  /** 근거가 게임에서 확인되지 않은 역할이 든 자리 수 */
  unconfirmed: number
}

export interface SlotSuggestion {
  index: number
  label: string
  from: SlotProfile
  to: SlotProfile
  gain: number
  unconfirmed: boolean
}

export interface TacticRecommendResult {
  ok: boolean
  message?: string
  ranked: TacticCandidate[]
  suggestions: SlotSuggestion[]
  elapsedMs: number
}

export interface RoleStarRow {
  roleId: string
  label: string
  phase: Phase
  n: number
  rho: number | null
  flagged: boolean
  note: string
}

export interface RoleStarReport {
  ok: boolean
  message: string
  rows: RoleStarRow[]
  players: number
  readAt: string | null
  elapsedMs?: number
}

export interface RoleBundlePreview {
  ok: boolean
  message: string
  /** 가져오기를 확인할 때 되돌려 주는 표(본체가 파일을 기억한다) */
  token?: string
  changes: string[]
  warnings: string[]
}

// ---------- 설정 이전 기록 ----------

export interface MigrationNote {
  kind: 'slot' | 'weightsCarried' | 'weightsReset' | 'share' | 'tacticsDropped' | 'backup' | 'problem'
  text: string
}

export interface MigrationRecord {
  version: number
  /** 이전한 시각(ISO) */
  at: string
  notes: MigrationNote[]
  /** 사용자가 알림을 확인했는가(확인하면 다시 보이지 않는다) */
  acknowledged: boolean
  backupFile?: string
}

// ---------- 아직 채우지 않은 창구 ----------

/** 아직 채우지 않은 창구(빈 서비스와 미리보기 목업의 빈 틀)가 돌려주는 글 */
export const NOT_READY = '아직 준비되지 않았습니다.'

export const simpleFailed = (message: string): SimpleResult => ({ ok: false, message })
export const tacticSaveFailed = (message: string): TacticSaveResult => ({ ok: false, message, problems: [] })
export const normsFailed = (message: string): NormsResult => ({ ok: false, message, norms: {} })
export const tacticImportFailed = (message: string): TacticImportResult => ({ ok: false, message, problems: [], unknownBits: [] })
export const tacticRecommendFailed = (message: string): TacticRecommendResult => ({ ok: false, message, ranked: [], suggestions: [], elapsedMs: 0 })
export const roleBundlePreviewFailed = (message: string): RoleBundlePreview => ({ ok: false, message, changes: [], warnings: [] })
export const roleStarFailed = (message: string): RoleStarReport => ({ ok: false, message, rows: [], players: 0, readAt: null })
