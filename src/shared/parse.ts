import Papa from 'papaparse'
import { FIELD_BY_ID, matchField } from './fields'
import type { CellValue, ColumnInfo, PlayerRow } from './types'

export interface ParsedExport {
  columns: ColumnInfo[]
  rows: PlayerRow[]
}

/** 파일 바이트를 글자로. BOM을 보고, 없으면 UTF-8로 읽다가 깨지면 EUC-KR로 읽는다. */
export function decodeBytes(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

const RANGE_RE = /^(\d{1,2})\s*[-~–]\s*(\d{1,2})$/
const PLAIN_NUM_RE = /^-?\d+(\.\d+)?$/
const COMMA_DECIMAL_RE = /^-?\d+,\d{1,2}$/
const EMPTY_MARKS = new Set(['', '-', '--', '?', 'n/a', '없음'])

/** 한 칸을 읽는다. 범위(12-15)는 중간값, 쉼표 소수(4,5)는 4.5로 본다. */
export function parseCell(input: string): CellValue {
  const raw = (input ?? '').trim()
  if (EMPTY_MARKS.has(raw.toLowerCase())) return { raw, num: null }

  const range = RANGE_RE.exec(raw)
  if (range) {
    const lo = Number(range[1])
    const hi = Number(range[2])
    if (lo <= hi && hi <= 20) return { raw, num: (lo + hi) / 2, range: [lo, hi] }
  }
  if (PLAIN_NUM_RE.test(raw)) return { raw, num: Number(raw) }
  if (COMMA_DECIMAL_RE.test(raw)) return { raw, num: Number(raw.replace(',', '.')) }

  // 출전 기록 "19 (2)": 선발 19, 교체 2. 정렬은 합계로 한다.
  const apps = APPS_RE.exec(raw)
  if (apps) return { raw, num: Number(apps[1]) + Number(apps[2]) }

  const money = parseMoney(raw)
  if (money !== null) return { raw, num: money }
  return { raw, num: null }
}

const APPS_RE = /^(\d+)\s*\((\d+)\)$/
const MONEY_PART_RE = /(\d[\d,]*(?:\.\d+)?)\s*(억|만|천)?\s*원/g
const MONEY_UNIT: Record<string, number> = { 억: 100_000_000, 만: 10_000, 천: 1_000 }

/**
 * 한국어 금액을 원 단위 숫자로. "주급 4.5억 원" → 450000000.
 * "950억 원 - 1,130억 원"처럼 범위면 두 값의 가운데를 쓴다.
 */
export function parseMoney(raw: string): number | null {
  const amounts: number[] = []
  for (const match of raw.matchAll(MONEY_PART_RE)) {
    const value = Number(match[1].replace(/,/g, ''))
    if (Number.isFinite(value)) amounts.push(value * (match[2] ? MONEY_UNIT[match[2]] : 1))
  }
  if (amounts.length === 0) return null
  return amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
}

/** HTML 표를 행렬로. 게임이 내보내는 단순한 표만 상대하므로 정규식으로 충분하다. */
function htmlToMatrix(html: string): string[][] {
  const matrix: string[][] = []
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(html))) {
    const cells: string[] = []
    const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      cells.push(decodeEntities(cellMatch[1].replace(/<[^>]+>/g, '')).trim())
    }
    if (cells.length > 0) matrix.push(cells)
  }
  return matrix
}

function csvToMatrix(text: string): string[][] {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    delimitersToGuess: [';', ',', '\t', '|']
  })
  return result.data.map((row) => row.map((cell) => (cell ?? '').trim()))
}

/** 같은 이름의 열이 여러 개면 뒤쪽에 (2), (3)을 붙여 구분한다. */
function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((header, i) => {
    const base = header.trim() || `열 ${i + 1}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base} (${count})`
  })
}

function baseHeader(header: string): string {
  return header.replace(/ \(\d+\)$/, '')
}

/**
 * 내보내기 파일 내용을 선수 표로 바꾼다.
 * @param overrides 열 이름 → 항목 id (설정에서 직접 지정한 것)
 */
export function parseExport(
  text: string,
  fileName: string,
  overrides: Record<string, string> = {}
): ParsedExport {
  const isHtml = /\.html?$/i.test(fileName) || /^\s*<(!doctype|html|table)/i.test(text)
  const matrix = (isHtml ? htmlToMatrix(text) : csvToMatrix(text)).filter((row) =>
    row.some((cell) => cell !== '')
  )
  if (matrix.length < 2) {
    throw new Error('표를 찾지 못했습니다. 머리 줄과 선수 줄이 하나 이상 있어야 합니다.')
  }

  const headers = uniqueHeaders(matrix[0])
  const body = matrix.slice(1)
  const parsed = body.map((row) => headers.map((_, c) => parseCell(row[c] ?? '')))
  const columns = deriveColumns(headers, (c) => parsed.map((row) => row[c]), overrides)

  const nameIndex = Math.max(
    0,
    columns.findIndex((col) => col.field === 'name')
  )
  const rows: PlayerRow[] = parsed
    .map((cells, idx) => ({
      idx,
      name: cells[nameIndex]?.raw ?? '',
      cells: Object.fromEntries(headers.map((header, c) => [header, cells[c]]))
    }))
    .filter((row) => row.name !== '')

  if (rows.length === 0) throw new Error('선수 줄이 없습니다.')
  return { columns, rows }
}

/**
 * 열 이름과 값을 보고 각 열이 무엇인지 정한다.
 * 저장된 스냅샷을 다시 열 때도 불러서, 설정에서 바꾼 열 지정이 예전 기록에도 적용되게 한다.
 */
export function deriveColumns(
  headers: string[],
  valuesOf: (columnIndex: number) => CellValue[],
  overrides: Record<string, string> = {}
): ColumnInfo[] {
  const usedFields = new Set<string>()
  return headers.map((header, c) => {
    const filled = valuesOf(c).filter((cell) => cell && cell.raw !== '' && cell.raw !== '-')
    const numericCount = filled.filter((cell) => cell.num !== null).length
    const numeric = filled.length > 0 && numericCount / filled.length >= 0.8
    const inAttrRange = filled.every((cell) => cell.num === null || (cell.num >= 1 && cell.num <= 20))

    const overrideId = overrides[header] ?? overrides[baseHeader(header)]
    let field = overrideId ? (FIELD_BY_ID[overrideId] ?? null) : matchField(baseHeader(header), numeric)
    // 같은 항목이 두 번 잡히면 뒤쪽은 알 수 없는 열로 둔다
    if (field && usedFields.has(field.id)) field = null
    if (field) usedFields.add(field.id)

    return {
      header,
      field: field?.id ?? null,
      group: field?.group ?? 'other',
      short: field?.short ?? header,
      label: field?.label ?? header,
      isAttr: Boolean(field?.isAttr) && numeric && inAttrRange,
      numeric
    }
  })
}
