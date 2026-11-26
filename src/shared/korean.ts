/**
 * 한국어 조사. 이름 같은 낱말 뒤에 받침 여부에 맞는 조사를 붙인다.
 * 낱말이 한글로 끝나지 않으면(영어 이름, 숫자) 받침을 알 수 없어 "이(가)"처럼 둘을 함께 적는다.
 */

/** 앞이 받침 있을 때 / 받침 없을 때 */
export type JosaPair = '이/가' | '은/는' | '을/를' | '과/와'

const HANGUL_FIRST = 0xac00
const HANGUL_LAST = 0xd7a3
/** 한글 글자 하나는 (초성 19 × 중성 21 × 종성 28)로 이어져 있고, 종성 0이 받침 없음이다 */
const FINALS = 28

/** 낱말의 마지막 글자에 받침이 있는지. 한글이 아니면 null */
export function hasBatchim(word: string): boolean | null {
  const trimmed = word.trimEnd()
  if (trimmed.length === 0) return null
  const code = trimmed.charCodeAt(trimmed.length - 1)
  if (code < HANGUL_FIRST || code > HANGUL_LAST) return null
  return (code - HANGUL_FIRST) % FINALS !== 0
}

/** 조사만. 한글이 아니면 "이(가)"처럼 둘 다 */
export function josa(word: string, pair: JosaPair): string {
  const [withBatchim, without] = pair.split('/')
  const batchim = hasBatchim(word)
  if (batchim === null) return `${withBatchim}(${without})`
  return batchim ? withBatchim : without
}

/** 낱말 + 조사. 예: withJosa('케르케즈', '이/가') → '케르케즈가', withJosa('반 다이크', '은/는') → '반 다이크는' */
export function withJosa(word: string, pair: JosaPair): string {
  return `${word}${josa(word, pair)}`
}
