import { describe, expect, it } from 'vitest'
import { BLOCK_SIZE } from '../src/main/save/reader'
import { SEX_FEMALE, SEX_MALE, SEX_UNKNOWN, ownerTag, sexAt } from '../src/main/save/world'

const BLOCK = 100

/** 사람 꼬리표: [플래그 u32][앞의 작은 수][색인][번호][번호][다음 기록의 종류]. 플래그의 둘째 바이트가 꼬리표 -7이다 */
function recordWith(flagByte: number, tagAt = BLOCK + 700): Buffer {
  const db = Buffer.alloc(2000)
  db.writeUInt32LE(4, tagAt - 4)
  db[tagAt - 7] = flagByte
  db.writeUInt32LE(501, tagAt)
  db.writeUInt32LE(22222, tagAt + 4)
  db.writeUInt32LE(22222, tagAt + 8)
  db[tagAt + 12] = 2
  return db
}

describe('선수의 성별', () => {
  it('꼬리표 앞 플래그의 0x10 비트가 켜져 있으면 여자다', () => {
    for (const flag of [0x10, 0x12, 0x50, 0x52, 0x90]) {
      const db = recordWith(flag)
      const tag = ownerTag(db, BLOCK, db.length)!
      expect(sexAt(db, BLOCK, tag.at)).toBe(SEX_FEMALE)
    }
  })

  it('꺼져 있으면 다른 비트가 켜져 있어도 남자다', () => {
    for (const flag of [0x00, 0x02, 0x40, 0x42, 0x80, 0x82]) {
      const db = recordWith(flag)
      const tag = ownerTag(db, BLOCK, db.length)!
      expect(sexAt(db, BLOCK, tag.at)).toBe(SEX_MALE)
    }
  })

  it('다른 바이트의 0x10 비트는 성별로 보지 않는다', () => {
    const db = recordWith(0x00)
    const tag = ownerTag(db, BLOCK, db.length)!
    db[tag.at - 8] = 0x10
    db[tag.at - 6] = 0x10
    db[tag.at - 5] = 0x10
    expect(sexAt(db, BLOCK, tag.at)).toBe(SEX_MALE)
  })

  it('꼬리표가 능력치 블록 안으로 들어가면 모른다', () => {
    const db = recordWith(0x10)
    expect(sexAt(db, BLOCK, BLOCK + BLOCK_SIZE + 3)).toBe(SEX_UNKNOWN)
  })

  it('ownerTag가 꼬리표의 위치를 알려 준다', () => {
    const db = recordWith(0x00, BLOCK + 900)
    expect(ownerTag(db, BLOCK, db.length)).toEqual({ uid: 22222, index: 501, at: BLOCK + 900 })
  })
})
