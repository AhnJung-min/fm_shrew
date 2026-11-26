import { constants, zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { extractDatabase, openContainer } from '../src/main/save/container'
import { SaveFormatError } from '../src/main/save/reader'
import { categoriesOf, checkEdit, shownValue, type CandidateBench } from '../src/shared/world'

const SIGNATURE = Buffer.from([0x02, 0x01, 0x66, 0x6d, 0x66, 0x2e, 0x08, 0x00, 0x00])
const pack = (data: Buffer): Buffer => zstdCompressSync(data, { params: { [constants.ZSTD_c_checksumFlag]: 1 } })

/** 세이브와 같은 꾸러미를 만든다: 머리, 압축한 파일들, 둘째 머리, 목차 */
function makeSave(files: Array<{ name: string; data: Buffer }>): Buffer {
  const packed = files.map((file) => pack(file.data))
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
  const text = (value: string): Buffer => Buffer.concat([u32(Buffer.byteLength(value)), Buffer.from(value)])
  const parts: Buffer[] = [text('시험 세이브'), u32(files.length)]
  let offset = 0
  files.forEach((file, i) => {
    parts.push(text(file.name), text('.dat'), u64(offset), u64(packed[i].length), u64(file.data.length), Buffer.alloc(16, 0xee))
    offset += packed[i].length
  })
  const body = Buffer.concat(packed)
  const head = Buffer.alloc(26)
  SIGNATURE.copy(head)
  head.writeBigUInt64LE(BigInt(17 + body.length), 9)
  head[17] = 0x11
  head[25] = 0x03
  return Buffer.concat([head, body, SIGNATURE, pack(Buffer.concat(parts))])
}

describe('세이브 꾸러미', () => {
  const before = Buffer.from('앞 파일의 내용'.repeat(40))
  const after = Buffer.from('뒤 파일의 내용'.repeat(300))
  const database = Buffer.from('데이터베이스의 내용'.repeat(120))
  const save = makeSave([
    { name: 'game_info', data: before },
    { name: 'game_db', data: database },
    { name: 'news', data: after }
  ])

  it('목차에서 데이터베이스를 찾아 푼다', () => {
    const container = openContainer(save)
    expect(container.entries.map((entry) => entry.name)).toEqual(['game_info', 'game_db', 'news'])
    expect(extractDatabase(container).equals(database)).toBe(true)
  })

  it('세이브가 아닌 파일은 거절한다', () => {
    expect(() => openContainer(Buffer.from('세이브가 아닌 파일입니다. 충분히 긴 내용을 채웁니다.'))).toThrow(SaveFormatError)
  })

})

describe('선수 값 고치기', () => {
  it('범위를 벗어난 값은 받지 않는다', () => {
    expect(checkEdit({ uid: 1, ca: 201 })).not.toBeNull()
    expect(checkEdit({ uid: 1, ca: 150, pa: 140 })).not.toBeNull()
    expect(checkEdit({ uid: 1, attributes: new Array<number>(54).fill(101) })).not.toBeNull()
    expect(checkEdit({ uid: 1, positions: new Array<number>(14).fill(10) })).not.toBeNull()
    expect(checkEdit({ uid: 1, positions: new Array<number>(15).fill(20), ca: 150, pa: 150 })).toBeNull()
  })
})

describe('영입 후보의 유형', () => {
  const bench: CandidateBench = { starter: { name: '주전', score: 80, ca: 150 }, backup: { name: '후보', score: 72 } }
  const player = { score: 70, age: 25, ca: 140, pa: 145, hasClub: true }

  it('주전 이상이면 즉시 전력감, 두 번째 선수 이상이면 교체 자원이다', () => {
    expect(categoriesOf({ ...player, score: 80 }, bench)).toEqual(['starter'])
    expect(categoriesOf({ ...player, score: 75 }, bench)).toEqual(['rotation'])
    expect(categoriesOf({ ...player, score: 71.9 }, bench)).toEqual([])
  })

  it('두 번째 선수가 없으면 주전보다 6점 낮은 데까지를 교체 자원으로 본다', () => {
    const alone: CandidateBench = { starter: bench.starter, backup: null }
    expect(categoriesOf({ ...player, score: 74 }, alone)).toEqual(['rotation'])
    expect(categoriesOf({ ...player, score: 73.9 }, alone)).toEqual([])
  })

  it('어리고, 잠재 능력이 내 주전의 현재 능력 이상이고, 더 클 여지가 있으면 유망주다', () => {
    expect(categoriesOf({ ...player, age: 19, ca: 120, pa: 160 }, bench)).toEqual(['prospect'])
    expect(categoriesOf({ ...player, age: 22, ca: 120, pa: 160 }, bench)).toEqual([])
    expect(categoriesOf({ ...player, age: 19, ca: 120, pa: 149 }, bench)).toEqual([])
    expect(categoriesOf({ ...player, age: 19, ca: 155, pa: 160 }, bench)).toEqual([])
    expect(categoriesOf({ ...player, age: null, ca: 120, pa: 160 }, bench)).toEqual([])
  })

  it('소속 구단이 없으면 자유 계약이고, 다른 유형과 겹칠 수 있다', () => {
    expect(categoriesOf({ ...player, score: 85, hasClub: false }, bench)).toEqual(['starter', 'free'])
  })

  it('저장값을 게임 표시값으로 바꾼다', () => {
    expect([1, 5, 52, 53, 84, 100].map(shownValue)).toEqual([1, 1, 10, 11, 17, 20])
  })
})
