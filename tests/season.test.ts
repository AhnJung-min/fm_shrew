import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { constants, zstdCompressSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { openContainer } from '../src/main/save/container'
import { kickOffTime, readFixtures } from '../src/main/save/fixtures'
import { findLeagueTable } from '../src/main/save/leagueTable'
import { decodeSeason, readSeason, spanFrames } from '../src/main/save/season'
import type { SaveWorld } from '../src/main/save/world'
import { leagueStage, SeasonService } from '../src/main/seasonService'

/* ---------- 만들어 쓰는 세이브 조각 (모두 지어낸 값) ---------- */

const TODAY = { year: 2026, day: 3 }
const SIGNATURE = Buffer.from([0x02, 0x01, 0x66, 0x6d, 0x66, 0x2e, 0x08, 0x00, 0x00])
const pack = (data: Buffer): Buffer => zstdCompressSync(data, { params: { [constants.ZSTD_c_checksumFlag]: 1 } })

interface Spec {
  home: number
  away: number
  day: number
  year?: number
  slot?: number
  stage?: number
  season?: number
  round?: number | null
  played: boolean
  score?: [number, number]
  /** 연장 등을 거친 점수 */
  extra?: [number, number]
  /** 결과 꾸러미 안의 사건 수 */
  events?: number
}

/** 경기 핵심 67바이트 */
function core(spec: Spec): Buffer {
  const b = Buffer.alloc(67)
  b[0] = 0x1c
  b.writeUInt32LE(spec.stage ?? 241, 1)
  b.writeUInt32LE(spec.home, 12)
  b[16] = 0xff
  b.writeUInt32LE(spec.away, 19)
  b[23] = 0xff
  b.writeUInt16LE(spec.day | ((spec.slot ?? 37) << 9), 25)
  b.writeUInt16LE(spec.year ?? 2026, 27)
  b.writeUInt16LE(spec.season ?? 2025, 38)
  b[50] = spec.round === undefined ? 255 : (spec.round ?? 255)
  return b
}

/** 경기들을 세이브에 놓인 모양대로 이어 붙인다: [결과 칸][꾸러미][핵심]. 첫 경기 앞에는 결과 칸이 없다 */
function chain(specs: Spec[]): Buffer {
  const parts: Buffer[] = []
  specs.forEach((spec, i) => {
    if (i > 0) {
      if (!spec.played) parts.push(Buffer.from([0]))
      else {
        const events = spec.events ?? 0
        const packet = Buffer.alloc(29 + 16 * events)
        packet[0] = 0x1c
        packet[5] = spec.score?.[0] ?? 0
        packet[9] = spec.score?.[1] ?? 0
        packet[6] = spec.extra ? spec.extra[0] : 0xff
        packet[10] = spec.extra ? spec.extra[1] : 0xff
        packet.writeUInt32LE(events, 25)
        parts.push(Buffer.from([1]), packet)
      }
    }
    parts.push(core(spec))
  })
  parts.push(Buffer.from([0]))
  return Buffer.concat(parts)
}

function at(total: number, pieces: Array<[number, Buffer]>): Buffer {
  const db = Buffer.alloc(total)
  for (const [offset, piece] of pieces) piece.copy(db, offset)
  return db
}

interface Total {
  won: number
  drawn: number
  lost: number
  gf: number
  ga: number
  pts?: number
}

/** 순위표 블록 하나. head는 첫 줄이 시작하는 곳 */
function block(team: number, index: number, rounds: number, total: Total): Buffer {
  const head = 23
  const out = Buffer.alloc(head + 87 + 34 * rounds)
  out.writeUInt32LE(team, 0)
  out[4] = index
  const played = total.won + total.drawn + total.lost
  const row = (i: number, value: { played: number; won: number; drawn: number; lost: number; gf: number; ga: number; pts: number }): void => {
    const p = head + 17 * i
    out.writeUInt32LE(0xffffffff, p)
    out[p + 4] = value.played
    out[p + 5] = value.played
    out[p + 6] = value.won
    out[p + 7] = value.drawn
    out[p + 8] = value.lost
    out.writeUInt16LE(value.gf, p + 10)
    out.writeUInt16LE(value.ga, p + 12)
    out.writeUInt16LE(value.pts, p + 14)
  }
  const pts = total.pts ?? total.won * 3 + total.drawn
  const full = { played, won: total.won, drawn: total.drawn, lost: total.lost, gf: total.gf, ga: total.ga, pts }
  const none = { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 }
  // 전체, 홈(전부), 원정(없음), 전반(전부), 후반(없음)
  ;[full, full, none, full, none].forEach((value, i) => row(i, value))
  out.writeUInt16LE(rounds, head + 85)
  for (let s = 0; s < rounds * 2; s++) out.writeUInt32LE(0xffffffff, head + 87 + 17 * s)
  return out
}

/** 블록들을 간격을 두고 놓는다 */
function tables(blocks: Buffer[], start = 100): Buffer {
  const parts: Array<[number, Buffer]> = []
  let offset = start
  for (const piece of blocks) {
    parts.push([offset, piece])
    offset += piece.length + 40
  }
  return at(offset + 100, parts)
}

/* ---------- 경기 일정 ---------- */

describe('경기 일정 읽기', () => {
  it('킥오프 시각 칸을 시각으로 바꾼다', () => {
    expect(kickOffTime(37)).toBe('15:00')
    expect(kickOffTime(57)).toBe('20:00')
    expect(kickOffTime(56)).toBe('19:45')
    expect(kickOffTime(200)).toBeNull()
  })

  it('끝난 경기의 점수와 앞으로 할 경기를 읽는다(점수는 홈 팀 득점이 먼저)', () => {
    const db = at(
      4000,
      [[200, chain([
        { home: 1, away: 2, day: 350, played: false, round: 17 },
        { home: 3, away: 1, day: 356, played: true, score: [2, 3], round: 18 },
        { home: 1, away: 4, day: 362, slot: 57, played: true, score: [0, 0], round: 19, events: 3 },
        { home: 5, away: 1, day: 3, played: false, round: 20 },
        { home: 1, away: 2, day: 10, played: false, round: 21 }
      ])]]
    )
    const found = readFixtures(db, TODAY)
    expect(found).toHaveLength(5)
    const byDay = new Map(found.map((fixture) => [`${fixture.date.year}:${fixture.date.day}`, fixture]))
    // 첫 경기는 앞 경기와의 이어짐을 모른다
    expect(byDay.get('2026:350')).toMatchObject({ homeId: 1, awayId: 2, played: null, homeGoals: null, round: 17, stageId: 241, season: 2025 })
    expect(byDay.get('2026:356')).toMatchObject({ homeId: 3, awayId: 1, played: true, homeGoals: 2, awayGoals: 3, round: 18 })
    // 사건이 3개 든 꾸러미를 건너뛰고 다음 경기를 이어서 읽는다
    expect(byDay.get('2026:362')).toMatchObject({ played: true, homeGoals: 0, awayGoals: 0, slot: 57 })
    expect(byDay.get('2026:3')).toMatchObject({ homeId: 5, awayId: 1, played: false, homeGoals: null })
    expect(byDay.get('2026:10')).toMatchObject({ played: false })
  })

  it('연장 등을 거친 점수가 있으면 그것을 쓰고, 말이 안 되면 점수를 비워 둔다', () => {
    const db = at(
      2000,
      [[100, chain([
        { home: 1, away: 2, day: 100, played: false },
        { home: 1, away: 3, day: 101, played: true, score: [1, 1], extra: [2, 1] },
        // 연장 점수가 기본 점수보다 작으면 믿지 않는다
        { home: 1, away: 4, day: 102, played: true, score: [3, 1], extra: [1, 1] },
        // 득점이 40을 넘으면 점수가 아니다
        { home: 1, away: 5, day: 103, played: true, score: [90, 1] }
      ])]]
    )
    const found = readFixtures(db, TODAY)
    const score = (away: number): [number | null, number | null] => {
      const fixture = found.find((each) => each.awayId === away)!
      return [fixture.homeGoals, fixture.awayGoals]
    }
    expect(score(3)).toEqual([2, 1])
    expect(score(4)).toEqual([null, null])
    expect(score(5)).toEqual([null, null])
    expect(found.find((each) => each.awayId === 4)!.played).toBe(true)
  })

  it('가장 큰 덩어리만 일정으로 보고, 연도 범위를 벗어난 기록은 버린다', () => {
    const calendar = chain([
      { home: 1, away: 2, day: 10, played: false },
      { home: 2, away: 1, day: 20, played: false },
      { home: 1, away: 3, day: 30, played: false },
      // 오늘에서 너무 먼 연도
      { home: 1, away: 4, day: 40, year: 2000, played: false }
    ])
    const stray = chain([
      { home: 7, away: 8, day: 10, played: false },
      { home: 8, away: 7, day: 20, played: false }
    ])
    const db = at(2_400_000, [
      [100, stray],
      [1_300_000, calendar]
    ])
    const found = readFixtures(db, TODAY)
    expect(found.map((fixture) => [fixture.homeId, fixture.awayId].join('-')).sort()).toEqual(['1-2', '1-3', '2-1'])
  })

  it('특정 팀의 경기만 골라 준다', () => {
    const db = at(2000, [[100, chain([
      { home: 1, away: 2, day: 10, played: false },
      { home: 3, away: 4, day: 11, played: false },
      { home: 5, away: 1, day: 12, played: false }
    ])]])
    expect(readFixtures(db, TODAY, new Set([1]))).toHaveLength(2)
    expect(readFixtures(db, TODAY, new Set([4]))).toHaveLength(1)
    expect(readFixtures(db, TODAY, new Set([99]))).toHaveLength(0)
  })

  it('이어짐이 끊기면 다음 기록에서 다시 시작하고, 그 경기가 끝났는지는 모른다', () => {
    const first = chain([
      { home: 1, away: 2, day: 10, played: false },
      { home: 1, away: 3, day: 11, played: true, score: [1, 0] }
    ])
    const second = chain([
      { home: 1, away: 4, day: 12, played: false },
      { home: 1, away: 5, day: 13, played: true, score: [4, 4] }
    ])
    // 두 덩어리 사이에 알 수 없는 바이트가 끼어 있다
    const db = at(2000, [[100, first], [100 + first.length + 25, second]])
    const found = readFixtures(db, TODAY)
    const away = (id: number) => found.find((fixture) => fixture.awayId === id)!
    expect(away(3)).toMatchObject({ played: true, homeGoals: 1 })
    expect(away(4).played).toBeNull()
    expect(away(5)).toMatchObject({ played: true, homeGoals: 4, awayGoals: 4 })
  })

  it('경기 기록이 없으면 빈 목록을 돌려준다', () => {
    expect(readFixtures(Buffer.alloc(5000), TODAY)).toEqual([])
  })
})

/* ---------- 리그 순위표 ---------- */

describe('리그 순위표 읽기', () => {
  const league = [
    block(10, 0, 2, { won: 3, drawn: 1, lost: 0, gf: 9, ga: 2 }),
    block(11, 1, 2, { won: 1, drawn: 1, lost: 2, gf: 4, ga: 6 }),
    block(12, 2, 2, { won: 0, drawn: 2, lost: 2, gf: 2, ga: 7 })
  ]

  it('내 팀이 든 표를 순위 순서대로 읽는다', () => {
    const table = findLeagueTable(tables(league), 11)!
    expect(table.roundsPerVenue).toBe(2)
    expect(table.rows.map((row) => row.teamId)).toEqual([10, 11, 12])
    expect(table.rows[0]).toMatchObject({ played: 4, won: 3, drawn: 1, lost: 0, goalsFor: 9, goalsAgainst: 2, points: 10 })
    // 득점의 합과 실점의 합이 같고, 승점은 승 × 3 + 무다
    expect(table.rows.reduce((sum, row) => sum + row.goalsFor, 0)).toBe(table.rows.reduce((sum, row) => sum + row.goalsAgainst, 0))
    for (const row of table.rows) expect(row.points).toBe(row.won * 3 + row.drawn)
  })

  it('같은 표가 순서만 섞여 한 번 더 들어 있어도 한 팀을 두 번 세지 않는다', () => {
    const copy = [
      block(12, 0, 2, { won: 0, drawn: 2, lost: 2, gf: 2, ga: 7 }),
      block(10, 1, 2, { won: 3, drawn: 1, lost: 0, gf: 9, ga: 2 }),
      block(11, 2, 2, { won: 1, drawn: 1, lost: 2, gf: 4, ga: 6 })
    ]
    const table = findLeagueTable(tables([...league, ...copy]), 12)!
    expect(table.rows.map((row) => row.teamId)).toEqual([10, 11, 12])
  })

  it('팀이 여러 표에 있으면 경기 수가 가장 많은 표를 리그로 본다', () => {
    const cup = [
      block(10, 0, 1, { won: 1, drawn: 0, lost: 0, gf: 2, ga: 0 }),
      block(20, 1, 1, { won: 0, drawn: 0, lost: 1, gf: 0, ga: 2 })
    ]
    const db = tables([...cup, ...league])
    expect(findLeagueTable(db, 10)!.rows.map((row) => row.teamId)).toEqual([10, 11, 12])
    expect(findLeagueTable(db, 20)!.rows.map((row) => row.teamId)).toEqual([10, 20])
  })

  it('표에 없는 팀이나, 아직 한 경기도 치르지 않은 팀뿐인 표는 없는 것으로 본다', () => {
    expect(findLeagueTable(tables(league), 99)).toBeNull()
    const unplayed = [block(10, 0, 2, { won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 }), block(11, 1, 2, { won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 })]
    expect(findLeagueTable(tables(unplayed), 10)).toBeNull()
  })

  it('줄의 숫자가 서로 맞지 않는 블록은 버린다', () => {
    const broken = block(11, 1, 2, { won: 1, drawn: 1, lost: 2, gf: 4, ga: 6 })
    broken[23 + 4] = 9 // 치른 경기 수가 승 + 무 + 패와 다르다
    expect(findLeagueTable(tables([league[0], broken, league[2]]), 10)).toBeNull()
  })
})

/* ---------- 세이브 꾸러미의 이름 없는 구간 ---------- */

/** 목차에 없는 압축 조각(frames)을 non_pl_hist_ls와 humans 사이에 끼운 세이브 */
function makeSaveWithSpan(frames: Buffer[]): Buffer {
  const listed: Array<{ name: string; data: Buffer; unlisted?: Buffer[] }> = [
    { name: 'game_info', data: Buffer.from('정보'.repeat(30)) },
    { name: 'non_pl_hist_ls', data: Buffer.from('기록'.repeat(30)), unlisted: frames },
    { name: 'humans', data: Buffer.from('사람'.repeat(30)) }
  ]
  const u32 = (value: number): Buffer => {
    const out = Buffer.alloc(4)
    out.writeUInt32LE(value)
    return out
  }
  const u64 = (value: number): Buffer => {
    const out = Buffer.alloc(8)
    out.writeBigUInt64LE(BigInt(value))
    return out
  }
  const text = (value: string): Buffer => Buffer.concat([u32(Buffer.byteLength(value)), Buffer.from(value)])
  const parts: Buffer[] = [text('시험 세이브'), u32(listed.length)]
  const body: Buffer[] = []
  let offset = 0
  for (const file of listed) {
    const packed = pack(file.data)
    parts.push(text(file.name), text('.dat'), u64(offset), u64(packed.length), u64(file.data.length), Buffer.alloc(16, 0xee))
    body.push(packed)
    offset += packed.length
    for (const frame of file.unlisted ?? []) {
      const compressed = pack(frame)
      body.push(compressed)
      offset += compressed.length
    }
  }
  const joined = Buffer.concat(body)
  const head = Buffer.alloc(26)
  SIGNATURE.copy(head)
  head.writeBigUInt64LE(BigInt(17 + joined.length), 9)
  head[17] = 0x11
  head[25] = 0x03
  return Buffer.concat([head, joined, SIGNATURE, pack(Buffer.concat(parts))])
}

const SCHEDULE: Spec[] = [
  { home: 1, away: 2, day: 340, year: 2025, round: 15, played: false },
  { home: 3, away: 1, day: 347, year: 2025, round: 16, played: true, score: [0, 2] },
  { home: 1, away: 4, day: 354, year: 2025, round: 17, played: true, score: [1, 1] },
  { home: 5, away: 1, day: 361, year: 2025, round: 18, played: true, score: [3, 0], stage: 900, slot: 57 },
  { home: 1, away: 2, day: 4, round: 19, played: false, slot: 57 },
  { home: 6, away: 1, day: 11, round: 20, played: false },
  { home: 1, away: 3, day: 18, round: 21, played: false }
]
// 팀 1의 리그(단계 241) 상대는 2, 3, 4, 6이고 순위표에도 이 팀들이 있다. 5와는 다른 대회(단계 900)에서 만났다.
const TABLE = [
  block(1, 0, 2, { won: 2, drawn: 1, lost: 1, gf: 6, ga: 4 }),
  block(2, 1, 2, { won: 2, drawn: 0, lost: 2, gf: 5, ga: 5 }),
  block(3, 2, 2, { won: 1, drawn: 1, lost: 2, gf: 4, ga: 4 }),
  block(4, 3, 2, { won: 1, drawn: 0, lost: 3, gf: 3, ga: 5 })
]

function spanOf(): Buffer {
  const schedule = chain(SCHEDULE)
  // 일정에서 먼 곳(다른 덩어리)에 순위표를 놓는다
  return at(3_000_000, [
    [500, schedule],
    [2_000_000, tables(TABLE, 0)]
  ])
}

describe('이름 없는 구간 읽기', () => {
  it('목차에 없는 압축 조각들을 이어서 풀고, 조각 경계에 걸친 기록도 읽는다', async () => {
    const span = spanOf()
    // 기록 한가운데를 가르도록 아무 데나 자른 조각들
    const cuts = [0, 777, 1_000_001, 2_000_100, 2_000_321, span.length]
    const frames = cuts.slice(1).map((end, i) => span.subarray(cuts[i], end))
    const save = makeSaveWithSpan(frames)
    const container = openContainer(save)
    expect(spanFrames(container)).toHaveLength(frames.length)

    const dir = mkdtempSync(join(tmpdir(), 'fmb-season-'))
    try {
      const path = join(dir, 'test.fm')
      writeFileSync(path, save)
      const season = (await readSeason(path, 1, TODAY))!
      expect(season.fixtures).toHaveLength(SCHEDULE.length)
      expect(season.fixtures.filter((fixture) => fixture.played)).toHaveLength(3)
      expect(season.table!.rows.map((row) => row.teamId)).toEqual([1, 2, 3, 4])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('이름 없는 구간이 없는 세이브는 null을 돌려준다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fmb-season-'))
    try {
      const path = join(dir, 'none.fm')
      writeFileSync(path, makeSaveWithSpan([]))
      expect(await readSeason(path, 1, TODAY)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('풀어 놓은 구간에서 내 팀의 경기를 날짜 순서로 뽑는다', () => {
    const season = decodeSeason(spanOf(), 1, TODAY)
    expect(season.fixtures.map((fixture) => `${fixture.date.year}:${fixture.date.day}`)).toEqual(
      ['2025:340', '2025:347', '2025:354', '2025:361', '2026:4', '2026:11', '2026:18']
    )
  })
})

/* ---------- 화면에 줄 결과 ---------- */

function fakeWorld(): SaveWorld {
  return {
    teamId: 1,
    gameDate: TODAY,
    count: 4,
    teamIds: Uint32Array.from([1, 2, 3, 4]),
    club: Int32Array.from([0, 1, 2, -1]),
    clubs: [
      { uid: 7001, name: '가온 FC', short: '가온', women: false },
      { uid: 7002, name: '나래 시티', short: '나래', women: false },
      { uid: 7003, name: '다솜 유나이티드', short: '다솜', women: false }
    ]
  } as unknown as SaveWorld
}

describe('경기 센터 결과', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fmb-season-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'a.fm')
  writeFileSync(path, makeSaveWithSpan([spanOf()]))

  it('리그 경기를 알아보고, 최근 경기는 가까운 순서, 앞으로의 경기는 다가오는 순서로 준다', async () => {
    const world = fakeWorld()
    const service = new SeasonService({ current: () => ({ path, world }), namesDir: join(dir, 'names') })
    const result = await service.season()
    expect(result.ok).toBe(true)
    expect(result.teamId).toBe(1)
    expect(result.today).toEqual({ year: 2026, month: 1, day: 3 })

    // 가장 최근 경기부터. 361일(12월 27일)은 리그가 아닌 대회
    expect(result.recent.map((match) => [match.opponentId, match.home, match.goalsFor, match.goalsAgainst, match.result, match.league])).toEqual([
      [5, false, 0, 3, 'loss', false],
      [4, true, 1, 1, 'draw', true],
      [3, false, 2, 0, 'win', true]
    ])
    expect(result.recent[0].time).toBe('20:00')
    expect(result.recent[1].round).toBe(18)

    expect(result.upcoming.map((match) => [match.opponentId, match.home, match.date.month, match.date.day, match.round])).toEqual([
      [2, true, 1, 4, 20],
      [6, false, 1, 11, 21],
      [3, true, 1, 18, 22]
    ])
    expect(result.upcoming.every((match) => !match.played && match.result === null && match.goalsFor === null)).toBe(true)
    // 이름: 세이브에서 구단을 알아낸 팀은 그 이름, 아닌 팀은 빈 글자
    expect(result.recent[1].opponent).toBe('')
    expect(result.upcoming[0].opponent).toBe('나래 시티')
    expect(result.upcoming[2].opponent).toBe('다솜 유나이티드')
    // 엠블럼 번호: 구단을 아는 팀만
    expect(result.upcoming.map((match) => match.clubUid)).toEqual([7002, null, 7003])
    expect(result.recent[1].clubUid).toBeNull()
  })

  it('순위표에 내 팀을 표시하고 득실을 계산한다', async () => {
    const service = new SeasonService({ current: () => ({ path, world: fakeWorld() }), namesDir: join(dir, 'names') })
    const result = await service.season()
    expect(result.table!.map((row) => row.clubUid)).toEqual([7001, 7002, 7003, null])
    expect(result.table!.map((row) => [row.position, row.teamId, row.name, row.points, row.goalDiff, row.mine])).toEqual([
      [1, 1, '가온 FC', 7, 2, true],
      [2, 2, '나래 시티', 6, 0, false],
      [3, 3, '다솜 유나이티드', 4, 0, false],
      [4, 4, '', 3, -2, false]
    ])
  })

  it('적용한 세이브가 없거나 내 팀을 모르면 이유를 알려 주고 지어내지 않는다', async () => {
    const none = await new SeasonService({ current: () => null, namesDir: dir }).season()
    expect(none).toMatchObject({ ok: false, recent: [], upcoming: [] })
    expect(none.message).toContain('세이브')

    const noTeam = { ...fakeWorld(), teamId: undefined } as unknown as SaveWorld
    const unknown = await new SeasonService({ current: () => ({ path, world: noTeam }), namesDir: dir }).season()
    expect(unknown.ok).toBe(false)
    expect(unknown.table).toBeUndefined()
    expect(unknown.message).toContain('내 팀')
  })

  it('읽을 수 없는 파일이면 실패를 알리고, 다음에 다시 읽어 본다', async () => {
    const missing = join(dir, 'missing.fm')
    const service = new SeasonService({ current: () => ({ path: missing, world: fakeWorld() }), namesDir: dir })
    const result = await service.season()
    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
    // 파일이 생기면 읽는다
    writeFileSync(missing, makeSaveWithSpan([spanOf()]))
    expect((await service.season()).ok).toBe(true)
  })

  it('리그 단계는 순위표의 팀들과 가장 많이 겨루는 단계다', () => {
    const season = decodeSeason(spanOf(), 1, TODAY)
    expect(leagueStage(season.fixtures, season.table, 1)).toBe(241)
    expect(leagueStage(season.fixtures, null, 1)).toBeNull()
  })
})
