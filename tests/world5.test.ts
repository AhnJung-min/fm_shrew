/**
 * 수식 검토 5회차 반영 중 세이브 전체를 보는 쪽(WorldService, DashboardService)의 시험.
 * 지어낸 세이브(SaveWorld)를 직접 만들어 WorldService에 끼워 넣는다. 구단·선수 이름은 모두 지어낸 것이다.
 */
import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardService, wageModelMissing } from '../src/main/dashboardService'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from '../src/main/save/reader'
import { NO_TEAM, SEX_MALE, signedClubTeam, type SaveWorld } from '../src/main/save/world'
import { WorldService } from '../src/main/worldService'
import { POSITION_KEYS } from '../src/shared/positions'
import type { CandidateQuery } from '../src/shared/world'

interface Spec {
  name: string
  team: number
  /** 구단 순번. 소속이 없으면 -1 */
  club: number
  ca: number
  pa?: number
  age?: number
  /** 모든 능력치(게임 표시값 1~20). 역할 점수는 이 값 × 5 */
  level?: number
  status?: number
  wage?: number
  end?: number
  loanFrom?: number
  contractTeam?: number
}

const TODAY = { year: 2026, day: 3 }
const DC = POSITION_KEYS.indexOf('DC')
const FUTURE = 2029 * 1000 + 181

/** 지어낸 세이브: 팀 100(내 1군), 101(내 2군), 200(강한 구단), 300(약한 구단), 400(강한 구단) */
function build(specs: Spec[]): SaveWorld {
  const count = specs.length
  const world: SaveWorld = {
    count,
    names: specs.map((spec) => spec.name),
    uids: Uint32Array.from(specs, (_, i) => 1000 + i),
    teamIds: Uint32Array.from(specs, (spec) => spec.team),
    club: Int32Array.from(specs, (spec) => spec.club),
    clubs: ['A구단', 'B구단', 'C구단', 'D구단'].map((name, i) => ({ uid: 9000 + i, name, short: name, women: false })),
    ca: Uint16Array.from(specs, (spec) => spec.ca),
    pa: Uint16Array.from(specs, (spec) => spec.pa ?? spec.ca),
    value: new Uint32Array(count).fill(5_000_000),
    wage: Uint32Array.from(specs, (spec) => spec.wage ?? 20_000 + spec.ca * 100),
    contractEnd: Uint32Array.from(specs, (spec) => spec.end ?? FUTURE),
    loanFrom: Uint32Array.from(specs, (spec) => spec.loanFrom ?? NO_TEAM),
    contractTeam: Uint32Array.from(specs, (spec) => spec.contractTeam ?? spec.loanFrom ?? spec.team),
    squadStatus: Uint8Array.from(specs, (spec) => spec.status ?? 4),
    nationId: new Uint16Array(count),
    sex: new Uint8Array(count).fill(SEX_MALE),
    birthYear: Uint16Array.from(specs, (spec) => 2026 - (spec.age ?? 27)),
    birthDay: new Uint16Array(count).fill(1),
    positions: new Uint8Array(count * POSITION_COUNT).fill(1),
    attributes: new Uint8Array(count * ATTRIBUTE_COUNT),
    teamId: 100,
    gameDate: TODAY
  }
  specs.forEach((spec, i) => {
    world.positions[i * POSITION_COUNT + DC] = 20
    world.attributes.fill((spec.level ?? 10) * 5, i * ATTRIBUTE_COUNT, (i + 1) * ATTRIBUTE_COUNT)
  })
  return world
}

/** 팀마다 약한 선수 여럿으로 체급(상위 11명 현재 능력의 중간값)을 만든다 */
const filler = (prefix: string, team: number, club: number, cas: number[]): Spec[] => cas.map((ca, i) => ({ name: `${prefix}${i + 1}`, team, club, ca, level: 10 }))

function makeWorld(): SaveWorld {
  return build([
    // 내 1군: 체급 S_me = 150(상위 11명의 중간값)
    { name: '가온', team: 100, club: 0, ca: 160, level: 15, status: 3 },
    ...[158, 156, 154, 152, 150, 150, 148, 146, 144, 142, 140].map((ca, i): Spec => ({ name: `우리${i + 1}`, team: 100, club: 0, ca, level: 14, status: 3 })),
    // 내가 데려온 임대 선수(원 소속 D구단)와, 내 2군에서 올라온 선수(원 소속이 내 구단이라 임대 영입이 아니다)
    { name: '임대영입', team: 100, club: 0, ca: 130, level: 12, loanFrom: 400, status: 3 },
    { name: '승격', team: 100, club: 0, ca: 125, level: 12, loanFrom: 101, status: 3 },
    { name: '이군', team: 101, club: 0, ca: 90, level: 8 },
    // 강한 구단 B(팀 200): 체급 약 158. 핵심 선수와 로테이션 선수가 둘 다 한 단계 위 적합도(80)
    ...filler('비', 200, 1, [165, 163, 161, 159, 157, 155, 153, 151, 150, 149, 148, 147]),
    { name: '비핵심', team: 200, club: 1, ca: 160, level: 16, status: 1 },
    { name: '비로테', team: 200, club: 1, ca: 158, level: 16, status: 4 },
    // 약한 구단 C(팀 300): 체급 약 105. 핵심 선수여도 구단이 약하면 현실적이다
    ...filler('씨', 300, 2, [110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100]),
    { name: '씨핵심', team: 300, club: 2, ca: 155, level: 16, status: 1 },
    // 임대 중인 후보: 지금 뛰는 팀 300(약함), 원 소속 팀 400(강함)
    { name: '임대중', team: 300, club: 2, ca: 160, level: 16, status: 3, loanFrom: 400 },
    // 내가 임대 보낸 선수: 지금 뛰는 팀 300, 원 소속은 내 1군(100)
    { name: '임대보냄', team: 300, club: 2, ca: 150, level: 16, status: 3, loanFrom: 100 },
    // 강한 구단 D(팀 400)
    ...filler('디', 400, 3, [165, 163, 161, 159, 157, 155, 153, 151, 150, 149, 148, 147]),
    // 소속이 없는 선수: 자유 계약 / 다른 구단과 계약을 마침(주급 > 0, 만료일이 오늘 뒤) / 계약이 이미 끝남
    { name: '자유', team: NO_TEAM, club: -1, ca: 150, level: 16, wage: 0, end: 0, contractTeam: NO_TEAM },
    { name: '계약됨', team: NO_TEAM, club: -1, ca: 152, level: 16, wage: 18_398, end: FUTURE, contractTeam: 200 },
    { name: '계약끝남', team: NO_TEAM, club: -1, ca: 151, level: 16, wage: 15_000, end: 2025 * 1000 + 100, contractTeam: 200 }
  ])
}

function service(world: SaveWorld, trustLoans = true): WorldService {
  const ws = new WorldService({
    knownTeam: () => 100,
    rosterNames: () => [],
    rememberTeam: () => undefined,
    roleWeights: () => ({}),
    namesDir: join(tmpdir(), 'fm-round5-names')
  })
  ;(ws as unknown as { loaded: unknown }).loaded = { path: '가상.fm', mtimeMs: 1, size: 1, world, byUid: new Map(), live: null, note: '' }
  // 임대 기록을 믿으려면 세이브 전체에서 임대가 100명 넘게 읽혀야 한다. 시험 세이브는 작아서 믿는 것으로 정해 둔다
  const index = (ws as unknown as { loanIndex(world: SaveWorld): { trusted: boolean } }).loanIndex(world)
  index.trusted = trustLoans
  return ws
}

const ask = (over: Partial<CandidateQuery> = {}): CandidateQuery => ({
  roleId: 'cb', category: 'all', maxAge: null, onlyEligible: true, includeUnknownClub: false, search: '', expiringWithinMonths: null, ...over
})

describe('수정 A: 파는 구단의 체급(세이브 전체에서 구한다)', () => {
  const world = makeWorld()
  const ws = service(world)
  const result = ws.candidates(ask())
  const rowOf = (name: string) => result.rows.find((row) => row.name === name)

  it('구단 체급은 소속 남자 선수의 현재 능력 상위 11명의 중간값이다', () => {
    const statures = (ws as unknown as { statures(world: SaveWorld): Map<number, number> }).statures(world)
    expect(statures.get(100)).toBe(150)
    expect(statures.get(200)!).toBeGreaterThan(155)
    expect(statures.get(300)!).toBeLessThan(110)
    // 선수가 5명 미만인 팀(임대 영입 하나뿐인 2군 등)은 모른다
    expect(statures.has(101)).toBe(false)
  })

  it('같거나 강한 구단의 핵심 선수는 낮고(등급은 고려까지), 입지가 로테이션이면 낮지 않다', () => {
    const star = rowOf('비핵심')!
    expect(star.recommend.realism.low).toBe(true)
    expect(star.recommend.realism.reasons.join(' ')).toContain('소속 구단의 주전 수준(현재 능력')
    expect(star.recommend.realism.reasons.join(' ')).toContain('우리(150)와 비슷하거나 높고')
    expect(['maybe', 'low']).toContain(star.tier)
    const rotation = rowOf('비로테')!
    expect(rotation.recommend.realism.low).toBe(false)
    // 총점은 체급과 상관없이 같은 식이다: 같은 적합도(80)·같은 CA 근처에서 정렬이 입지·주급에만 좌우된다
    expect(Number.isFinite(star.recommend.total)).toBe(true)
  })

  it('약한 구단의 핵심 선수는 낮지 않다', () => {
    expect(rowOf('씨핵심')!.recommend.realism.low).toBe(false)
  })

  it('임대 중인 후보는 원 소속 팀(D구단)의 체급으로 본다: 지금 뛰는 팀이 약해도 낮다. 소속 칸은 원 소속이다', () => {
    const loaned = rowOf('임대중')!
    expect(loaned.club).toBe('D구단')
    expect(loaned.loanedTo).toBe('C구단')
    expect(loaned.recommend.realism.low).toBe(true)
    expect(loaned.recommend.realism.reasons.join(' ')).toContain('소속 구단의 주전 수준')
  })

  it('임대 기록을 믿을 수 없으면(세이브 전체에서 임대가 적게 읽힘) 지금 뛰는 팀으로 본다', () => {
    const untrusted = service(makeWorld(), false).candidates(ask())
    const loaned = untrusted.rows.find((row) => row.name === '임대중')!
    expect(loaned.club).toBe('C구단')
    expect(loaned.recommend.realism.low).toBe(false)
  })

  it('"현실적인 후보"만 등급을 센다: 낮은 선수가 맨 위여도 낮지 않은 선수의 등급은 내려가지 않는다', () => {
    const starter = ws.candidates(ask({ category: 'starter' }))
    const realistic = starter.rows.filter((row) => !row.recommend.realism.low)
    expect(realistic.length).toBeGreaterThan(0)
    const best = realistic[0]
    expect(best.tier).toBe('top')
    for (const row of starter.rows.filter((each) => each.recommend.realism.low)) expect(['maybe', 'low']).toContain(row.tier)
  })
})

describe('수정 E: 다른 구단과 계약을 마친 무소속 선수(T4)', () => {
  const world = makeWorld()
  const ws = service(world)

  it('판정: 소속 팀 없음 ∧ 주급 > 0 ∧ 만료일 > 오늘. 계약이 끝난 선수나 주급이 없는 선수는 자유 계약이다', () => {
    const at = (name: string): number => world.names.indexOf(name)
    expect(signedClubTeam(world, at('계약됨'))).toBe(200)
    expect(signedClubTeam(world, at('계약끝남'))).toBeNull()
    expect(signedClubTeam(world, at('자유'))).toBeNull()
    expect(signedClubTeam(world, at('가온'))).toBeNull()
  })

  it('자유 계약 탭에서 빠진다. 자유 계약 인원 수에도 들지 않는다', () => {
    const free = ws.candidates(ask({ category: 'free' }))
    const names = free.rows.map((row) => row.name)
    expect(names).toContain('자유')
    expect(names).toContain('계약끝남')
    expect(names).not.toContain('계약됨')
    expect(free.counts.free).toBe(2)
  })

  it('다른 탭에서는 소속 있음("구단명(입단 예정)")이고 영입 현실성이 낮다. 이유에 계약 구단이 들어간다', () => {
    const all = ws.candidates(ask())
    const signed = all.rows.find((row) => row.name === '계약됨')!
    expect(signed).toBeDefined()
    expect(signed.club).toBe('B구단(입단 예정)')
    expect(signed.clubUid).toBe(9001)
    expect(signed.categories).not.toContain('free')
    expect(signed.recommend.realism.low).toBe(true)
    expect(signed.recommend.realism.reasons[0]).toBe('다른 구단(B구단)과 계약을 마쳤습니다')
    // 그 계약 기록의 주급·만료일로 소속 있는 선수와 같은 식으로 계산한다
    expect(signed.wage).toBe(18_398)
    expect(signed.contractEnd).toEqual({ year: 2029, month: 6, day: 30 })
    expect(['maybe', 'low']).toContain(signed.tier)
    // 자유 계약 선수는 그대로 "자유 계약"
    expect(all.rows.find((row) => row.name === '자유')!.club).toBe('자유 계약')
  })
})

describe('수정 G: 내가 임대 보낸 선수는 후보에서 뺀다(T11)', () => {
  it('원 소속 팀의 구단이 내 구단이면 어느 탭에도, 이름 검색에도 나오지 않는다', () => {
    const ws = service(makeWorld())
    for (const category of ['all', 'starter', 'rotation', 'prospect', 'free'] as const) {
      expect(ws.candidates(ask({ category })).rows.map((row) => row.name), category).not.toContain('임대보냄')
    }
    expect(ws.candidates(ask({ search: '임대보냄' })).rows).toHaveLength(0)
    // 임대 기록을 믿을 수 없을 때는 거르지 않는다(임대 기록의 뜻을 모르므로)
    expect(service(makeWorld(), false).candidates(ask()).rows.map((row) => row.name)).toContain('임대보냄')
  })
})

describe('수정 F: 표의 "주전 대비"', () => {
  it('gapEff = f_eff(후보) - anchor. 화면에 보이는 적합도끼리의 차이 gap과 따로 둔다', () => {
    const result = service(makeWorld()).candidates(ask())
    const row = result.rows.find((each) => each.name === '비로테')!
    // 후보: 적합도 80, 숙련 20, 27세라 감점 없음. 주전: 적합도 75(숙련 20, 28세 아래라 하락 없음)
    expect(row.recommend.fit.effective).toBe(80)
    expect(row.gap).toBe(5)
    expect(row.gapEff).toBe(5)
    expect(result.rows.every((each) => each.gapEff !== null)).toBe(true)
  })
})

describe('수정 B: 내 선수 표에 임대 영입을 싣는다', () => {
  it('원 소속이 다른 구단인 임대 선수의 줄에만 임대 끝(오늘 이후 첫 6월 30일)과 원 소속을 싣는다', () => {
    const squad = service(makeWorld()).squad()
    expect(squad.ok).toBe(true)
    const loaned = squad.rows.filter((row) => row.loan)
    expect(loaned.map((row) => row.name)).toEqual(['임대영입'])
    expect(loaned[0].loan).toEqual({ end: { year: 2026, month: 6, day: 30 }, from: 'D구단' })
  })

  it('임대 기록을 믿을 수 없으면 싣지 않는다', () => {
    expect(service(makeWorld(), false).squad().rows.some((row) => row.loan)).toBe(false)
  })
})

describe('수정 K: 순위표를 읽지 못하는 리그에서는 주급 기준을 세우지 않는다(T12)', () => {
  const world = makeWorld()
  const ws = service(world)
  const dash = new DashboardService({
    world: ws,
    season: {} as never,
    settings: () => ({ formation: '4-4-2', slotRoles: {}, roleWeights: {} }),
    namesDir: join(tmpdir(), 'fm-round5-names')
  })
  const fit = (table: unknown): unknown => (dash as unknown as { fitModel(world: SaveWorld, table: unknown, trusted: boolean): unknown }).fitModel(world, table, true)
  const teams = (ids: number[]): unknown => ids.map((teamId) => ({ teamId }))

  it('순위표가 없거나 팀이 8개 미만이면 모델이 없다(예전에는 모든 남자 선수로 대신 맞췄다)', () => {
    expect(fit(null)).toBeNull()
    expect(fit(teams([100, 200, 300]))).toBeNull()
  })

  it('팀이 8개 이상이고 표본이 30명 이상이면 리그 모델이다', () => {
    const model = fit(teams([100, 200, 300, 400, 1, 2, 3, 4])) as { scope: string; teams: number; b2: number } | null
    expect(model).not.toBeNull()
    expect(model!.scope).toBe('league')
    expect(model!.teams).toBe(8)
    expect(Number.isFinite(model!.b2)).toBe(true)
  })

  it('팀은 충분해도 리그 선수의 주급 표본이 30명 미만이면 모델이 없다', () => {
    expect(fit(teams([100, 1, 2, 3, 4, 5, 6, 7]))).toBeNull()
  })

  it('카드 문장: 순위표를 못 읽은 리그는 그렇게 말한다', () => {
    expect(wageModelMissing(null)).toBe('이 리그의 주급 기준을 세우지 못했습니다(리그 순위표를 읽지 못함).')
    expect(wageModelMissing([])).toContain('리그 순위표를 읽지 못함')
    expect(wageModelMissing(Array.from({ length: 10 }, () => ({})))).toContain('표본이 모자랍니다')
  })
})
