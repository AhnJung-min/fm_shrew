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

/**
 * 문장을 맺는 꼴("~입니다", "~낮습니다", "~남았습니다")을 뒤에 다른 절이 이어지는 꼴("~이고", "~낮고", "~남았고")로 바꾼다.
 * 알아보는 맺음은 "입니다"·"습니다"와, 그 밖의 "ㅂ니다"로 끝나는 동사("못 미칩니다" → "못 미치고", "돌아갑니다" → "돌아가고")다.
 * 그 밖의 맺음은 그대로 둔다.
 */
export function linkForm(clause: string): string {
  if (clause.endsWith('입니다')) return `${clause.slice(0, -3)}이고`
  if (clause.endsWith('습니다')) return `${clause.slice(0, -3)}고`
  if (clause.endsWith('니다') && clause.length >= 3) {
    const code = clause.charCodeAt(clause.length - 3)
    // 앞 글자의 받침이 ㅂ(종성 17)이면 받침을 떼고 "고"를 붙인다
    if (code >= HANGUL_FIRST && code <= HANGUL_LAST && (code - HANGUL_FIRST) % FINALS === 17) return `${clause.slice(0, -3)}${String.fromCharCode(code - 17)}고`
  }
  return clause
}

/**
 * 맺는 꼴로 쓴 절들을 한 문장으로 잇는다. 마지막만 맺고 앞의 절은 잇는 꼴로 바꾼다
 * (쉼표를 두고 "~입니다, ~입니다"처럼 맺는 꼴을 두 번 쓰지 않는다).
 * 예: ['주전 A가 34세입니다', '후보가 B 한 명뿐입니다'] → "주전 A가 34세이고, 후보가 B 한 명뿐입니다."
 */
export function joinClauses(clauses: string[]): string {
  if (clauses.length === 0) return ''
  return `${[...clauses.slice(0, -1).map(linkForm), clauses[clauses.length - 1]].join(', ')}.`
}
