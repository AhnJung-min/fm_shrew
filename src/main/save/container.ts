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

const SIGNATURE = Buffer.from([0x02, 0x01, 0x66, 0x6d, 0x66, 0x2e, 0x08, 0x00, 0x00])
const HEAD_SIZE = 26
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
  return { data, tocHead, toc, entries }
}

function databaseEntry(container: SaveContainer): TocEntry {
  const entry = container.entries.find((each) => each.name === DATABASE)
  if (!entry || HEAD_SIZE + entry.offset + entry.compressedSize > container.tocHead) {
    throw new SaveFormatError('세이브 파일에서 데이터베이스를 찾지 못했습니다.')
  }
  return entry
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
