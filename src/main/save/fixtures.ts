import { readDate } from './contracts'
import type { GameDate } from './reader'

/**
 * 경기 일정과 결과 읽기.
 *
 * 구조는 공개 해독기 fmsave(Randal S. Olson, MIT. https://github.com/rhiever/fmsave)의 26.3.2 구조 설명을 따랐고,
 * 코드는 가져오지 않았다. fmsave는 선수 번호를 잘못 알아보는 일이 있다고 알려져 있어, 값마다 실제 세이브에서 확인했다
 * (내 팀의 리그 경기 38개 가운데 끝난 것의 점수가 같은 세이브의 순위표 기록과 20개 팀 모두 똑같았다).
 *
 * 세이브 꾸러미 안, 목차에 이름이 없는 구간(non_pl_hist_ls 파일 뒤부터 humans 파일 앞까지. season.ts가 풀어 준다)에 경기 일정이 있다. 경기 하나는 이렇게 이어 붙어 있다.
 *
 *   [결과 칸 u8: 0 또는 1] [결과 꾸러미: 결과 칸이 1일 때만] [핵심 67바이트]
 *
 * - 핵심 67바이트는 홈 팀 번호가 놓인 곳 H를 기준으로 H-12부터다.
 *     H-12 표지 0x1c, H-11 대회 단계 번호 u32, H 홈 팀 번호 u32, H+4 와 H+11이 0xff, H+7 원정 팀 번호 u32,
 *     H+13 [연중 일수 9비트 + 킥오프 시각 칸 7비트] u16, H+15 연도 u16, H+26 시즌 시작 연도 u16,
 *     H+37 경기 구분, H+38 라운드 번호(0부터, 255는 라운드 없음).
 * - 핵심 바로 뒤(H+55)가 다음 경기의 결과 칸이다. 0이면 다음 경기의 핵심이 곧바로 이어지고(H+68이 다음 H),
 *   1이면 결과 꾸러미가 먼저 온다: 29바이트 머리(0x1c로 시작, +5 홈 득점, +9 원정 득점, +6·+10은 연장 등을 거친
 *   득점이고 255면 없음, +25 사건 수 u32) 뒤에 사건이 16바이트씩 사건 수만큼. 그 뒤에 핵심이 온다.
 *   그러니 한 경기가 끝났는지와 점수는 그 경기의 "앞 경기" 뒤에 적혀 있다.
 * - 킥오프 시각은 (칸 + 23) × 15분이다. 칸 37이 15:00.
 * - 일정은 한 세이브에 여러 벌 들어 있고, 1MB 넘게 떨어진 덩어리로 나뉜다. 가장 기록이 많은 덩어리가 진짜 일정이다.
 */

const MARKER = 0x1c
const CORE_BEFORE = 12
const CORE_AFTER = 56
const MIN_TEAM = 1
const MAX_TEAM = 2_999_999
/** 이 거리 넘게 떨어지면 다른 덩어리 */
const CLUSTER_GAP = 1_048_576
const YEARS_BEFORE = 7
const YEARS_AFTER = 8
const PACKET_HEAD = 29
const EVENT_BYTES = 16
const MAX_EVENTS = 10_000
const MAX_GOALS = 40
const NO_ROUND = 255
const NO_GOALS = 0xff

export interface SaveFixture {
  homeId: number
  awayId: number
  date: GameDate
  /** 킥오프 시각 칸(시각은 kickOffTime) */
  slot: number
  /** 대회 단계 번호(대회마다, 시즌마다 다르다) */
  stageId: number
  /** 시즌 시작 연도. 모르면 0 */
  season: number
  /** 라운드(0부터). 없으면 null */
  round: number | null
  /** 끝난 경기인지. 앞 경기와의 이어짐이 끊겨 알 수 없으면 null */
  played: boolean | null
  homeGoals: number | null
  awayGoals: number | null
}

/** 킥오프 시각 칸을 "15:00"으로. 하루를 넘으면 null */
export function kickOffTime(slot: number): string | null {
  const minutes = (slot + 23) * 15
  if (minutes < 0 || minutes >= 24 * 60) return null
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** 핵심 67바이트가 놓인 곳(H)이 맞는지: 표지와 날짜 */
function coreAt(db: Buffer, h: number): boolean {
  return h >= CORE_BEFORE && h + CORE_AFTER <= db.length && db[h - CORE_BEFORE] === MARKER && readDate(db, h + 13) !== null
}

/** 경기 일정이 시작될 수 있는 자리들(핵심의 표지와 고정 바이트, 날짜의 연도 범위가 맞는 곳) */
function findAnchors(db: Buffer, today: GameDate): number[] {
  const anchors: number[] = []
  const low = today.year - YEARS_BEFORE
  const high = today.year + YEARS_AFTER
  let from = 0
  for (;;) {
    const marker = db.indexOf(MARKER, from)
    if (marker < 0) break
    from = marker + 1
    const h = marker + CORE_BEFORE
    if (h + CORE_AFTER > db.length) break
    if (db[h + 4] !== 0xff || db[h + 11] !== 0xff) continue
    const year = db.readUInt16LE(h + 15)
    if (year < low || year > high) continue
    const home = db.readUInt32LE(h)
    const away = db.readUInt32LE(h + 7)
    if (home < MIN_TEAM || home > MAX_TEAM || away < MIN_TEAM || away > MAX_TEAM) continue
    anchors.push(h)
  }
  return anchors
}

/** 기록이 가장 많은 덩어리 */
function largestCluster(anchors: number[]): number[] {
  let best: [number, number] = [0, 0]
  let start = 0
  for (let i = 1; i <= anchors.length; i++) {
    if (i === anchors.length || anchors[i] - anchors[i - 1] > CLUSTER_GAP) {
      if (i - start > best[1] - best[0]) best = [start, i]
      start = i
    }
  }
  return anchors.slice(best[0], best[1])
}

/**
 * 일정이 든 구간 전체에서 경기를 읽는다. only를 주면 그 팀들이 홈이나 원정인 경기만 돌려준다.
 * today는 게임 속 오늘(연도 범위를 정하는 데 쓴다).
 */
export function readFixtures(db: Buffer, today: GameDate, only?: ReadonlySet<number>): SaveFixture[] {
  const cluster = largestCluster(findAnchors(db, today))
  if (cluster.length === 0) return []
  const lastAnchor = cluster[cluster.length - 1]
  const low = today.year - YEARS_BEFORE
  const high = today.year + YEARS_AFTER

  const found = new Map<string, SaveFixture>()
  let next = 0
  let played: boolean | null = null
  let score: [number, number] | null = null
  let h = cluster[0]
  /** 이어짐이 끊겼으니 다음 자리표로 건너뛴다. 더 없으면 false */
  const skip = (): boolean => {
    while (next < cluster.length && cluster[next] <= h) next++
    if (next >= cluster.length) return false
    h = cluster[next]
    played = null
    score = null
    return true
  }

  while (h <= lastAnchor) {
    if (!coreAt(db, h)) {
      if (!skip()) break
      continue
    }
    const homeId = db.readUInt32LE(h)
    const awayId = db.readUInt32LE(h + 7)
    const date = readDate(db, h + 13)!
    if (
      date.year >= low &&
      date.year <= high &&
      homeId >= MIN_TEAM &&
      homeId <= MAX_TEAM &&
      awayId >= MIN_TEAM &&
      awayId <= MAX_TEAM &&
      (!only || only.has(homeId) || only.has(awayId))
    ) {
      const round = db[h + 38]
      const fixture: SaveFixture = {
        homeId,
        awayId,
        date,
        slot: db.readUInt16LE(h + 13) >> 9,
        stageId: db.readUInt32LE(h - 11),
        season: db.readUInt16LE(h + 26),
        round: round === NO_ROUND ? null : round,
        played,
        homeGoals: score ? score[0] : null,
        awayGoals: score ? score[1] : null
      }
      // 같은 경기가 두 번 나오면 끝난 쪽(점수가 있는 쪽)을 쓴다
      const key = `${homeId}:${awayId}:${db.readUInt16LE(h + 13)}:${date.year}`
      const before = found.get(key)
      if (!before || (before.played !== true && fixture.played === true)) found.set(key, fixture)
    }

    // 이 경기 뒤의 결과 칸: 다음 경기의 것이다
    const flag = db[h + 55]
    if (flag === 0) {
      played = false
      score = null
      h += 68
      continue
    }
    const packet = h + CORE_AFTER
    if (flag !== 1 || packet + PACKET_HEAD > db.length || db[packet] !== MARKER) {
      if (!skip()) break
      continue
    }
    const events = db.readUInt32LE(packet + 25)
    if (events > MAX_EVENTS) {
      if (!skip()) break
      continue
    }
    played = true
    score = null
    const basic: [number, number] = [db[packet + 5], db[packet + 9]]
    const extra: [number, number] = [db[packet + 6], db[packet + 10]]
    if (Math.max(...basic) <= MAX_GOALS) {
      if (extra[0] === NO_GOALS && extra[1] === NO_GOALS) score = basic
      else if (Math.max(...extra) <= MAX_GOALS && extra[0] >= basic[0] && extra[1] >= basic[1]) score = extra
    }
    h = packet + PACKET_HEAD + EVENT_BYTES * events + CORE_BEFORE
  }
  return [...found.values()]
}
