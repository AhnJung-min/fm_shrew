import { zstdDecompressSync } from 'node:zlib'
import { SaveFormatError } from './reader'

/**
 * FM26 세이브(.fm)의 겉 구조. 26.3.2 세이브를 직접 분석해 알아낸 것이다.
 *
 * 세이브는 여러 파일을 묶은 꾸러미다.
 *   [머리 26바이트] [파일들: zstd로 압축한 조각이 이어 붙음] [둘째 머리 9바이트] [목차: zstd 조각 하나]
 * - 머리: 02 01 "fmf." 08 00 00, 그다음 u64 = 9번째 바이트부터 둘째 머리까지의 길이, 그리고 9바이트(뜻 모름, 건드리지 않는다)
 * - 목차(풀면): [u32 길이][세이브 이름] [u32 파일 수] 그리고 파일마다
 *     [u32 길이][이름] [u32 길이][확장자] [u64 위치] [u64 압축 크기] [u64 원래 크기] [16바이트: 시각 둘]
 *   위치는 머리(26바이트) 뒤부터 센다.
 * - 선수·구단이 든 데이터베이스는 "game_db" 파일이다.
 *
 * 읽기만 한다. 데이터베이스를 고쳐 다시 묶은 파일은 우리 쪽에서 다시 읽으면 멀쩡해도 게임(26.3.2)이
 * "저장된 게임을 열 수 없습니다"라며 불러오지 않았다(게임이 무엇을 검사하는지는 알아내지 못했다).
 * 그래서 값 수정은 세이브가 아니라 켜져 있는 게임에 한다(plugin/LiveMemory.cs).
 */

export const SIGNATURE = Buffer.from([0x02, 0x01, 0x66, 0x6d, 0x66, 0x2e, 0x08, 0x00, 0x00])
export const HEAD_SIZE = 26
const DATABASE = 'game_db'

export interface TocEntry {
  name: string
  /** 머리 뒤부터 센 위치 */
  offset: number
  compressedSize: number
  size: number
}

export interface SaveContainer {
  data: Buffer
  /** 둘째 머리가 시작하는 곳 */
  tocHead: number
  /** 풀어 놓은 목차 */
  toc: Buffer
  entries: TocEntry[]
}

function u64(buffer: Buffer, at: number): number {
  const value = buffer.readBigUInt64LE(at)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new SaveFormatError('세이브 목차의 숫자가 예상 범위를 벗어났습니다.')
  return Number(value)
}

/** 풀어 놓은 목차에서 파일 목록을 읽는다. 구조가 예상과 다르면 SaveFormatError. 파일 전체를 읽지 않고 목차만 읽을 때(save/peek.ts)도 쓴다. */
export function parseToc(toc: Buffer): TocEntry[] {
  const entries: TocEntry[] = []
  try {
    let p = 4 + toc.readUInt32LE(0)
    const count = toc.readUInt32LE(p)
    p += 4
    for (let i = 0; i < count; i++) {
      const nameLength = toc.readUInt32LE(p)
      const name = toc.toString('utf8', p + 4, p + 4 + nameLength)
      p += 4 + nameLength
      p += 4 + toc.readUInt32LE(p)
      entries.push({
        name,
        offset: u64(toc, p),
        compressedSize: u64(toc, p + 8),
        size: u64(toc, p + 16)
      })
      p += 40
    }
  } catch (error) {
    if (error instanceof SaveFormatError) throw error
    throw new SaveFormatError('세이브 파일의 목차를 읽지 못했습니다.')
  }
  return entries
}

/** 세이브 파일의 목차를 읽는다. 구조가 예상과 다르면 SaveFormatError. */
export function openContainer(data: Buffer): SaveContainer {
  if (data.length < HEAD_SIZE + 16 || !data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    throw new SaveFormatError('FM26 세이브 파일이 아니거나 형식이 바뀌었습니다.')
  }
  const tocHead = SIGNATURE.length + u64(data, SIGNATURE.length)
  if (tocHead + SIGNATURE.length >= data.length || !data.subarray(tocHead, tocHead + SIGNATURE.length).equals(SIGNATURE)) {
    throw new SaveFormatError('세이브 파일에서 목차를 찾지 못했습니다.')
  }
  let toc: Buffer
  try {
    toc = zstdDecompressSync(data.subarray(tocHead + SIGNATURE.length))
  } catch {
    throw new SaveFormatError('세이브 파일의 목차를 풀지 못했습니다.')
  }
  return { data, tocHead, toc, entries: parseToc(toc) }
}

function databaseEntry(container: SaveContainer): TocEntry {
  const entry = container.entries.find((each) => each.name === DATABASE)
  if (!entry || HEAD_SIZE + entry.offset + entry.compressedSize > container.tocHead) {
    throw new SaveFormatError('세이브 파일에서 데이터베이스를 찾지 못했습니다.')
  }
  return entry
}

/** 꾸러미 안의 작은 파일 하나를 풀어 돌려준다. 없거나 풀지 못하면 null */
export function extractFile(container: SaveContainer, name: string): Buffer | null {
  const entry = container.entries.find((each) => each.name === name)
  if (!entry || HEAD_SIZE + entry.offset + entry.compressedSize > container.tocHead) return null
  const start = HEAD_SIZE + entry.offset
  try {
    return zstdDecompressSync(container.data.subarray(start, start + entry.compressedSize), { maxOutputLength: 64 * 1024 * 1024 })
  } catch {
    return null
  }
}

/**
 * 게임의 오늘 날짜. 꾸러미의 game_info 파일에 있다(26.3.2 세이브 셋을 견주어 확인):
 *   [8바이트][판 이름 길이 u32][판 이름] … 판 이름 뒤 165바이트째에 [파일 이름 수 u32][길이 u32 + 이름]… [3바이트][날짜]
 * 날짜는 [연중 일수 u16(아래 9비트)][연도 u16]. 읽지 못하면 null.
 */
export function gameDateOf(info: Buffer): { year: number; day: number } | null {
  try {
    let at = 12 + info.readUInt32LE(8) + 165
    const count = info.readUInt32LE(at)
    if (count > 64) return null
    at += 4
    for (let i = 0; i < count; i++) at += 4 + info.readUInt32LE(at)
    at += 3
    const day = info.readUInt16LE(at) & 0x1ff
    const year = info.readUInt16LE(at + 2)
    return year >= 2020 && year <= 2200 && day >= 1 && day <= 366 ? { year, day } : null
  } catch {
    return null
  }
}

/** 데이터베이스(game_db)를 풀어 돌려준다. */
export function extractDatabase(container: SaveContainer): Buffer {
  const entry = databaseEntry(container)
  const start = HEAD_SIZE + entry.offset
  let db: Buffer
  try {
    db = zstdDecompressSync(container.data.subarray(start, start + entry.compressedSize), { maxOutputLength: 2 ** 31 - 1 })
  } catch {
    throw new SaveFormatError('세이브 파일의 데이터베이스를 풀지 못했습니다.')
  }
  if (db.length !== entry.size) throw new SaveFormatError('세이브 파일의 데이터베이스 크기가 목차와 다릅니다.')
  return db
}
