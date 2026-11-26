import type { GameDate } from './reader'

/**
 * 선수 기록 안의 계약 읽기: 주급, 계약 기간, 계약상 입지.
 *
 * 구조는 공개 해독기 fmsave(Randal S. Olson, MIT. https://github.com/rhiever/fmsave)의 26.3.2 구조 설명을 따랐고,
 * 코드는 가져오지 않았다. 반 다이크의 주급 350,000과 만료일 2027-06-30이 켜져 있는 게임이 알려 준 값과 같은 것을 확인했다.
 *
 * - 계약 기록 하나는 표지 `01 00 6c 07`(없는 날짜인 "1900년 1일")이 있는 곳 M을 기준으로 읽는다.
 *   M+5의 u32가 그 선수의 사람 색인이어야 한다(같은 표지가 다른 뜻으로도 많이 나온다).
 *   M-19 시작일, M+9 계약한 팀 번호 u32, M+17 주급 u32(게임의 기준 통화인 파운드).
 * - 조건(만료일, 입지)은 그 앞의 "꼬리" E에 있다. E = M - 66 - 29 × n (n은 0부터).
 *   E+3이 3이고 E+4의 u32가 4이며 E+42가 n인 곳이 꼬리다. E+28 만료일, E+36 입지.
 * - 선수 한 명에 기록이 여럿일 수 있다(재계약이 다음 달부터 효력이 생기는 경우 등). 지금 효력이 있는 것은
 *   오늘까지 시작한 것 가운데 가장 늦게 시작한 것이다.
 * - 날짜는 [연중 일수 u16(아래 9비트)][연도 u16].
 */

const TAG = Buffer.from([0x01, 0x00, 0x6c, 0x07])
const SELECTOR_AT = 5
const START_AT = -19
const TEAM_AT = 9
const WAGE_AT = 17
const TAIL_BASE = 66
const TAIL_STEP = 29
const TAIL_MAX_STEPS = 200
const TAIL_END_AT = 28
const TAIL_STATUS_AT = 36
const TAIL_COUNT_AT = 42

export interface SaveContract {
  teamId: number
  /** 주급(파운드) */
  wage: number
  start: GameDate | null
  /** 만료일. 조건을 읽지 못했으면 null */
  end: GameDate | null
  /** 계약상 입지(게임의 값 그대로). 조건을 읽지 못했으면 0 */
  status: number
}

/** 4바이트 날짜. 없는 날짜(1900년)나 날짜가 아닌 값이면 null */
export function readDate(db: Buffer, at: number): GameDate | null {
  if (at < 0 || at + 4 > db.length) return null
  const day = db.readUInt16LE(at) & 0x1ff
  const year = db.readUInt16LE(at + 2)
  if (year < 1950 || year > 2200 || day < 1 || day > 366) return null
  return { year, day }
}

/** 견줄 수 있는 수로: 연도 × 1000 + 연중 일수 */
export const dateKey = (date: GameDate): number => date.year * 1000 + date.day

/** 연중 일수를 월·일로 */
export function calendar(date: GameDate): { year: number; month: number; day: number } {
  const at = new Date(Date.UTC(date.year, 0, date.day))
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() }
}

function findTail(db: Buffer, tag: number): number {
  for (let steps = 0; steps <= TAIL_MAX_STEPS; steps++) {
    const tail = tag - TAIL_BASE - TAIL_STEP * steps
    if (tail < 0) return -1
    if (db[tail + 3] === 3 && db.readUInt32LE(tail + 4) === 4 && db[tail + TAIL_COUNT_AT] === steps) return tail
  }
  return -1
}

/** [from, to) 안에서 사람 색인이 ownerIndex인 선수의 계약 기록들. 파일에 적힌 순서(오래된 것부터) */
export function findContracts(db: Buffer, from: number, to: number, ownerIndex: number): SaveContract[] {
  const found: SaveContract[] = []
  const limit = Math.min(to, db.length) - (WAGE_AT + 4)
  let at = Math.max(from, -START_AT)
  while (at < limit) {
    const tag = db.indexOf(TAG, at)
    if (tag < 0 || tag >= limit) break
    at = tag + 1
    if (db.readUInt32LE(tag + SELECTOR_AT) !== ownerIndex) continue
    const tail = findTail(db, tag)
    found.push({
      teamId: db.readUInt32LE(tag + TEAM_AT),
      wage: db.readUInt32LE(tag + WAGE_AT),
      start: readDate(db, tag + START_AT),
      end: tail < 0 ? null : readDate(db, tail + TAIL_END_AT),
      status: tail < 0 ? 0 : db[tail + TAIL_STATUS_AT]
    })
  }
  return found
}

/**
 * 임대 중인 선수의 원 소속 팀. 임대가 아니면 null.
 *
 * 임대 선수의 계약 기록은 둘이다(세이브에서 확인): 원 소속과 맺은 계약(만료일이 있다)과,
 * 임대받은 팀과 맺은 기록(만료일 칸이 없고 입지가 0). 후자의 팀이 선수의 현재 소속 팀과 같으면 임대로 본다.
 * 지금 효력이 있는 계약은 둘 중 늦게 시작한 쪽이라(원 소속이 재계약하면 원 소속 쪽) 임대 여부를 가리는 데 쓸 수 없다.
 * 오늘까지 시작한 기록만 본다(앞으로 효력이 생길 이적 합의는 임대가 아니다).
 */
export function loanLender(records: SaveContract[], today: GameDate | null, currentTeam: number): number | null {
  const started = today ? records.filter((record) => !record.start || dateKey(record.start) <= dateKey(today)) : records
  if (!started.some((record) => record.end === null && record.teamId === currentTeam)) return null
  const startOf = (record: SaveContract): number => (record.start ? dateKey(record.start) : 0)
  let parent: SaveContract | null = null
  for (const record of started) {
    if (record.end !== null && record.teamId !== currentTeam && (!parent || startOf(record) >= startOf(parent))) parent = record
  }
  return parent ? parent.teamId : null
}

/**
 * 지금 효력이 있는 계약: 오늘까지 시작한 것 가운데 가장 늦게 시작한 것.
 * 오늘을 모르거나 아직 시작한 것이 없으면 가장 먼저 시작하는 것.
 */
export function contractInEffect(records: SaveContract[], today: GameDate | null): SaveContract | null {
  if (records.length === 0) return null
  const startOf = (record: SaveContract): number => (record.start ? dateKey(record.start) : 0)
  let earliest = records[0]
  let current: SaveContract | null = null
  for (const record of records) {
    if (startOf(record) < startOf(earliest)) earliest = record
    if (today && startOf(record) <= dateKey(today) && (!current || startOf(record) >= startOf(current))) current = record
  }
  return current ?? earliest
}
