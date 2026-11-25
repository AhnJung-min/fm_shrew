import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

/**
 * FM26 세이브(.fm) 읽기.
 *
 * 형식은 공개돼 있지 않아 2026-11 기준 26.3.2 세이브를 직접 분석해 알아낸 구조에 기댄다.
 * 게임 패치로 구조가 바뀌면 여기서 "알아보지 못했다"는 오류가 난다. 원본 파일은 읽기만 한다.
 *
 * 알아낸 구조:
 * - 파일은 zstd 프레임이 이어 붙은 것이고, 가장 큰 프레임이 데이터베이스다.
 * - 이름표 넷: [id u32][길이 u32][UTF-8]이 id 순서로 이어진다. (이름, 추가 이름, 성, 표시 이름)
 * - 선수 기록: [팀 id u32][0 u32][포지션 숙련도 15바이트(1~20)][능력치 54바이트(1~100)] ... [인물 정보]
 * - 인물 정보: [이름 id][0][성 id][0][표시 이름 id][0][전체 이름 길이 u32][전체 이름][생일: 연중 일수 u16][연도 u16]
 */

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const POSITION_COUNT = 15
const ATTRIBUTE_COUNT = 54
const BLOCK_SIZE = POSITION_COUNT + ATTRIBUTE_COUNT

/** 능력치 54개의 저장 순서 */
export const SAVE_ATTRIBUTE_ORDER = [
  'crossing', 'dribbling', 'finishing', 'heading', 'longShots', 'marking', 'offTheBall', 'passing', 'penalty',
  'tackling', 'vision', 'handling', 'aerialReach', 'commandOfArea', 'communication', 'kicking', 'throwing',
  'anticipation', 'decisions', 'oneOnOnes', 'positioning', 'reflexes', 'firstTouch', 'technique', 'leftFoot',
  'rightFoot', 'flair', 'corners', 'teamwork', 'workRate', 'longThrows', 'eccentricity', 'rushingOut', 'punching',
  'acceleration', 'freeKick', 'strength', 'stamina', 'pace', 'jumping', 'leadership', 'dirtiness', 'balance',
  'bravery', 'consistency', 'aggression', 'agility', 'importantMatches', 'injuryProneness', 'versatility',
  'naturalFitness', 'determination', 'composure', 'concentration'
] as const

export interface SavePlayer {
  /** 게임에 표시되는 이름(한국어 표기가 있으면 그것) */
  name: string
  englishName: string
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

/** 세이브 파일에서 가장 큰 zstd 프레임(데이터베이스)을 풀어 돌려준다. */
export function readDatabase(path: string): Buffer {
  const data = readFileSync(path)
  const offsets: number[] = []
  let at = 0
  while ((at = data.indexOf(ZSTD_MAGIC, at)) !== -1) {
    offsets.push(at)
    at += 4
  }
  if (offsets.length === 0) throw new SaveFormatError('세이브 파일에서 압축 데이터를 찾지 못했습니다.')
  offsets.push(data.length)

  // 조각 길이가 가장 긴 곳이 데이터베이스다. 데이터 안에 우연히 같은 표시가 있으면 조각이 잘리므로 뒤로 늘려 가며 시도한다.
  let start = 0
  for (let i = 1; i < offsets.length - 1; i++) {
    if (offsets[i + 1] - offsets[i] > offsets[start + 1] - offsets[start]) start = i
  }
  for (let endIndex = start + 1; endIndex < Math.min(offsets.length, start + 400); endIndex++) {
    try {
      return zstdDecompressSync(data.subarray(offsets[start], offsets[endIndex]), { maxOutputLength: 2 ** 31 - 1 })
    } catch {
      // 다음 경계까지 늘려 다시 시도
    }
  }
  throw new SaveFormatError('세이브 파일의 압축을 풀지 못했습니다.')
}

type NameTable = Map<number, string>

/**
 * 이름표 넷(이름, 추가 이름, 성, 표시 이름)을 찾는다.
 * 같은 모양의 표가 다른 곳에도 있을 수 있어, 가장 큰 표(성)를 기준으로 앞의 둘과 뒤의 하나를 고른다.
 */
function findNameTables(db: Buffer): NameTable[] {
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

interface Person {
  firstId: number
  secondId: number
  displayId: number
  birthDay: number
  birthYear: number
}

function findPerson(db: Buffer, from: number, to: number): Person | null {
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

function findBlocks(db: Buffer): number[] {
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
function guessGameDate(db: Buffer, ranges: Array<[number, number]>): GameDate | null {
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

/** 세이브 하나를 읽어 둔 것. 큰 버퍼는 필요한 값만 뽑은 뒤 버린다. */
export interface SaveIndex {
  /** 모든 선수의 표시 이름과 팀 id (팀을 찾을 때 쓴다) */
  names: string[]
  teamIds: Uint32Array
  /** 팀 id로 그 팀 선수를 자세히 읽는다 */
  playersOf(teamId: number): SavePlayer[]
  gameDateOf(teamId: number): GameDate | null
  playerCount: number
}

export function indexSave(path: string): SaveIndex {
  const db = readDatabase(path)
  const tables = findNameTables(db)
  if (tables.length < 4) {
    throw new SaveFormatError('세이브 파일에서 이름표를 찾지 못했습니다. 게임이 업데이트되어 형식이 바뀌었을 수 있습니다.')
  }
  const [firstNames, extraFirstNames, secondNames, displayNames] = tables
  const blocks = findBlocks(db)
  if (blocks.length < 1000) {
    throw new SaveFormatError('세이브 파일에서 선수 기록을 찾지 못했습니다. 게임이 업데이트되어 형식이 바뀌었을 수 있습니다.')
  }

  const recordEnd = (k: number): number => Math.min(blocks[k + 1] ?? db.length, blocks[k] + 60_000)
  const people: Array<Person | null> = blocks.map((block, k) => findPerson(db, block + BLOCK_SIZE, recordEnd(k)))
  const englishName = (person: Person): string => {
    const first = firstNames.get(person.firstId) ?? extraFirstNames.get(person.firstId) ?? ''
    const second = secondNames.get(person.secondId) ?? ''
    return `${first} ${second}`.trim()
  }
  const nameOf = (person: Person | null): string =>
    person ? (displayNames.get(person.displayId) ?? englishName(person)) : ''

  const teamIds = new Uint32Array(blocks.length)
  blocks.forEach((block, k) => (teamIds[k] = db.readUInt32LE(block - 8)))
  const names = people.map(nameOf)

  const indexesOf = (teamId: number): number[] => {
    const found: number[] = []
    for (let k = 0; k < blocks.length; k++) if (teamIds[k] === teamId && people[k]) found.push(k)
    return found
  }

  return {
    names,
    teamIds,
    playerCount: blocks.length,
    playersOf(teamId) {
      return indexesOf(teamId).map((k) => {
        const person = people[k]!
        const block = blocks[k]
        return {
          name: names[k],
          englishName: englishName(person),
          teamId,
          birthYear: person.birthYear,
          birthDay: person.birthDay,
          positions: [...db.subarray(block, block + POSITION_COUNT)],
          attributes: [...db.subarray(block + POSITION_COUNT, block + BLOCK_SIZE)]
        }
      })
    },
    gameDateOf(teamId) {
      return guessGameDate(db, indexesOf(teamId).map((k) => [blocks[k], recordEnd(k)] as [number, number]))
    }
  }
}

/** 이름 목록과 가장 많이 겹치는 팀을 찾는다. 겹치는 선수가 너무 적으면 null. */
export function findTeamByNames(index: SaveIndex, rosterNames: string[]): number | null {
  const wanted = new Set(rosterNames)
  const hits = new Map<number, number>()
  index.names.forEach((name, k) => {
    if (!wanted.has(name)) return
    const team = index.teamIds[k]
    if (team === 0xffffffff) return
    hits.set(team, (hits.get(team) ?? 0) + 1)
  })
  let best: number | null = null
  let bestCount = 0
  for (const [team, count] of hits) {
    if (count > bestCount) {
      best = team
      bestCount = count
    }
  }
  return bestCount >= Math.max(5, Math.ceil(rosterNames.length * 0.5)) ? best : null
}
