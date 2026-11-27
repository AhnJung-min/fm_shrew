/**
 * 시작 화면 쪽 시험: 내 구단 고르기(A-14), 옛 플러그인 안내 문구(D-10).
 * 구단·선수 이름은 모두 지어낸 것이다.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clubChoices } from '../src/main/clubChoices'
import { humanTeamsOf, summaryStrings } from '../src/main/save/summary'
import { NO_TEAM, SEX_MALE, type SaveWorld } from '../src/main/save/world'
import { WorldService } from '../src/main/worldService'
import { CLUB_PLUGIN, MARKET_PLUGIN, NEEDED_PLUGIN } from '../src/shared/game'
import { FULL_PLUGIN, oldPluginNotice, PLUGIN_GATES, pluginNeedLine, pluginUnmetLine } from '../src/shared/pluginGates'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from '../src/main/save/reader'

/** 구단 3곳(대표 팀 10, 20, 30). 팀 10은 선수 25명, 20은 12명, 30은 5명(1군으로 보기엔 모자람). 팀 11은 팀 10 구단의 유스 */
function build(): SaveWorld {
  const specs: Array<{ name: string; team: number; club: number; ca: number }> = []
  const add = (prefix: string, team: number, club: number, count: number, ca: number): void => {
    for (let i = 0; i < count; i++) specs.push({ name: `${prefix}${i}`, team, club, ca: ca - i })
  }
  add('가', 10, 0, 25, 150)
  add('나', 20, 1, 12, 100)
  add('다', 30, 2, 5, 90)
  add('유', 11, 0, 30, 60)
  const n = specs.length
  return {
    count: n,
    names: specs.map((spec) => spec.name),
    uids: Uint32Array.from(specs, (_, i) => 100 + i),
    teamIds: Uint32Array.from(specs, (spec) => spec.team),
    club: Int32Array.from(specs, (spec) => spec.club),
    clubs: [
      { uid: 9001, name: '가상 시티', short: 'GSC', women: false, nationFields: [5, -1, 5, 5], mainTeam: 10 },
      { uid: 9002, name: '가상 유나이티드', short: 'GUN', women: true, nationFields: [-1, -1, 7, 7], mainTeam: 20 },
      { uid: 9003, name: '가상 로버스', short: 'GRV', women: false, nationFields: [5, -1, 5, 5], mainTeam: 30 }
    ],
    ca: Uint16Array.from(specs, (spec) => spec.ca),
    pa: Uint16Array.from(specs, (spec) => spec.ca + 10),
    value: new Uint32Array(n),
    wage: new Uint32Array(n),
    contractEnd: new Uint32Array(n),
    loanFrom: new Uint32Array(n).fill(NO_TEAM),
    contractTeam: new Uint32Array(n).fill(NO_TEAM),
    squadStatus: new Uint8Array(n),
    nationId: new Uint16Array(n),
    sex: new Uint8Array(n).fill(SEX_MALE),
    birthYear: new Uint16Array(n).fill(2000),
    birthDay: new Uint16Array(n).fill(1),
    positions: new Uint8Array(n * POSITION_COUNT).fill(1),
    attributes: new Uint8Array(n * ATTRIBUTE_COUNT).fill(50),
    gameDate: { year: 2026, day: 3 }
  }
}

describe('내 구단 고르기: 구단 목록', () => {
  it('대표 팀(1군)의 선수만 세고, 1군 선수가 11명 미만인 구단은 뺀다', () => {
    const choices = clubChoices(build(), () => '')
    expect(choices.map((choice) => choice.name).sort()).toEqual(['가상 시티', '가상 유나이티드'].sort())
    const city = choices.find((choice) => choice.teamId === 10)!
    // 유스 팀(11)의 30명은 세지 않는다
    expect(city.players).toBe(25)
    expect(city.uid).toBe(9001)
  })

  it('체급은 상위 22명의 현재 능력 평균이고, 센 구단이 먼저 나온다', () => {
    const choices = clubChoices(build(), () => '')
    // 가: 150, 149, ..., 129(상위 22명) → 평균 139.5, 반올림 140
    expect(choices[0].teamId).toBe(10)
    expect(choices[0].strength).toBe(140)
    expect(choices[1].strength).toBeLessThan(choices[0].strength)
  })

  it('세이브 요약에 감독이 맡은 구단으로 적힌 곳이 약해도 맨 앞에 나온다', () => {
    const world = build()
    world.humanTeams = [20]
    const choices = clubChoices(world, () => '')
    expect(choices[0]).toMatchObject({ teamId: 20, human: true })
    expect(choices.filter((choice) => choice.human)).toHaveLength(1)
  })

  it('나라 이름은 알아 둔 것이 있을 때만 붙고, 첫 번째로 채워진 나라 칸을 쓴다', () => {
    const known = new Map([[5, '가상 나라'], [7, '다른 가상 나라']])
    const choices = clubChoices(build(), (id) => known.get(id) ?? '')
    expect(choices.find((choice) => choice.teamId === 10)?.nation).toBe('가상 나라')
    expect(choices.find((choice) => choice.teamId === 20)?.nation).toBe('다른 가상 나라')
    expect(clubChoices(build(), () => '').every((choice) => choice.nation === '')).toBe(true)
  })

  it('여자 구단 표시를 담는다', () => {
    expect(clubChoices(build(), () => '').find((choice) => choice.teamId === 20)?.women).toBe(true)
  })

  it('대표 팀을 모르는 구단은 선수가 가장 많은 팀으로 어림한다', () => {
    const world = build()
    world.clubs[0].mainTeam = undefined
    const choice = clubChoices(world, () => '').find((each) => each.uid === 9001)
    // 구단 0의 팀은 10(25명)과 11(30명): 가장 많은 팀 11
    expect(choice?.teamId).toBe(11)
  })
})

describe('내 구단 고르기: 서비스', () => {
  const service = (world: SaveWorld, remembered: number[]): WorldService => {
    const ws = new WorldService({
      knownTeam: () => undefined,
      rosterNames: () => [],
      rememberTeam: (_file, team) => remembered.push(team),
      roleWeights: () => ({}),
      namesDir: join(tmpdir(), 'fm-connect-names')
    })
    ;(ws as unknown as { loaded: unknown }).loaded = { path: '가상.fm', mtimeMs: 1, size: 1, world, byUid: new Map(), live: null, note: '' }
    return ws
  }

  it('세이브를 적용하지 않았으면 목록이 없다', () => {
    const ws = new WorldService({ knownTeam: () => undefined, rosterNames: () => [], rememberTeam: () => undefined, roleWeights: () => ({}), namesDir: tmpdir() })
    expect(ws.clubs().ok).toBe(false)
  })

  it('내 팀을 모르는 세이브에서는 스쿼드가 "시작 화면에서 고르라"고 안내한다', () => {
    const ws = service(build(), [])
    const squad = ws.squad()
    expect(squad.ok).toBe(false)
    expect(squad.message).toContain('시작 화면')
  })

  it('목록에 없는 팀은 고를 수 없고, 기억하지도 않는다', () => {
    const remembered: number[] = []
    const result = service(build(), remembered).chooseTeam(30)
    expect(result.ok).toBe(false)
    expect(remembered).toEqual([])
  })

  it('목록을 준다', () => {
    const list = service(build(), []).clubs()
    expect(list.ok).toBe(true)
    expect(list.clubs.length).toBe(2)
  })
})

describe('세이브 요약에서 감독이 맡은 구단 찾기', () => {
  /** [길이 u32][UTF-8] 꼴 글자들 사이에 의미 없는 바이트를 섞는다 */
  const pack = (texts: string[]): Buffer =>
    Buffer.concat(
      texts.flatMap((text) => {
        const bytes = Buffer.from(text, 'utf8')
        const head = Buffer.alloc(4)
        head.writeUInt32LE(bytes.length)
        return [Buffer.from([0xff, 0x01, 0x00]), head, bytes]
      })
    )

  it('길이가 붙은 글자를 뽑는다', () => {
    expect(summaryStrings(pack(['가상 구단', '선수 하나', '리그 이름']))).toEqual(expect.arrayContaining(['가상 구단', '선수 하나', '리그 이름']))
  })

  it('이름이 많이 겹치는 팀을 사람이 맡은 팀으로 본다', () => {
    const world = build()
    const names = Array.from({ length: 12 }, (_, i) => `가${i}`)
    expect(humanTeamsOf(world, summaryStrings(pack(['가상 시티', ...names])))).toEqual([10])
  })

  it('겹침이 적으면(우연히 같은 이름 몇 개) 찾지 않는다', () => {
    const world = build()
    expect(humanTeamsOf(world, summaryStrings(pack(['가0', '가1', '나0', '다0'])))).toEqual([])
  })

  it('글자가 아닌 덩어리만 있어도 죽지 않는다', () => {
    expect(summaryStrings(Buffer.from([1, 2, 3, 255, 255, 255, 255, 9, 9, 9]))).toEqual([])
  })
})

describe('옛 플러그인 안내(D-10): 버전 숫자는 앱의 버전 문에서 만든다', () => {
  it('문 표는 낮은 버전부터이고 세 상수를 모두 담는다', () => {
    const versions = PLUGIN_GATES.map((gate) => gate.version)
    for (const version of [NEEDED_PLUGIN, MARKET_PLUGIN, CLUB_PLUGIN]) expect(versions).toContain(version)
    expect(versions).toEqual([...versions].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
  })

  it('안내에는 각 문의 버전이 모두 적히고 "새 버전" 같은 말로 한 버전을 가리키지 않는다', () => {
    const text = oldPluginNotice('0.8.0')
    for (const gate of PLUGIN_GATES) expect(text).toContain(gate.version)
    expect(text).toContain('0.8.0')
    expect(text).toContain(FULL_PLUGIN)
    expect(text).not.toContain('새 버전')
    expect(pluginNeedLine()).toContain(NEEDED_PLUGIN)
  })

  it('버전을 모르면 "알 수 없음"으로 적는다', () => {
    expect(oldPluginNotice('')).toContain('알 수 없음')
  })

  it('일부 기능만 꺼진 버전에서는 꺼진 기능만 적고, 모두 켜진 버전에서는 빈 글자다', () => {
    expect(pluginUnmetLine(FULL_PLUGIN)).toBe('')
    const line = pluginUnmetLine(NEEDED_PLUGIN)
    expect(line).toContain('구단 현황')
    expect(line).not.toContain('게임의 지금 값 읽기')
  })
})
