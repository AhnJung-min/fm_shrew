/**
 * 플러그인 창구의 앱 쪽 계약 검사(N-04). 켜진 게임에서 녹화한 응답을 이름만 지어낸 값으로 바꾼 것(tests/fixtures/plugin/)을
 * 가짜 플러그인 서버가 그대로 돌려주고, 앱의 코드(bridge.ts, club.ts, clubService.ts, worldService.market)가 기대한 값을 내는지 본다.
 * 플러그인(C#)을 올릴 때 응답 모양이 바뀌면 이 검사가 앱 쪽에서 먼저 알려 준다.
 *
 * 녹화본은 club, health, people, roles, roster다. state는 녹화본이 없어 bridge.ts가 읽는 모양대로 직접 만들었다.
 * 0.14.0의 새 창구(/tactic, /rolestars, /state의 게임 버전·게임 날짜·선수 번호)는 아직 켜진 게임에서 녹화하지 않았다. 견본(state-0.14, tactic, rolestars)은
 * 게임에서 읽어 둔 비트와 역할 번호의 꼴에 지어낸 이름과 번호를 입힌 것이고, 사용자가 게임에서 새 창구를 확인한 뒤 실제 응답 녹화본으로 바꾼다(docs/checklist.md).
 * 모든 이름(선수, 구단, 경기장, 리그, 나라, 감독)과 고유 번호는 지어낸 값이다.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ClubService, firstTeam } from '../src/main/clubService'
import { GameLink } from '../src/main/gameLink'
import { POSITION_COUNT } from '../src/main/save/reader'
import type { SaveWorld } from '../src/main/save/world'
import { importTactic, readGameTactic, type GameTacticInput } from '../src/main/tacticImportService'
import { gameClub, gameHealth, gameNames, gamePeople, gameRoleStars, gameState, gameTactic, HEALTH_BATCH, PEOPLE_PER_REQUEST, type GameState } from '../src/main/talk/bridge'
import { WorldService } from '../src/main/worldService'
import { buildSnapshot, HEALTH_PER_REQUEST, type RosterPlayer } from '../src/shared/club'
import { gameReadGate } from '../src/shared/compat'
import { CLUB_PLUGIN, MARKET_PLUGIN, NEEDED_PLUGIN, NO_DATA, TACTIC_PLUGIN, versionOlder, type GameStatus, type LinkStatus } from '../src/shared/game'
import { parseRoleStars } from '../src/shared/roleStars'
import { LEGACY_CATALOG } from '../src/shared/roleCatalog'
import { parseTacticAnswer } from '../src/shared/tacticImport'
import { fakeCatalogFromTactic } from './helpers/fakeGameCatalog'

const fixture = <T,>(name: string): T => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'plugin', `${name}.json`), 'utf8')) as T

interface Person { uid: number; age: number; value: string; valueSort: number; wage: string; wageSort: number; contractEnd: string; nation: string; club: string; gender: string }
interface RosterEntry { uid: number; name: string; wage: number; value: number }
interface RoleEntry { uid: number; name: string; best: string; bestOop: string; tactic?: string; ipMin?: string; ipMax?: string; oop?: string; ca: string }

const club = readFileSync(join(__dirname, 'fixtures', 'plugin', 'club.json'), 'utf8')
const health = readFileSync(join(__dirname, 'fixtures', 'plugin', 'health.json'), 'utf8')
const people = readFileSync(join(__dirname, 'fixtures', 'plugin', 'people.json'), 'utf8')
const state = readFileSync(join(__dirname, 'fixtures', 'plugin', 'state.json'), 'utf8')
const state14 = readFileSync(join(__dirname, 'fixtures', 'plugin', 'state-0.14.json'), 'utf8')
const tacticText = readFileSync(join(__dirname, 'fixtures', 'plugin', 'tactic.json'), 'utf8')
const roleStarsText = readFileSync(join(__dirname, 'fixtures', 'plugin', 'rolestars.json'), 'utf8')
/** 0.13.0 플러그인의 /state: 게임 버전을 모른다(0.11.0 녹화본에서 버전만 바꾼 것) */
const state13 = JSON.stringify({ ...JSON.parse(state), version: '0.13.0' })
const roster = fixture<RosterEntry[]>('roster')
const TEAM = 9001

let server: Server
let oldPlugin = false
/** 가짜 플러그인의 판: 0.14.0이면 /tactic과 /rolestars에 견본으로 답한다 */
let plugin: '0.11.0' | '0.13.0' | '0.14.0' = '0.11.0'
/** /tactic이 "player not found"(404)로 답할 선수 번호들, 그리고 게임이 바빠 모두 503으로 답하는지 */
let missing = new Set<number>()
/** /tactic이 자리 없는 빈 답(전술을 읽을 수 없는 선수)으로 답할 선수 번호들 */
let emptyFor = new Set<number>()
let busy = false
/** /tactic의 답을 견본 대신 이 글자로 돌려준다(null이면 견본) */
let tacticOverride: string | null = null
/** /state의 답을 견본 대신 이 글자로 돌려준다(null이면 견본) */
let stateOverride: string | null = null
const asked: string[] = []

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = request.url ?? ''
    asked.push(url)
    const json = (body: string): void => void response.writeHead(200, { 'content-type': 'application/json' }).end(body)
    if (request.headers['x-bridge-token'] !== 'secret') response.writeHead(401).end('bad token')
    else if (url === '/ping') response.end('fm-bojwagwan-bridge 0.9.0')
    else if (url === '/state') (oldPlugin ? response.writeHead(404).end('unknown path') : json(stateOverride ?? (plugin === '0.14.0' ? state14 : plugin === '0.13.0' ? state13 : state)))
    else if (plugin === '0.14.0' && url.startsWith('/tactic?')) {
      const query = new URL(url, 'http://localhost').searchParams
      if (busy) response.writeHead(503).end('game busy')
      else if (missing.has(Number(query.get('uid')))) response.writeHead(404).end('player not found')
      else if (emptyFor.has(Number(query.get('uid')))) json(JSON.stringify({ ip: { fields: {}, items: [] }, oop: { fields: {}, items: [] } }))
      else if (tacticOverride !== null) json(tacticOverride)
      else json(query.get('roles') === '1' ? tacticText : JSON.stringify({ ip: JSON.parse(tacticText).ip, oop: JSON.parse(tacticText).oop }))
    } else if (plugin === '0.14.0' && url.startsWith('/rolestars?')) json(roleStarsText)
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

// ---------- 플러그인 0.14.0: 게임 판 확인, 게임 전술(/tactic), 역할 별점(/rolestars) ----------

/** 견본의 문자 값이 모두 지어낸 이름이거나 숫자·표지·버전 글자인지(실제 이름이 남아 있지 않다) */
function strangersIn(value: unknown, found: string[] = [], key = ''): string[] {
  if (Array.isArray(value)) value.forEach((each) => strangersIn(each, found, key))
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, each]) => strangersIn(each, found, k))
  else if (typeof value === 'string' && !/^(\d+|True|False|ok|ip|oop|가상.*|선수\d\d|\d+\.\d+\.\d+(\+\d+)?|\d{4}-\d{2}-\d{2})$/.test(value)) found.push(`${key}: ${value}`)
  return found
}

describe('0.14.0 견본 자체의 점검', () => {
  it('이름 자리는 모두 지어낸 값이고, 선수 번호는 9000xxxx 꼴이다', () => {
    expect(strangersIn(JSON.parse(state14))).toEqual([])
    expect(strangersIn(JSON.parse(tacticText))).toEqual([])
    expect(strangersIn(JSON.parse(roleStarsText))).toEqual([])
    const ids: number[] = []
    const walk = (value: unknown, key = ''): void => {
      if (Array.isArray(value)) value.forEach((each) => walk(each, key))
      else if (value && typeof value === 'object') Object.entries(value).forEach(([k, each]) => walk(each, k))
      else if (typeof value === 'number' && (key === 'id' || key === 'uid')) ids.push(value)
    }
    walk(JSON.parse(tacticText))
    walk(JSON.parse(roleStarsText))
    expect(ids.length).toBeGreaterThan(20)
    expect(ids.every((id) => id >= 90_000_001 && id <= 90_000_999)).toBe(true)
  })
})

/** 게임 연결 상태(앱이 /state를 읽어 만드는 GameStatus와 같은 꼴) */
async function gameStatusNow(): Promise<GameStatus> {
  const read = (await gameState()) as GameState
  return {
    connected: true,
    pluginVersion: read.version,
    pluginOld: versionOlder(read.version, NEEDED_PLUGIN),
    loaded: read.loaded,
    manager: read.manager,
    team: read.team,
    teamShort: read.teamShort,
    ...(read.gameVersion === undefined ? {} : { gameVersion: read.gameVersion })
  }
}

describe('플러그인 0.14.0 문(N-02): 새 기능만 열고 닫는다', () => {
  it('0.14.0의 /state는 게임 버전을 주고, 게임 전술 가져오기와 별점 대조의 문이 열린다', async () => {
    plugin = '0.14.0'
    try {
      const read = await gameState()
      expect(read?.version).toBe('0.14.0')
      expect(read?.gameVersion).toBe('26.3.2+2329565')
      const status = await gameStatusNow()
      for (const feature of ['tactic', 'stars'] as const) {
        const gate = gameReadGate(status, feature)
        expect(gate.open, feature).toBe(true)
        expect(gate.row?.game).toBe('26.3.2')
      }
    } finally {
      plugin = '0.11.0'
    }
  })

  it('0.13.0이면 두 문이 닫히고(까닭에 0.14.0이 적힌다), 구단·건강·시장·이름은 그대로 읽힌다', async () => {
    plugin = '0.13.0'
    try {
      const read = await gameState()
      expect(read?.version).toBe('0.13.0')
      // 게임 버전 칸이 아예 없다(0.14.0에서 빈 글자로 오는 것과 다르다)
      expect(read).not.toHaveProperty('gameVersion')
      const status = await gameStatusNow()
      expect(status.pluginOld).toBe(false)
      for (const feature of ['tactic', 'stars'] as const) {
        const gate = gameReadGate(status, feature)
        expect(gate.open, feature).toBe(false)
        expect(gate.reason).toContain('0.14.0 이상')
        expect(gate.reason).toContain('0.13.0')
      }
      // 새 창구는 모르는 길이라 null이다(다른 기능은 막지 않는다)
      expect(await gameTactic(TEAM, roster[0].uid)).toBeNull()
      expect(await gameRoleStars(TEAM, [roster[0].uid])).toBeNull()
      expect(versionOlder('0.13.0', TACTIC_PLUGIN)).toBe(true)
      // 나머지 창구는 그대로다
      expect((await gameClub(TEAM))?.records).toHaveLength(1)
      expect((await gameHealth(rosterPlayers.map((each) => each.uid), TEAM))?.records).toHaveLength(8)
      expect(await gamePeople(roster.map((each) => each.uid))).toHaveLength(25)
      expect(await gameNames('team', [7, 9])).toHaveLength(2)
    } finally {
      plugin = '0.11.0'
    }
  })

  it('0.14.0이어도 게임 판이 표에 없거나 읽지 못했으면 문이 닫힌다', async () => {
    plugin = '0.14.0'
    try {
      const status = await gameStatusNow()
      expect(gameReadGate({ ...status, gameVersion: '26.4.0' }, 'tactic').open).toBe(false)
      expect(gameReadGate({ ...status, gameVersion: '' }, 'stars').open).toBe(false)
      expect(gameReadGate({ ...status, gameVersion: undefined }, 'stars').reason).toContain('확인 못 함')
    } finally {
      plugin = '0.11.0'
    }
  })
})

describe('/state의 게임 날짜와 내 팀 선수 번호(0.14.0)', () => {
  const names = roster.map((each) => each.name)
  const ids = roster.map((each) => each.uid)
  /** 견본 /state에서 몇 칸만 바꾼 응답 */
  const stateWith = (change: Record<string, unknown>): string => JSON.stringify({ ...JSON.parse(state14), ...change })

  it('견본의 날짜와 번호: 번호는 이름과 같은 순서·같은 수이고, 이름과 번호 모두 지어낸 값이다', () => {
    const sample = JSON.parse(state14) as { gameDate: string; players: string[]; playerIds: number[] }
    expect(sample.gameDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(sample.playerIds).toHaveLength(sample.players.length)
    expect(sample.players).toEqual(names)
    expect(sample.playerIds).toEqual(ids)
    expect(sample.playerIds.every((id) => id >= 90_000_001 && id <= 90_000_999)).toBe(true)
  })

  it('0.14.0의 /state에서 날짜와 선수 번호를 읽는다', async () => {
    plugin = '0.14.0'
    try {
      const read = await gameState()
      expect(read).toEqual({
        version: '0.14.0',
        gameVersion: '26.3.2+2329565',
        gameDate: '2026-08-15',
        loaded: true,
        manager: '가상 감독',
        team: '가상 FC',
        teamShort: '가상',
        players: names,
        playerIds: ids
      })
    } finally {
      plugin = '0.11.0'
    }
  })

  it('옛 플러그인(0.13.0, 0.11.0)의 /state에는 두 칸이 아예 없다(빈 값이 아니라 "모름"으로 읽힌다)', async () => {
    for (const old of ['0.13.0', '0.11.0'] as const) {
      plugin = old
      try {
        const read = await gameState()
        expect(read?.version, old).toBe(old)
        expect(read, old).not.toHaveProperty('gameDate')
        expect(read, old).not.toHaveProperty('playerIds')
        expect(read?.players, old).toEqual(names)
      } finally {
        plugin = '0.11.0'
      }
    }
  })

  it('게임이 날짜를 아직 모르면 빈 글자, 읽을 수 없는 글자도 빈 글자다', async () => {
    plugin = '0.14.0'
    try {
      for (const sent of ['', '2026-8-15', '15/08/2026', '2026-08-15T00:00:00', 20260815, null]) {
        stateOverride = stateWith({ gameDate: sent })
        const read = await gameState()
        // 숫자나 null처럼 글자가 아니면 칸이 없는 것으로 읽는다. 글자인데 날짜가 아니면 빈 글자(아직 모름)다
        if (typeof sent === 'string') expect(read?.gameDate, String(sent)).toBe('')
        else expect(read, String(sent)).not.toHaveProperty('gameDate')
      }
    } finally {
      stateOverride = null
      plugin = '0.11.0'
    }
  })

  it('읽지 못한 번호(0, 음수, 소수, 글자)는 0으로 자리를 지킨다: 이름과 같은 순서를 깨지 않는다', async () => {
    plugin = '0.14.0'
    try {
      stateOverride = stateWith({ playerIds: [ids[0], 0, -5, 1.5, '90000005', null, ...ids.slice(6)] })
      const read = await gameState()
      expect(read?.playerIds).toEqual([ids[0], 0, 0, 0, 0, 0, ...ids.slice(6)])
      expect(read?.playerIds).toHaveLength(read!.players.length)
      // 목록이 아니면 칸이 없는 것으로 읽는다
      stateOverride = stateWith({ playerIds: 'x' })
      expect(await gameState()).not.toHaveProperty('playerIds')
    } finally {
      stateOverride = null
      plugin = '0.11.0'
    }
  })

  describe('GameLink가 앱 안에 알린다', () => {
    const world = {
      path: null,
      status: () => NO_DATA,
      extras: () => ({ check: { ok: true, problems: [] }, teamNote: '' }),
      setLiveOff: () => undefined,
      setMarketOff: () => undefined
    } as never
    /** 게임 상태를 한 번 읽는다(앱은 3초마다 읽는다) */
    const poll = (link: GameLink): Promise<void> => (link as unknown as { check(): Promise<void> }).check()

    it('오늘 날짜는 상태(game.gameDate)에 실리고, 선수 번호는 rosterIds()로 나온다(읽지 못한 0은 뺀다)', async () => {
      const notified: LinkStatus[] = []
      const link = new GameLink(world, () => tmpdir(), (status) => notified.push(status))
      expect(link.rosterIds()).toEqual([])
      plugin = '0.14.0'
      try {
        await poll(link)
        expect(link.status().game).toMatchObject({ connected: true, pluginVersion: '0.14.0', loaded: true, gameVersion: '26.3.2+2329565', gameDate: '2026-08-15' })
        expect(link.rosterIds()).toEqual(ids)
        expect(link.rosterNames()).toEqual(names)
        expect(notified).toHaveLength(1)
        // 같은 답이면 다시 알리지 않고, 게임에서 하루가 지나 날짜가 바뀌면 알린다
        await poll(link)
        expect(notified).toHaveLength(1)
        stateOverride = stateWith({ gameDate: '2026-08-16' })
        await poll(link)
        expect(link.status().game.gameDate).toBe('2026-08-16')
        expect(notified).toHaveLength(2)
        // 일부 번호를 읽지 못했으면 그 선수만 빠지고, 이름은 그대로 모두 남는다
        stateOverride = stateWith({ playerIds: [0, ids[1], 0, ...ids.slice(3)] })
        await poll(link)
        expect(link.rosterIds()).toEqual([ids[1], ...ids.slice(3)])
        expect(link.rosterNames()).toEqual(names)
      } finally {
        stateOverride = null
        plugin = '0.11.0'
      }
    })

    it('옛 플러그인이거나 게임이 꺼지면 날짜는 없고 선수 번호는 빈 목록이다', async () => {
      const link = new GameLink(world, () => tmpdir(), () => undefined)
      const home = process.env.LOCALAPPDATA
      try {
        plugin = '0.14.0'
        await poll(link)
        expect(link.rosterIds()).toHaveLength(25)
        // 플러그인이 0.13.0으로 돌아갔다: 날짜 칸이 없고 번호는 모른다(이름은 그대로 온다)
        plugin = '0.13.0'
        await poll(link)
        expect(link.status().game).not.toHaveProperty('gameDate')
        expect(link.rosterIds()).toEqual([])
        expect(link.rosterNames()).toEqual(names)
        // 게임이 꺼져 /state도 /ping도 답하지 않으면 모두 비운다
        plugin = '0.14.0'
        await poll(link)
        expect(link.rosterIds()).toHaveLength(25)
        process.env.LOCALAPPDATA = join(tmpdir(), 'fmb-contract-none')
        await poll(link)
        expect(link.status().game.connected).toBe(false)
        expect(link.status().game).not.toHaveProperty('gameDate')
        expect(link.rosterIds()).toEqual([])
        expect(link.rosterNames()).toEqual([])
      } finally {
        process.env.LOCALAPPDATA = home
        plugin = '0.11.0'
      }
    })
  })
})

describe('/tactic과 /rolestars: 앱 쪽 요청과 해독', () => {
  it('/tactic: 팀과 선수 번호로 묻고 자리 11개의 두 국면을 읽는다. roles=1이면 자리별 역할 목록 22개도 온다', async () => {
    plugin = '0.14.0'
    try {
      asked.length = 0
      const plain = parseTacticAnswer(await gameTactic(TEAM, 90_000_001))
      expect(asked).toEqual([`/tactic?team=${TEAM}&uid=90000001`])
      expect(plain?.ip.rows).toHaveLength(11)
      expect(plain?.oop.rows).toHaveLength(11)
      expect(plain?.roleLists).toEqual([])
      const withRoles = parseTacticAnswer(await gameTactic(TEAM, 90_000_001, true))
      expect(asked.at(-1)).toBe(`/tactic?team=${TEAM}&uid=90000001&roles=1`)
      expect(withRoles?.roleLists).toHaveLength(22)
      // 소수는 버린다
      await gameTactic(TEAM + 0.7, 90_000_001.9)
      expect(asked.at(-1)).toBe(`/tactic?team=${TEAM}&uid=90000001`)
    } finally {
      plugin = '0.11.0'
    }
  })

  it('/tactic: 선수를 찾지 못하거나(404) 게임이 바쁘면(503) null이다', async () => {
    plugin = '0.14.0'
    missing = new Set([90_000_001])
    try {
      expect(await gameTactic(TEAM, 90_000_001)).toBeNull()
      expect(await gameTactic(TEAM, 90_000_002)).not.toBeNull()
      busy = true
      expect(await gameTactic(TEAM, 90_000_002)).toBeNull()
    } finally {
      plugin = '0.11.0'
      missing = new Set()
      busy = false
    }
  })

  it('/rolestars: 선수 5명까지 한 번에 묻고 표를 줄로 푼다', async () => {
    plugin = '0.14.0'
    try {
      asked.length = 0
      const uids = Array.from({ length: 8 }, (_, at) => 90_000_001 + at)
      const rows = parseRoleStars(await gameRoleStars(TEAM, uids))
      expect(asked).toEqual([`/rolestars?team=${TEAM}&uids=90000001,90000002,90000003,90000004,90000005`])
      expect(rows?.length).toBeGreaterThan(50)
      expect(new Set(rows?.map((each) => each.uid)).size).toBe(5)
      // 선수가 없으면 묻지 않는다
      asked.length = 0
      expect(await gameRoleStars(TEAM, [])).toEqual({ players: [] })
      expect(asked).toEqual([])
    } finally {
      plugin = '0.11.0'
    }
  })
})

describe('게임에서 전술 가져오기(서비스): 문과 읽기 순서', () => {
  const catalog = fakeCatalogFromTactic(JSON.parse(tacticText))
  const uids = [90_000_001, 90_000_002, 90_000_003, 90_000_004]
  const input = async (change: Partial<GameTacticInput> = {}): Promise<GameTacticInput> => ({
    game: await gameStatusNow(),
    teamId: TEAM,
    uids,
    catalog,
    readRoleLists: false,
    id: 'game:test',
    ...change
  })
  const tacticCalls = (): string[] => asked.filter((url) => url.startsWith('/tactic?'))

  it('게임 전술을 읽어 전술 초안을 준다(저장하지 않는다). 걸린 시간과 전술 이름이 따라온다', async () => {
    plugin = '0.14.0'
    try {
      asked.length = 0
      const result = await readGameTactic(await input())
      expect(result.ok, result.message).toBe(true)
      expect(result.problems).toEqual([])
      expect(result.unknownBits).toEqual([])
      expect(result.draft?.slots).toHaveLength(11)
      expect(result.draft?.source).toBe('game')
      expect(result.gameName).toBe('가상 4-3-3 전술')
      expect(result.formationName).toBe('가상 4-1-2-3')
      expect(result.message).toContain('읽었습니다')
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
      expect(tacticCalls()).toEqual([`/tactic?team=${TEAM}&uid=90000001`])
    } finally {
      plugin = '0.11.0'
    }
  })

  it('자리별 역할 목록도 읽으면(roles=1) 앱의 목록과 견주고, 읽은 곳 수를 알린다', async () => {
    plugin = '0.14.0'
    try {
      asked.length = 0
      const result = await readGameTactic(await input({ readRoleLists: true }))
      expect(tacticCalls()).toEqual([`/tactic?team=${TEAM}&uid=90000001&roles=1`])
      expect(result.ok).toBe(true)
      expect(result.message).toContain('22곳')
      expect(result.message).toContain('0곳이 앱의 목록과 달랐습니다')
      // 앱의 목록이 다르면 어디가 다른지 문제 목록에 적힌다(ok는 전술을 읽은 결과 그대로다)
      const edited = JSON.parse(tacticText)
      edited.roles[12].probe.items.pop()
      const other = await readGameTactic(await input({ readRoleLists: true, catalog: fakeCatalogFromTactic(edited) }))
      expect(other.ok).toBe(true)
      expect(other.message).toContain('1곳이 앱의 목록과 달랐습니다')
      expect(other.problems).toHaveLength(1)
      expect(other.problems[0]).toContain('게임에만 있음')
    } finally {
      plugin = '0.11.0'
    }
  })

  it('자리별 역할 목록을 받았어도 자리를 찾지 못해 견주지 못한 것은 "다른 곳 없음"으로 알리지 않는다(견준 수를 적고 문제로 남긴다)', async () => {
    plugin = '0.14.0'
    try {
      // 목록 2곳의 포지션을 앱이 모르는 값으로: 22곳을 받았지만 20곳만 견준다
      const some = JSON.parse(tacticText)
      some.roles[0].probe.fields['Team.Tactic.PositionValue'] = '3'
      some.roles[1].probe.fields['Team.Tactic.PositionValue'] = '3'
      tacticOverride = JSON.stringify(some)
      const partial = await readGameTactic(await input({ readRoleLists: true }))
      expect(partial.ok).toBe(true)
      expect(partial.message).toContain('22곳(전체 22곳)을 읽어 20곳을 견주었고, 그 가운데 0곳이 앱의 목록과 달랐습니다')
      expect(partial.problems).toEqual(['자리별 역할 목록 2곳은 자리를 찾지 못해 견주지 못했습니다.'])

      // 목록의 포지션이 하나도 오지 않았으면 하나도 견주지 못했다고 알린다(0곳이 달랐다고 하지 않는다)
      const none = JSON.parse(tacticText)
      for (const list of none.roles) delete list.probe.fields['Team.Tactic.PositionValue']
      tacticOverride = JSON.stringify(none)
      const nothing = await readGameTactic(await input({ readRoleLists: true }))
      expect(nothing.ok).toBe(true)
      expect(nothing.message).toContain('하나도 견주지 못했습니다(읽은 목록 22곳, 전체 22곳)')
      expect(nothing.message).not.toContain('달랐습니다')
      expect(nothing.problems).toEqual(['자리별 역할 목록 22곳은 자리를 찾지 못해 견주지 못했습니다.'])

      // 게임이 바빠 중간에 멈춰 일부만 받았고 받은 것을 모두 견주었으면, 견주지 못했다는 문제는 만들지 않는다(받은 수와 전체 수로 알린다)
      const early = JSON.parse(tacticText)
      early.roles = early.roles.slice(0, 10)
      tacticOverride = JSON.stringify(early)
      const stopped = await readGameTactic(await input({ readRoleLists: true }))
      expect(stopped.message).toContain('10곳(전체 22곳)을 읽어 10곳을 견주었고')
      expect(stopped.problems).toEqual([])
    } finally {
      tacticOverride = null
      plugin = '0.11.0'
    }
  })

  it('첫 선수를 게임에서 찾지 못하면(404) 다음 선수로 해 보고, 세 명까지만 해 본다', async () => {
    plugin = '0.14.0'
    try {
      missing = new Set([uids[0]])
      asked.length = 0
      const second = await readGameTactic(await input())
      expect(second.ok).toBe(true)
      expect(tacticCalls()).toEqual([`/tactic?team=${TEAM}&uid=${uids[0]}`, `/tactic?team=${TEAM}&uid=${uids[1]}`])

      missing = new Set(uids)
      asked.length = 0
      const none = await readGameTactic(await input())
      expect(none.ok).toBe(false)
      expect(none.draft).toBeUndefined()
      expect(none.message).toContain('게임이 바쁩니다')
      expect(none.message).toContain('직접 만들어 주세요')
      expect(tacticCalls()).toHaveLength(3)
    } finally {
      plugin = '0.11.0'
      missing = new Set()
    }
  })

  it('자리가 하나도 오지 않은 빈 답이면 다음 선수로 해 본다(세 명까지). 끝내 비어 있으면 11개가 아니라고 알린다', async () => {
    plugin = '0.14.0'
    try {
      emptyFor = new Set([uids[0]])
      asked.length = 0
      const recovered = await readGameTactic(await input())
      expect(recovered.ok).toBe(true)
      expect(tacticCalls()).toEqual([`/tactic?team=${TEAM}&uid=${uids[0]}`, `/tactic?team=${TEAM}&uid=${uids[1]}`])

      emptyFor = new Set(uids)
      asked.length = 0
      const none = await readGameTactic(await input())
      expect(none.ok).toBe(false)
      expect(none.draft).toBeUndefined()
      expect(none.problems.join('\n')).toContain('11개여야 하는데 0개가 왔습니다')
      expect(none.message).toContain('직접 만들어 주세요')
      expect(tacticCalls()).toHaveLength(3)
    } finally {
      plugin = '0.11.0'
      emptyFor = new Set()
    }
  })

  it('실패가 오래 걸렸으면(시간 초과, 게임이 바쁨) 다른 선수로 다시 해 보지 않는다', async () => {
    plugin = '0.14.0'
    missing = new Set(uids)
    // 시계를 부를 때마다 11초씩 가게 해서, 한 번의 요청이 10초보다 오래 걸린 것처럼 만든다
    let clock = 1_700_000_000_000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 11_000))
    try {
      asked.length = 0
      const result = await readGameTactic(await input())
      expect(result.ok).toBe(false)
      expect(result.message).toContain('게임이 바쁩니다')
      expect(tacticCalls()).toHaveLength(1)
    } finally {
      now.mockRestore()
      plugin = '0.11.0'
      missing = new Set()
    }
  })

  it('게임이 날짜를 넘기는 중이면(503) "게임이 바쁩니다"로 끝나고 오류를 던지지 않는다', async () => {
    plugin = '0.14.0'
    busy = true
    try {
      const result = await readGameTactic(await input())
      expect(result).toMatchObject({ ok: false, problems: [], unknownBits: [] })
      expect(result.message).toContain('게임이 바쁩니다')
    } finally {
      plugin = '0.11.0'
      busy = false
    }
  })

  it('답을 읽을 수 없으면(숫자로 온 역할 번호, 모양이 틀림) 읽지 못했다고 알리고 전술을 만들지 않는다', async () => {
    plugin = '0.14.0'
    try {
      const broken = JSON.parse(tacticText)
      broken.ip.items[0].PositionRole = 4096
      for (const body of [JSON.stringify(broken), '{"ip":1}', '[]', 'json이 아님']) {
        tacticOverride = body
        const result = await readGameTactic(await input())
        expect(result.ok, body.slice(0, 20)).toBe(false)
        expect(result.draft).toBeUndefined()
        expect(result.message).toMatch(/읽지 못했습니다|게임이 바쁩니다/)
      }
    } finally {
      plugin = '0.11.0'
      tacticOverride = null
    }
  })

  it('앱이 모르는 역할이 오면 초안 없이 모르는 값을 알린다(저장하지 않는다)', async () => {
    plugin = '0.14.0'
    try {
      const unknownRole = JSON.parse(tacticText)
      unknownRole.oop.items[3].PositionRole = '77'
      tacticOverride = JSON.stringify(unknownRole)
      const result = await readGameTactic(await input())
      expect(result.ok).toBe(false)
      expect(result.draft).toBeUndefined()
      expect(result.unknownBits).toEqual(['비점유 시 역할 77'])
      expect(result.message).toContain('직접 만들어 주세요')
    } finally {
      plugin = '0.11.0'
      tacticOverride = null
    }
  })

  it('게임이 꺼져 있거나 플러그인이 낮거나 게임 판이 표에 없으면 게임에 묻지 않고 그 까닭을 알린다', async () => {
    plugin = '0.14.0'
    try {
      const base = await input()
      const cases: Array<[string, Partial<GameTacticInput>, string]> = [
        ['꺼짐', { game: { connected: false, pluginVersion: '', gameVersion: undefined } }, 'FM이 켜져'],
        ['플러그인 0.13.0', { game: { ...base.game, pluginVersion: '0.13.0', gameVersion: undefined } }, '0.14.0 이상'],
        ['게임 판 26.4.0', { game: { ...base.game, gameVersion: '26.4.0' } }, '26.4.0'],
        ['게임 판 읽지 못함', { game: { ...base.game, gameVersion: '' } }, '확인 못 함'],
        ['옛 14역할 목록', { catalog: LEGACY_CATALOG }, '옛 14역할']
      ]
      for (const [name, change, reason] of cases) {
        asked.length = 0
        const result = await readGameTactic({ ...base, ...change })
        expect(result.ok, name).toBe(false)
        expect(result.message, name).toContain(reason)
        expect(tacticCalls(), name).toEqual([])
      }
    } finally {
      plugin = '0.11.0'
    }
  })
})

describe('게임에서 전술 가져오기(창구): 읽기 전에 보는 조건', () => {
  const players = roster.map((each, at) => ({ ...each, at }))
  const world = {
    count: players.length,
    teamId: TEAM,
    teamIds: new Uint32Array(players.length).fill(TEAM),
    names: players.map((each) => each.name),
    uids: Uint32Array.from(players, (each) => each.uid),
    positions: new Uint8Array(players.length * POSITION_COUNT).fill(1)
  } as unknown as SaveWorld
  const connected: GameStatus = { connected: true, pluginVersion: '0.14.0', pluginOld: false, loaded: true, manager: '가상 감독', team: '가상 FC', teamShort: '가상', gameVersion: '26.3.2+2329565' }
  /** roster는 게임이 /state로 알려 준 지금 내 팀 선수 이름(알려 주지 않았으면 빈 목록) */
  const deps = (game: GameStatus, overrides: { world?: SaveWorld | null; path?: string | null; catalog?: string; roster?: string[] } = {}): Parameters<typeof importTactic>[0] =>
    ({
      settings: { get: () => ({ catalog: overrides.catalog ?? 'fm26', customRoles: [] }) },
      world: { world: overrides.world === undefined ? world : overrides.world, path: overrides.path === undefined ? '가상.fm' : overrides.path },
      link: { status: () => ({ game, data: { club: '가상 FC' }, busy: false }), rosterNames: () => overrides.roster ?? [] }
    }) as never

  it('세이브가 없거나 내 팀을 모르거나 게임에 세이브가 없거나 다른 팀이면 게임에 묻지 않는다', async () => {
    plugin = '0.14.0'
    try {
      asked.length = 0
      expect((await importTactic(deps(connected, { world: null, path: null }))).message).toContain('세이브를 골라')
      expect((await importTactic(deps(connected, { world: { ...world, teamId: undefined } as unknown as SaveWorld }))).message).toContain('내 팀을 아직 찾지 못했습니다')
      expect((await importTactic(deps({ ...connected, loaded: false }))).message).toContain('세이브를 불러온 뒤')
      expect((await importTactic(deps({ ...connected, team: '다른 FC' }))).message).toContain('다릅니다')
      expect((await importTactic(deps({ ...connected, pluginVersion: '0.13.0', gameVersion: undefined }))).message).toContain('0.14.0 이상')
      expect(asked.filter((url) => url.startsWith('/tactic?'))).toEqual([])
    } finally {
      plugin = '0.11.0'
    }
  })

  it('내 팀의 선수 번호(앞에서 세 명까지)와 팀 번호로 게임에 묻는다. 어떤 값도 던지지 않는다', async () => {
    plugin = '0.14.0'
    missing = new Set(roster.map((each) => each.uid))
    try {
      asked.length = 0
      const result = await importTactic(deps(connected), { readRoleLists: true })
      expect(result.ok).toBe(false)
      expect(asked.filter((url) => url.startsWith('/tactic?'))).toEqual([
        `/tactic?team=${TEAM}&uid=90000001&roles=1`,
        `/tactic?team=${TEAM}&uid=90000002&roles=1`,
        `/tactic?team=${TEAM}&uid=90000003&roles=1`
      ])
      // 지금 쓰는 역할 목록이 옛 14역할이면 게임 전술은 풀 수 없어 묻지 않고 알린다
      asked.length = 0
      expect((await importTactic(deps(connected, { catalog: 'legacy14' }))).message).toContain('옛 14역할')
      expect(asked.filter((url) => url.startsWith('/tactic?'))).toEqual([])
    } finally {
      plugin = '0.11.0'
      missing = new Set()
    }
  })

  it('저장한 뒤에 팀을 떠난 선수는 건너뛴다: 게임이 알려 준 지금 내 팀 선수 이름에 있는 선수에게만 묻는다(다른 팀의 전술이 오지 않게)', async () => {
    plugin = '0.14.0'
    // 모두 404로 답하게 해, 어느 선수에게 물었는지만 본다
    missing = new Set(roster.map((each) => each.uid))
    const bySaveOrder = [...roster].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    const asks = (): string[] => asked.filter((url) => url.startsWith('/tactic?'))
    const ask = (uids: number[]): string[] => uids.map((uid) => `/tactic?team=${TEAM}&uid=${uid}`)
    try {
      // 세이브 순서의 앞 세 명이 지금은 내 팀이 아니다: 네 번째부터 세 명에게 묻는다
      asked.length = 0
      await importTactic(deps(connected, { roster: bySaveOrder.slice(3).map((each) => each.name) }))
      expect(asks()).toEqual(ask(bySaveOrder.slice(3, 6).map((each) => each.uid)))
      // 지금 내 팀 선수가 한 명뿐이면 그 선수에게만 묻는다
      asked.length = 0
      await importTactic(deps(connected, { roster: [bySaveOrder[6].name] }))
      expect(asks()).toEqual(ask([bySaveOrder[6].uid]))
      // 게임이 이름을 알려 주지 않았거나(빈 목록) 하나도 겹치지 않으면 세이브의 순서 그대로 묻는다
      for (const names of [[], ['가상 다른 선수']]) {
        asked.length = 0
        await importTactic(deps(connected, { roster: names }))
        expect(asks(), JSON.stringify(names)).toEqual(ask(bySaveOrder.slice(0, 3).map((each) => each.uid)))
      }
    } finally {
      plugin = '0.11.0'
      missing = new Set()
    }
  })
})
