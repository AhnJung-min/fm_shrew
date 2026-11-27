import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { K, LEDGER, withLedger, type LedgerName } from '../src/shared/ledger'
import { LEDGER_DOC_BEGIN, LEDGER_DOC_END, renderLedgerDoc, replaceLedgerDoc } from '../src/shared/ledgerDoc'
import { posPenaltySigma } from '../src/shared/positions'

const SHARED = join(__dirname, '..', 'src', 'shared')
const SCORING_DOC = join(__dirname, '..', 'docs', 'scoring.md')

describe('상수 대장(F-07)', () => {
  it('항목마다 이름, 값, 단위, 상태, 근거, 마지막 확인, 민감도가 있다', () => {
    const names = new Set<string>()
    for (const entry of LEDGER) {
      expect(entry.name, entry.name).toMatch(/^[A-Z][A-Z0-9_]+$/)
      expect(names.has(entry.name), `이름 중복 ${entry.name}`).toBe(false)
      names.add(entry.name)
      expect(['추정', '실측', '검증됨'], entry.name).toContain(entry.status)
      expect(['민감', '보통', '미측정'], entry.name).toContain(entry.sensitivity)
      expect(entry.unit.length, entry.name).toBeGreaterThan(0)
      expect(entry.basis.length, entry.name).toBeGreaterThan(5)
      expect(entry.lastChecked.date, entry.name).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // 세이브는 파일이나 구단 이름이 아니라 중립 이름으로 적는다
      expect(entry.lastChecked.save, entry.name).toMatch(/^시험 세이브 [A-Z]$/)
      expect(JSON.stringify(entry.value).match(/null|NaN|Infinity/), entry.name).toBeNull()
    }
    expect(LEDGER.length).toBeGreaterThan(100)
  })

  it('민감 표시는 문서가 알려 준 상수에만 있다: 숙련 감점 계수, 로테이션 경계, 성장 몫', () => {
    const sensitive = LEDGER.filter((entry) => entry.sensitivity === '민감').map((entry) => entry.name).sort()
    expect(sensitive).toEqual(
      [
        'PENALTY_ACCOMPLISHED_PER_POINT',
        'PENALTY_AWKWARD_BASE',
        'PENALTY_AWKWARD_PER_POINT',
        'PENALTY_POOR_BASE',
        'PENALTY_POOR_PER_POINT',
        'STARTER_TOLERANCE_SIGMAS',
        'CA_GATE',
        'GROWTH_SHARE_TABLE',
        'GROWTH_SHARE_TABLE_GOALKEEPER'
      ].sort()
    )
  })

  it('지금 값(K)은 기본값과 같고, 기본값 자체와는 따로 복사되어 있다', () => {
    for (const entry of LEDGER) expect(K[entry.name], entry.name).toEqual(entry.value)
    expect(K.GROWTH_SHARE_TABLE).not.toBe(LEDGER.find((entry) => entry.name === 'GROWTH_SHARE_TABLE')!.value)
  })
})

describe('withLedger: 파일을 고치지 않고 값을 잠깐 바꾼다(F-11 준비)', () => {
  it('바꾼 값이 계산에 반영되고, 끝나면 되돌린다', () => {
    expect(posPenaltySigma(15)).toBeCloseTo(0.4, 10)
    const inside = withLedger({ PENALTY_ACCOMPLISHED_PER_POINT: 0.16 }, () => posPenaltySigma(15))
    expect(inside).toBeCloseTo(0.8, 10)
    expect(posPenaltySigma(15)).toBeCloseTo(0.4, 10)
    expect(K.PENALTY_ACCOMPLISHED_PER_POINT).toBe(0.08)
  })

  it('예외가 나도 되돌리고, 안쪽 호출은 바깥 값으로 되돌아온다', () => {
    expect(() =>
      withLedger({ CA_GATE: 0.5 }, () => {
        throw new Error('중간에 실패')
      })
    ).toThrow('중간에 실패')
    expect(K.CA_GATE).toBe(0.85)
    withLedger({ CA_GATE: 0.5 }, () => {
      withLedger({ CA_GATE: 0.7, TIER_MIN_TOTAL: 50 }, () => {
        expect([K.CA_GATE, K.TIER_MIN_TOTAL]).toEqual([0.7, 50])
      })
      expect([K.CA_GATE, K.TIER_MIN_TOTAL]).toEqual([0.5, 60])
    })
    expect([K.CA_GATE, K.TIER_MIN_TOTAL]).toEqual([0.85, 60])
  })

  it('표 값도 바꿀 수 있고, 비동기 작업이 끝나야 되돌린다', async () => {
    const half = K.GROWTH_SHARE_TABLE.map(([age, share]): [number, number] => [age, share / 2])
    const during = await withLedger({ GROWTH_SHARE_TABLE: half }, async () => {
      await Promise.resolve()
      return K.GROWTH_SHARE_TABLE[0][1]
    })
    expect(during).toBeCloseTo(0.39, 10)
    expect(K.GROWTH_SHARE_TABLE[0][1]).toBe(0.78)
  })
})

/**
 * 수식 모듈(src/shared)에 대장 밖의 조정 상수가 없다는 검사.
 * 맨 윗줄의 `const 이름 = 숫자·숫자 배열·숫자 표`와, 안쪽의 대문자 이름 숫자 상수를 찾는다.
 * 조정 상수가 아닌 것(구조)은 아래 목록에 이유와 함께 적는다. 목록에 없는 것이 걸리면 대장(ledger.ts)으로 옮긴다.
 */
const STRUCTURAL: Record<string, string> = {
  'positions.ts:POSITION_NATURAL': '게임 숙련 척도의 최대값(20). 척도 자체라 조정 대상이 아니다',
  'depth.ts:PLAYABLE_BONUS': '주전 배정(헝가리안 방법)의 뼈대 값: 뛸 수 있는 쌍의 가중치를 언제나 양수로 만든다. 임시 주전 값(TEMPORARY_BONUS)이 이보다 낮다는 관계만 중요하다',
  'depth.ts:TIE_BREAK': '동점일 때 선수 번호 순으로 가르는 아주 작은 값(알고리즘 뼈대)',
  'tactic.ts:DAY_MS': '하루의 밀리초(단위 변환)',
  'tactic.ts:MAX_OPTIONS': '전술판 한 자리에서 보여 주는 내 선수 수(화면 줄 수, 점수에 영향 없음)',
  'insights.ts:CORE_COUNT': '진단 카드가 보여 주는 핵심 전력 인원(화면 줄 수)',
  'insights.ts:MAX_LINES': '진단 카드마다 이름을 보여 주는 최대 줄 수(화면 줄 수)',
  'dashboard.ts:OVERPAID_SHOWN': '주급 과다 의심 목록에 보여 주는 인원(화면 줄 수)',
  'dashboard.ts:SURPLUS_SHOWN': '정리 후보·임대 유망주 목록에 보여 주는 인원(화면 줄 수)',
  'dashboard.ts:WAGE_CA_CENTER': '로그 주급 모델의 열 눈금(현재 능력 기준점). 식을 다시 매개화할 뿐이라 값을 바꿔도 적합 결과가 같다',
  'dashboard.ts:WAGE_CA_QUAD_SCALE': '로그 주급 모델의 2차항 눈금. 위와 같다',
  'club.ts:HEALTH_PER_REQUEST': '게임 플러그인이 한 번에 받는 선수 수(플러그인 PersonInfo.MaxPeople. 통신 규격)',
  'korean.ts:HANGUL_FIRST': '한글 음절 유니코드 범위',
  'korean.ts:HANGUL_LAST': '한글 음절 유니코드 범위',
  'korean.ts:FINALS': '한글 받침 개수',
  'playerView.ts:WON_PER_POUND': '화면에 원화로 바꿔 보여 주는 환율(표시용 환산, 점수에 쓰이지 않는다)',
  'recommend.ts:IMPORTANT_STATUS': '계약상 입지 코드의 분류(코드 번호의 뜻이라 조정 대상이 아니다)',
  'recommend.ts:REALISM_STATUS': '계약상 입지 코드의 분류(핵심 선수 1, 중요 선수 2)'
}

interface Found {
  file: string
  name: string
  init: string
}

const STRINGS = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g
const bracketDepth = (text: string): number => {
  const bare = text.replace(STRINGS, '').replace(/\/\/.*$/, '')
  return (bare.match(/[([{]/g)?.length ?? 0) - (bare.match(/[)\]}]/g)?.length ?? 0)
}

/** 맨 윗줄에서 시작하는 const 선언과 그 초기값 글 */
function topLevelConstants(file: string, source: string): Found[] {
  const lines = source.split('\n')
  const found: Found[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = /^(?:export )?const ([A-Za-z_$][\w$]*)(?:\s*:\s*[^=]+?)?\s*=\s*(.*)$/.exec(lines[i])
    if (!match) continue
    let init = match[2]
    let depth = bracketDepth(init)
    let end = i
    while ((depth > 0 || init.trim() === '' || /[-+*/=,&|?:]\s*$/.test(init)) && end + 1 < lines.length) {
      end++
      init += `\n${lines[end]}`
      depth = bracketDepth(init)
    }
    found.push({ file, name: match[1], init })
    i = end
  }
  return found
}

/** 숫자 상수 표(숫자, 숫자 배열, 숫자 값 표, 숫자 집합)인가 */
function isNumericTable(init: string): boolean {
  const code = init
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\bas\s+(?:const|readonly\s+\w+\[\]|[A-Za-z<>\[\], ]+)\s*$/g, '')
    .replace(/new (?:Set|Map)(?:<[^>]*>)?\(/g, '(')
  if (code.trimStart().startsWith('/')) return false // 정규식 글자
  if (/['"`]/.test(code)) return false
  if (/=>|\bfunction\b/.test(code)) return false
  if (/[A-Za-z_$][\w$.]*\s*(?:<[^>]*>)?\s*\(/.test(code)) return false
  return /(?<![\w.$])(?:0x[0-9a-f_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)(?![\w$])/i.test(code)
}

function sharedFiles(): string[] {
  return readdirSync(SHARED).filter((name) => name.endsWith('.ts') && name !== 'ledger.ts')
}

describe('수식 모듈에 대장 밖의 조정 상수가 없다(F-07)', () => {
  it('src/shared의 숫자 상수는 대장에 있거나 구조 목록(이유 포함)에 있다', () => {
    const outside: string[] = []
    for (const file of sharedFiles()) {
      const source = readFileSync(join(SHARED, file), 'utf8')
      for (const found of topLevelConstants(file, source)) {
        if (isNumericTable(found.init) && !(`${file}:${found.name}` in STRUCTURAL)) outside.push(`${file}:${found.name} = ${found.init.replace(/\s+/g, ' ').slice(0, 60)}`)
      }
      // 함수 안의 대문자 이름 숫자 상수도 같다
      source.split('\n').forEach((line, i) => {
        const local = /^\s+(?:const|let) ([A-Z][A-Z0-9_]{2,})\s*(?::[^=]+)?=\s*[-+]?(?:\d|\.\d)/.exec(line)
        if (local && !(`${file}:${local[1]}` in STRUCTURAL)) outside.push(`${file}:${i + 1} ${local[1]}`)
      })
    }
    expect(outside, '대장(src/shared/ledger.ts)으로 옮기거나, 조정 상수가 아니면 이 파일의 STRUCTURAL에 이유와 함께 적는다').toEqual([])
  })

  it('구조 목록에 낡은 항목이 없다(적힌 상수가 실제로 있고 숫자 상수다)', () => {
    const present = new Set<string>()
    for (const file of sharedFiles()) {
      for (const found of topLevelConstants(file, readFileSync(join(SHARED, file), 'utf8'))) if (isNumericTable(found.init)) present.add(`${file}:${found.name}`)
    }
    expect(Object.keys(STRUCTURAL).filter((key) => !present.has(key))).toEqual([])
    for (const [key, reason] of Object.entries(STRUCTURAL)) expect(reason.length, key).toBeGreaterThan(5)
  })

  it('검사가 실제로 잡는다: 대장 밖에 숫자 상수를 두면 걸린다', () => {
    const sample = ['export const MY_LIMIT = 12', 'const TABLE: Record<string, number> = {', '  a: 1,', '  b: 2', '}', "const LABEL = '12'", 'const f = (x: number) => x * 3', 'export const SET: ReadonlySet<number> = new Set([1, 2])']
    const found = topLevelConstants('x.ts', sample.join('\n'))
    expect(found.filter((each) => isNumericTable(each.init)).map((each) => each.name)).toEqual(['MY_LIMIT', 'TABLE', 'SET'])
  })

  it('대장에 옮긴 상수가 다른 모듈에 이름만 남아 값을 복사해 두지 않았다', () => {
    // 같은 이름의 export const가 대장 밖에 또 있으면 값이 둘이 된다
    const ledgerNames = new Set<string>(LEDGER.map((entry) => entry.name as LedgerName))
    const copies: string[] = []
    for (const file of sharedFiles()) {
      for (const found of topLevelConstants(file, readFileSync(join(SHARED, file), 'utf8'))) if (ledgerNames.has(found.name)) copies.push(`${file}:${found.name}`)
    }
    expect(copies).toEqual([])
  })
})

describe('문서의 상수 목록이 대장과 맞다(N-06)', () => {
  it('docs/scoring.md의 표는 대장에서 만든 것과 같다(UPDATE_LEDGER_DOC=1이면 다시 쓴다. npm run docs:ledger)', () => {
    const doc = readFileSync(SCORING_DOC, 'utf8')
    expect(doc.includes(LEDGER_DOC_BEGIN), '문서에 시작 표지가 없다').toBe(true)
    expect(doc.includes(LEDGER_DOC_END), '문서에 끝 표지가 없다').toBe(true)
    if (process.env.UPDATE_LEDGER_DOC) {
      const next = replaceLedgerDoc(doc)
      expect(next).not.toBeNull()
      if (next !== doc) writeFileSync(SCORING_DOC, next!)
      return
    }
    const begin = doc.indexOf(LEDGER_DOC_BEGIN) + LEDGER_DOC_BEGIN.length
    const written = doc.slice(begin, doc.indexOf(LEDGER_DOC_END)).trim()
    expect(written, '문서의 상수 목록이 대장과 다르다. npm run docs:ledger로 다시 만든다').toBe(renderLedgerDoc().trim())
  })

  it('목록에는 대장의 모든 항목이 한 줄씩 있고, 값이 같다', () => {
    const rendered = renderLedgerDoc()
    for (const entry of LEDGER) expect(rendered, entry.name).toContain(`| \`${entry.name}\` |`)
    expect(renderLedgerDoc().split('\n').filter((line) => line.startsWith('| `')).length).toBe(LEDGER.length)
    expect(rendered).toContain('| `PENALTY_ACCOMPLISHED_PER_POINT` | 0.08 |')
  })
})
