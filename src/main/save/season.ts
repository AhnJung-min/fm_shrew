import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { zstdDecompress } from 'node:zlib'
import { openContainer, type SaveContainer } from './container'
import { readFixtures, type SaveFixture } from './fixtures'
import { findLeagueTable, type LeagueTable } from './leagueTable'
import { SaveFormatError, type GameDate } from './reader'

/**
 * 한 시즌의 경기 일정과 결과, 리그 순위표를 세이브에서 읽는다.
 *
 * 둘 다 세이브 꾸러미에서 목차에 이름이 없는 구간에 들어 있다(공개 해독기 fmsave가 "unlisted_after_non_pl_hist_ls"라 부르는 곳).
 * non_pl_hist_ls 파일이 끝난 곳에서 다음 파일이 시작하는 곳까지, 압축 조각(zstd 프레임)이 이어져 있고
 * 풀면 70MB 안팎이다. 선수·구단이 든 game_db보다 훨씬 작아 따로 풀어 읽는다.
 */

const PREVIOUS_FILE = 'non_pl_hist_ls'
const HEAD_SIZE = 26
const MAX_FRAMES = 200_000
const ZSTD_MAGIC = 0xfd2fb528
const SKIPPABLE_FIRST = 0x184d2a50
const SKIPPABLE_LAST = 0x184d2a5f
const MAX_BLOCK = 128 * 1024
/** 한꺼번에 풀어 달라고 맡기는 조각 수 */
const BATCH = 24

const decompress = promisify(zstdDecompress)

/** 압축 조각 하나가 끝나는 곳. 머리와 블록 머리만 보고 센다. 이상하면 -1 */
function frameEnd(data: Buffer, start: number, limit: number): number {
  if (start + 6 > limit) return -1
  const descriptor = data[start + 4]
  if (descriptor & 0x08) return -1
  const single = (descriptor & 0x20) !== 0
  let at = start + 5 + (single ? 0 : 1) + [0, 1, 2, 4][descriptor & 3] + [single ? 1 : 0, 2, 4, 8][descriptor >> 6]
  for (;;) {
    if (at + 3 > limit) return -1
    const header = data[at] | (data[at + 1] << 8) | (data[at + 2] << 16)
    const type = (header >> 1) & 3
    const size = header >> 3
    if (type === 3 || size > MAX_BLOCK) return -1
    at += 3 + (type === 1 ? 1 : size)
    if (header & 1) break
  }
  if (descriptor & 0x04) at += 4
  return at <= limit ? at : -1
}

/** 이름 없는 구간의 압축 조각들이 놓인 곳. 구간이 없으면 빈 목록 */
export function spanFrames(container: SaveContainer): Array<[number, number]> {
  const previous = container.entries.find((entry) => entry.name === PREVIOUS_FILE)
  if (!previous) return []
  const start = HEAD_SIZE + previous.offset + previous.compressedSize
  let end = container.tocHead
  for (const entry of container.entries) {
    const at = HEAD_SIZE + entry.offset
    if (at >= start && at < end) end = at
  }
  const frames: Array<[number, number]> = []
  let at = start
  while (at < end) {
    if (frames.length >= MAX_FRAMES || at + 4 > end) throw new SaveFormatError('세이브의 경기 기록 구간이 예상과 다릅니다.')
    const magic = container.data.readUInt32LE(at)
    if (magic >= SKIPPABLE_FIRST && magic <= SKIPPABLE_LAST) {
      if (at + 8 > end) throw new SaveFormatError('세이브의 경기 기록 구간이 예상과 다릅니다.')
      at += 8 + container.data.readUInt32LE(at + 4)
      continue
    }
    const next = magic === ZSTD_MAGIC ? frameEnd(container.data, at, end) : -1
    if (next < 0) throw new SaveFormatError('세이브의 경기 기록 구간이 예상과 다릅니다.')
    frames.push([at, next])
    at = next
  }
  return frames
}

/** 이름 없는 구간을 풀어 한 덩어리로. 압축 해제는 다른 스레드에 맡겨 앱이 멈추지 않게 한다. 구간이 없으면 null */
export async function readSpan(container: SaveContainer): Promise<Buffer | null> {
  const frames = spanFrames(container)
  if (frames.length === 0) return null
  const parts: Buffer[] = []
  try {
    for (let from = 0; from < frames.length; from += BATCH) {
      const batch = frames.slice(from, from + BATCH).map(([start, end]) => decompress(container.data.subarray(start, end)))
      parts.push(...(await Promise.all(batch)))
    }
  } catch {
    throw new SaveFormatError('세이브의 경기 기록을 풀지 못했습니다.')
  }
  return Buffer.concat(parts)
}

export interface SaveSeason {
  /** 그 팀의 경기(끝난 것과 앞으로 할 것 모두), 날짜 순서 */
  fixtures: SaveFixture[]
  /** 그 팀이 속한 리그의 순위표. 찾지 못했으면 null */
  table: LeagueTable | null
}

const byDate = (a: SaveFixture, b: SaveFixture): number =>
  a.date.year - b.date.year || a.date.day - b.date.day || a.slot - b.slot

/** 풀어 놓은 구간에서 그 팀의 경기와 리그 순위표를 뽑는다. */
export function decodeSeason(span: Buffer, teamId: number, today: GameDate): SaveSeason {
  return {
    fixtures: readFixtures(span, today, new Set([teamId])).sort(byDate),
    table: findLeagueTable(span, teamId)
  }
}

/** 세이브 파일을 읽어 그 팀의 경기와 리그 순위표를 뽑는다. 파일은 읽기만 한다. */
export async function readSeason(path: string, teamId: number, today: GameDate): Promise<SaveSeason | null> {
  const container = openContainer(await readFile(path))
  const span = await readSpan(container)
  return span ? decodeSeason(span, teamId, today) : null
}
