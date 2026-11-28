import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { HEAD_SIZE, parseToc, SIGNATURE } from './container'
import { summaryStrings } from './summary'

/**
 * 세이브를 적용하기 전에 그 세이브를 저장한 게임의 판을 엿본다(N-02). 세이브 파일은 수십~수백 MB라서 통째로 읽지 않고,
 * 위치를 지정해 머리(26바이트), 목차(압축한 것 20KB 안팎), save_game_summary 조각(압축한 것 1KB 안팎)만 읽는다. 데이터베이스(game_db) 조각은 읽지 않는다.
 * 게임이 꺼져 있어도 알 수 있다. 요약에는 "26.3.2+2329565" 꼴 글자가 있다(26.3.2 세이브에서 확인).
 */

const SUMMARY = 'save_game_summary'
/** 압축한 목차의 크기 한도(정상 세이브는 수십 KB다). 이보다 크면 세이브 형식이 아니라고 본다 */
const MAX_TOC_BYTES = 4 * 1024 * 1024
/** 압축한 요약 조각과 푼 요약의 크기 한도(정상은 수 KB다) */
const MAX_SUMMARY_BYTES = 1024 * 1024
/** 풀어 놓은 목차의 크기 한도 */
const MAX_TOC_TEXT_BYTES = 16 * 1024 * 1024
/** 요약 글자 가운데 게임 버전: "주.부.수"와 선택으로 "+빌드 번호" */
const VERSION_TEXT = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:\+\d{1,10})?$/

/** 파일의 position부터 length바이트를 읽는다. 파일이 짧으면 null */
function readAt(fd: number, position: number, length: number): Buffer | null {
  const buffer = Buffer.alloc(length)
  let done = 0
  while (done < length) {
    const got = readSync(fd, buffer, done, length - done, position + done)
    if (got === 0) return null
    done += got
  }
  return buffer
}

/**
 * 세이브가 저장된 게임의 버전 글자("26.3.2+2329565")를 읽는다. 세이브가 아니거나, 잘렸거나, 요약에 버전 글자가 없거나, 읽을 수 없으면 null이다(던지지 않는다).
 * 앱이 확인한 판인지는 shared/compat.ts의 checkGameVersion으로 본다.
 */
export function peekSaveVersion(path: string): string | null {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const head = readAt(fd, 0, HEAD_SIZE)
    if (!head || !head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return null
    const span = head.readBigUInt64LE(SIGNATURE.length)
    if (span > BigInt(size)) return null
    const tocHead = SIGNATURE.length + Number(span)
    const tocBytes = size - tocHead - SIGNATURE.length
    if (tocHead < HEAD_SIZE || tocBytes <= 0 || tocBytes > MAX_TOC_BYTES) return null
    const second = readAt(fd, tocHead, SIGNATURE.length)
    const packedToc = second?.equals(SIGNATURE) ? readAt(fd, tocHead + SIGNATURE.length, tocBytes) : null
    if (!packedToc) return null

    const entry = parseToc(zstdDecompressSync(packedToc, { maxOutputLength: MAX_TOC_TEXT_BYTES })).find((each) => each.name === SUMMARY)
    if (!entry || entry.compressedSize <= 0 || entry.compressedSize > MAX_SUMMARY_BYTES || HEAD_SIZE + entry.offset + entry.compressedSize > tocHead) return null
    const packedSummary = readAt(fd, HEAD_SIZE + entry.offset, entry.compressedSize)
    if (!packedSummary) return null
    const summary = zstdDecompressSync(packedSummary, { maxOutputLength: MAX_SUMMARY_BYTES })
    return summaryStrings(summary).find((text) => VERSION_TEXT.test(text)) ?? null
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // 닫지 못해도 읽기만 했으므로 달라질 것이 없다
      }
    }
  }
}
