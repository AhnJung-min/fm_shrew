/** 날짜 하나(달·일은 1부터) */
export interface SeasonDate {
  year: number
  month: number
  day: number
}

/** 내 팀 입장에서 본 한 경기 */
export interface SeasonMatch {
  date: SeasonDate
  /** 킥오프 시각("15:00"). 모르면 null */
  time: string | null
  /** 상대 팀 번호와 이름. 이름을 모르면 빈 글자 */
  opponentId: number
  opponent: string
  /** 상대 구단의 엠블럼 번호. 구단을 알아내지 못했으면 null */
  clubUid: number | null
  /** 내 팀이 홈이면 true */
  home: boolean
  /** 리그 경기인지(그 밖은 컵이나 다른 대회, 친선 경기) */
  league: boolean
  /** 그 대회의 몇 번째 라운드인지(1부터). 라운드가 없으면 null */
  round: number | null
  /** 끝난 경기인지 */
  played: boolean
  /** 끝난 경기의 내 팀 득점·실점. 점수를 읽지 못했으면 null */
  goalsFor: number | null
  goalsAgainst: number | null
  result: 'win' | 'draw' | 'loss' | null
}

/** 순위표의 한 줄 */
export interface SeasonTableRow {
  position: number
  teamId: number
  /** 팀 이름. 모르면 빈 글자 */
  name: string
  /** 구단의 엠블럼 번호. 구단을 알아내지 못했으면 null */
  clubUid: number | null
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  points: number
  /** 내 팀이면 true */
  mine: boolean
}

export interface SeasonResult {
  ok: boolean
  /** ok가 아닐 때, 또는 일부만 읽었을 때 화면에 그대로 보여 줄 설명 */
  message?: string
  teamId?: number
  /** 게임 속 오늘 */
  today?: SeasonDate
  /** 최근에 끝난 경기, 가장 최근 것이 먼저(최대 5) */
  recent: SeasonMatch[]
  /** 앞으로 할 경기, 가장 가까운 것이 먼저(최대 5) */
  upcoming: SeasonMatch[]
  /** 내 팀이 속한 리그의 순위표. 읽지 못했으면 없다 */
  table?: SeasonTableRow[]
  /** 순위표를 못 읽었을 때 이유 */
  tableMessage?: string
}

export const NO_SEASON: SeasonResult = { ok: false, recent: [], upcoming: [] }
