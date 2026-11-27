import { LEDGER, type LedgerEntry } from './ledger'

/**
 * docs/scoring.md의 상수 목록을 대장(ledger.ts)에서 만든다(N-06).
 * 목록은 문서의 LEDGER_DOC_BEGIN·LEDGER_DOC_END 표지 사이에 있고, 직접 고치지 않는다.
 * 다시 만들려면 `npm run docs:ledger`(tests/ledger.test.ts가 문서를 다시 쓴다). 문서와 대장이 어긋나면 같은 검사가 실패한다.
 */
export const LEDGER_DOC_BEGIN = '<!-- LEDGER_DOC_BEGIN: src/shared/ledger.ts에서 만든 목록입니다. 직접 고치지 말고 npm run docs:ledger로 다시 만드세요 -->'
export const LEDGER_DOC_END = '<!-- LEDGER_DOC_END -->'

/** 표 칸에 넣을 값 글자. 숫자는 그대로, 표와 묶음은 짧게 풀어 쓴다 */
export function formatLedgerValue(value: unknown): string {
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map((each) => (Array.isArray(each) ? `[${each.map(formatLedgerValue).join(', ')}]` : formatLedgerValue(each))).join(', ')
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, each]) => (each && typeof each === 'object' && !Array.isArray(each) ? `${key} {${formatLedgerValue(each)}}` : `${key}: ${formatLedgerValue(each)}`))
      .join(', ')
  }
  return String(value)
}

const cell = (text: string): string => text.replace(/\|/g, '/').replace(/\s+/g, ' ').trim()

function rowOf(entry: LedgerEntry): string {
  const checked = `${entry.lastChecked.date}, ${entry.lastChecked.save}`
  return `| \`${entry.name}\` | ${cell(formatLedgerValue(entry.value))} | ${cell(entry.unit)} | ${entry.status} | ${entry.sensitivity} | ${cell(entry.basis)} | ${cell(checked)} |`
}

/** 표지 사이에 들어가는 목록 전체(표지 줄 제외) */
export function renderLedgerDoc(entries: ReadonlyArray<LedgerEntry> = LEDGER): string {
  const count = (pick: (entry: LedgerEntry) => boolean): number => entries.filter(pick).length
  const sensitive = entries.filter((entry) => entry.sensitivity === '민감').map((entry) => `\`${entry.name}\``)
  return [
    `- 조정 상수 ${entries.length}개: 추정 ${count((e) => e.status === '추정')}, 실측 ${count((e) => e.status === '실측')}, 검증됨 ${count((e) => e.status === '검증됨')}.`,
    '- 추정은 게임의 실제 결과로 맞춰 본 적이 없다는 뜻이다. 실측은 세이브 자료에서 잰 값이고, 검증됨은 실제 결과와 대조까지 마친 값이다.',
    `- 민감은 상수를 ±20%(숙련 감점 계수는 절반과 두 배) 바꿨을 때 탭별 상위 10명 겹침이 0.8 미만인 것이다: ${sensitive.join(', ')}.`,
    '',
    '| 이름 | 값 | 단위 | 상태 | 민감도 | 근거 | 마지막 확인(날짜, 세이브) |',
    '|---|---|---|---|---|---|---|',
    ...entries.map(rowOf)
  ].join('\n')
}

/** 문서 글에서 표지 사이를 새 목록으로 바꾼다. 표지가 없으면 null */
export function replaceLedgerDoc(doc: string, entries: ReadonlyArray<LedgerEntry> = LEDGER): string | null {
  const begin = doc.indexOf(LEDGER_DOC_BEGIN)
  const end = doc.indexOf(LEDGER_DOC_END)
  if (begin < 0 || end < begin) return null
  return `${doc.slice(0, begin + LEDGER_DOC_BEGIN.length)}\n${renderLedgerDoc(entries)}\n${doc.slice(end)}`
}
