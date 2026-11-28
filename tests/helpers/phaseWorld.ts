/**
 * 2단계 U5 시험이 함께 쓰는 지어낸 자료와 서비스 만들기: 작은 세이브 세계를 직접 짓고(선수와 구단 이름은 모두 지어낸 것이다),
 * 쓰는 카탈로그와 주 전술을 주어 WorldService에 끼운다. 세이브 파일이나 게임 자료는 읽지 않는다.
 *
 * 꼴은 tests/world5.test.ts의 build()와 service()에서 복사했다(그 파일은 고치지 않는다).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from '../../src/main/save/reader'
import { NO_TEAM, SEX_FEMALE, SEX_MALE, type SaveWorld } from '../../src/main/save/world'
import { WorldService } from '../../src/main/worldService'
import { POSITION_KEYS } from '../../src/shared/positions'
import type { RoleCatalog } from '../../src/shared/roleCatalog'
import type { Tactic } from '../../src/shared/tacticModel'
import type { CandidateQuery } from '../../src/shared/world'
import { seeded } from './syntheticWorld'

export interface PersonSpec {
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
}

/** 게임 속 오늘 */
export const TODAY = { year: 2026, day: 3 }
const FUTURE = 2029 * 1000 + 181

/** 선수 명세로 세이브 세계를 짓는다. 팀 100이 내 1군이고, 숙련은 모두 1, 능력치는 level × 5다(호출한 쪽이 고친다) */
export function buildWorld(specs: PersonSpec[]): SaveWorld {
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
    loanFrom: new Uint32Array(count).fill(NO_TEAM),
    contractTeam: Uint32Array.from(specs, (spec) => (spec.team === NO_TEAM ? NO_TEAM : spec.team)),
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
  specs.forEach((spec, i) => world.attributes.fill((spec.level ?? 10) * 5, i * ATTRIBUTE_COUNT, (i + 1) * ATTRIBUTE_COUNT))
  return world
}

/** 숙련 열 번호(세이브의 숙련도 순서) */
export const POSITION_AT = (key: string): number => POSITION_KEYS.indexOf(key as (typeof POSITION_KEYS)[number])

/**
 * 무작위 세이브 세계(정해진 씨앗이면 늘 같다). 선수 count명, 내 1군(팀 100) 25명, 나머지는 팀 200~800.
 * 숙련은 대개 낮고 선수마다 한두 자리가 15~20이다. 능력치는 저장값 1~100이고, 일부 선수는 능력치가 몇 개 비어 있어(저장값 0) 능력치가 다 있지 않은 선수의 길도 탄다.
 * 4%는 여자, 3%는 이름이 없다. 아주 적은 선수는 능력치가 절반 넘게 비어 점수를 낼 수 없다(60% 규칙).
 */
export function randomWorld(seed: number, count = 2400): SaveWorld {
  const draw = seeded(seed)
  const pick = (n: number): number => Math.floor(draw() * n)
  const specs: PersonSpec[] = Array.from({ length: count }, (_, k) => ({
    name: draw() < 0.03 ? '' : `시험 선수 ${k + 1}`,
    team: k < 25 ? 100 : 200 + 100 * pick(7),
    club: k < 25 ? 0 : pick(4),
    ca: 60 + pick(131),
    pa: 100 + pick(100),
    age: 17 + pick(20)
  }))
  const world = buildWorld(specs)
  for (let k = 0; k < count; k++) {
    if (draw() < 0.04) world.sex[k] = SEX_FEMALE
    for (let p = 0; p < POSITION_COUNT; p++) world.positions[k * POSITION_COUNT + p] = 1 + pick(10)
    for (let n = 1 + pick(2); n > 0; n--) world.positions[k * POSITION_COUNT + pick(POSITION_COUNT)] = 15 + pick(6)
    for (let a = 0; a < ATTRIBUTE_COUNT; a++) world.attributes[k * ATTRIBUTE_COUNT + a] = 1 + pick(100)
    const hole = draw()
    // 능력치가 몇 개 비어 있다(저장값 0): 비율에 따라 점수는 낼 수 있지만 능력치가 다 있지는 않다
    const empties = hole < 0.1 ? 1 + pick(14) : hole < 0.12 ? 28 + pick(20) : 0
    for (let n = 0; n < empties; n++) world.attributes[k * ATTRIBUTE_COUNT + pick(ATTRIBUTE_COUNT)] = 0
  }
  return world
}

export interface ServiceOptions {
  catalog?: RoleCatalog
  mainTactic?: Tactic | null
  /** 사용자가 고친 역할 가중치. 함수로 주면 부를 때마다 읽는다(시험이 중간에 바꿀 수 있다) */
  roleWeights?: Record<string, Record<string, number>> | (() => Record<string, Record<string, number>>)
}

/** 세이브 세계를 끼운 WorldService(임대 기록은 믿는 것으로 정해 둔다). 이름 저장소는 임시 폴더이고, 만든 폴더를 함께 돌려준다 */
export function serviceOf(world: SaveWorld, options: ServiceOptions = {}): { ws: WorldService; namesDir: string } {
  const namesDir = mkdtempSync(join(tmpdir(), 'fmb-phase-names-'))
  const weights = options.roleWeights ?? {}
  const ws = new WorldService({
    knownTeam: () => 100,
    rosterNames: () => [],
    rememberTeam: () => undefined,
    roleWeights: typeof weights === 'function' ? weights : () => weights,
    ...(options.catalog ? { catalog: () => options.catalog! } : {}),
    ...(options.mainTactic !== undefined ? { mainTactic: () => options.mainTactic! } : {}),
    namesDir
  })
  ;(ws as unknown as { loaded: unknown }).loaded = { path: '가상.fm', mtimeMs: 1, size: 1, world, byUid: new Map(), live: null, note: '' }
  // 임대 기록을 믿으려면 세이브 전체에서 임대가 100명 넘게 읽혀야 한다. 시험 세계는 작아서 믿는 것으로 정해 둔다
  const index = (ws as unknown as { loanIndex(world: SaveWorld): { trusted: boolean } }).loanIndex(world)
  index.trusted = true
  return { ws, namesDir }
}

/** 후보 찾기 요청(역할만 고른 꼴이 바탕이고, over로 고친다) */
export const ask = (roleId: string, over: Partial<CandidateQuery> = {}): CandidateQuery => ({
  roleId,
  category: 'all',
  maxAge: null,
  onlyEligible: true,
  includeUnknownClub: false,
  search: '',
  expiringWithinMonths: null,
  ...over
})
