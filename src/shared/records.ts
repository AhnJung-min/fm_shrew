/** 설정 화면의 "기록" 구역이 세이브마다 보여 주는 값(기록 보관은 main/records) */
export interface SaveRecords {
  /** 폴더 이름(8자리 해시). 지우기에 쓴다 */
  id: string
  /** 세이브 파일 이름(확장자 없이) */
  label: string
  teamId: number | null
  /** 이 기록을 처음 만든 날(실제 날짜, YYYY-MM-DD) */
  created: string
  /** 폴더 전체 크기 */
  bytes: number
  /** 성장 스냅샷 수 */
  snapshots: number
  /** 가장 최근 스냅샷의 게임 날짜(YYYY-MM-DD). 없으면 null */
  lastSnapshot: string | null
  /** 평점을 가져온 경기 수 */
  ratedMatches: number
}
