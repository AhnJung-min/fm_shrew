import { describe, expect, it } from 'vitest'
import { gameDateOf } from '../src/main/save/container'
import { calendar, contractInEffect, findContracts, readDate, type SaveContract } from '../src/main/save/contracts'

/** 날짜를 4바이트로: [연중 일수][연도] */
function putDate(db: Buffer, at: number, year: number, day: number): void {
  db.writeUInt16LE(day, at)
  db.writeUInt16LE(year, at + 2)
}

/** 계약 기록 하나를 적는다. tag는 표지가 놓이는 곳, steps는 꼬리까지의 걸음 수 */
function putContract(db: Buffer, tag: number, owner: number, wage: number, steps: number): void {
  Buffer.from([0x01, 0x00, 0x6c, 0x07]).copy(db, tag)
  db.writeUInt32LE(owner, tag + 5)
  db.writeUInt32LE(533, tag + 9)
  db.writeUInt32LE(wage, tag + 17)
  putDate(db, tag - 19, 2025, 174)
  const tail = tag - 66 - 29 * steps
  db[tail + 3] = 3
  db.writeUInt32LE(4, tail + 4)
  db[tail + 42] = steps
  putDate(db, tail + 28, 2027, 181)
  db[tail + 36] = 1
}

describe('세이브의 계약', () => {
  it('그 선수의 색인이 적힌 기록에서 주급·기간·입지를 읽는다', () => {
    const db = Buffer.alloc(1200)
    putContract(db, 400, 33940, 350_000, 2)
    // 같은 표지지만 다른 사람의 기록
    putContract(db, 900, 111, 99, 0)
    const found = findContracts(db, 0, db.length, 33940)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ teamId: 533, wage: 350_000, status: 1, start: { year: 2025, day: 174 }, end: { year: 2027, day: 181 } })
  })

  it('꼬리를 찾지 못하면 주급만 알고 만료일은 모른다', () => {
    const db = Buffer.alloc(600)
    putContract(db, 300, 7, 1000, 0)
    db[300 - 66 + 3] = 0
    expect(findContracts(db, 0, db.length, 7)[0]).toMatchObject({ wage: 1000, end: null, status: 0 })
  })

  it('지금 효력이 있는 것은 오늘까지 시작한 것 가운데 가장 늦게 시작한 것이다', () => {
    const record = (year: number, day: number, wage: number): SaveContract => ({ teamId: 1, wage, start: { year, day }, end: null, status: 0 })
    const records = [record(2025, 174, 100), record(2026, 1, 200), record(2027, 1, 300)]
    expect(contractInEffect(records, { year: 2025, day: 300 })?.wage).toBe(100)
    expect(contractInEffect(records, { year: 2026, day: 3 })?.wage).toBe(200)
    // 오늘을 모르면 가장 먼저 시작하는 것
    expect(contractInEffect(records, null)?.wage).toBe(100)
    expect(contractInEffect([], null)).toBeNull()
  })

  it('날짜를 읽고 월·일로 바꾼다', () => {
    const db = Buffer.alloc(8)
    // 위쪽 비트에는 하루 안의 시각이 들어 있어 떼어 낸다
    db.writeUInt16LE(181 | (0x24 << 9), 0)
    db.writeUInt16LE(2027, 2)
    expect(readDate(db, 0)).toEqual({ year: 2027, day: 181 })
    expect(calendar({ year: 2027, day: 181 })).toEqual({ year: 2027, month: 6, day: 30 })
    // 없는 날짜(1900년 1일)
    putDate(db, 4, 1900, 1)
    expect(readDate(db, 4)).toBeNull()
  })
})

describe('게임의 오늘 날짜', () => {
  const info = (files: string[]): Buffer => {
    const version = Buffer.from('26.2.0+0')
    const parts = [Buffer.alloc(8), Buffer.alloc(4), version, Buffer.alloc(165), Buffer.alloc(4)]
    parts[1].writeUInt32LE(version.length)
    parts[4].writeUInt32LE(files.length)
    for (const file of files) {
      const length = Buffer.alloc(4)
      length.writeUInt32LE(file.length)
      parts.push(length, Buffer.from(file))
    }
    const date = Buffer.alloc(7)
    date.writeUInt16LE(3 | (0x24 << 9), 3)
    date.writeUInt16LE(2026, 5)
    parts.push(date)
    return Buffer.concat(parts)
  }

  it('파일 이름 목록 뒤에서 읽는다', () => {
    expect(gameDateOf(info([]))).toEqual({ year: 2026, day: 3 })
    expect(gameDateOf(info(['WINHTTP.DLL']))).toEqual({ year: 2026, day: 3 })
  })

  it('모양이 다르면 모르는 것으로 둔다', () => {
    expect(gameDateOf(Buffer.alloc(40))).toBeNull()
    expect(gameDateOf(Buffer.alloc(400))).toBeNull()
  })
})
