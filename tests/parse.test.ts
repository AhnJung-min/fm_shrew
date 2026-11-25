import { describe, expect, it } from 'vitest'
import { decodeBytes, parseCell, parseExport } from '../src/shared/parse'
import { sampleSquadCsv } from '../src/shared/sample'

describe('parseCell', () => {
  it('일반 숫자를 읽는다', () => {
    expect(parseCell('14')).toEqual({ raw: '14', num: 14 })
  })
  it('쉼표 소수(별점)를 읽는다', () => {
    expect(parseCell('4,5').num).toBe(4.5)
  })
  it('범위는 중간값으로 읽고 범위를 남긴다', () => {
    expect(parseCell('12-15')).toEqual({ raw: '12-15', num: 13.5, range: [12, 15] })
  })
  it('빈 칸과 줄표는 값 없음으로 본다', () => {
    expect(parseCell('-').num).toBeNull()
    expect(parseCell('').num).toBeNull()
  })
  it('돈과 날짜는 숫자로 바꾸지 않는다', () => {
    expect(parseCell('₩12,000').num).toBeNull()
    expect(parseCell('2027.6.30').num).toBeNull()
  })
})

describe('실제 FM26 내보내기 형식', () => {
  it('한국어 금액을 원 단위로 읽는다', () => {
    expect(parseCell('주급 4.5억 원').num).toBe(450_000_000)
    expect(parseCell('주급 1,500만 원').num).toBe(15_000_000)
    expect(parseCell('950억 원 - 1,130억 원').num).toBe(104_000_000_000)
    expect(parseCell('7,000만 원 - 5.5억 원').num).toBe(310_000_000)
  })
  it('출전 기록은 선발과 교체를 더한다', () => {
    expect(parseCell('19 (2)').num).toBe(21)
  })
  it('플러그인이 내보낸 스쿼드 줄을 알아본다', () => {
    const csv = [
      '선발됨;상태;선수;포지션;종합 신체 컨디션;경기력;사기;출전 시간 만족도;최근 전적;경기;골;도움;평균;급료;몸값',
      'GK;관심;알리송 베케르;GK;94;100;;기쁨;;22;0;0;7.16;주급 4.5억 원;950억 원 - 1,130억 원',
      'D (R);경고;로날드 아라우호;D (RC), WB (R);86;100;;아주 행복함;;19 (2);0;1;6.90;주급 4억 원;460억 원 - 690억 원',
      '-;부상;프레디 우드먼;GK;-1;46;;만족한다;-;0;0;0;-;주급 3,750만 원;19억 원 - 29억 원'
    ].join('\r\n')
    const { columns, rows } = parseExport(csv, 'moneyball_export_20261125_235511.csv')
    expect(rows.map((r) => r.name)).toEqual(['알리송 베케르', '로날드 아라우호', '프레디 우드먼'])
    expect(columns.filter((c) => c.field === null).map((c) => c.header)).toEqual([])
    expect(columns.find((c) => c.header === '급료')).toMatchObject({ field: 'wage', numeric: true, isAttr: false })
    expect(columns.find((c) => c.header === '경기')).toMatchObject({ field: 'apps', numeric: true })
    // 컨디션·경기력은 1~20 능력치가 아니다
    expect(columns.some((c) => c.isAttr)).toBe(false)
  })
})

describe('parseExport', () => {
  it('세미콜론 CSV와 한국어 열 이름을 알아본다', () => {
    const { columns, rows } = parseExport(sampleSquadCsv(), 'player_export.csv')
    expect(rows.length).toBe(26)
    expect(columns.find((c) => c.header === '골 결정력')).toMatchObject({ field: 'finishing', isAttr: true })
    expect(columns.find((c) => c.header === '이름')?.field).toBe('name')
    expect(columns.find((c) => c.header === '현재 능력')).toMatchObject({ field: 'ability', isAttr: false })
    expect(columns.filter((c) => c.field === null)).toEqual([])
    expect(rows[0].name).not.toBe('')
  })

  it('영문 약어 열과 겹치는 약어(Nat, Pos)를 값으로 가른다', () => {
    const csv = ['Name,Position,Nat,Age,Pos,Nat,Fin', 'A. Player,ST (C),ENG,24,11,15,17', 'B. Player,D (C),KOR,29,16,12,6'].join('\n')
    const { columns } = parseExport(csv, 'view.csv')
    expect(columns.map((c) => c.field)).toEqual([
      'name',
      'position',
      'nationality',
      'age',
      'positioning',
      'naturalFitness',
      'finishing'
    ])
  })

  it('HTML 표도 읽는다', () => {
    const html =
      '<html><body><table><tr><th>이름</th><th>나이</th><th>패스</th></tr>' +
      '<tr><td>한지우</td><td>21</td><td>15</td></tr><tr><td>윤태성 &amp; Co</td><td>30</td><td>9</td></tr></table></body></html>'
    const { columns, rows } = parseExport(html, 'squad.html')
    expect(rows.map((r) => r.name)).toEqual(['한지우', '윤태성 & Co'])
    expect(columns[2]).toMatchObject({ field: 'passing', isAttr: true })
  })

  it('모르는 열은 그대로 두고, 직접 지정하면 따른다', () => {
    const csv = '이름;이상한열\n한지우;14\n윤태성;9'
    expect(parseExport(csv, 'a.csv').columns[1]).toMatchObject({ field: null, group: 'other' })
    expect(parseExport(csv, 'a.csv', { 이상한열: 'pace' }).columns[1]).toMatchObject({ field: 'pace', isAttr: true })
  })

  it('표가 없으면 이유를 알려 준다', () => {
    expect(() => parseExport('이름;나이', 'a.csv')).toThrow(/표를 찾지 못했습니다/)
  })
})

describe('decodeBytes', () => {
  it('BOM이 있는 UTF-8을 읽는다', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('이름;나이')])
    expect(decodeBytes(bytes)).toBe('이름;나이')
  })
})
