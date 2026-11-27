import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { POSITION_KEYS } from '../src/shared/positions'
import { buildGrowth, decodeGrowth, encodeGrowth, GROUP_UNKNOWN, growthDate, positionGroupOf, takeGrowthInput, type GrowthSnapshot } from '../src/main/records/growth'
import { RecordKeeper } from '../src/main/records/keeper'
import { importRatings, parseRatingLine, positionFromMask } from '../src/main/records/ratings'
import { folderIdOf, planThinning, RecordStore, saveLabel, type SnapshotFile } from '../src/main/records/store'
import type { SaveWorld } from '../src/main/save/world'

let root: string
let store: RecordStore

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fmb-records-'))
  store = new RecordStore(join(root, 'records'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const WIDTH = POSITION_KEYS.length

/** 숙련도 15개를 만든다: 주어진 자리만 값을 준다 */
function ratings(set: Partial<Record<(typeof POSITION_KEYS)[number], number>>): number[] {
  return POSITION_KEYS.map((key) => set[key] ?? 0)
}

/** 선수 몇 명만 있는 가짜 세이브(기록 보관이 읽는 칸만 채운다) */
function fakeWorld(date: { year: number; day: number } | null, teamId: number | undefined = 7): SaveWorld {
  const players = [
    { uid: 1001, birthYear: 2000, birthDay: 100, ca: 150, pa: 170, pos: ratings({ GK: 20 }) },
    { uid: 1002, birthYear: 2008, birthDay: 300, ca: 90, pa: 160, pos: ratings({ DC: 20, DR: 12 }) },
    { uid: 1003, birthYear: 0, birthDay: 0, ca: 120, pa: 120, pos: ratings({ ST: 18, AMC: 12 }) },
    { uid: 0, birthYear: 1999, birthDay: 1, ca: 100, pa: 100, pos: ratings({ MC: 20 }) },
    { uid: 1005, birthYear: 1999, birthDay: 1, ca: 100, pa: 100, pos: ratings({ MC: 20 }) },
    { uid: 1005, birthYear: 1990, birthDay: 1, ca: 80, pa: 80, pos: ratings({ DM: 20 }) }
  ]
  const world = {
    count: players.length,
    uids: Uint32Array.from(players.map((p) => p.uid)),
    birthYear: Uint16Array.from(players.map((p) => p.birthYear)),
    birthDay: Uint16Array.from(players.map((p) => p.birthDay)),
    ca: Uint16Array.from(players.map((p) => p.ca)),
    pa: Uint16Array.from(players.map((p) => p.pa)),
    positions: Uint8Array.from(players.flatMap((p) => p.pos)),
    gameDate: date,
    teamId
  }
  return world as unknown as SaveWorld
}

/** 무늬 없는 값으로 채운 스냅샷(압축이 잘 안 되어 크기를 정하기 쉽다) */
function noisy(year: number, day: number, n = 400): GrowthSnapshot {
  let seed = year * 1000 + day
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed & 0xff
  }
  const fill = (): Uint8Array => Uint8Array.from({ length: n }, next)
  return { year, day, uids: Uint32Array.from({ length: n }, (_, i) => i + 1), ages: fill(), ca: fill(), pa: fill(), groups: fill() }
}

describe('위치군', () => {
  it('가장 숙련이 높은 자리로 정하고, 같으면 앞선 자리를 따른다', () => {
    expect(positionGroupOf(ratings({ GK: 20 }))).toBe(0)
    expect(positionGroupOf(ratings({ DC: 20, DR: 20 }))).toBe(1)
    expect(positionGroupOf(ratings({ DR: 18, DC: 12 }))).toBe(2)
    expect(positionGroupOf(ratings({ WBL: 17, MC: 9 }))).toBe(2)
    expect(positionGroupOf(ratings({ DM: 19, MC: 19 }))).toBe(3)
    expect(positionGroupOf(ratings({ MC: 15 }))).toBe(4)
    expect(positionGroupOf(ratings({ AMR: 16 }))).toBe(5)
    expect(positionGroupOf(ratings({ ST: 20 }))).toBe(6)
    expect(positionGroupOf(ratings({}))).toBe(GROUP_UNKNOWN)
  })

  it('다른 선수의 칸을 읽을 때는 시작 위치만큼 건너뛴다', () => {
    const both = [...ratings({ GK: 20 }), ...ratings({ ST: 20 })]
    expect(positionGroupOf(both, WIDTH)).toBe(6)
  })
})

describe('성장 스냅샷 만들기와 읽기', () => {
  it('번호가 없거나 겹치는 선수는 빼고, 나이를 모르면 0으로 둔다', () => {
    const snap = buildGrowth(takeGrowthInput(fakeWorld({ year: 2026, day: 182 })))!
    expect(Array.from(snap.uids)).toEqual([1001, 1002, 1003])
    expect(Array.from(snap.ages)).toEqual([26, 17, 0])
    expect(Array.from(snap.ca)).toEqual([150, 90, 120])
    expect(Array.from(snap.pa)).toEqual([170, 160, 120])
    expect(Array.from(snap.groups)).toEqual([0, 1, 6])
  })

  it('게임 날짜를 모르면 만들지 않는다', () => {
    expect(buildGrowth(takeGrowthInput(fakeWorld(null)))).toBeNull()
  })

  it('복사해 둔 값을 쓰므로, 만든 뒤에 세이브 값이 바뀌어도 그날의 값이 남는다', () => {
    const world = fakeWorld({ year: 2026, day: 182 })
    const input = takeGrowthInput(world)
    world.ca[0] = 199
    world.positions[0] = 0
    const snap = buildGrowth(input)!
    expect(snap.ca[0]).toBe(150)
    expect(snap.groups[0]).toBe(0)
  })

  it('압축해서 쓰고 다시 읽으면 같다', () => {
    const snap = buildGrowth(takeGrowthInput(fakeWorld({ year: 2026, day: 182 })))!
    const back = decodeGrowth(encodeGrowth(snap))
    expect(back.year).toBe(2026)
    expect(back.day).toBe(182)
    for (const key of ['uids', 'ages', 'ca', 'pa', 'groups'] as const) expect(Array.from(back[key])).toEqual(Array.from(snap[key]))
    expect(growthDate(back)).toBe('2026-07-01')
  })

  it('번호가 오름차순이 아니어도(차이가 음수여도) 그대로 돌아온다', () => {
    const snap = noisy(2026, 10, 4)
    snap.uids = Uint32Array.from([4_000_000_000, 5, 4_294_967_295, 1])
    expect(Array.from(decodeGrowth(encodeGrowth(snap)).uids)).toEqual([4_000_000_000, 5, 4_294_967_295, 1])
  })

  it('큰 스냅샷도 같고, 모르는 형식이나 잘린 파일은 거절한다', () => {
    const big = noisy(2027, 40, 5000)
    const back = decodeGrowth(encodeGrowth(big))
    expect(Array.from(back.uids)).toEqual(Array.from(big.uids))
    expect(Array.from(back.pa)).toEqual(Array.from(big.pa))
    const raw = encodeGrowth(big)
    expect(() => decodeGrowth(raw.subarray(0, raw.length - 8))).toThrow()
    expect(() => decodeGrowth(Buffer.from('not gzip'))).toThrow()
  })
})

describe('한 달에 한 번', () => {
  it('같은 달의 두 번째 스냅샷은 쓰지 않고, 다른 달이면 쓴다', async () => {
    expect(await store.writeSnapshot('save-a', 7, noisy(2026, 182))).toBe('written') // 7월 1일
    expect(await store.writeSnapshot('save-a', 7, noisy(2026, 200))).toBe('exists') // 7월 19일
    expect(await store.writeSnapshot('save-a', 7, noisy(2026, 213))).toBe('written') // 8월 1일
    expect(store.snapshots('save-a').map((s) => s.date)).toEqual(['2026-07-01', '2026-08-01'])
  })

  it('같은 달을 동시에 써도 하나만 남는다', async () => {
    const results = await Promise.all([store.writeSnapshot('save-a', 7, noisy(2026, 182)), store.writeSnapshot('save-a', 7, noisy(2026, 190))])
    expect(results.sort()).toEqual(['exists', 'written'])
    expect(store.snapshots('save-a')).toHaveLength(1)
  })

  it('다른 세이브는 따로 센다. 읽을 때도 같은 값이 나온다', async () => {
    await store.writeSnapshot('save-a', 7, noisy(2026, 182))
    expect(await store.writeSnapshot('save-b', 8, noisy(2026, 182))).toBe('written')
    const back = await store.readSnapshot('save-b', '2026-07-01')
    expect(back.uids.length).toBe(400)
    expect(store.meta('save-b')!.teamId).toBe(8)
  })

  it('RecordKeeper.onRead: 세이브를 읽을 때마다 불러도 그 달에는 한 번만 남는다', async () => {
    const keeper = new RecordKeeper(store, () => join(root, 'none.jsonl'))
    const path = join(root, '내 세이브.fm')
    await keeper.onRead(path, fakeWorld({ year: 2026, day: 182 }))
    await keeper.onRead(path, fakeWorld({ year: 2026, day: 190 }))
    await keeper.onRead(path, fakeWorld({ year: 2026, day: 213 }))
    await keeper.onRead(path, fakeWorld(null))
    expect(store.snapshots(saveLabel(path)).map((s) => s.date)).toEqual(['2026-07-01', '2026-08-01'])
    expect(keeper.summaries()).toMatchObject([{ label: '내 세이브', snapshots: 2, lastSnapshot: '2026-08-01', teamId: 7, ratedMatches: 0 }])
  })

  it('폴더 이름은 세이브 이름의 짧은 해시다(대소문자 무시)', () => {
    expect(folderIdOf('My Save')).toMatch(/^[0-9a-f]{8}$/)
    expect(folderIdOf('My Save')).toBe(folderIdOf('my save'))
    expect(folderIdOf('My Save')).not.toBe(folderIdOf('My Save 2'))
  })
})

describe('크기 상한과 솎기', () => {
  const snap = (date: string, bytes = 100): SnapshotFile => ({ file: `${date}.fmg`, date, bytes })
  const monthly = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01'].map((d) => snap(d))

  it('상한 안이면 아무것도 지우지 않는다', () => {
    expect(planThinning(monthly, 0, 700)).toEqual([])
  })

  it('넘으면 오래된 분기부터 분기당 하나만 남기고, 상한 안에 들면 멈춘다', () => {
    // 700바이트에서 600으로: 가장 오래된 분기(7~9월)에서 하나만 지우면 된다
    expect(planThinning(monthly, 0, 600)).toEqual(['2026-08-01.fmg'])
    // 400: 7~9월에서 둘, 10~12월에서 하나
    expect(planThinning(monthly, 0, 400)).toEqual(['2026-08-01.fmg', '2026-09-01.fmg', '2026-11-01.fmg'])
  })

  it('분기당 하나로도 넘으면 가장 오래된 것부터 지우고, 가장 최근 것은 남긴다', () => {
    // 분기당 하나로 줄이면 07-01, 10-01, 2027-01-01 세 개(300). 상한 150이면 오래된 것부터
    expect(planThinning(monthly, 0, 150)).toEqual(['2026-08-01.fmg', '2026-09-01.fmg', '2026-11-01.fmg', '2026-12-01.fmg', '2026-07-01.fmg', '2026-10-01.fmg'])
    expect(planThinning(monthly, 0, 1)).not.toContain('2027-01-01.fmg')
  })

  it('평점 기록 같은 다른 파일의 크기도 합쳐서 본다', () => {
    expect(planThinning(monthly, 100, 700)).toEqual(['2026-08-01.fmg'])
  })

  it('스냅샷을 쓸 때마다 상한을 맞춘다', async () => {
    const sample = (await store.writeSnapshot('save-a', 7, noisy(2026, 182)), store.snapshots('save-a')[0].bytes)
    const small = new RecordStore(join(root, 'small'), Math.round(sample * 4.5))
    // 2026-07 ~ 2027-03, 아홉 달
    const days = [182, 213, 244, 274, 305, 335, 366, 32, 60]
    const years = [2026, 2026, 2026, 2026, 2026, 2026, 2026, 2027, 2027]
    for (let i = 0; i < days.length; i++) await small.writeSnapshot('save-a', 7, noisy(years[i], days[i]))
    const left = small.snapshots('save-a')
    const total = left.reduce((sum, s) => sum + s.bytes, 0)
    expect(total).toBeLessThanOrEqual(Math.round(sample * 4.5) - 0)
    expect(left.length).toBeLessThan(9)
    // 가장 최근 것은 남는다
    expect(left[left.length - 1].date).toBe(growthDate({ year: 2027, day: 60 }))
  })
})

describe('경기 평점 가져오기', () => {
  const player = { uid: 456, side: 'home', pos: 16, min: 90, rating: 7.1, inc: 0, t: 0, slot: 3 }
  const line = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({
      v: 1,
      gameDate: '2026-08-15',
      comp: '리그',
      compUid: 11,
      home: { id: 7, uid: 676, name: '우리 팀', goals: 2 },
      away: { id: null, uid: 671, name: '상대 팀', goals: 1 },
      myTeamId: 7,
      full: 90,
      players: [player, { uid: null, side: 'away', pos: 16384, min: null, rating: 6.4, inc: 1, t: 30, slot: -1 }],
      ...over
    })
  let source: string
  const run = (teamId: number | null | undefined = 7, label = 'save-a'): ReturnType<typeof importRatings> => importRatings(store, label, teamId, source)
  const saved = (label = 'save-a'): string[] => {
    const file = join(store.dir(label), 'ratings.jsonl')
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
  }

  beforeEach(() => {
    source = join(root, 'plugin-ratings.jsonl')
  })

  it('줄을 읽는다: 팀·선수 번호는 null이어도 된다', () => {
    expect(parseRatingLine(line())).not.toBeNull()
    expect(parseRatingLine(line({ myTeamId: null }))).not.toBeNull()
    expect(parseRatingLine(line({ v: 2 }))).toBeNull()
    expect(parseRatingLine(line({ gameDate: '15/08/2026' }))).toBeNull()
    expect(parseRatingLine(line({ players: 'x' }))).toBeNull()
    expect(parseRatingLine(line({ players: [{ ...player, rating: 'good' }] }))).toBeNull()
    expect(parseRatingLine(line({ players: [{ ...player, pos: 'D (C)' }] }))).toBeNull()
    expect(parseRatingLine(line({ players: [{ ...player, min: null, uid: null }] }))).not.toBeNull()
    expect(parseRatingLine(line({ home: { id: null, uid: null, name: '우리 팀', goals: null } }))).not.toBeNull()
    expect(parseRatingLine('{깨진 줄')).toBeNull()
    expect(parseRatingLine('[]')).toBeNull()
  })

  it('파일이 없거나 내 팀을 모르면 아무것도 하지 않는다', () => {
    expect(run()).toMatchObject({ imported: 0 })
    writeFileSync(source, line() + '\n')
    expect(importRatings(store, 'save-a', undefined, source)).toMatchObject({ imported: 0 })
    expect(run(null)).toMatchObject({ imported: 0 })
    expect(saved()).toEqual([])
  })

  it('새로 생긴 줄만 읽고, 읽은 곳을 기억한다', () => {
    writeFileSync(source, line() + '\n')
    expect(run()).toEqual({ imported: 1, duplicates: 0, otherTeam: 0, malformed: 0 })
    const offset = store.meta('save-a')!.ratingsOffset
    expect(offset).toBe(Buffer.byteLength(line() + '\n'))
    appendFileSync(source, line({ gameDate: '2026-08-22', home: { id: 9, uid: 671, name: '상대 팀', goals: 0 }, away: { id: 7, uid: 676, name: '우리 팀', goals: 3 } }) + '\n')
    expect(run()).toEqual({ imported: 1, duplicates: 0, otherTeam: 0, malformed: 0 })
    expect(saved()).toHaveLength(2)
    // 새 줄이 없으면 다시 읽지 않는다
    expect(run()).toEqual({ imported: 0, duplicates: 0, otherTeam: 0, malformed: 0 })
    expect(store.meta('save-a')).toMatchObject({ ratingsOffset: Buffer.byteLength(readFileSync(source, 'utf8')), ratedMatches: 2 })
  })

  it('같은 경기인지는 uid로 가리고(없으면 이름으로), 이름이 달라도 uid가 같으면 같은 경기다', () => {
    const lines = [line(), line({ home: { id: 7, uid: 676, name: '바뀐 이름', goals: 2 } }), line({ home: { id: 7, uid: 999, name: '우리 팀', goals: 2 } })]
    writeFileSync(source, lines.join('\n') + '\n')
    expect(run()).toMatchObject({ imported: 2, duplicates: 1 })
    // uid가 없으면 이름으로 가른다
    const noUid = (name: string): string => line({ gameDate: '2026-09-01', home: { id: 7, uid: null, name, goals: 0 }, away: { id: null, uid: null, name: '상대 팀', goals: 0 } })
    writeFileSync(source, [noUid('가'), noUid('가'), noUid('나')].join('\n') + '\n')
    store.saveMeta('save-b', { ...store.ensure('save-b', 7), ratingsOffset: 0 })
    expect(run(7, 'save-b')).toMatchObject({ imported: 2, duplicates: 1 })
  })

  it('같은 (날짜, 홈, 원정) 경기는 한 번만 넣는다: 같은 파일을 다시 읽거나 줄이 겹쳐도', () => {
    writeFileSync(source, line() + '\n' + line({ comp: '다른 이름' }) + '\n')
    expect(run()).toMatchObject({ imported: 1, duplicates: 1 })
    // 처음부터 다시 읽게 해도(읽은 곳을 잃어버린 경우) 겹치지 않는다
    store.saveMeta('save-a', { ...store.meta('save-a')!, ratingsOffset: 0 })
    expect(run()).toMatchObject({ imported: 0, duplicates: 2 })
    expect(saved()).toHaveLength(1)
    expect(store.meta('save-a')!.ratedMatches).toBe(1)
  })

  it('깨진 줄과 모르는 버전은 건너뛰고 센다', () => {
    writeFileSync(source, ['{깨진', line({ v: 9 }), '', line(), '   '].join('\n') + '\n')
    expect(run()).toEqual({ imported: 1, duplicates: 0, otherTeam: 0, malformed: 2 })
  })

  it('다른 팀의 경기는 가져오지 않지만 읽은 곳은 지나간다', () => {
    writeFileSync(source, line({ myTeamId: 99 }) + '\n' + line({ myTeamId: null, gameDate: '2026-08-16' }) + '\n' + line({ gameDate: '2026-08-17' }) + '\n')
    expect(run()).toEqual({ imported: 1, duplicates: 0, otherTeam: 2, malformed: 0 })
    expect(run()).toMatchObject({ imported: 0, otherTeam: 0 })
    // 다른 세이브(다른 팀)는 자기 줄만 가져간다
    expect(run(99, 'save-b')).toMatchObject({ imported: 1, otherTeam: 2 })
    expect(saved('save-a')).toHaveLength(1)
    expect(saved('save-b')).toHaveLength(1)
  })

  it('끝이 줄바꿈으로 끝나지 않은 줄은 쓰는 중이라 다음에 읽는다', () => {
    const second = line({ gameDate: '2026-08-22' })
    writeFileSync(source, line() + '\n' + second.slice(0, 40))
    expect(run()).toMatchObject({ imported: 1, malformed: 0 })
    appendFileSync(source, second.slice(40) + '\n')
    expect(run()).toMatchObject({ imported: 1, malformed: 0 })
    expect(saved()).toHaveLength(2)
  })

  it('파일이 전보다 작아졌으면 처음부터 읽는다. 앞의 BOM과 CRLF도 견딘다', () => {
    writeFileSync(source, line() + '\n' + line({ gameDate: '2026-09-01' }) + '\n')
    run()
    writeFileSync(source, '﻿' + line({ gameDate: '2026-10-01' }) + '\r\n')
    expect(run()).toEqual({ imported: 1, duplicates: 0, otherTeam: 0, malformed: 0 })
    expect(saved()).toHaveLength(3)
  })

  it('RecordKeeper는 세이브를 읽을 때 내 팀의 평점을 가져온다', async () => {
    writeFileSync(source, line() + '\n')
    const keeper = new RecordKeeper(store, () => source)
    await keeper.onRead(join(root, 'save-a.fm'), fakeWorld(null, 7))
    expect(saved()).toHaveLength(1)
    expect(keeper.summaries()[0]).toMatchObject({ label: 'save-a', ratedMatches: 1, snapshots: 0, lastSnapshot: null })
  })
})

describe('경기 기록의 자리 코드', () => {
  it('PositionMask 비트를 자리와 위치군으로 읽는다', () => {
    expect(positionFromMask(1)).toMatchObject({ key: 'GK', groupName: '골키퍼', side: null })
    expect(positionFromMask(2)).toMatchObject({ key: 'SW', groupName: '중앙 수비', side: null })
    expect(positionFromMask(4)).toMatchObject({ key: 'DR', groupName: '측면 수비', side: 'R' })
    expect(positionFromMask(8)).toMatchObject({ key: 'DL', groupName: '측면 수비', side: 'L' })
    expect(positionFromMask(16)).toMatchObject({ key: 'DC', groupName: '중앙 수비', side: 'C' })
    expect(positionFromMask(32)).toMatchObject({ key: 'WBR', groupName: '측면 수비', side: 'R' })
    expect(positionFromMask(64)).toMatchObject({ key: 'WBL', groupName: '측면 수비', side: 'L' })
    expect(positionFromMask(128)).toMatchObject({ key: 'DM', groupName: '수비형 미드', side: 'C' })
    expect(positionFromMask(256)).toMatchObject({ key: 'MR', groupName: '공격형·측면', side: 'R' })
    expect(positionFromMask(512)).toMatchObject({ key: 'ML', groupName: '공격형·측면', side: 'L' })
    expect(positionFromMask(1024)).toMatchObject({ key: 'MC', groupName: '중앙 미드', side: 'C' })
    expect(positionFromMask(2048)).toMatchObject({ key: 'AMR', groupName: '공격형·측면', side: 'R' })
    expect(positionFromMask(4096)).toMatchObject({ key: 'AML', groupName: '공격형·측면', side: 'L' })
    expect(positionFromMask(8192)).toMatchObject({ key: 'AMC', groupName: '공격형·측면', side: 'C' })
    expect(positionFromMask(16384)).toMatchObject({ key: 'ST', groupName: '공격수', side: 'C' })
  })

  it('쪽 표시 비트가 더해지면 그 쪽을 따른다', () => {
    expect(positionFromMask(2097168)).toMatchObject({ key: 'DC', side: 'R' })
    expect(positionFromMask(1049600)).toMatchObject({ key: 'MC', side: 'L' })
    expect(positionFromMask(1048576 + 1)).toMatchObject({ key: 'GK', side: null })
  })

  it('0이나 자리 비트가 없는 값은 모름(null)', () => {
    expect(positionFromMask(0)).toBeNull()
    expect(positionFromMask(1048576)).toBeNull()
    expect(positionFromMask(-5)).toBeNull()
    expect(positionFromMask(1.5)).toBeNull()
  })

  it('위치군은 성장 스냅샷의 위치군과 같은 순번이다', () => {
    for (const [mask, key] of [[1, 'GK'], [16, 'DC'], [64, 'WBL'], [128, 'DM'], [1024, 'MC'], [8192, 'AMC'], [16384, 'ST']] as const) {
      expect(positionFromMask(mask)!.group).toBe(positionGroupOf(ratings({ [key]: 20 })))
    }
  })
})

describe('기록 요약과 폴더', () => {
  it('세이브마다 크기·스냅샷 수·마지막 날짜·평점 경기 수를 낸다', async () => {
    await store.writeSnapshot('save-a', 7, noisy(2026, 182))
    await store.writeSnapshot('save-a', 7, noisy(2026, 213))
    const [entry] = store.summaries()
    expect(entry).toMatchObject({ label: 'save-a', teamId: 7, snapshots: 2, lastSnapshot: '2026-08-01', ratedMatches: 0 })
    expect(entry.bytes).toBeGreaterThan(entry.snapshots * 100)
    expect(entry.id).toBe(folderIdOf('save-a'))
    expect(store.folderOf(entry.id)).toBe(store.dir('save-a'))
  })

  it('지울 폴더는 기록 폴더 안의 해시 이름만 받는다', () => {
    expect(store.folderOf('..')).toBeNull()
    expect(store.folderOf('../x')).toBeNull()
    expect(store.folderOf('deadbeef')).toBeNull()
  })

  it('기록이 없으면 빈 목록이다', () => {
    expect(store.summaries()).toEqual([])
  })
})
