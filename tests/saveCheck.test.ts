/**
 * 세이브 형식 자가 점검(A-16)의 시험. 지어낸 세이브(선수·구단 이름은 모두 지어낸 것)를 만들어,
 * 멀쩡한 세이브는 통과하고 일부러 깨뜨린 세이브는 걸리며, 걸리면 점수 화면(스쿼드·영입 후보·대시보드)에 아무것도 안 나오는지 본다.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DashboardService } from '../src/main/dashboardService'
import { checkSaveWorld, SAVE_GUARDS } from '../src/main/saveCheck'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from '../src/main/save/reader'
import { NO_TEAM, SEX_MALE, type SaveWorld } from '../src/main/save/world'
import { WorldService } from '../src/main/worldService'
import { POSITION_KEYS } from '../src/shared/positions'
import type { CandidateQuery } from '../src/shared/world'

const N = 6_000
const DC = POSITION_KEYS.indexOf('DC')

/** 멀쩡한 세이브: 현재 능력과 능력치가 함께 오르고, 모두 범위 안이다. 팀 100이 내 팀(선수 25명) */
function healthy(n = N, loans = true): SaveWorld {
  const world: SaveWorld = {
    count: n,
    names: Array.from({ length: n }, (_, i) => `선수${i}`),
    uids: Uint32Array.from({ length: n }, (_, i) => 1000 + i),
    teamIds: Uint32Array.from({ length: n }, (_, i) => (i < 25 ? 100 : 200 + (i % 100))),
    club: Int32Array.from({ length: n }, (_, i) => (i < 25 ? 0 : 1 + (i % 100))),
    clubs: Array.from({ length: 101 }, (_, i) => ({ uid: 9000 + i, name: `가상구단${i}`, short: `G${i}`, women: false })),
    ca: new Uint16Array(n),
    pa: new Uint16Array(n),
    value: new Uint32Array(n).fill(1_000_000),
    wage: new Uint32Array(n).fill(20_000),
    contractEnd: new Uint32Array(n).fill(2029 * 1000 + 181),
    loanFrom: Uint32Array.from({ length: n }, (_, i) => (loans && i % 15 === 7 && i >= 25 ? 200 : NO_TEAM)),
    contractTeam: new Uint32Array(n).fill(NO_TEAM),
    squadStatus: new Uint8Array(n).fill(4),
    nationId: new Uint16Array(n),
    sex: new Uint8Array(n).fill(SEX_MALE),
    birthYear: Uint16Array.from({ length: n }, (_, i) => 2026 - (17 + (i % 20))),
    birthDay: new Uint16Array(n).fill(1),
    positions: new Uint8Array(n * POSITION_COUNT).fill(1),
    attributes: new Uint8Array(n * ATTRIBUTE_COUNT),
    teamId: 100,
    gameDate: { year: 2026, day: 3 }
  }
  for (let i = 0; i < n; i++) {
    const ca = 60 + ((i * 7) % 90) // 60~149
    world.ca[i] = ca
    world.pa[i] = Math.min(200, ca + 10)
    world.positions[i * POSITION_COUNT + DC] = 20
    // 능력치 저장값(1~100)은 현재 능력에 비례하고 조금씩 흔들린다
    for (let a = 0; a < ATTRIBUTE_COUNT; a++) world.attributes[i * ATTRIBUTE_COUNT + a] = Math.max(1, Math.min(100, Math.round(ca / 3 + ((a * 5 + i) % 7) - 3)))
  }
  return world
}

const problemsOf = (world: SaveWorld): string => checkSaveWorld(world).problems.join(' / ')

describe('세이브 형식 점검: 멀쩡한 세이브는 통과한다', () => {
  it('지어낸 멀쩡한 세이브에는 문제가 없다', () => {
    const result = checkSaveWorld(healthy())
    expect(result.problems).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('실제 세이브에서 흔히 보이는 소수의 깨진 기록(이름 없음, 능력 범위 밖)은 허용한다', () => {
    const world = healthy()
    world.names[0] = ''
    world.names[1] = ''
    world.ca[0] = 27_652
    world.pa[0] = 26_482
    world.ca[1] = 371
    world.pa[1] = 3
    expect(checkSaveWorld(world).ok).toBe(true)
  })
})

describe('세이브 형식 점검: 일부러 깨뜨린 세이브는 걸린다', () => {
  it('선수 수가 너무 적다', () => {
    const world = healthy()
    world.count = SAVE_GUARDS.playersMin - 1
    expect(problemsOf(world)).toContain('선수 수가')
  })

  it('이름 없는 선수가 많다', () => {
    const world = healthy()
    for (let i = 0; i < N * 0.2; i++) world.names[i] = ''
    expect(problemsOf(world)).toContain('이름을 읽지 못한 선수')
  })

  it('임대 선수가 너무 많다', () => {
    const world = healthy()
    world.loanFrom.fill(200)
    expect(problemsOf(world)).toContain('임대 선수가')
  })

  it('선수가 아주 많은데 임대가 거의 없으면 임대 읽기가 깨진 것으로 본다', () => {
    expect(checkSaveWorld(healthy(30_000)).ok).toBe(true)
    expect(problemsOf(healthy(30_000, false))).toContain('임대 선수가')
  })

  it('현재·잠재 능력이 1~200을 벗어난 선수가 많다', () => {
    const world = healthy()
    for (let i = 0; i < N * 0.1; i++) world.ca[i] = 0
    expect(problemsOf(world)).toContain('1~200')
  })

  it('현재 능력이 잠재 능력보다 크게 높은 선수가 많다', () => {
    const world = healthy()
    for (let i = 0; i < N * 0.1; i++) world.pa[i] = Math.max(1, world.ca[i] - 20)
    expect(problemsOf(world)).toContain('잠재 능력보다')
  })

  it('능력치가 1~100을 벗어난 값이 많다', () => {
    const world = healthy()
    for (let i = 0; i < N * 0.1; i++) world.attributes[i * ATTRIBUTE_COUNT + 3] = 180
    expect(problemsOf(world)).toContain('능력치가 1~100')
  })

  it('포지션 숙련이 1~20을 벗어난 값이 많다', () => {
    const world = healthy()
    for (let i = 0; i < N * 0.1; i++) world.positions[i * POSITION_COUNT + 2] = 99
    expect(problemsOf(world)).toContain('포지션 숙련이 1~20')
  })

  it('뛸 수 있는 포지션이 하나도 없는 선수가 많다', () => {
    const world = healthy()
    for (let i = 0; i < N * 0.2; i++) world.positions[i * POSITION_COUNT + DC] = 3
    expect(problemsOf(world)).toContain('뛸 수 있는 포지션')
  })

  it('현재 능력의 평균이 이상하다', () => {
    const world = healthy()
    for (let i = 0; i < N; i++) world.ca[i] = Math.min(200, world.ca[i] + 100)
    expect(problemsOf(world)).toContain('현재 능력 평균')
  })

  it('현재 능력과 능력치가 어긋나게 읽혔다(관계가 사라진다)', () => {
    const world = healthy()
    // 능력치를 선수 순서와 무관한 값으로 바꾼다: 범위는 멀쩡하지만 현재 능력과의 관계가 없다
    for (let i = 0; i < N; i++) for (let a = 0; a < ATTRIBUTE_COUNT; a++) world.attributes[i * ATTRIBUTE_COUNT + a] = 1 + (((i * 2654435761) >>> 0) % 100)
    expect(problemsOf(world)).toContain('관계가 약합니다')
  })

  it('나이가 이상하다(생일을 엉뚱하게 읽음)', () => {
    const world = healthy()
    world.birthYear.fill(1500)
    expect(problemsOf(world)).toContain('나이가')
  })

  it('걸린 항목마다 무엇이 이상한지가 한 줄씩 담긴다', () => {
    const world = healthy()
    for (let i = 0; i < N * 0.2; i++) world.names[i] = ''
    world.birthYear.fill(1500)
    const result = checkSaveWorld(world)
    expect(result.ok).toBe(false)
    expect(result.problems.length).toBeGreaterThanOrEqual(2)
    expect(result.problems.every((line) => line.length > 5)).toBe(true)
  })
})

const ask = (over: Partial<CandidateQuery> = {}): CandidateQuery => ({
  roleId: 'cb', category: 'all', maxAge: null, onlyEligible: true, includeUnknownClub: false, search: '', expiringWithinMonths: null, ...over
})

function service(world: SaveWorld): WorldService {
  const ws = new WorldService({
    knownTeam: () => 100,
    rosterNames: () => [],
    rememberTeam: () => undefined,
    roleWeights: () => ({}),
    namesDir: join(tmpdir(), 'fm-savecheck-names')
  })
  ;(ws as unknown as { loaded: unknown }).loaded = {
    path: '가상.fm', mtimeMs: 1, size: 1, world, byUid: new Map(), live: null, note: '', check: checkSaveWorld(world)
  }
  return ws
}

describe('세이브 형식 점검에 걸리면 점수가 나오는 곳이 모두 막힌다', () => {
  const broken = healthy()
  for (let i = 0; i < N * 0.2; i++) broken.names[i] = ''
  broken.birthYear.fill(1500)

  it('멀쩡한 세이브는 스쿼드가 나온다(막지 않는다)', () => {
    const ws = service(healthy())
    expect(ws.blocked()).toBeNull()
    expect(ws.squad().ok).toBe(true)
    expect(ws.squad().rows.length).toBeGreaterThan(0)
  })

  it('깨진 세이브: 스쿼드는 줄이 없고 안내가 나온다', () => {
    const ws = service(broken)
    const squad = ws.squad()
    expect(squad.ok).toBe(false)
    expect(squad.rows).toEqual([])
    expect(squad.message).toContain('세이브 형식이 바뀐 것 같습니다')
  })

  it('깨진 세이브: 영입 후보는 한 줄도 나오지 않는다', () => {
    const result = service(broken).candidates(ask())
    expect(result.ok).toBe(false)
    expect(result.rows).toEqual([])
    expect(result.message).toContain('세이브 형식이 바뀐 것 같습니다')
  })

  it('깨진 세이브: 대시보드는 비어 있고 안내가 나온다', async () => {
    const ws = service(broken)
    const dashboard = new DashboardService({
      world: ws,
      season: { season: async () => ({ ok: false, recent: [], upcoming: [] }) } as never,
      settings: () => ({ formation: '4-2-3-1', slotRoles: {}, roleWeights: {} }),
      namesDir: join(tmpdir(), 'fm-savecheck-names')
    })
    const data = await dashboard.dashboard()
    expect(data.ok).toBe(false)
    expect(data.message).toContain('세이브 형식이 바뀐 것 같습니다')
  })

  it('화면으로 가는 연결 상태에 점검 결과가 실린다', () => {
    const extras = service(broken).extras()
    expect(extras.check.ok).toBe(false)
    expect(extras.check.problems.length).toBeGreaterThan(0)
    expect(service(healthy()).extras().check.ok).toBe(true)
  })
})
