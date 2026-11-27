import { gunzipSync, gzipSync } from 'node:zlib'
import { POSITION_KEYS } from '@shared/positions'
import { calendar } from '../save/contracts'
import { ageAt, type SaveWorld } from '../save/world'

/**
 * 성장 스냅샷(F-09 기록): 세이브를 적용할 때 세이브 안 모든 선수의 나이·현재 능력·잠재 능력·위치군을 그날의 값으로 남긴다.
 * 4단계에서 두 스냅샷을 견줘 나이별 성장률을 잰다(readGrowth로 읽는다).
 *
 * 파일(gzip을 풀면): 머리 9바이트, 이어서 선수 수만큼의 열 다섯 개. 정수는 모두 little-endian.
 *   [0]   u8   형식 버전(GROWTH_VERSION)
 *   [1]   u16  게임 날짜의 연도
 *   [3]   u16  게임 날짜의 연중 일수(1~366)
 *   [5]   u32  선수 수 n
 *   [9]   u32 × n  선수 고유 번호. 앞 선수와의 차이(mod 2^32, 첫 선수는 번호 그대로)로 적는다. 세이브 안의 번호가 거의 오름차순이라 차이가 작아 압축이 훨씬 잘 된다
 *         u8  × n  나이(모르면 0)
 *         u8  × n  현재 능력(1~200)
 *         u8  × n  잠재 능력(1~200)
 *         u8  × n  위치군(GROWTH_GROUPS의 순번, 모르면 GROUP_UNKNOWN)
 * 열로 나눠 두면 gzip이 잘 줄인다.
 */
export const GROWTH_VERSION = 1
const HEADER_SIZE = 9

/** 위치군. 가장 숙련이 높은 자리로 정한다(positionGroupOf). 순번이 파일에 들어가므로 바꾸지 말고 뒤에만 더한다 */
export const GROWTH_GROUPS = ['골키퍼', '중앙 수비', '측면 수비', '수비형 미드', '중앙 미드', '공격형·측면', '공격수'] as const
export const GROUP_UNKNOWN = 255

/** 숙련도 15개(POSITION_KEYS 순서)의 자리 → 위치군 순번 */
const GROUP_OF_KEY: Record<(typeof POSITION_KEYS)[number], number> = {
  GK: 0,
  SW: 1,
  DC: 1,
  DL: 2,
  DR: 2,
  WBL: 2,
  WBR: 2,
  DM: 3,
  MC: 4,
  ML: 5,
  MR: 5,
  AML: 5,
  AMC: 5,
  AMR: 5,
  ST: 6
}
const GROUP_BY_INDEX = POSITION_KEYS.map((key) => GROUP_OF_KEY[key])

/** 자리 하나(POSITION_KEYS의 이름)가 속한 위치군 순번 */
export const groupOfKey = (key: (typeof POSITION_KEYS)[number]): number => GROUP_OF_KEY[key]

/** 숙련도 배열 ratings의 at부터 15개에서 가장 높은 자리의 위치군. 같으면 POSITION_KEYS에서 앞선 자리. 숙련이 모두 0이면 모름 */
export function positionGroupOf(ratings: ArrayLike<number>, at = 0): number {
  let best = 0
  let group = GROUP_UNKNOWN
  for (let i = 0; i < GROUP_BY_INDEX.length; i++) {
    const value = ratings[at + i]
    if (value > best) {
      best = value
      group = GROUP_BY_INDEX[i]
    }
  }
  return group
}

export interface GrowthSnapshot {
  year: number
  /** 연중 일수 */
  day: number
  /** 같은 순번의 값끼리 한 선수 */
  uids: Uint32Array
  /** 모르면 0 */
  ages: Uint8Array
  ca: Uint8Array
  pa: Uint8Array
  /** GROWTH_GROUPS의 순번. 모르면 GROUP_UNKNOWN */
  groups: Uint8Array
}

/** 스냅샷의 게임 날짜를 YYYY-MM-DD로 */
export function growthDate(snap: { year: number; day: number }): string {
  const { year, month, day } = calendar({ year: snap.year, day: snap.day })
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * 세이브를 읽은 직후(게임의 지금 값으로 덮어쓰기 전)에 동기로 떠 두는 입력.
 * 덮어쓰기가 바뀌는 것은 현재·잠재 능력과 숙련도뿐이라 이 셋만 복사한다(몇 MB, 1ms 안팎). 나머지는 세이브 객체를 그대로 본다.
 */
export interface GrowthInput {
  world: SaveWorld
  ca: Uint16Array
  pa: Uint16Array
  positions: Uint8Array
}

export function takeGrowthInput(world: SaveWorld): GrowthInput {
  return {
    world,
    ca: world.ca.slice(0, world.count),
    pa: world.pa.slice(0, world.count),
    positions: world.positions.slice(0, world.count * POSITION_KEYS.length)
  }
}

/** 입력에서 스냅샷을 만든다. 게임 날짜를 모르면 null. 번호가 없거나 겹치는 기록(어느 선수인지 가릴 수 없다)은 뺀다 */
export function buildGrowth(input: GrowthInput): GrowthSnapshot | null {
  const { world } = input
  const today = world.gameDate
  if (!today) return null
  const seen = new Set<number>()
  const repeated = new Set<number>()
  for (let k = 0; k < world.count; k++) {
    const uid = world.uids[k]
    if (uid === 0) continue
    if (seen.has(uid)) repeated.add(uid)
    else seen.add(uid)
  }
  const keep: number[] = []
  for (let k = 0; k < world.count; k++) {
    const uid = world.uids[k]
    if (uid !== 0 && !repeated.has(uid)) keep.push(k)
  }
  const n = keep.length
  const snap: GrowthSnapshot = {
    year: today.year,
    day: today.day,
    uids: new Uint32Array(n),
    ages: new Uint8Array(n),
    ca: new Uint8Array(n),
    pa: new Uint8Array(n),
    groups: new Uint8Array(n)
  }
  const width = POSITION_KEYS.length
  for (let i = 0; i < n; i++) {
    const k = keep[i]
    snap.uids[i] = world.uids[k]
    snap.ages[i] = Math.min(255, Math.max(0, ageAt(world, k) ?? 0))
    snap.ca[i] = Math.min(255, input.ca[k])
    snap.pa[i] = Math.min(255, input.pa[k])
    snap.groups[i] = positionGroupOf(input.positions, k * width)
  }
  return snap
}

/** 스냅샷을 파일 내용(압축 전)으로 */
export function encodeGrowthRaw(snap: GrowthSnapshot): Buffer {
  const n = snap.uids.length
  const raw = Buffer.alloc(HEADER_SIZE + n * 8)
  raw.writeUInt8(GROWTH_VERSION, 0)
  raw.writeUInt16LE(snap.year, 1)
  raw.writeUInt16LE(snap.day, 3)
  raw.writeUInt32LE(n, 5)
  let at = HEADER_SIZE
  for (let i = 0, prev = 0; i < n; prev = snap.uids[i], i++, at += 4) raw.writeUInt32LE((snap.uids[i] - prev) >>> 0, at)
  for (const column of [snap.ages, snap.ca, snap.pa, snap.groups]) {
    raw.set(column, at)
    at += n
  }
  return raw
}

/** 스냅샷을 압축한 파일 내용으로 */
export const encodeGrowth = (snap: GrowthSnapshot): Buffer => gzipSync(encodeGrowthRaw(snap))

/** 압축한 파일 내용을 스냅샷으로. 모르는 형식이면 오류 */
export function decodeGrowth(file: Buffer): GrowthSnapshot {
  const raw = gunzipSync(file)
  if (raw.length < HEADER_SIZE) throw new Error('성장 스냅샷이 너무 짧습니다.')
  const version = raw.readUInt8(0)
  if (version !== GROWTH_VERSION) throw new Error(`알 수 없는 성장 스냅샷 형식(${version})입니다.`)
  const n = raw.readUInt32LE(5)
  if (raw.length !== HEADER_SIZE + n * 8) throw new Error('성장 스냅샷의 크기가 맞지 않습니다.')
  const uids = new Uint32Array(n)
  let at = HEADER_SIZE
  for (let i = 0, prev = 0; i < n; i++, at += 4) uids[i] = prev = (prev + raw.readUInt32LE(at)) >>> 0
  const column = (): Uint8Array => {
    const out = Uint8Array.from(raw.subarray(at, at + n))
    at += n
    return out
  }
  return { year: raw.readUInt16LE(1), day: raw.readUInt16LE(3), uids, ages: column(), ca: column(), pa: column(), groups: column() }
}
