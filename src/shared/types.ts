import type { TalkCapture, TalkEffort, TalkResult, TalkStats, TalkStatus } from './talk'

/** 스냅샷 종류: 내 스쿼드인지, 선수 검색(영입 후보) 결과인지 */
export type SnapshotKind = 'squad' | 'search'

export type ColumnGroup = 'info' | 'technical' | 'mental' | 'physical' | 'goalkeeping' | 'other'

/** 한 칸의 값. 원문과 함께, 숫자로 읽을 수 있으면 숫자도 담는다. */
export interface CellValue {
  raw: string
  /** 숫자로 읽은 값. 범위(12-15)는 중간값. 숫자가 아니면 null */
  num: number | null
  /** 스카우트 정보가 부족해 범위로 나온 값 */
  range?: [number, number]
}

export interface ColumnInfo {
  /** 파일에 적힌 열 이름 그대로 */
  header: string
  /** 앱이 알아본 항목 id. 못 알아보면 null */
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
}

export interface PlayerRow {
  idx: number
  name: string
  /** 열 이름(header) → 값 */
  cells: Record<string, CellValue>
}

export interface SnapshotMeta {
  id: number
  kind: SnapshotKind
  sourceFile: string
  fileName: string
  importedAt: string
  rowCount: number
  columnCount: number
}

export interface Snapshot extends SnapshotMeta {
  columns: ColumnInfo[]
  rows: PlayerRow[]
}

export type Density = 'compact' | 'comfortable'

export interface Settings {
  /** 내보내기 파일이 생기는지 지켜볼 폴더들 */
  watchDirs: string[]
  /** 세이브 파일(.fm)이 있는 폴더. 게임이 저장하면 내 팀 선수를 다시 읽는다 */
  saveDir: string
  /** 세이브 파일 이름 → 내 팀 id (한 번 찾으면 기억한다) */
  saveTeams: Record<string, number>
  density: Density
  /** 뎁스 차트에 쓰는 포메이션 id */
  formation: string
  /** "포메이션:자리 순번" → 역할 id. 자리마다 고른 역할을 기억한다 */
  slotRoles: Record<string, string>
  /** 역할 id → (능력치 id → 가중치). 기본 프리셋에서 고친 것만 담는다 */
  roleWeights: Record<string, Record<string, number>>
  /** 토크 도우미를 부르는 전역 단축키(Electron 가속기 표기) */
  talkHotkey: string
  /** 토크 도우미가 쓰는 Claude 모델 */
  talkModel: string
  /** 생각의 깊이 */
  talkEffort: TalkEffort
  /** 자주 쓰는 말 */
  talkPhrases: string[]
  /** 게임 창을 못 찾을 때 주 모니터 전체를 찍어도 되는지 */
  talkAllowScreen: boolean
  /** 토크 도우미 누적 사용량 */
  talkStats: TalkStats
  /** 열 이름 → 항목 id. 자동 인식이 틀렸거나 못 알아본 열을 직접 지정 */
  columnOverrides: Record<string, string>
}

export interface WatchDirStatus {
  dir: string
  exists: boolean
}

export interface AppStatus {
  watchDirs: WatchDirStatus[]
  saveDir: WatchDirStatus
  dataDir: string
  version: string
}

export interface ImportResult {
  ok: boolean
  file: string
  snapshot?: SnapshotMeta
  /** 실패했거나 건너뛴 이유 */
  message?: string
  skipped?: boolean
}

/** 화면(렌더러)이 쓰는 기능 목록. Electron에서는 preload가, 브라우저 미리보기에서는 mock이 구현한다. */
export interface Api {
  getStatus(): Promise<AppStatus>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  listSnapshots(): Promise<SnapshotMeta[]>
  getSnapshot(id: number): Promise<Snapshot | null>
  setSnapshotKind(id: number, kind: SnapshotKind): Promise<void>
  deleteSnapshot(id: number): Promise<void>
  /** 파일 선택 창을 열어 가져오기 */
  pickAndImport(): Promise<ImportResult[]>
  /** 끌어다 놓은 파일 경로로 가져오기 */
  importPaths(paths: string[]): Promise<ImportResult[]>
  pickFolder(): Promise<string | null>
  openPath(path: string): Promise<void>
  /** 끌어다 놓은 File의 실제 경로 */
  pathForFile(file: File): string
  onImported(cb: (result: ImportResult) => void): () => void

  // 토크·협상 도우미
  talkStatus(): Promise<TalkStatus>
  /** API 키를 저장한다. 키는 메인 프로세스에만 남고 화면으로 돌아오지 않는다 */
  talkSetKey(key: string): Promise<TalkStatus>
  talkClearKey(): Promise<TalkStatus>
  /** 지금 게임 화면을 찍는다 */
  talkCapture(): Promise<{ ok: boolean; capture?: TalkCapture; message?: string }>
  /** 찍어 둔 화면과 하고 싶은 말을 AI에 보낸다 */
  talkAsk(captureId: number, intent: string): Promise<TalkResult>
  /** 단축키로 화면이 찍혔을 때 */
  onTalkCaptured(cb: (event: { capture?: TalkCapture; message?: string }) => void): () => void
  /** 앱 창을 내려 게임으로 돌아간다 */
  hideWindow(): Promise<void>
}
