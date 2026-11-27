/**
 * 플러그인 창구의 앱 쪽 계약 검사(N-04). 켜진 게임에서 녹화한 응답을 이름만 지어낸 값으로 바꾼 것(tests/fixtures/plugin/)을
 * 가짜 플러그인 서버가 그대로 돌려주고, 앱의 코드(bridge.ts, club.ts, clubService.ts, worldService.market)가 기대한 값을 내는지 본다.
 * 플러그인(C#)을 올릴 때 응답 모양이 바뀌면 이 검사가 앱 쪽에서 먼저 알려 준다.
 *
 * 녹화본은 club, health, people, roles, roster다. state는 녹화본이 없어 bridge.ts가 읽는 모양대로 직접 만들었다.
 * 모든 이름(선수, 구단, 경기장, 리그, 나라, 감독)과 고유 번호는 지어낸 값이다.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ClubService, firstTeam } from '../src/main/clubService'
import { POSITION_COUNT } from '../src/main/save/reader'
import type { SaveWorld } from '../src/main/save/world'
import { gameClub, gameHealth, gameNames, gamePeople, gameState, HEALTH_BATCH, PEOPLE_PER_REQUEST } from '../src/main/talk/bridge'
import { WorldService } from '../src/main/worldService'
import { buildSnapshot, HEALTH_PER_REQUEST, type RosterPlayer } from '../src/shared/club'
import { CLUB_PLUGIN, MARKET_PLUGIN, NEEDED_PLUGIN, versionOlder, type LinkStatus } from '../src/shared/game'

const fixture = <T,>(name: string): T => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'plugin', `${name}.json`), 'utf8')) as T

interface Person { uid: number; age: number; value: string; valueSort: number; wage: string; wageSort: number; contractEnd: string; nation: string; club: string; gender: string }
interface RosterEntry { uid: number; name: string; wage: number; value: number }
interface RoleEntry { uid: number; name: string; best: string; bestOop: string; tactic?: string; ipMin?: string; ipMax?: string; oop?: string; ca: string }

const club = readFileSync(join(__dirname, 'fixtures', 'plugin', 'club.json'), 'utf8')
const health = readFileSync(join(__dirname, 'fixtures', 'plugin', 'health.json'), 'utf8')
const people = readFileSync(join(__dirname, 'fixtures', 'plugin', 'people.json'), 'utf8')
const state = readFileSync(join(__dirname, 'fixtures', 'plugin', 'state.json'), 'utf8')
const roster = fixture<RosterEntry[]>('roster')
const TEAM = 9001

let server: Server
let oldPlugin = false
const asked: string[] = []

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = request.url ?? ''
    asked.push(url)
    const json = (body: string): void => void response.writeHead(200, { 'content-type': 'application/json' }).end(body)
    if (request.headers['x-bridge-token'] !== 'secret') response.writeHead(401).end('bad token')
    else if (url === '/ping') response.end('fm-bojwagwan-bridge 0.9.0')
    else if (url === '/state') (oldPlugin ? response.writeHead(404).end('unknown path') : json(state))
    else if (url.startsWith('/club?')) json(club)
    else if (url.startsWith('/health?')) json(health)
    else if (url.startsWith('/people?')) json(people)
    else if (url.startsWith('/names?')) json('[{"id":7,"name":"가상국1"},{"id":9,"name":"가상 FC","club":"가상 FC","gender":"True"}]')
    else response.writeHead(404).end('unknown path')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const home = mkdtempSync(join(tmpdir(), 'fmb-contract-'))
  mkdirSync(join(home, 'FmBojwagwan'))
  writeFileSync(join(home, 'FmBojwagwan', 'bridge.json'), JSON.stringify({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, token: 'secret', pid: 1, version: 'test' }))
  process.env.LOCALAPPDATA = home
})

afterAll(() => {
  server.close()
})

const rosterPlayers: RosterPlayer[] = roster.map((each) => ({ uid: each.uid, name: each.name, position: 'ST' }))

describe('녹화본 자체의 점검', () => {
  it('이름 자리는 모두 지어낸 값이다(실제 선수·구단 이름이 남아 있지 않다)', () => {
    // 이름이 들어가는 항목은 모두 지어낸 값(가상 ..., 선수NN)이어야 한다
    const NAME_KEYS = new Set(['name', 'club', 'stadium', 'division', 'divisionShort', 'nation', 'manager', 'team', 'teamShort', 'best', 'bestOop', 'tactic'])
    const strangers: string[] = []
    const walk = (value: unknown, key = ''): void => {
      if (key === 'paths') return // 항목 이름 → 게임 안 경로(이름이 아니다)
      if (Array.isArray(value)) value.forEach((each) => walk(each, key))
      else if (value && typeof value === 'object') Object.entries(value).forEach(([k, each]) => walk(each, k))
      else if (typeof value === 'string' && NAME_KEYS.has(key) && !['best', 'bestOop', 'tactic'].includes(key) && !/^(가상|선수\d\d$|VL$)/.test(value)) strangers.push(`${key}: ${value}`)
    }
    for (const text of [club, health, people, state, JSON.stringify(roster), JSON.stringify(fixture('roles'))]) walk(JSON.parse(text))
    expect(strangers).toEqual([])
    expect(roster).toHaveLength(25)
    expect(roster.every((each) => /^선수\d\d$/.test(each.name))).toBe(true)
    expect(roster.every((each) => each.uid >= 90_000_001 && each.uid <= 90_000_025)).toBe(true)
  })
})

describe('/state: 게임이 켜져 있는지, 플러그인 버전, 내 팀', () => {
  it('상태 응답을 읽는다', async () => {
    oldPlugin = false
    const read = await gameState()
    expect(read).toEqual({
      version: '0.11.0',
      loaded: true,
      manager: '가상 감독',
      team: '가상 FC',
      teamShort: '가상',
      players: roster.map((each) => each.name)
    })
  })

  it('버전 판정: 녹화한 0.11.0은 지금 앱이 기대하는 모든 기능을 지원한다', () => {
    for (const needed of [NEEDED_PLUGIN, MARKET_PLUGIN, CLUB_PLUGIN]) expect(versionOlder('0.11.0', needed), needed).toBe(false)
    expect(versionOlder('0.9.0', CLUB_PLUGIN)).toBe(true)
  })

  it('/state를 모르는 옛 플러그인은 /ping으로 연결됐다는 것과 버전만 알린다', async () => {
    oldPlugin = true
    try {
      expect(await gameState()).toEqual({ version: '0.9.0', loaded: false, manager: '', team: '', teamShort: '', players: [] })
    } finally {
      oldPlugin = false
    }
  })
})

describe('/club + /health: 구단 프로필·시설·재정과 선수단 건강', () => {
  it('두 응답을 읽어 화면용 값으로 바꾼다', async () => {
    const clubAnswer = await gameClub(TEAM)
    const healthAnswer = await gameHealth(rosterPlayers.map((each) => each.uid), TEAM)
    expect(asked).toContain(`/club?team=${TEAM}`)
    expect(clubAnswer?.records).toHaveLength(1)
    expect(clubAnswer?.paths.wageBudget).toBe('Club.WageBudget')
    expect(healthAnswer?.records).toHaveLength(8)
    expect(healthAnswer?.paths.condition).toBe('Condition')

    const snapshot = buildSnapshot({ club: clubAnswer, health: healthAnswer, roster: rosterPlayers, readAt: '2026-11-27T16:20:00.000Z' })
    expect(snapshot.ok).toBe(true)
    expect(snapshot.profile).toMatchObject({ teamName: '가상 FC', division: '가상 리그', stadium: '가상 경기장' })
    // 시설 4종과 재정 5종이 모두 읽힌다
    expect(snapshot.facilities.map((each) => each.id)).toEqual(['training', 'youthFacilities', 'youthCoaching', 'youthRecruitment'])
    expect(snapshot.finances.map((each) => each.id)).toEqual(['transferBudget', 'wageBudget', 'wageSpend', 'wageRemaining', 'balance'])
    // 1군 25명 가운데 게임이 답한 8명만 읽힌 것으로 센다
    expect(snapshot.players).toHaveLength(25)
    expect(snapshot.players.filter((each) => each.read)).toHaveLength(8)
    expect(snapshot.players.filter((each) => !each.read).every((each) => each.condition === null && !each.injured)).toBe(true)
    // 징계가 없는 선수에게도 게임은 "이유 -1, 1경기"를 돌려준다: 징계로 읽지 않는다
    expect(snapshot.players.some((each) => each.suspended)).toBe(false)
    expect(snapshot.report).not.toBeNull()
  })

  it('녹화한 값 그대로: 조건·사기·평점이 숫자로 읽힌다', async () => {
    const healthAnswer = await gameHealth(rosterPlayers.map((each) => each.uid), TEAM)
    const first = buildSnapshot({ club: null, health: healthAnswer, roster: rosterPlayers, readAt: 'x' }).players.find((each) => each.uid === 90_000_001)!
    expect(first).toMatchObject({ read: true, injured: false, condition: 93, sharpness: 99, morale: 18, appearances: 22, goals: 3, assists: 1 })
    expect(first.rating).toBeCloseTo(6.92, 2)
    expect(first.lastRating).toBeCloseTo(8.4, 1)
  })

  it('수용 인원 "6.1276만석 전부 좌석"처럼 소수 만 단위 글자도 석 수로 풀어 읽는다', async () => {
    const answer = await gameClub(TEAM)
    const snapshot = buildSnapshot({ club: answer, health: null, roster: [], readAt: 'x' })
    expect(snapshot.profile?.capacity).toBe('61,276석, 전부 좌석')
  })

  it('ClubService: 세이브의 1군 명단으로 30명씩 묶어 묻고, 읽은 값을 한 덩어리로 합친다', async () => {
    const count = roster.length
    const world = {
      count,
      teamId: TEAM,
      teamIds: new Uint32Array(count).fill(TEAM),
      names: roster.map((each) => each.name),
      uids: Uint32Array.from(roster, (each) => each.uid),
      positions: new Uint8Array(count * POSITION_COUNT).fill(1)
    } as unknown as SaveWorld
    expect(firstTeam(world)).toHaveLength(25)
    const link: LinkStatus = {
      game: { connected: true, pluginVersion: '0.11.0', pluginOld: false, loaded: true, manager: '가상 감독', team: '가상 FC', teamShort: '가상' },
      data: { club: '가상 FC' } as LinkStatus['data'],
      busy: false
    }
    asked.length = 0
    const service = new ClubService({ world, path: '가상.fm' } as unknown as WorldService, () => link)
    const snapshot = await service.snapshot(true)
    expect(snapshot.ok, snapshot.message).toBe(true)
    expect(snapshot.players.filter((each) => each.read)).toHaveLength(8)
    expect(snapshot.finances).toHaveLength(5)
    expect(asked.filter((url) => url.startsWith('/club?'))).toEqual([`/club?team=${TEAM}`])
    // 25명이라 건강 요청은 한 번이고, 한 번에 30명을 넘기지 않는다
    const healthCalls = asked.filter((url) => url.startsWith('/health?'))
    expect(healthCalls).toHaveLength(Math.ceil(25 / HEALTH_PER_REQUEST))
    expect(HEALTH_BATCH).toBe(HEALTH_PER_REQUEST)
    expect(healthCalls[0].split('uids=')[1].split('&')[0].split(',')).toHaveLength(25)
  })
})

describe('/people: 몸값·주급·계약·국적', () => {
  it('답을 읽고, 선수마다 글자와 정렬용 숫자가 함께 있다', async () => {
    const answers = await gamePeople(roster.map((each) => each.uid))
    expect(answers).toHaveLength(25)
    expect(asked.at(-1)).toBe(`/people?uids=${roster.map((each) => each.uid).join(',')}`)
    for (const each of answers!) {
      expect(each.valueSort, `${each.uid} 몸값`).toBeGreaterThan(0)
      expect(each.wageSort, `${each.uid} 주급`).toBeGreaterThan(0)
      expect(each.value).toMatch(/원/)
      expect(each.wage).toMatch(/^주급 /)
      expect(each.contractEnd).toMatch(/^\d{4}년\/\d{1,2}월\/\d{1,2}일$/)
      expect(each.gender).toBe('False')
    }
    expect(PEOPLE_PER_REQUEST).toBe(30)
  })

  it('세이브의 주급·몸값(roster)과 게임이 알려 준 정렬 값(people)이 모든 선수에서 0.5% 안으로 같다(게임이 주급을 어림해 적는 한 명은 0.07% 차이)', () => {
    const byUid = new Map(fixture<Person[]>('people').map((each) => [each.uid, each]))
    for (const saved of roster) {
      expect(Math.abs(byUid.get(saved.uid)!.wageSort - saved.wage) / saved.wage, `${saved.name} 주급`).toBeLessThan(0.005)
      expect(Math.abs(byUid.get(saved.uid)!.valueSort - saved.value) / saved.value, `${saved.name} 몸값`).toBeLessThan(0.005)
    }
  })

  it('WorldService.market이 시장 정보로 바꾼다: 글자 그대로, 날짜는 읽고, 성별은 참 거짓으로', async () => {
    const ws = new WorldService({ knownTeam: () => undefined, rosterNames: () => [], rememberTeam: () => undefined, roleWeights: () => ({}), namesDir: join(tmpdir(), 'fmb-contract-names') })
    const result = await ws.market(roster.map((each) => each.uid))
    expect(result.ok).toBe(true)
    expect(result.players).toHaveLength(25)
    const person = fixture<Person[]>('people')[0]
    const first = result.players.find((each) => each.uid === person.uid)!
    expect(first).toEqual({
      uid: person.uid,
      value: person.value,
      valueSort: person.valueSort,
      wage: person.wage,
      wageSort: person.wageSort,
      contractEnd: { year: 2028, month: 6, day: 30 },
      nation: person.nation,
      club: '가상 FC',
      female: false
    })
    expect(result.players.every((each) => each.female === false)).toBe(true)
  })
})

describe('/names: 나라와 팀 이름', () => {
  it('번호와 이름 목록을 읽고, 팀의 성별 값을 그대로 둔다', async () => {
    expect(await gameNames('team', [7, 9])).toEqual([
      { id: 7, name: '가상국1' },
      { id: 9, name: '가상 FC', club: '가상 FC', gender: 'True' }
    ])
  })
})

describe('앱이 아직 읽지 않는 녹화본: roles(게임의 역할과 별점)', () => {
  it('모양을 고정해 둔다: 선수마다 게임이 고른 최적 역할이 있고, 전술을 맡은 선수만 별점이 있다', () => {
    const roles = fixture<RoleEntry[]>('roles')
    expect(roles).toHaveLength(25)
    const known = new Set(roster.map((each) => each.uid))
    for (const each of roles) {
      expect(known.has(each.uid)).toBe(true)
      expect(typeof each.best).toBe('string')
      expect(typeof each.bestOop).toBe('string')
      expect(Number(each.ca)).toBeGreaterThanOrEqual(0)
      if (each.tactic) {
        // 별점은 20점 만점의 글자 숫자
        for (const star of [each.ipMin, each.ipMax, each.oop]) expect(Number(star)).toBeGreaterThan(0)
        for (const star of [each.ipMin, each.ipMax, each.oop]) expect(Number(star)).toBeLessThanOrEqual(20)
        expect(Number(each.ipMax)).toBeGreaterThanOrEqual(Number(each.ipMin))
      } else {
        expect(each.ipMin).toBeUndefined()
      }
    }
    expect(roles.filter((each) => each.tactic).length).toBeGreaterThan(0)
  })
})
