/**
 * 세이브 버전 엿보기(N-02): 세이브를 적용하기 전에 저장한 게임의 판을 머리·목차·요약 조각만 읽어 알아낸다.
 * 시험이 만든 작은 꾸러미(tests/save.test.ts와 같은 모양)로 보고, FMB_TEST_SAVE가 있으면 실제 시험 세이브에서도 본다.
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { constants, zstdCompressSync } from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeVersion } from '../src/shared/compat'

// 읽은 위치를 세려고 readSync를 그대로 부르는 감시 함수로 바꾼다
const reads: Array<{ position: number; length: number }> = []
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readSync: (fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number) => {
      reads.push({ position, length })
      return actual.readSync(fd, buffer, offset, length, position)
    }
  }
})

const { peekSaveVersion } = await import('../src/main/save/peek')
const { openContainer, parseToc } = await import('../src/main/save/container')

const SIGNATURE = Buffer.from([0x02, 0x01, 0x66, 0x6d, 0x66, 0x2e, 0x08, 0x00, 0x00])
const HEAD = 26
const pack = (data: Buffer): Buffer => zstdCompressSync(data, { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
const u32 = (value: number): Buffer => {
  const out = Buffer.alloc(4)
  out.writeUInt32LE(value)
  return out
}
const u64 = (value: number): Buffer => {
  const out = Buffer.alloc(8)
  out.writeBigUInt64LE(BigInt(value))
  return out
}
/** 요약이 담는 글자 하나: [길이 u32][UTF-8] */
const text = (value: string): Buffer => Buffer.concat([u32(Buffer.byteLength(value)), Buffer.from(value)])

interface Made {
  data: Buffer
  /** 파일마다 꾸러미 안의 위치(머리 26바이트를 더한 파일 위치)와 압축한 크기 */
  places: Record<string, { at: number; size: number }>
}

/** 세이브와 같은 꾸러미를 만든다: 머리, 압축한 파일들, 둘째 머리, 목차 */
function makeSave(files: Array<{ name: string; data: Buffer }>): Made {
  const packed = files.map((file) => pack(file.data))
  const parts: Buffer[] = [text('시험 세이브'), u32(files.length)]
  const places: Made['places'] = {}
  let offset = 0
  files.forEach((file, i) => {
    parts.push(text(file.name), text('.dat'), u64(offset), u64(packed[i].length), u64(file.data.length), Buffer.alloc(16, 0xee))
    places[file.name] = { at: HEAD + offset, size: packed[i].length }
    offset += packed[i].length
  })
  const body = Buffer.concat(packed)
  const head = Buffer.alloc(HEAD)
  SIGNATURE.copy(head)
  head.writeBigUInt64LE(BigInt(17 + body.length), 9)
  head[17] = 0x11
  head[25] = 0x03
  return { data: Buffer.concat([head, body, SIGNATURE, pack(Buffer.concat(parts))]), places }
}

/** 실제 요약처럼 글자가 아닌 바이트와 글자들이 섞인 요약 */
const summary = (...strings: string[]): Buffer => Buffer.concat([Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), ...strings.map(text), Buffer.alloc(12, 0xff)])

/** 데이터베이스 조각: 압축이 잘 안 되는 큰 덩어리(읽었는지 가늠하려고 크게 만든다. 내용은 상관없다) */
const bigDatabase = randomBytes(300_000)

let dir: string
let counter = 0
const put = (data: Buffer): string => {
  const path = join(dir, `save-${counter++}.fm`)
  writeFileSync(path, data)
  return path
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fmb-peek-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  reads.length = 0
})

const FILES = (extra: Buffer = summary('가상 구단', '선수01', '선수02', '26.3.2+2329565', '가상 리그')): Array<{ name: string; data: Buffer }> => [
  { name: 'game_info', data: Buffer.from('게임 정보'.repeat(40)) },
  { name: 'save_game_summary', data: extra },
  { name: 'game_db', data: bigDatabase },
  { name: 'news', data: Buffer.from('뉴스'.repeat(300)) }
]

describe('peekSaveVersion', () => {
  it("요약에서 게임 버전 글자를 찾는다('26.3.2+2329565')", () => {
    const path = put(makeSave(FILES()).data)
    const version = peekSaveVersion(path)
    expect(version).toBe('26.3.2+2329565')
    expect(normalizeVersion(version)).toBe('26.3.2')
  })

  it('빌드 번호가 없는 글자도 읽고, 요약의 다른 글자(이름, 숫자가 섞인 글자)는 버전으로 보지 않는다', () => {
    expect(peekSaveVersion(put(makeSave(FILES(summary('1.5 시즌', '선수 26.3', '26.4.0'))).data))).toBe('26.4.0')
    expect(peekSaveVersion(put(makeSave(FILES(summary('가상 구단', '선수01', '26.3.2beta', '3.14'))).data))).toBeNull()
  })

  it('데이터베이스(game_db) 조각은 읽지 않고, 머리·목차·요약 조각만 위치를 지정해 읽는다', () => {
    const made = makeSave(FILES())
    const path = put(made.data)
    expect(made.data.length).toBeGreaterThan(300_000)
    reads.length = 0
    expect(peekSaveVersion(path)).toBe('26.3.2+2329565')
    expect(reads.length).toBeGreaterThan(0)
    const database = made.places.game_db
    for (const read of reads) {
      // 읽은 구간이 데이터베이스 조각과 겹치지 않는다
      const overlaps = read.position < database.at + database.size && read.position + read.length > database.at
      expect(overlaps, `읽은 구간 ${read.position}+${read.length}`).toBe(false)
    }
    // 읽은 양은 파일 크기에 견주어 아주 작다(머리 26 + 서명 9 + 압축한 목차 + 압축한 요약)
    const total = reads.reduce((sum, read) => sum + read.length, 0)
    expect(total).toBeLessThan(HEAD + 9 + 4000 + made.places.save_game_summary.size)
    expect(total).toBeLessThan(made.data.length / 20)
    // 요약 조각은 읽었다
    const summaryPlace = made.places.save_game_summary
    expect(reads.some((read) => read.position === summaryPlace.at && read.length === summaryPlace.size)).toBe(true)
  })

  it('요약이 없거나 요약에 버전 글자가 없으면 null이다', () => {
    const noSummary = makeSave(FILES().filter((file) => file.name !== 'save_game_summary'))
    expect(peekSaveVersion(put(noSummary.data))).toBeNull()
    expect(peekSaveVersion(put(makeSave(FILES(summary('가상 구단', '선수01', '가상 리그'))).data))).toBeNull()
    expect(peekSaveVersion(put(makeSave(FILES(Buffer.from([1, 2, 3, 255, 255, 255, 255]))).data))).toBeNull()
  })

  it('잘린 세이브는 null이고 던지지 않는다', () => {
    const made = makeSave(FILES())
    for (const keep of [0, 5, 9, 25, HEAD, 100, made.places.save_game_summary.at + 10, made.data.length - 30, made.data.length - 1]) {
      expect(peekSaveVersion(put(made.data.subarray(0, keep))), `앞 ${keep}바이트만`).toBeNull()
    }
  })

  it('세이브가 아닌 파일, 없는 파일, 폴더는 null이다', () => {
    expect(peekSaveVersion(put(Buffer.from('세이브가 아닌 파일입니다. 충분히 긴 내용을 채웁니다. '.repeat(10))))).toBeNull()
    expect(peekSaveVersion(put(Buffer.alloc(0)))).toBeNull()
    expect(peekSaveVersion(join(dir, '없는 파일.fm'))).toBeNull()
    expect(peekSaveVersion(dir)).toBeNull()
  })

  it('머리의 길이 값이 파일보다 크거나 목차가 깨져 있으면 null이다', () => {
    const made = makeSave(FILES())
    const hugeSpan = Buffer.from(made.data)
    hugeSpan.writeBigUInt64LE(2n ** 40n, 9)
    expect(peekSaveVersion(put(hugeSpan))).toBeNull()
    const brokenToc = Buffer.from(made.data)
    brokenToc.fill(0x77, made.data.length - 20)
    expect(peekSaveVersion(put(brokenToc))).toBeNull()
    const noSecondHead = Buffer.from(made.data)
    const tocHead = 9 + Number(made.data.readBigUInt64LE(9))
    noSecondHead.fill(0, tocHead, tocHead + 9)
    expect(peekSaveVersion(put(noSecondHead))).toBeNull()
  })

  it('목차가 가리키는 요약 조각이 목차보다 뒤에 있거나 파일 밖이면 null이다', () => {
    const made = makeSave(FILES())
    const tocHead = 9 + Number(made.data.readBigUInt64LE(9))
    // 요약의 압축 크기를 파일보다 크게 고친 목차를 다시 압축해 붙인다
    const container = openContainer(made.data)
    const toc = Buffer.from(container.toc)
    const entry = parseToc(toc).find((each) => each.name === 'save_game_summary')!
    expect(entry.compressedSize).toBe(made.places.save_game_summary.size)
    // 목차 안에서 그 항목의 압축 크기 칸을 찾아 고친다(이름 뒤 [확장자 길이 u32][확장자 4바이트] 다음의 [위치 u64][압축 크기 u64])
    const at = toc.indexOf(Buffer.from('save_game_summary')) + 'save_game_summary'.length + 4 + 4 + 8
    expect(Number(toc.readBigUInt64LE(at))).toBe(entry.compressedSize)
    toc.writeBigUInt64LE(BigInt(made.data.length * 10), at)
    const forged = Buffer.concat([made.data.subarray(0, tocHead), SIGNATURE, pack(toc)])
    expect(peekSaveVersion(put(forged))).toBeNull()
  })
})

describe('목차 읽기 나누기(container.ts)', () => {
  it('openContainer가 낸 목차를 parseToc로 다시 읽어도 같다(나누기 전과 같은 동작)', () => {
    const made = makeSave(FILES())
    const container = openContainer(made.data)
    expect(parseToc(container.toc)).toEqual(container.entries)
    expect(container.entries.map((entry) => entry.name)).toEqual(['game_info', 'save_game_summary', 'game_db', 'news'])
  })
})

const REAL = process.env.FMB_TEST_SAVE
describe.skipIf(!REAL)('시험 세이브(FMB_TEST_SAVE가 있을 때만 돈다)', () => {
  it("실제 세이브에서 '26.3.2'를 찾고, 파일의 아주 작은 부분만 읽는다", () => {
    reads.length = 0
    const version = peekSaveVersion(REAL!)
    expect(normalizeVersion(version)).toBe('26.3.2')
    const total = reads.reduce((sum, read) => sum + read.length, 0)
    // 세이브는 수십~수백 MB인데 읽은 것은 수십 KB다
    expect(total).toBeLessThan(200_000)
  })
})
