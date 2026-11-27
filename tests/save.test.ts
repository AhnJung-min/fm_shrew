import { constants, zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { extractDatabase, openContainer } from '../src/main/save/container'
import { findPerson, SaveFormatError, type Person } from '../src/main/save/reader'
import { ownerUid } from '../src/main/save/world'
import { versionOlder } from '../src/shared/game'
import { categoriesOf, checkEdit, parseGameDate, shownValue, type CandidateBench } from '../src/shared/world'

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
  // 유형 판정의 자세한 경계는 tests/norms.test.ts에서 본다. 여기서는 세이브 값과 이어지는 것만 확인한다
  const bench: CandidateBench = { starter: { name: '주전', score: 80, ca: 150 }, backup: { name: '후보', score: 72 } }
  const player = { score: 70, age: 25, ca: 140, pa: 145, hasClub: true }

  it('주전 수준이면 즉시 전력감, 첫 후보 수준 이상이면 교체 자원이다(기준 분포 없이도 계산된다)', () => {
    expect(categoriesOf({ ...player, score: 80 }, bench)).toEqual(['starter'])
    expect(categoriesOf({ ...player, score: 75 }, bench)).toEqual(['rotation'])
    expect(categoriesOf({ ...player, score: 60 }, bench)).toEqual([])
  })

  it('소속 구단이 없으면 자유 계약이 붙지만, 위 유형에 들지 못하면 붙지 않는다', () => {
    expect(categoriesOf({ ...player, score: 85, hasClub: false }, bench)).toEqual(['starter', 'free'])
    expect(categoriesOf({ ...player, score: 60, hasClub: false }, bench)).toEqual([])
  })

  it('저장값을 게임 표시값으로 바꾼다', () => {
    expect([1, 5, 52, 53, 84, 100].map(shownValue)).toEqual([1, 1, 10, 11, 17, 20])
  })
})

describe('선수의 고유 번호', () => {
  const BLOCK = 100
  /** 사람 꼬리표: [앞의 작은 수][색인][번호][번호][다음 기록의 종류] */
  const tag = (db: Buffer, at: number, index: number, uid: number, kind = 2): void => {
    db.writeUInt32LE(4, at - 4)
    db.writeUInt32LE(index, at)
    db.writeUInt32LE(uid, at + 4)
    db.writeUInt32LE(uid, at + 8)
    db[at + 12] = kind
  }

  it('능력치 앞의 번호는 앞 사람의 것이고, 뒤에서 색인이 하나 큰 꼬리표가 이 선수의 것이다', () => {
    const db = Buffer.alloc(2000)
    tag(db, BLOCK - 43, 500, 11111)
    // 날짜가 두 번 잇달아 적힌 곳(번호처럼 보이지만 앞의 수가 크다)
    db.writeUInt32LE(0xffff0000, BLOCK + 196)
    db.writeUInt32LE(0x076c0001, BLOCK + 200)
    db.writeUInt32LE(0x076c0001, BLOCK + 204)
    db.writeUInt32LE(0x076c0001, BLOCK + 208)
    tag(db, BLOCK + 700, 501, 22222)
    tag(db, BLOCK + 1400, 502, 33333)
    expect(ownerUid(db, BLOCK, db.length)).toBe(22222)
  })

  it('앞 사람의 꼬리표가 없으면 뒤에서 처음 나오는 꼬리표를 쓴다', () => {
    const db = Buffer.alloc(2000)
    tag(db, BLOCK + 700, 501, 22222)
    tag(db, BLOCK + 1400, 502, 33333)
    expect(ownerUid(db, BLOCK, db.length)).toBe(22222)
  })

  it('꼬리표가 없으면 모르는 것(0)으로 둔다', () => {
    expect(ownerUid(Buffer.alloc(2000), BLOCK, 2000)).toBe(0)
  })
})

describe('플러그인 버전', () => {
  it('낮은 버전을 가려낸다', () => {
    expect(versionOlder('0.8.0', '0.9.0')).toBe(true)
    expect(versionOlder('0.9.0', '0.9.0')).toBe(false)
    expect(versionOlder('0.10.0', '0.9.0')).toBe(false)
    expect(versionOlder('', '0.9.0')).toBe(true)
  })
})

describe('게임이 적어 준 날짜', () => {
  it('연·월·일을 뽑는다', () => {
    expect(parseGameDate('2027년/6월/30일')).toEqual({ year: 2027, month: 6, day: 30 })
    expect(parseGameDate('30/6/2027')).toEqual({ year: 2027, month: 6, day: 30 })
    expect(parseGameDate('2027.12.31')).toEqual({ year: 2027, month: 12, day: 31 })
  })
  it('날짜가 아니면 모르는 것으로 둔다', () => {
    expect(parseGameDate('-')).toBeNull()
    expect(parseGameDate('계약 없음')).toBeNull()
    expect(parseGameDate('13/13/2027')).toBeNull()
  })
})

describe('사람 기록 찾기', () => {
  /** 사람 기록 모양 하나를 at에 쓴다: [이름 u32][0][성 u32][0][표시 이름 u32][0][길이 u32][이름 글자][생일 u16][해 u16] */
  function writePerson(db: Buffer, at: number, ids: { first: number; second: number; display: number }, born: number): void {
    db.writeUInt32LE(ids.first, at)
    db[at + 4] = 0
    db.writeUInt32LE(ids.second, at + 5)
    db[at + 9] = 0
    db.writeUInt32LE(ids.display, at + 10)
    db[at + 14] = 0
    db.writeUInt32LE(0, at + 15)
    db.writeUInt16LE(100, at + 19)
    db.writeUInt16LE(born, at + 21)
  }

  it('모양만 맞는 앞의 자료보다 이름 번호가 이름표에 있는 뒤의 기록을 고른다', () => {
    const db = Buffer.alloc(400, 0xaa)
    // 앞: 이름 번호가 이름표에 없고 표시 이름이 0번(세이브에서 "Stiven Rua"로 나오던 경우)
    writePerson(db, 40, { first: 65536, second: 0xffffff, display: 0 }, 2014)
    // 뒤: 진짜 기록
    writePerson(db, 200, { first: 11, second: 22, display: 33 }, 1994)
    const names = new Set([11, 22, 33])
    const accept = (person: Person): boolean => names.has(person.firstId) && names.has(person.secondId) && names.has(person.displayId)
    expect(findPerson(db, 0, db.length)?.birthYear).toBe(2014)
    const found = findPerson(db, 0, db.length, accept)
    expect(found).toMatchObject({ firstId: 11, secondId: 22, displayId: 33, birthYear: 1994 })
  })

  it('통과하는 후보가 없으면 모양이 맞는 첫 후보를 쓴다(예전 동작)', () => {
    const db = Buffer.alloc(300, 0xaa)
    writePerson(db, 40, { first: 7, second: 8, display: 9 }, 2001)
    expect(findPerson(db, 0, db.length, () => false)).toMatchObject({ firstId: 7, birthYear: 2001 })
  })
})
