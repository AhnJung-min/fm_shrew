import { LEDGER, SENSITIVE_BELOW, sensitivityOf, type LedgerEntry, type LedgerMeasure } from './ledger'

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

/** 민감도 칸의 글. 예: "민감 0.07 (로테이션 탭, +20%)", "보통 1.00 (변화 없음)", 잰 적이 없으면 "미측정" */
export function formatSensitivity(measured: LedgerMeasure | undefined): string {
  if (!measured) return '미측정'
  const where = measured.tab && measured.direction ? `${measured.tab} 탭${measured.wide ? '(넓힘)' : ''}, ${measured.direction}` : '변화 없음'
  return `${sensitivityOf(measured)} ${measured.overlap.toFixed(2)} (${where})`
}

function rowOf(entry: LedgerEntry): string {
  const checked = `${entry.lastChecked.date}, ${entry.lastChecked.save}`
  return `| \`${entry.name}\` | ${cell(formatLedgerValue(entry.value))} | ${cell(entry.unit)} | ${entry.status} | ${cell(formatSensitivity(entry.measured))} | ${cell(entry.basis)} | ${cell(checked)} |`
}

/** 표지 사이에 들어가는 목록 전체(표지 줄 제외) */
export function renderLedgerDoc(entries: ReadonlyArray<LedgerEntry> = LEDGER): string {
  const count = (pick: (entry: LedgerEntry) => boolean): number => entries.filter(pick).length
  const overlapOf = (entry: LedgerEntry): number => entry.measured?.overlap ?? 1
  const sensitive = entries
    .filter((entry) => entry.sensitivity === '민감')
    .sort((a, b) => overlapOf(a) - overlapOf(b))
    .map((entry) => `\`${entry.name}\`(${overlapOf(entry).toFixed(2)})`)
  return [
    `- 조정 상수 ${entries.length}개: 추정 ${count((e) => e.status === '추정')}, 실측 ${count((e) => e.status === '실측')}, 검증됨 ${count((e) => e.status === '검증됨')}.`,
    '- 추정은 게임의 실제 결과로 맞춰 본 적이 없다는 뜻이다. 실측은 세이브 자료에서 잰 값이고, 검증됨은 실제 결과와 대조까지 마친 값이다.',
    `- 민감도는 tests/sensitivity.test.ts가 시험 세이브 A에서 잰 값이다. 상수를 ±20%(숙련 감점 계수는 절반과 두 배) 바꿨을 때 영입 후보의 탭별 상위 10명이 그대로인 비율(겹침)을 재고, 가장 낮은 겹침과 그 탭, 바꾼 방향을 괄호에 적는다. 겹침이 ${SENSITIVE_BELOW} 미만이면 민감, 이상이면 보통이다.`,
    '- 탭 뒤의 (넓힘)은 영입 후보 화면의 "이 자리를 뛸 수 있는 선수만"을 끈 조건에서 가장 낮았다는 뜻이다. 변화 없음은 값을 바꿔도 이 세이브의 어느 목록도 바뀌지 않았다는 뜻이고, 미측정은 그 검사가 읽지 않아 재지 못한 상수다.',
    `- 민감한 상수 ${sensitive.length}개(겹침): ${sensitive.join(', ')}.`,
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
