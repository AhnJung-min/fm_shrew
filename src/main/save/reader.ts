
/**
 * FM26 세이브(.fm) 읽기.
 *
 * 형식은 공개돼 있지 않아 2026-11 기준 26.3.2 세이브를 직접 분석해 알아낸 구조에 기댄다.
 * 게임 패치로 구조가 바뀌면 여기서 "알아보지 못했다"는 오류가 난다. 원본 파일은 읽기만 한다.
 *
 * 알아낸 구조(겉 구조와 목차는 container.ts, 구단과 전체 선수는 world.ts):
 * - 이름표 넷: [id u32][길이 u32][UTF-8]이 id 순서로 이어진다. (이름, 추가 이름, 성, 표시 이름)
 * - 선수 기록: [포지션 숙련도 15바이트(1~20)][능력치 54바이트(1~100)] ... [인물 정보]
 *   숙련도 바로 앞(거꾸로 센 위치): -8 소속 팀 번호 u32, -12 대표팀 번호 u32, -22 잠재 능력 u16, -24 현재 능력 u16,
 *   -30 평판 u16 셋, -35와 -39 선수 고유 번호 u32(같은 값이 두 번)
 * - 인물 정보: [이름 id][0][성 id][0][표시 이름 id][0][전체 이름 길이 u32][전체 이름][생일: 연중 일수 u16][연도 u16]
 */

export const POSITION_COUNT = 15
export const ATTRIBUTE_COUNT = 54
export const BLOCK_SIZE = POSITION_COUNT + ATTRIBUTE_COUNT

export { SAVE_ATTRIBUTE_ORDER } from '@shared/world'

export interface SavePlayer {
  /** 게임에 표시되는 이름(한국어 표기가 있으면 그것) */
  name: string
  teamId: number
  birthYear: number
  /** 생일의 연중 일수(1~366) */
  birthDay: number
  /** 포지션 숙련도 15개(1~20) */
  positions: number[]
  /** 능력치 54개(1~100, 5로 나누면 게임 표시값) */
  attributes: number[]
}

export class SaveFormatError extends Error {}

export type NameTable = Map<number, string>

/**
 * 이름표 넷(이름, 추가 이름, 성, 표시 이름)을 찾는다.
 * 같은 모양의 표가 다른 곳에도 있을 수 있어, 가장 큰 표(성)를 기준으로 앞의 둘과 뒤의 하나를 고른다.
 */
export function findNameTables(db: Buffer): NameTable[] {
  const all = findSequentialTables(db)
  let largest = -1
  all.forEach((entry, i) => {
    if (largest < 0 || entry.table.size > all[largest].table.size) largest = i
  })
  if (largest < 2 || largest + 1 >= all.length) return []
  const group = all.slice(largest - 2, largest + 2)
  // 네 표는 서로 바로 붙어 있어야 한다
  for (let i = 1; i < group.length; i++) {
    if (group[i].start - group[i - 1].end > 64) return []
  }
  return group.map((entry) => entry.table)
}

function findSequentialTables(db: Buffer): Array<{ start: number; end: number; table: NameTable }> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const tables: Array<{ start: number; end: number; table: NameTable }> = []
  const limit = db.length - 16
  const entryLength = (at: number): number => {
    const length = db.readUInt32LE(at + 4)
    return length >= 1 && length <= 80 ? length : -1
  }

  let p = 0
  while (p < limit) {
    // 싼 검사부터: 길이가 그럴듯하고, 다음 항목의 id가 정확히 1 크다
    const length = entryLength(p)
    if (length < 0 || p + 16 + length > limit || db.readUInt32LE(p + 8 + length) !== db.readUInt32LE(p) + 1) {
      p++
      continue
    }
    const table: NameTable = new Map()
    let cursor = p
    let expected = db.readUInt32LE(p)
    while (cursor < limit) {
      const len = entryLength(cursor)
      if (len < 0 || db.readUInt32LE(cursor) !== expected) break
      let text: string
      try {
        text = decoder.decode(db.subarray(cursor + 8, cursor + 8 + len))
      } catch {
        break
      }
      table.set(expected, text)
      expected++
      cursor += 8 + len
    }
    if (table.size >= 1000) {
      tables.push({ start: p, end: cursor, table })
      p = cursor
    } else {
      p++
    }
  }
  return tables
}

export interface Person {
  firstId: number
  secondId: number
  displayId: number
  birthDay: number
  birthYear: number
}

export function findPerson(db: Buffer, from: number, to: number): Person | null {
  for (let q = from; q < to - 30; q++) {
    if (db[q + 4] !== 0 || db[q + 9] !== 0 || db[q + 14] !== 0) continue
    const nameLength = db.readUInt32LE(q + 15)
    if (nameLength > 90) continue
    const dateAt = q + 19 + nameLength
    if (dateAt + 4 > db.length) return null
    const birthDay = db.readUInt16LE(dateAt)
    const birthYear = db.readUInt16LE(dateAt + 2)
    if (birthDay < 1 || birthDay > 366 || birthYear < 1940 || birthYear > 2015) continue
    const firstId = db.readUInt32LE(q)
    const secondId = db.readUInt32LE(q + 5)
    if (firstId === 0 && secondId === 0) continue
    return { firstId, secondId, displayId: db.readUInt32LE(q + 10), birthDay, birthYear }
  }
  return null
}

/** 선수 기록(숙련도 15개 + 능력치 54개)이 시작하는 위치들 */
export function findBlocks(db: Buffer): number[] {
  const blocks: number[] = []
  const limit = db.length - BLOCK_SIZE
  for (let i = 8; i < limit; i++) {
    const first = db[i]
    if (first < 1 || first > 20) continue
    const before = db[i - 1]
    if (before >= 1 && before <= 20) continue
    let ok = true
    for (let k = 1; k < POSITION_COUNT; k++) {
      const value = db[i + k]
      if (value < 1 || value > 20) {
        ok = false
        break
      }
    }
    if (!ok) continue
    for (let k = POSITION_COUNT; k < BLOCK_SIZE; k++) {
      const value = db[i + k]
      if (value < 1 || value > 100) {
        ok = false
        break
      }
    }
    if (!ok) continue
    blocks.push(i)
    i += BLOCK_SIZE - 1
  }
  return blocks
}

export interface GameDate {
  year: number
  /** 연중 일수(1~366) */
  day: number
}

/** 선수 기록 안에서 가장 자주 나오는 날짜를 게임의 현재 날짜로 본다(기록마다 "마지막 갱신일"이 찍혀 있다). */
export function guessGameDate(db: Buffer, ranges: Array<[number, number]>): GameDate | null {
  const counts = new Map<number, number>()
  for (const [from, to] of ranges) {
    for (let q = from; q < to - 4; q++) {
      const year = db.readUInt16LE(q + 2)
      if (year < 2024 || year > 2060) continue
      const day = db.readUInt16LE(q) & 0x1ff
      if (day < 1 || day > 366) continue
      const key = year * 1000 + day
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  let best = 0
  let bestCount = 0
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key
      bestCount = count
    }
  }
  return bestCount > 0 ? { year: Math.floor(best / 1000), day: best % 1000 } : null
}
