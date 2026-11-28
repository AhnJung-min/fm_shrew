/**
 * 시험용 세이브 꾸러미 만들기: 실제 세이브와 같은 겉 구조(머리, 압축한 파일들, 둘째 머리, 목차)로 작은 파일을 만든다.
 * 세이브 버전 엿보기(tests/savePeek.test.ts)와 세이브 목록·적용 전 확인(tests/gameLinkVersion.test.ts)이 함께 쓴다.
 */
import { constants, zstdCompressSync } from 'node:zlib'

export const SIGNATURE = Buffer.from([0x02, 0x01, 0x66, 0x6d, 0x66, 0x2e, 0x08, 0x00, 0x00])
export const HEAD = 26

export const pack = (data: Buffer): Buffer => zstdCompressSync(data, { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
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
export const text = (value: string): Buffer => Buffer.concat([u32(Buffer.byteLength(value)), Buffer.from(value)])

export interface MadeSave {
  data: Buffer
  /** 파일마다 꾸러미 안의 위치(머리 26바이트를 더한 파일 위치)와 압축한 크기 */
  places: Record<string, { at: number; size: number }>
}

/** 세이브와 같은 꾸러미를 만든다: 머리, 압축한 파일들, 둘째 머리, 목차 */
export function makeSave(files: Array<{ name: string; data: Buffer }>): MadeSave {
  const packed = files.map((file) => pack(file.data))
  const parts: Buffer[] = [text('시험 세이브'), u32(files.length)]
  const places: MadeSave['places'] = {}
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
export const summary = (...strings: string[]): Buffer => Buffer.concat([Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), ...strings.map(text), Buffer.alloc(12, 0xff)])

/** 요약에 게임 판 글자를 넣은 작은 세이브(데이터베이스 조각은 짧은 덩어리) */
export function saveWithVersion(version: string | null): Buffer {
  return makeSave([
    { name: 'game_info', data: Buffer.from('게임 정보'.repeat(10)) },
    { name: 'save_game_summary', data: summary('가상 구단', '선수01', ...(version === null ? [] : [version]), '가상 리그') },
    { name: 'game_db', data: Buffer.from('데이터베이스'.repeat(30)) }
  ]).data
}
