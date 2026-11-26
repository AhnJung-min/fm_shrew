import { describe, expect, it } from 'vitest'
import {
  buildSnapshot,
  cleanText,
  facilitiesOf,
  financesOf,
  levelOf,
  numberOf,
  parsePluginAnswer,
  percentOf,
  playerHealthOf,
  poundsText,
  profileOf,
  squadReport,
  suspensionOf,
  yesNo,
  type GameFields,
  type RosterPlayer
} from '../src/shared/club'

const player = (uid: number, name = `선수${uid}`): RosterPlayer => ({ uid, name, position: 'ST' })

describe('글자 읽기', () => {
  it('꼬리표를 떼고, 비었거나 줄표뿐이면 null', () => {
    expect(cleanText(' <b>우수</b> ')).toBe('우수')
    expect(cleanText('-')).toBeNull()
    expect(cleanText('')).toBeNull()
    expect(cleanText(undefined)).toBeNull()
    expect(cleanText(0)).toBe('0')
  })

  it('숫자와 단위를 읽는다', () => {
    expect(numberOf('1,234')).toBe(1234)
    expect(numberOf('£1.2M')).toBe(1_200_000)
    expect(numberOf('€650K')).toBe(650_000)
    expect(numberOf('92%')).toBe(92)
    expect(numberOf('6.85')).toBe(6.85)
    expect(numberOf('3 Months')).toBe(3)
    expect(numberOf('우수')).toBeNull()
    expect(numberOf('-')).toBeNull()
  })

  it('참 거짓', () => {
    expect(yesNo('True')).toBe(true)
    expect(yesNo('false')).toBe(false)
    expect(yesNo('기타')).toBeNull()
    expect(yesNo(undefined)).toBeNull()
  })

  it('컨디션은 %가 적혀 있으면 그것을, 아니면 만 분율로 본다', () => {
    expect(percentOf('9873', '99%')).toBe(99)
    expect(percentOf('9873')).toBe(99)
    expect(percentOf('87')).toBe(87)
    expect(percentOf('0.62')).toBe(62)
    expect(percentOf('12000')).toBe(100)
    expect(percentOf(undefined, undefined)).toBeNull()
  })

  it('금액을 짧게', () => {
    expect(poundsText(3_200_000)).toBe('£3.2M')
    expect(poundsText(45_000_000)).toBe('£45M')
    expect(poundsText(62_000)).toBe('£62K')
    expect(poundsText(-1_500_000)).toBe('-£1.5M')
  })

  it('별 숫자를 막대 길이로', () => {
    expect(levelOf('4')).toEqual({ value: 4, max: 5 })
    expect(levelOf('7')).toEqual({ value: 7, max: 10 })
    expect(levelOf('15')).toEqual({ value: 15, max: 20 })
    expect(levelOf('150')).toBeNull()
    expect(levelOf('우수')).toBeNull()
  })
})

describe('플러그인 응답', () => {
  it('기록과 경로를 읽는다', () => {
    const answer = parsePluginAnswer('{"records":[{"team":3,"name":"가"}],"paths":{"name":"Name"},"skipped":["Stadium.Name"]}')
    expect(answer?.records[0].name).toBe('가')
    expect(answer?.paths.name).toBe('Name')
    expect(answer?.skipped).toEqual(['Stadium.Name'])
  })

  it('깨진 응답은 null', () => {
    expect(parsePluginAnswer('not json')).toBeNull()
    expect(parsePluginAnswer('{"foo":1}')).toBeNull()
    expect(parsePluginAnswer('[]')).toBeNull()
  })
})

describe('구단', () => {
  it('프로필: 읽지 못한 값은 null', () => {
    const profile = profileOf({ name: '한강 유나이티드', division: '1부 리그', founded: '1946' })
    expect(profile.division).toBe('1부 리그')
    expect(profile.founded).toBe('1946')
    expect(profile.stadium).toBeNull()
    expect(profileOf(null).division).toBeNull()
  })

  it('시설: 별이 있으면 막대, 글자가 숫자면 그것도 막대, 없으면 null', () => {
    const items = facilitiesOf({ training: '우수', trainingStars: '4', youthCoaching: '12', youthRecruitment: '평균' })
    expect(items).toHaveLength(4)
    expect(items[0]).toMatchObject({ id: 'training', text: '우수', level: { value: 4, max: 5 } })
    expect(items[1]).toMatchObject({ id: 'youthFacilities', text: null, level: null })
    expect(items[2]).toMatchObject({ id: 'youthCoaching', text: '12', level: { value: 12, max: 20 } })
    expect(items[3]).toMatchObject({ id: 'youthRecruitment', text: '평균', level: null })
  })

  it('재정: 게임이 준 글자를 먼저, 숫자만 있으면 파운드로 적는다', () => {
    const items = financesOf({ transferBudget: '3200000', wageBudget: '€1.5M', wageSpend: '1388000', wageSpendText: '€1.39M', balance: '-2500000', balanceStatus: '위험' })
    const by = Object.fromEntries(items.map((item) => [item.id, item]))
    expect(by.transferBudget).toMatchObject({ text: '£3.2M', converted: true, sort: 3_200_000 })
    expect(by.wageBudget).toMatchObject({ text: '€1.5M', converted: false, sort: 1_500_000 })
    expect(by.wageSpend).toMatchObject({ text: '€1.39M', converted: false })
    expect(by.wageRemaining).toMatchObject({ text: null, sort: null })
    expect(by.balance).toMatchObject({ text: '-£2.5M', note: '위험' })
  })
})

describe('징계', () => {
  it('남은 경기 수가 있으면 그것으로 판단한다', () => {
    expect(suspensionOf({ banLeft: '0', banReason: '레드카드' }).suspended).toBe(false)
    expect(suspensionOf({ banLeft: '2', banReason: '레드카드' })).toEqual({ suspended: true, text: '레드카드 · 2경기 남음' })
  })

  it('남은 경기 수를 모르면 사유 글자로 판단하되 "없음"은 징계가 아니다', () => {
    expect(suspensionOf({ banReason: '경고 누적' })).toEqual({ suspended: true, text: '경고 누적' })
    expect(suspensionOf({ banReason: 'None' }).suspended).toBe(false)
    expect(suspensionOf({}).suspended).toBe(false)
  })
})

describe('선수 상태', () => {
  it('부상 선수: 이름과 복귀 시기', () => {
    const health = playerHealthOf(player(1), { injured: 'True', injuryName: '햄스트링 염좌', injuryDuration: '3주', injuryDays: '21' })
    expect(health).toMatchObject({ read: true, injured: true, injury: '햄스트링 염좌', injuryReturn: '3주', injuryDays: 21 })
  })

  it('부상 이름이 없고 일수만 있으면 일수로 적는다', () => {
    const health = playerHealthOf(player(1), { injured: 'True', injuryDays: '10' })
    expect(health.injury).toBeNull()
    expect(health.injuryReturn).toBe('10일')
  })

  it('IsInjured가 False면 남아 있는 부상 글자는 무시한다', () => {
    const health = playerHealthOf(player(1), { injured: 'False', injuryName: '지난 부상' })
    expect(health.injured).toBe(false)
    expect(health.injury).toBeNull()
  })

  it('IsInjured를 모르면 부상 이름이 있는지로 본다', () => {
    expect(playerHealthOf(player(1), { injuryName: '발목' }).injured).toBe(true)
    expect(playerHealthOf(player(1), { age: '24' }).injured).toBe(false)
  })

  it('컨디션·감각·평점', () => {
    const health = playerHealthOf(player(1), {
      condition: '8450',
      conditionText: '84%',
      sharpness: '7000',
      morale: '14',
      moraleText: '좋음',
      appearances: '12',
      rating: '7.12',
      lastRating: '6.8'
    })
    expect(health).toMatchObject({ condition: 84, sharpness: 70, morale: 14, moraleText: '좋음', appearances: 12, rating: 7.12, lastRating: 6.8 })
  })

  it('게임이 답하지 않은 선수는 read가 false이고 모두 비어 있다', () => {
    const health = playerHealthOf(player(9), undefined)
    expect(health.read).toBe(false)
    expect(health.condition).toBeNull()
  })

  it('평점 0은 아직 뛰지 않은 것으로 본다', () => {
    expect(playerHealthOf(player(1), { rating: '0', appearances: '0' }).rating).toBeNull()
  })
})

describe('선수단 요약', () => {
  const make = (uid: number, fields: GameFields) => playerHealthOf(player(uid), { age: '25', ...fields })

  it('부상은 오래 걸리는 순, 징계와 낮은 컨디션을 모은다', () => {
    const players = [
      make(1, { injured: 'True', injuryName: '가', injuryDays: '10' }),
      make(2, { injured: 'True', injuryName: '나', injuryDays: '40' }),
      make(3, { condition: '7000', sharpness: '9000' }),
      make(4, { condition: '9500', sharpness: '6000' }),
      make(5, { banLeft: '1', banReason: '퇴장' })
    ]
    const report = squadReport(players)
    expect(report.injured.map((each) => each.uid)).toEqual([2, 1])
    expect(report.suspended.map((each) => each.uid)).toEqual([5])
    expect(report.lowCondition.map((each) => each.uid)).toEqual([3])
    expect(report.lowSharpness.map((each) => each.uid)).toEqual([4])
    expect(report.answered).toBe(5)
  })

  it('부상 중인 선수는 컨디션이 낮은 목록에 넣지 않는다', () => {
    const report = squadReport([make(1, { injured: 'True', condition: '5000' })])
    expect(report.lowCondition).toEqual([])
  })

  it('평점은 충분히 뛴 선수만 비교하고, 선수가 적으면 보여 주지 않는다', () => {
    const few = squadReport([make(1, { rating: '7.5', appearances: '10' }), make(2, { rating: '6.0', appearances: '10' })])
    expect(few.bestForm).toEqual([])
    const many = squadReport(
      [7.9, 7.4, 7.1, 6.9, 6.5, 6.1, 5.8].map((rating, i) => make(i + 1, { rating: String(rating), appearances: '10' })).concat(make(99, { rating: '9.9', appearances: '1' }))
    )
    expect(many.bestForm.map((each) => each.uid)).toEqual([1, 2, 3])
    expect(many.worstForm.map((each) => each.uid)).toEqual([7, 6, 5])
  })

  it('사기는 값을 읽은 선수가 네 명 이상일 때 낮은 세 명', () => {
    const three = squadReport([1, 2, 3].map((uid) => make(uid, { morale: String(uid) })))
    expect(three.lowMorale).toEqual([])
    const four = squadReport([4, 2, 9, 6].map((morale, i) => make(i + 1, { morale: String(morale) })))
    expect(four.lowMorale.map((each) => each.morale)).toEqual([2, 4, 6])
  })
})

describe('buildSnapshot', () => {
  it('구단 값과 선수 상태를 한데 묶는다', () => {
    const snapshot = buildSnapshot({
      club: { records: [{ team: 5, name: '한강 유나이티드', division: '1부', transferBudget: '2000000' }], paths: { division: 'Division.Name' }, skipped: [] },
      health: { records: [{ uid: 1, injured: 'True', injuryName: '발목' }], paths: { injured: 'IsInjured' }, skipped: [] },
      roster: [player(1), player(2)],
      readAt: '2026-11-27T10:00:00.000Z'
    })
    expect(snapshot.ok).toBe(true)
    expect(snapshot.profile?.division).toBe('1부')
    expect(snapshot.finances[0].text).toBe('£2.0M')
    expect(snapshot.players).toHaveLength(2)
    expect(snapshot.players[0].injured).toBe(true)
    expect(snapshot.players[1].read).toBe(false)
    expect(snapshot.report?.answered).toBe(1)
    expect(snapshot.paths).toEqual({ division: 'Division.Name', injured: 'IsInjured' })
  })
})
