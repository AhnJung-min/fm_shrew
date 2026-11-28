import type { RoleNorms } from './norms'
import type { ClubSnapshot } from './club'
import type { DashboardData } from './dashboard'
import type { ApplyResult, LinkStatus, SaveFileInfo } from './game'
import type { SaveRecords } from './records'
import type { CatalogId, CustomRole } from './roleCatalog'
import type { SeasonResult } from './season'
import type { SlotProfile } from './slotProfile'
import type { TalkEffort, TalkStats, TalkStatus } from './talk'
import type {
  MigrationRecord,
  NormsResult,
  RoleBundlePreview,
  RoleStarReport,
  SimpleResult,
  TacticImportResult,
  TacticRecommendResult,
  TacticSaveResult
} from './tacticApi'
import type { Tactic, TacticSet } from './tacticModel'
import type { CandidateQuery, CandidateResult, EditorApplyResult, EditorEdit, EditorListItem, EditorPlayer, MarketResult, PlayerProfile } from './world'

/** key·support는 "주요 능력치만" 볼 때 능력치 열을 핵심과 도움으로 묶는 화면용 묶음(keyAttributes.ts) */
export type ColumnGroup = 'info' | 'contract' | 'technical' | 'mental' | 'physical' | 'goalkeeping' | 'other' | 'key' | 'support'

/** 한 칸의 값. 원문과 함께, 숫자로 읽을 수 있으면 숫자도 담는다. */
export interface CellValue {
  raw: string
  /** 숫자로 읽은 값. 범위(12-15)는 중간값. 숫자가 아니면 null */
  num: number | null
  /** 스카우트 정보가 부족해 범위로 나온 값 */
  range?: [number, number]
}

export interface ColumnInfo {
  /** 열 이름(줄의 cells에서 값을 찾는 열쇠) */
  header: string
  /** 항목 id. 앱이 따로 덧붙인 열이 아니면 fields.ts의 id */
  field: string | null
  group: ColumnGroup
  /** 표 머리에 쓰는 짧은 이름 */
  short: string
  /** 전체 이름 */
  label: string
  /** 1~20 능력치 열인지 */
  isAttr: boolean
  /** 값이 대부분 숫자인지(오른쪽 정렬과 숫자 정렬에 사용) */
  numeric: boolean
  /** 열 너비(px)를 직접 정할 때. 없으면 값의 길이로 어림한다 */
  width?: number
  /** 표 머리에 마우스를 올렸을 때의 설명. 없으면 전체 이름(파일에서 읽은 열이면 파일의 열 이름도) */
  hint?: string
}

export interface PlayerRow {
  idx: number
  name: string
  /** 열 이름(header) → 값 */
  cells: Record<string, CellValue>
  /** 포지션 숙련도 15개(1~20), positions.ts의 POSITION_KEYS 순서. 적합도에서 숙련 감점을 계산하는 데 쓴다. 모르면 없다 */
  ratings?: number[]
  /**
   * 다른 구단에서 임대로 온 선수(임대 영입)면 임대 끝 날짜와 원 소속 구단. 임대가 아니면 없다.
   * 세이브의 임대 기록에는 만료일이 없어, 끝 날짜는 오늘 이후 첫 6월 30일로 어림한 값이다(추정). 원 소속을 모르면 from은 빈 글자
   */
  loan?: { end: { year: number; month: number; day: number }; from: string }
}

/** 내 팀 선수 표 */
export interface SquadResult {
  ok: boolean
  /** 표를 만들지 못한 이유 */
  message?: string
  columns: ColumnInfo[]
  /** 줄의 idx는 선수 고유 번호다 */
  rows: PlayerRow[]
  /** 세이브가 알려 주는 게임 속 오늘(계약이 얼마나 남았는지 셀 때 쓴다). 모르면 없다 */
  today?: { year: number; month: number; day: number }
  /** 내 구단의 고유 번호(엠블럼용). 모르면 없다 */
  clubUid?: number
  /** 역할별 기준 분포(전술 분석이 점수를 역할마다 같은 눈금으로 재는 데 쓴다). 세이브 전체에서 구한 값이라 모르면 없다 */
  roleNorms?: RoleNorms
}

export type Density = 'compact' | 'comfortable'

/** 화면 색. blue는 어두운 남색, black은 무채색 검정 */
export type ThemeId = 'blue' | 'black'

/** 글자 크기(화면 배율). 1은 보통, 1.1은 크게, 1.25는 아주 크게. 100% 아래로는 내리지 않는다 */
export type UiScale = 1 | 1.1 | 1.25

export interface Settings {
  /** 세이브 파일(.fm)이 있는 폴더 */
  saveDir: string
  /** 마지막으로 적용한 세이브의 경로. 앱을 켜면 이 세이브를 다시 적용한다 */
  activeSave: string
  /** 세이브 파일 이름 → 내 팀 id (한 번 찾으면 기억한다) */
  saveTeams: Record<string, number>
  density: Density
  /** 화면 색 */
  theme: ThemeId
  /** 뎁스 차트에 쓰는 포메이션 id */
  formation: string
  /** "포메이션:자리 순번" → 역할 id. 자리마다 고른 역할을 기억한다 */
  slotRoles: Record<string, string>
  /** 역할 id → (능력치 id → 가중치). 기본 프리셋에서 고친 것만 담는다 */
  roleWeights: Record<string, Record<string, number>>
  /** 게임 안 직접 답변이 쓰는 Claude 모델 */
  talkModel: string
  /** 생각의 깊이 */
  talkEffort: TalkEffort
  /** 게임 안 직접 답변의 누적 사용량 */
  talkStats: TalkStats
  /** 경기 화면에서 본 "홈|원정" 약칭들(최근 것만). 여러 경기에 다 나오는 약칭이 우리 팀이다 */
  matchPairs: string[]
  /** 창을 닫아도 앱을 끄지 않고 작업 표시줄 알림 영역에 남겨 둘지(게임 안 직접 답변이 계속 되도록) */
  keepRunning: boolean
  /** 게임이 저장할 때마다 세이브 사본을 남길지 */
  backupEnabled: boolean
  /** 세이브마다 보관할 사본 개수. 넘으면 오래된 것부터 지운다 */
  backupKeep: number

  // ---------- 2단계(FM26 역할 체계)에서 더한 칸. 모두 선택이고, 옛 칸(formation, slotRoles, roleWeights)은 그대로 둔다 ----------
  /**
   * 세이브 파일 이름 → 전술 묶음(전술 1~3개와 주 전술). 본체만 쓴다: 화면이 보낸 settings:set patch에서는 버리고,
   * 전용 창구(tacticsSave)로만 쓴다(MAIN_OWNED_KEYS)
   */
  tactics?: Record<string, TacticSet>
  /** 세이브별 묶음이 없을 때 쓰는 기본 전술 묶음. 세이브별 묶음은 처음 고칠 때 이것을 복사해 만든다. 본체만 쓴다 */
  tacticsDefault?: TacticSet
  /** 쓰는 역할 카탈로그. 없으면 기본(catalogs.ts의 DEFAULT_CATALOG). 'legacy14'로 두면 옛 14역할 계산으로 돈다 */
  catalog?: CatalogId
  /** 사용자가 만든 역할. 본체만 쓴다(전용 창구 customRolesSave) */
  customRoles?: CustomRole[]
  /** 설정 이전(옛 설정 → 새 전술) 기록과 알림. 본체만 쓴다 */
  migration?: MigrationRecord
  /** 설정 파일의 판. 이 값이 이전 단계보다 낮으면 이전한다. 본체만 쓴다 */
  settingsVersion?: number
  /** 설정 파일이 깨져 있었을 때의 기록(깨진 파일은 따로 남기고 기본값으로 시작했다). 본체만 쓴다 */
  settingsProblem?: { at: string; file: string; message: string }
  // ---------- 디자인 적용 1차 ----------
  /** 글자 크기(화면 배율). 없으면 1(보통) */
  uiScale?: UiScale
  /** 창을 늘 다른 창 위에 둔다. 없으면 끔 */
  alwaysOnTop?: boolean
}

/** 세이브 사본 하나 */
export interface BackupEntry {
  /** 사본 파일 이름 */
  id: string
  /** 원래 세이브 파일 이름(예: 내 세이브.fm) */
  saveName: string
  /** 게임이 그 세이브를 저장한 시각 */
  savedAt: string
  /** 복원하기 직전에 있던 세이브를 남겨 둔 것인지 */
  beforeRestore: boolean
  bytes: number
}

export interface BackupList {
  /** 사본을 두는 폴더 */
  dir: string
  /** 최근 것부터 */
  entries: BackupEntry[]
  totalBytes: number
}

export interface WatchDirStatus {
  dir: string
  exists: boolean
}

export interface AppStatus {
  saveDir: WatchDirStatus
  dataDir: string
  version: string
}

/** 화면(렌더러)이 쓰는 기능 목록. Electron에서는 preload가, 브라우저 미리보기에서는 mock이 구현한다. */
export interface Api {
  getStatus(): Promise<AppStatus>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  openPath(path: string): Promise<void>

  // 게임 연결과 세이브 적용
  linkStatus(): Promise<LinkStatus>
  /** 세이브 폴더의 세이브 파일들, 최근에 저장한 것부터 */
  listSaves(): Promise<SaveFileInfo[]>
  /**
   * 세이브를 골라 적용한다. 그 세이브의 자료로 모든 화면이 돈다. 몇 초 걸린다.
   * 그 세이브를 저장한 게임의 판이 앱이 확인한 판(shared/compat.ts의 지원 표)이 아니거나 읽을 수 없으면 적용하지 않고 ok 거짓에 needsConfirm 참으로 돌려준다.
   * allowUnknownVersion은 사용자가 그것을 확인한 뒤에도 적용하겠다는 뜻이다. 앱을 켤 때의 자동 적용은 이 값을 주지 않아 그런 세이브를 건너뛴다(본체 gameLink.ts의 apply)
   */
  applySave(path: string, options?: { allowUnknownVersion?: boolean }): Promise<ApplyResult>
  /** 켜져 있는 게임에서 지금 값을 다시 받는다 */
  refreshLive(rescan: boolean): Promise<void>
  /** 게임 연결이나 자료가 바뀌었을 때 */
  onLinkChanged(cb: (status: LinkStatus) => void): () => void
  /** 내 팀 선수 표 */
  worldSquad(): Promise<SquadResult>
  /** 적용한 세이브에서 읽은 내 팀의 지난 경기·앞으로 할 경기와 리그 순위표 */
  worldSeason(): Promise<SeasonResult>
  /** 대시보드에 필요한 값 전부(적용한 세이브와 전술 설정에서 계산) */
  worldDashboard(): Promise<DashboardData>
  /** 켜져 있는 게임에 물어 받는 구단 프로필·시설·재정과 선수단 건강·경기력. force면 기억해 둔 것을 쓰지 않는다 */
  worldClub(force?: boolean): Promise<ClubSnapshot>

  // 세이브 전체(모든 구단의 선수)
  /** 고른 역할로 영입 후보를 유형별로 고른다 */
  worldCandidates(query: CandidateQuery): Promise<CandidateResult>
  /** 선수들의 몸값·주급·계약 만료·국적을 켜져 있는 게임에 물어 받는다 */
  worldMarket(uids: number[]): Promise<MarketResult>
  /** 선수 한 명의 정보 화면에 필요한 값 전부. 선수를 찾지 못하면 null */
  worldProfile(uid: number): Promise<PlayerProfile | null>
  /** 선수 얼굴 사진의 주소. 사진을 줄 수 없는 환경(브라우저 미리보기)이면 null. 파일이 없으면 주소를 열 때 404가 난다 */
  faceUrl(uid: number): string | null
  /** 구단 엠블럼의 주소(구단 고유 번호). 브라우저 미리보기에서는 null. 파일이 없으면 404 */
  clubLogoUrl(uid: number): string | null
  /** 에디터의 선수 목록. 찾는 글자가 없으면 내 팀 선수들 */
  editorList(search: string): Promise<{ ok: boolean; message?: string; saveName?: string; items: EditorListItem[] }>
  /** 선수의 값. 게임이 켜져 있으면 게임의 지금 값을, 아니면 세이브의 값을 준다 */
  editorPlayer(uid: number): Promise<EditorPlayer | null>
  /** 고친 값을 켜져 있는 게임에 바로 넣는다 */
  editorApply(edits: EditorEdit[]): Promise<EditorApplyResult>

  // 게임 안 직접 답변(AI 키와 상태)
  talkStatus(): Promise<TalkStatus>
  /** API 키를 저장한다. 키는 메인 프로세스에만 남고 화면으로 돌아오지 않는다 */
  talkSetKey(key: string): Promise<TalkStatus>
  talkClearKey(): Promise<TalkStatus>
  // 세이브 자동 백업
  backupList(): Promise<BackupList>
  /** 세이브 폴더의 가장 최근 세이브를 지금 사본으로 남긴다 */
  backupNow(): Promise<{ ok: boolean; message?: string }>
  /** 사본을 세이브 폴더로 되돌린다. 지금 있는 세이브는 먼저 사본으로 남긴다 */
  backupRestore(id: string): Promise<{ ok: boolean; message?: string }>
  backupDelete(id: string): Promise<void>
  /** 사본이 생기거나 없어졌을 때 */
  onBackupChanged(cb: () => void): () => void
  /** 본체가 설정을 바꿨을 때(예: 알림 영역 메뉴의 '항상 위에 두기'). 바뀐 뒤의 설정 전체를 준다 */
  onSettingsChanged(cb: (settings: Settings) => void): () => void
  // 기록 보관(성장 스냅샷·경기 평점)
  recordsList(): Promise<SaveRecords[]>
  /** 세이브 하나의 기록 폴더를 휴지통으로 보낸다 */
  recordsRemove(id: string): Promise<{ ok: boolean; message?: string }>

  // ---------- 2단계(FM26 역할 체계)의 창구. 채널 이름은 tacticApi.ts의 TACTIC_CHANNELS ----------
  /** 전술 묶음을 저장한다. saveKey가 null이면 모든 세이브의 기본 묶음(tacticsDefault). 본체가 검사한 뒤에만 쓴다 */
  tacticsSave(saveKey: string | null, set: TacticSet): Promise<TacticSaveResult>
  /** 화면에 없는 프로파일(편집 중인 초안, 바꾼 직후의 역할)의 기준 분포 */
  worldNorms(profiles: SlotProfile[]): Promise<NormsResult>
  /** 켜져 있는 게임의 지금 전술을 읽어 전술 초안으로 돌려준다(저장하지 않는다) */
  tacticImport(options?: { readRoleLists?: boolean }): Promise<TacticImportResult>
  /** 내 선수단에 맞는 전술을 찾아 순위로 돌려준다 */
  tacticRecommend(tactic: Tactic): Promise<TacticRecommendResult>
  customRolesSave(roles: CustomRole[]): Promise<SimpleResult>
  /** 역할 가중치 묶음을 파일로 내보낸다(저장 위치는 본체의 대화상자가 묻는다) */
  roleBundleExport(): Promise<SimpleResult>
  /** 가져올 가중치 묶음 파일을 골라 바뀔 것을 미리 본다(파일 위치는 본체의 대화상자가 묻는다) */
  roleBundlePreview(): Promise<RoleBundlePreview>
  roleBundleApply(token: string, mode: 'merge' | 'replace'): Promise<SimpleResult>
  /** 앱의 역할 적합도와 게임의 역할 별점을 견준 표(점수에는 넣지 않는다) */
  roleStarCheck(): Promise<RoleStarReport>
  /** 설정 이전 알림을 확인했다고 알린다 */
  migrationAck(): Promise<SimpleResult>
}
