import { describe, expect, it } from 'vitest'
import {
  ageCard,
  buildInsights,
  coreCard,
  dateFromNumber,
  expiringCard,
  insightPlayers,
  growthRoomCard,
  type InsightPlayer
} from '../src/shared/insights'
import { contractWindows, firstTeamPlayers, type FirstTeamPlayer } from '../src/shared/dashboard'
import type { ColumnInfo, PlayerRow } from '../src/shared/types'

const player = (idx: number, patch: Partial<InsightPlayer> = {}): InsightPlayer => ({
  idx,
  name: `선수${idx}`,
  position: 'M (C)',
  age: 25,
  ca: 100,
  pa: 100,
  contractEnd: null,
  wage: '',
  ...patch
})

const today = { year: 2026, month: 7, day: 1 }

describe('dateFromNumber', () => {
  it('20270630 꼴의 수를 날짜로 바꾼다', () => {
    expect(dateFromNumber(20270630)).toEqual({ year: 2027, month: 6, day: 30 })
    expect(dateFromNumber(null)).toBeNull()
    expect(dateFromNumber(0)).toBeNull()
    expect(dateFromNumber(20271340)).toBeNull()
  })
})

describe('나이 구성', () => {
  it('나이대별 인원과 평균을 센다', () => {
    const card = ageCard([player(1, { age: 19 }), player(2, { age: 21 }), player(3, { age: 24 }), player(4, { age: 28 }), player(5, { age: 33 }), player(6, { age: 31 })], true)
    expect(card.bars?.map((bar) => bar.count)).toEqual([2, 1, 1, 2])
    expect(card.finding).toContain('평균 나이는 26.0세')
    expect(card.lines.map((line) => line.idx)).toEqual([5, 6])
  })
  it('나이를 읽지 못한 선수는 세지 않고 그렇게 적는다', () => {
    const card = ageCard([player(1, { age: 20 }), player(2, { age: null })], true)
    expect(card.note).toContain('1명')
  })
  it('나이 열이 없으면 자료 없음', () => {
    expect(ageCard([player(1)], false).tone).toBe('missing')
  })
})

describe('성장 기대주', () => {
  it('23세 이하 가운데 잠재와 현재의 차이가 큰 순으로 세 명', () => {
    const card = growthRoomCard(
      [
        player(1, { age: 18, ca: 90, pa: 150 }),
        player(2, { age: 20, ca: 100, pa: 130 }),
        player(3, { age: 22, ca: 120, pa: 190 }),
        player(4, { age: 23, ca: 110, pa: 125 }),
        player(5, { age: 24, ca: 80, pa: 200 }),
        player(6, { age: 19, ca: 100, pa: 100 })
      ],
      true
    )
    expect(card.lines.map((line) => line.idx)).toEqual([3, 1, 2])
    expect(card.more).toBe(1)
    expect(card.lines[0].detail).toContain('+70')
  })
  it('어린 선수가 없거나 클 여지가 없으면 그렇게 적는다', () => {
    expect(growthRoomCard([player(1, { age: 30 })], true).finding).toContain('23세 이하 선수가 없습니다')
    expect(growthRoomCard([player(1, { age: 20, ca: 100, pa: 100 })], true).lines).toEqual([])
  })
  it('잠재 능력 열이 없으면 자료 없음', () => {
    expect(growthRoomCard([player(1)], false).tone).toBe('missing')
  })
})

describe('핵심 전력', () => {
  it('현재 능력 상위 다섯 명', () => {
    const players = [90, 140, 120, 100, 150, 130, 80].map((ca, i) => player(i + 1, { ca }))
    const card = coreCard(players, true)
    expect(card.lines.map((line) => line.idx)).toEqual([5, 2, 6, 3, 4])
    expect(card.finding).toContain('1위 150')
  })
})

describe('계약 만료 임박', () => {
  const end = (year: number, month: number, day: number) => ({ year, month, day })

  it('12개월 안에 끝나는 계약만 빠른 순으로 센다', () => {
    const card = expiringCard(
      [
        player(1, { contractEnd: end(2027, 6, 30), wage: '£120K' }),
        player(2, { contractEnd: end(2026, 7, 20) }),
        player(3, { contractEnd: end(2027, 7, 1) }),
        player(4, { contractEnd: end(2027, 7, 2) }),
        player(5, { contractEnd: end(2026, 6, 30) }),
        player(6, { contractEnd: end(2029, 6, 30) })
      ],
      today,
      true
    )
    expect(card.lines.map((line) => line.idx)).toEqual([2, 1, 3])
    expect(card.finding).toContain('3명')
    expect(card.lines[0].detail).toContain('19일 남음')
    expect(card.lines[1].detail).toContain('£120K')
    expect(card.tone).toBe('attention')
  })
  it('읽지 못한 선수 수를 밝힌다', () => {
    const card = expiringCard([player(1, { contractEnd: end(2030, 6, 30) }), player(2)], today, true)
    expect(card.finding).toContain('없습니다')
    expect(card.note).toContain('1명')
  })
  it('오늘 날짜나 만료일 열이 없으면 짐작하지 않는다', () => {
    expect(expiringCard([player(1, { contractEnd: end(2027, 1, 1) })], undefined, true).tone).toBe('missing')
    expect(expiringCard([player(1)], today, false).tone).toBe('missing')
    expect(expiringCard([player(1)], today, true).tone).toBe('missing')
  })
  it('한 줄에 다 못 담는 선수는 외 N명으로 센다', () => {
    const many = Array.from({ length: 8 }, (_, i) => player(i + 1, { contractEnd: end(2026, 8, i + 1) }))
    const card = expiringCard(many, today, true)
    expect(card.lines).toHaveLength(5)
    expect(card.more).toBe(3)
  })
})

describe('표에서 뽑기', () => {
  const columns: ColumnInfo[] = [
    ['이름', 'name'],
    ['포지션', 'position'],
    ['나이', 'age'],
    ['현재 능력', 'ability'],
    ['잠재 능력', 'potential'],
    ['계약 만료', 'contractEnd'],
    ['주급', 'wage']
  ].map(([header, field]) => ({ header, field, group: 'info', short: header, label: header, isAttr: false, numeric: true }))
  const rows: PlayerRow[] = [
    {
      idx: 7,
      name: '가나',
      cells: {
        이름: { raw: '가나', num: null },
        포지션: { raw: 'ST (C)', num: null },
        나이: { raw: '20', num: 20 },
        '현재 능력': { raw: '110', num: 110 },
        '잠재 능력': { raw: '150', num: 150 },
        '계약 만료': { raw: '2026.12.31', num: 20261231 },
        주급: { raw: '£90K', num: 90000 }
      }
    },
    { idx: 8, name: '다라', cells: { 이름: { raw: '다라', num: null }, '계약 만료': { raw: '', num: null } } }
  ]

  it('열 이름이 아니라 항목으로 값을 찾는다', () => {
    const { players, has } = insightPlayers(rows, columns)
    expect(players[0]).toMatchObject({ idx: 7, age: 20, ca: 110, pa: 150, wage: '£90K', contractEnd: { year: 2026, month: 12, day: 31 } })
    expect(players[1]).toMatchObject({ age: null, ca: null, contractEnd: null })
    expect(has).toEqual({ age: true, ability: true, potential: true, contract: true })
  })
  it('F-08. 임대로 온 선수는 대시보드처럼 임대 끝 날짜로 센다(원 소속과 맺은 계약일과 주급은 쓰지 않는다)', () => {
    const today2 = { year: 2026, month: 7, day: 1 }
    const loaned: PlayerRow = { ...rows[0], idx: 9, name: '임대생', loan: { end: { year: 2027, month: 6, day: 30 }, from: '가상 FC' } }
    const all = [...rows, loaned]
    const card = expiringCard(insightPlayers(all, columns).players, today2, true)
    const dashboard = contractWindows(firstTeamPlayers(all, columns), today2)
    expect(card.lines.map((line) => line.idx)).toEqual(dashboard.within1y.map((row) => row.uid))
    expect(card.lines.find((line) => line.idx === 9)?.detail).toContain('임대 복귀(추정)')
    expect(card.lines.find((line) => line.idx === 9)?.detail).not.toContain('주급')
  })
  it('카드 다섯 장을 만든다', () => {
    const cards = buildInsights({ rows, columns, today }, null, '4-4-2')
    expect(cards.map((card) => card.id)).toEqual(['depth', 'expiring', 'prospects', 'core', 'age'])
    expect(cards[0].tone).toBe('missing')
    expect(cards[1].lines[0].idx).toBe(7)
  })
})

describe('F-08 정의 통일', () => {
  const end = (year: number, month: number, day: number) => ({ year, month, day })
  const asDashboard = (p: InsightPlayer): FirstTeamPlayer => ({ uid: p.idx, name: p.name, age: p.age, position: p.position, ca: p.ca, pa: p.pa, wage: null, contractEnd: p.contractEnd })

  it('1. "12개월"은 365일이다: 같은 입력에 대시보드 계약 카드와 진단 카드가 같은 선수를 센다', () => {
    // 오늘 2027-07-01에서 달력으로 12개월 뒤(2028-07-01)는 2028년 2월 29일 때문에 366일 뒤다. 예전 진단 카드는 달력으로 세어 이 선수를 포함했다
    const today2 = end(2027, 7, 1)
    const players = [
      player(1, { contractEnd: end(2027, 6, 30) }), // 이미 끝남: 둘 다 뺀다
      player(2, { contractEnd: end(2027, 7, 1) }), // 오늘 끝남(0일): 둘 다 센다
      player(3, { contractEnd: end(2028, 6, 30) }), // 365일: 둘 다 센다
      player(4, { contractEnd: end(2028, 7, 1) }), // 366일: 둘 다 뺀다
      player(5, { contractEnd: end(2027, 12, 31) }),
      player(6, { contractEnd: end(2030, 6, 30) }),
      player(7)
    ]
    const card = expiringCard(players, today2, true)
    const dashboard = contractWindows(players.map(asDashboard), today2)
    expect(card.lines.map((line) => line.idx)).toEqual([2, 5, 3])
    expect(card.more).toBe(0)
    expect(dashboard.within1y.map((row) => row.uid)).toEqual([2, 5, 3])
    expect(card.finding).toContain('3명')
    expect(dashboard.expired.map((row) => row.uid)).toEqual([1])
  })

  it('1. 오늘부터 윤년 2월을 지나도 두 카드가 같다(2028-01-15의 365일 뒤는 2029-01-14, 달력 12개월 뒤는 2029-01-15)', () => {
    const today2 = end(2028, 1, 15)
    const players = [player(1, { contractEnd: end(2029, 1, 14) }), player(2, { contractEnd: end(2029, 1, 15) }), player(3, { contractEnd: end(2028, 12, 15) })]
    const card = expiringCard(players, today2, true)
    const dashboard = contractWindows(players.map(asDashboard), today2)
    expect(card.lines.map((line) => line.idx)).toEqual(dashboard.within1y.map((row) => row.uid))
    expect(dashboard.within1y.map((row) => row.uid)).toEqual([3, 1])
  })

  it('2. "유망주"는 ③의 자격에만 쓴다: 진단 카드의 글에는 나오지 않고 이름은 "성장 여지"다', () => {
    const young = [player(1, { age: 18, ca: 90, pa: 150 }), player(2, { age: 20, ca: 100, pa: 130 })]
    const cards = [
      growthRoomCard(young, true),
      growthRoomCard([player(1, { age: 30 })], true),
      growthRoomCard([player(1, { age: 20, ca: 100, pa: 100 })], true),
      growthRoomCard(young, false)
    ]
    expect(cards[0].id).toBe('prospects')
    expect(cards[0].title).toBe('성장 여지')
    for (const card of cards) {
      const text = [card.title, card.finding, card.linesTitle ?? '', card.note ?? '', ...card.lines.map((line) => `${line.name} ${line.detail}`)].join(' ')
      expect(text).not.toContain('유망주')
      expect(text).not.toContain('기대주')
    }
  })
})
