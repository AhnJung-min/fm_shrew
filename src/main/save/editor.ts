import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { extractDatabase, openContainer, replaceDatabase } from './container'
import { ATTRIBUTE_COUNT, BLOCK_SIZE, POSITION_COUNT, SaveFormatError, findBlocks } from './reader'

/**
 * 세이브의 선수 값을 고쳐 새 파일로 쓴다.
 *
 * 고치는 것은 선수 기록 안의 정해진 자리뿐이다(숙련도 15바이트, 능력치 54바이트, 현재·잠재 능력).
 * 데이터베이스의 크기와 다른 내용은 그대로 두고, 값만 제자리에서 바꾼 뒤 다시 압축해 꾸러미에 넣는다.
 * 원본 파일은 건드리지 않는다.
 */

export interface SaveEdit {
  /** 선수 고유 번호(world.uids) */
  uid: number
  /** 숙련도 15개(1~20) */
  positions?: number[]
  /** 능력치 54개(1~100) */
  attributes?: number[]
  /** 현재·잠재 능력(1~200) */
  ca?: number
  pa?: number
}

function inRange(values: number[], length: number, min: number, max: number): boolean {
  return values.length === length && values.every((value) => Number.isInteger(value) && value >= min && value <= max)
}

/** 고칠 값이 범위 안인지 본다. 문제가 있으면 그 이유를 돌려준다. */
export function checkEdit(edit: SaveEdit): string | null {
  if (!Number.isInteger(edit.uid) || edit.uid <= 0) return '선수를 알아볼 수 없습니다.'
  if (edit.positions && !inRange(edit.positions, POSITION_COUNT, 1, 20)) return '포지션 숙련도는 1~20이어야 합니다.'
  if (edit.attributes && !inRange(edit.attributes, ATTRIBUTE_COUNT, 1, 100)) return '능력치 값이 범위를 벗어났습니다.'
  for (const value of [edit.ca, edit.pa]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 200)) return '현재·잠재 능력은 1~200이어야 합니다.'
  }
  if (edit.ca !== undefined && edit.pa !== undefined && edit.ca > edit.pa) return '현재 능력이 잠재 능력보다 클 수 없습니다.'
  return null
}

/** 풀어 놓은 데이터베이스에 수정을 적는다(제자리에서 바꾼다). 적용한 선수 수를 돌려준다. */
export function applyEdits(db: Buffer, edits: SaveEdit[]): number {
  for (const edit of edits) {
    const problem = checkEdit(edit)
    if (problem) throw new SaveFormatError(problem)
  }
  const wanted = new Map<number, SaveEdit>(edits.map((edit) => [edit.uid, edit]))
  const found = new Map<number, number[]>()
  for (const block of findBlocks(db)) {
    if (block < 40) continue
    const uid = db.readUInt32LE(block - 39)
    if (uid !== db.readUInt32LE(block - 35) || !wanted.has(uid)) continue
    found.set(uid, [...(found.get(uid) ?? []), block])
  }
  for (const edit of edits) {
    const blocks = found.get(edit.uid) ?? []
    // 같은 번호의 기록이 둘 이상이면 어느 것이 그 선수인지 알 수 없다. 아무것도 쓰지 않고 그만둔다
    if (blocks.length !== 1) throw new SaveFormatError('세이브에서 고칠 선수를 찾지 못했습니다. 게임에서 다시 저장한 뒤 시도해 주세요.')
  }
  for (const edit of edits) {
    const block = found.get(edit.uid)![0]
    if (edit.positions) db.set(edit.positions, block)
    if (edit.attributes) db.set(edit.attributes, block + POSITION_COUNT)
    if (edit.ca !== undefined) db.writeUInt16LE(edit.ca, block - 24)
    if (edit.pa !== undefined) db.writeUInt16LE(edit.pa, block - 22)
  }
  return edits.length
}

/**
 * source 세이브에 수정을 적용한 새 세이브를 target에 쓴다.
 * 쓰기 전에 만든 내용을 다시 풀어, 고친 값이 들어갔고 나머지는 원본과 같은지 확인한다.
 */
export function writeEditedSave(source: string, target: string, edits: SaveEdit[]): { players: number; bytes: number } {
  const container = openContainer(readFileSync(source))
  const original = extractDatabase(container)
  const edited = Buffer.from(original)
  const players = applyEdits(edited, edits)

  const packed = replaceDatabase(container, edited)
  const check = extractDatabase(openContainer(packed))
  if (!check.equals(edited)) throw new SaveFormatError('새 세이브를 만드는 데 실패했습니다(다시 읽은 내용이 다릅니다).')
  // 고친 선수 기록 밖은 한 바이트도 달라지지 않아야 한다
  let differing = 0
  for (let i = 0; i < original.length; i++) if (original[i] !== edited[i]) differing++
  if (differing > edits.length * (BLOCK_SIZE + 4)) throw new SaveFormatError('새 세이브를 만드는 데 실패했습니다(예상보다 많이 바뀌었습니다).')

  // 다 쓴 뒤에 이름을 바꿔, 쓰다 만 파일이 세이브 폴더에 남지 않게 한다
  const partial = `${target}.part`
  try {
    writeFileSync(partial, packed)
    renameSync(partial, target)
  } catch (error) {
    rmSync(partial, { force: true })
    throw error
  }
  return { players, bytes: packed.length }
}
