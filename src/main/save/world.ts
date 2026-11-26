import { readFileSync } from 'node:fs'
import { extractDatabase, openContainer } from './container'
import {
  ATTRIBUTE_COUNT,
  BLOCK_SIZE,
  POSITION_COUNT,
  SaveFormatError,
  findBlocks,
  findNameTables,
  findPerson,
  guessGameDate,
  type GameDate,
  type Person,
  type SavePlayer
} from './reader'

/**
 * 세이브에 든 모든 선수와 구단.
 *
 * 구단 기록(26.3.2 세이브를 분석해 알아낸 것):
 *   [순번 u32][고유 번호 u32][고유 번호 u32][00] [칸 넷: 나라 번호 셋과 ffffffff 하나][도시 번호 u32][6바이트]
 *   [길이 u32][이름][길이 u32][짧은 이름] … [u32][00 00 00][팀 수 u8][팀 번호 u32 …] …
 * - 팀 목록의 첫 번호가 구단의 대표 팀(1군)이고 나머지는 2군·유스 팀이다. 선수 기록의 "소속 팀 번호"가 이 번호들이다.
 * - 팀 목록이 기록 안 어디에 있는지는 구단마다 다르다. 대신 대표 팀 번호가 (순번 + 차이)이고 그 차이가
 *   같은 나라의 구단끼리 같다는 점을 쓴다: "000000, 수, 번호" 모양인 곳을 모두 후보로 모은 뒤,
 *   이웃한 구단들에 똑같이 나오는 차이를 고른다.
 * - 고유 번호가 20억 이상인 구단은 여자 팀이다.
 */

export const NO_TEAM = 0xffffffff
/** 몸값 자리에 이 값이 적혀 있으면 몸값이 정해지지 않은 것이다 */
const VALUE_PLACEHOLDER = 300_000_000
const WOMEN_CLUB_UID = 2_000_000_000

export interface ClubInfo {
  name: string
  short: string
  women: boolean
}

export interface SaveWorld {
  count: number
  /** 게임에 표시되는 이름. 인물 정보를 찾지 못한 기록은 빈 글자 */
  names: string[]
  uids: Uint32Array
  teamIds: Uint32Array
  /** clubs의 순번. 구단을 알아내지 못했으면 -1 */
  club: Int32Array
  clubs: ClubInfo[]
  /** 현재 능력, 잠재 능력(1~200) */
  ca: Uint16Array
  pa: Uint16Array
  /**
   * 세이브에 적힌 기준 몸값(게임의 기준 통화인 파운드). 모르면 0.
   * 능력치 블록 바로 뒤의 u32다. 켜져 있는 게임이 알려 주는 기준 몸값과 같은 수다(공개 해독기 fmsave의 구조 설명에서 알게 됨).
   */
  value: Uint32Array
  /** 생일을 모르면 0 */
  birthYear: Uint16Array
  birthDay: Uint16Array
  /** 선수마다 숙련도 15개(1~20), 능력치 54개(1~100)가 이어져 있다 */
  positions: Uint8Array
  attributes: Uint8Array
  /** 내 팀 번호. 찾지 못했으면 없다 */
  teamId?: number
  /** 게임의 오늘. 내 팀을 찾았을 때만 안다 */
  gameDate: GameDate | null
}

interface ClubRecord extends ClubInfo {
  at: number
  /** 이름들이 끝난 곳 */
  bodyAt: number
  x: number
}

/** 팀 목록 하나에 들 수 있는 팀 수 */
const MAX_TEAMS = 12
/** 차이를 정할 때 뒤따르는 구단 몇 곳과 맞춰 보는지, 그중 몇 곳이 맞아야 하는지 */
const LOOK_AHEAD = 4
const AGREE = 2

const decoder = new TextDecoder('utf-8', { fatal: true })

function textAt(db: Buffer, at: number, length: number): string | null {
  try {
    return decoder.decode(db.subarray(at, at + length))
  } catch {
    return null
  }
}

/** 선수 기록이 시작하기 전까지의 구간에서 구단 기록을 찾는다. */
function findClubs(db: Buffer, limit: number): ClubRecord[] {
  const clubs: ClubRecord[] = []
  const end = Math.min(limit, db.length) - 64
  for (let r = 0; r < end; r++) {
    if (db[r + 12] !== 0) continue
    const uid = db.readUInt32LE(r + 4)
    if (uid === 0 || uid !== db.readUInt32LE(r + 8)) continue
    const x = db.readUInt32LE(r)
    if (x > 200_000) continue
    // 나라 번호 칸 넷: 하나 이상은 비어 있고(ffffffff) 나머지는 작은 번호다
    let empty = 0
    let small = 0
    for (let f = r + 13; f < r + 29; f += 4) {
      const value = db.readUInt32LE(f)
      if (value === NO_TEAM) empty++
      else if (value < 5000) small++
    }
    if (empty === 0 || small === 0 || empty + small !== 4) continue
    const nameLength = db.readUInt32LE(r + 39)
    if (nameLength < 1 || nameLength > 120 || r + 47 + nameLength > end) continue
    const shortLength = db.readUInt32LE(r + 43 + nameLength)
    if (shortLength < 1 || shortLength > 120) continue
    const name = textAt(db, r + 43, nameLength)
    const short = name === null ? null : textAt(db, r + 47 + nameLength, shortLength)
    if (name === null || short === null) continue

    const bodyAt = r + 47 + nameLength + shortLength
    clubs.push({ at: r, bodyAt, x, name, short, women: uid >= WOMEN_CLUB_UID })
    r = bodyAt
  }
  return clubs
}

/** 팀 번호 → 구단 순번 */
function mapTeams(db: Buffer, clubs: ClubRecord[], limit: number): Map<number, number> {
  // 구단마다: "00 00 00, 팀 수(1~12), 번호"가 놓인 곳들. (번호 - 순번) → 그 번호가 적힌 위치
  const candidates: Array<Map<number, number>> = clubs.map((club, i) => {
    const found = new Map<number, number>()
    const end = Math.min(clubs[i + 1]?.at ?? limit, club.bodyAt + 200_000, db.length - 4)
    for (let p = club.bodyAt + 4; p < end; p++) {
      const count = db[p - 1]
      if (count < 1 || count > MAX_TEAMS || db[p - 2] !== 0 || db[p - 3] !== 0 || db[p - 4] !== 0) continue
      const delta = db.readUInt32LE(p) - club.x
      if (delta >= 0 && delta < 100_000 && !found.has(delta)) found.set(delta, p)
    }
    return found
  })

  const teamClub = new Map<number, number>()
  let current: number | null = null
  for (let i = 0; i < clubs.length; i++) {
    const mine = candidates[i]
    if (current === null || !mine.has(current)) {
      // 차이가 바뀌는 곳(나라가 바뀜): 뒤따르는 구단들에도 나오는 차이를 고른다
      let best: number | null = null
      let bestVotes = 0
      for (const delta of mine.keys()) {
        let votes = 0
        for (let j = i + 1; j <= i + LOOK_AHEAD && j < clubs.length; j++) if (candidates[j].has(delta)) votes++
        if (votes > bestVotes) {
          best = delta
          bestVotes = votes
        }
      }
      if (best === null || bestVotes < AGREE) continue
      current = best
    }
    const at = mine.get(current)!
    const count = db[at - 1]
    for (let k = 0; k < count; k++) {
      const team = db.readUInt32LE(at + k * 4)
      // 대표 팀(첫 번호)은 덮어쓰고, 2군·유스 번호는 먼저 정해진 것이 없을 때만 적는다
      if (k === 0 || !teamClub.has(team)) teamClub.set(team, i)
    }
  }
  return teamClub
}

/** 사람의 색인이 가질 수 있는 가장 큰 값(세이브 하나에 사람은 수십만 명이다) */
const MAX_PERSON_INDEX = 0x000f_ffff
/** 꼬리표 뒤에 오는 "다음 기록의 종류" 값의 범위 */
const MAX_RECORD_KIND = 0x10

/**
 * 선수의 고유 번호(게임이 쓰는 번호. 켜져 있는 게임에서 이 선수를 찾을 때 쓴다). 찾지 못하면 0.
 *
 * 사람마다 기록의 끝에 꼬리표 [색인 u32][고유 번호 u32][같은 번호 u32]가 붙고, 바로 뒤에 다음 기록의 종류(1바이트)가 온다.
 * 그래서 능력치 블록 "앞"에 적힌 번호는 이 선수가 아니라 앞 사람의 것이다. 이 선수의 꼬리표는 블록 "뒤"에 있다.
 * 색인은 사람마다 1씩 늘어나므로, 블록 뒤에서 색인이 (앞 사람의 색인 + 1)인 꼬리표를 찾는다.
 * 켜져 있는 게임의 메모리와 대조했을 때 선수 99,873명 모두 이 규칙으로 맞았다(26.3.2).
 * 앞 사람의 꼬리표를 읽지 못한 기록은 블록 뒤에서 처음 나오는 꼬리표를 쓴다.
 */
export function ownerUid(db: Buffer, block: number, end: number): number {
  const before = db.readUInt32LE(block - 39)
  const wanted = before !== 0 && before === db.readUInt32LE(block - 35) ? db.readUInt32LE(block - 43) + 1 : -1
  const last = Math.min(end, db.length) - 13
  let first = 0
  for (let at = block + BLOCK_SIZE; at <= last; at++) {
    const uid = db.readUInt32LE(at + 4)
    if (uid === 0 || uid === 0xffffffff || uid !== db.readUInt32LE(at + 8)) continue
    const index = db.readUInt32LE(at)
    if (index === 0 || index > MAX_PERSON_INDEX || index === uid) continue
    // 꼬리표 앞에는 작은 수(u32), 뒤에는 기록의 종류가 온다. 날짜가 두 번 잇달아 적힌 곳 같은 것을 걸러 낸다
    if (db.readUInt32LE(at - 4) > 0xff) continue
    const kind = db[at + 12]
    if (kind === 0 || kind > MAX_RECORD_KIND) continue
    if (index === wanted) return uid
    if (first === 0) first = uid
    if (wanted < 0) break
  }
  return first
}

/**
 * 풀어 놓은 데이터베이스에서 모든 선수와 구단을 뽑는다.
 * pickTeam은 뽑아 놓은 선수들을 보고 내 팀 번호를 정해 준다(모르면 undefined).
 */
export function buildWorld(db: Buffer, pickTeam?: (world: SaveWorld) => number | undefined): SaveWorld {
  const tables = findNameTables(db)
  if (tables.length < 4) {
    throw new SaveFormatError('세이브 파일에서 이름표를 찾지 못했습니다. 게임이 업데이트되어 형식이 바뀌었을 수 있습니다.')
  }
  const [firstNames, extraFirstNames, secondNames, displayNames] = tables
  const blocks = findBlocks(db)
  if (blocks.length < 1000) {
    throw new SaveFormatError('세이브 파일에서 선수 기록을 찾지 못했습니다. 게임이 업데이트되어 형식이 바뀌었을 수 있습니다.')
  }
  const count = blocks.length
  const recordEnd = (k: number): number => Math.min(blocks[k + 1] ?? db.length, blocks[k] + 60_000)
  const nameOf = (person: Person): string => {
    const shown = displayNames.get(person.displayId)
    if (shown) return shown
    const first = firstNames.get(person.firstId) ?? extraFirstNames.get(person.firstId) ?? ''
    return `${first} ${secondNames.get(person.secondId) ?? ''}`.trim()
  }

  const clubs = findClubs(db, blocks[0])
  const teamClub = mapTeams(db, clubs, blocks[0])

  const world: SaveWorld = {
    count,
    names: new Array<string>(count),
    uids: new Uint32Array(count),
    teamIds: new Uint32Array(count),
    club: new Int32Array(count),
    clubs: clubs.map(({ name, short, women }) => ({ name, short, women })),
    ca: new Uint16Array(count),
    pa: new Uint16Array(count),
    value: new Uint32Array(count),
    birthYear: new Uint16Array(count),
    birthDay: new Uint16Array(count),
    positions: new Uint8Array(count * POSITION_COUNT),
    attributes: new Uint8Array(count * ATTRIBUTE_COUNT),
    gameDate: null
  }
  for (let k = 0; k < count; k++) {
    const block = blocks[k]
    const person = findPerson(db, block + BLOCK_SIZE, recordEnd(k))
    world.names[k] = person ? nameOf(person) : ''
    world.birthYear[k] = person?.birthYear ?? 0
    world.birthDay[k] = person?.birthDay ?? 0
    world.teamIds[k] = db.readUInt32LE(block - 8)
    world.club[k] = teamClub.get(world.teamIds[k]) ?? -1
    world.ca[k] = db.readUInt16LE(block - 24)
    world.pa[k] = db.readUInt16LE(block - 22)
    world.uids[k] = ownerUid(db, block, recordEnd(k))
    const value = block + BLOCK_SIZE + 4 <= db.length ? db.readUInt32LE(block + BLOCK_SIZE) : 0
    world.value[k] = value === VALUE_PLACEHOLDER ? 0 : value
    world.positions.set(db.subarray(block, block + POSITION_COUNT), k * POSITION_COUNT)
    world.attributes.set(db.subarray(block + POSITION_COUNT, block + BLOCK_SIZE), k * ATTRIBUTE_COUNT)
  }

  // 기록마다 "마지막 갱신일"이 찍혀 있다. 매일 갱신되는 내 팀 선수들의 기록에서 가장 흔한 날짜가 게임의 오늘이다.
  // (다른 팀 선수의 기록은 오래전에 갱신된 채로 남아 있어 쓸 수 없다)
  world.teamId = pickTeam?.(world)
  if (world.teamId !== undefined) {
    const mine: Array<[number, number]> = []
    for (let k = 0; k < count; k++) if (world.teamIds[k] === world.teamId) mine.push([blocks[k], recordEnd(k)])
    world.gameDate = guessGameDate(db, mine)
  }
  return world
}

/** 세이브 파일을 읽어 모든 선수와 구단을 뽑는다. 파일은 읽기만 한다. */
export function readWorld(path: string, pickTeam?: (world: SaveWorld) => number | undefined): SaveWorld {
  return buildWorld(extractDatabase(openContainer(readFileSync(path))), pickTeam)
}

/** 그 팀에 이름을 아는 선수가 있는지 */
export function teamHasPlayers(world: SaveWorld, teamId: number): boolean {
  for (let k = 0; k < world.count; k++) if (world.teamIds[k] === teamId && world.names[k]) return true
  return false
}

/** 한 팀의 선수들 */
export function playersOfTeam(world: SaveWorld, teamId: number): SavePlayer[] {
  const players: SavePlayer[] = []
  for (let k = 0; k < world.count; k++) {
    if (world.teamIds[k] !== teamId || !world.names[k]) continue
    players.push({
      name: world.names[k],
      teamId,
      birthYear: world.birthYear[k],
      birthDay: world.birthDay[k],
      positions: [...world.positions.subarray(k * POSITION_COUNT, (k + 1) * POSITION_COUNT)],
      attributes: [...world.attributes.subarray(k * ATTRIBUTE_COUNT, (k + 1) * ATTRIBUTE_COUNT)]
    })
  }
  return players
}

/** 이름 목록과 가장 많이 겹치는 팀을 찾는다. 겹치는 선수가 너무 적으면 null. */
export function findTeamByNames(world: SaveWorld, rosterNames: string[]): number | null {
  const wanted = new Set(rosterNames)
  const hits = new Map<number, number>()
  world.names.forEach((name, k) => {
    if (!name || !wanted.has(name)) return
    const team = world.teamIds[k]
    if (team === NO_TEAM) return
    hits.set(team, (hits.get(team) ?? 0) + 1)
  })
  let best: number | null = null
  let bestCount = 0
  for (const [team, hit] of hits) {
    if (hit > bestCount) {
      best = team
      bestCount = hit
    }
  }
  return bestCount >= Math.max(5, Math.ceil(rosterNames.length * 0.5)) ? best : null
}

/** 선수의 나이. 생일이나 오늘 날짜를 모르면 null */
export function ageAt(world: SaveWorld, k: number): number | null {
  const today = world.gameDate
  const year = world.birthYear[k]
  if (!today || year === 0) return null
  return today.year - year - (today.day < world.birthDay[k] ? 1 : 0)
}
