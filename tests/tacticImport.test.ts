/**
 * 게임 전술 가져오기의 앱 쪽 해독(A-01): 플러그인 /tactic의 답(견본 tests/fixtures/plugin/tactic.json)을 전술 초안으로 바꾼다.
 * 견본은 켜진 게임에서 읽은 비트와 역할 번호의 꼴이고 이름과 번호는 지어낸 값이다. 실제 FM26 카탈로그는 U4가 채우므로
 * 여기서는 견본에서 만든 작은 가짜 카탈로그(tests/helpers/fakeGameCatalog.ts)로 시험하고, 실제 카탈로그로 모든 역할이 풀리는지는 채워진 뒤에만 본다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FM26_CATALOG } from '../src/shared/catalogFm26'
import { roleGameId, SUPPORTED_VERSIONS } from '../src/shared/compat'
import { LEGACY_CATALOG, withCustomRoles } from '../src/shared/roleCatalog'
import { cellOfPosition, parseTacticAnswer, roleListReport, tacticFromGame, type GameTacticAnswer } from '../src/shared/tacticImport'
import { validateTactic } from '../src/shared/tacticModel'
import { fakeCatalogFromTactic } from './helpers/fakeGameCatalog'

/** 견본을 시험마다 고쳐 쓰므로 모양을 느슨하게 둔다 */
type Json = Record<string, any>
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'plugin', 'tactic.json'), 'utf8')) as Json
const fresh = (): Json => structuredClone(fixture)
const row = SUPPORTED_VERSIONS[0]
const catalog = fakeCatalogFromTactic(fresh() as never)

/** 견본(또는 고친 견본)을 읽어 전술로 바꾼다 */
function convert(json: Json = fresh(), useCatalog = catalog) {
  const answer = parseTacticAnswer(json)
  expect(answer, '견본이 읽혀야 한다').not.toBeNull()
  return tacticFromGame(answer as GameTacticAnswer, useCatalog, row, 'game:test')
}

/** 견본의 자리 순번 → 점유 시·비점유 시의 칸과 역할 번호(게임 열거형의 값. 관찰한 한 전술) */
const EXPECTED: Array<{ index: number; ip: [string, string]; oop: [string, string] }> = [
  { index: 0, ip: ['GK/C', '4096'], oop: ['GK/C', '2'] },
  { index: 1, ip: ['D/R', '4503599627370496'], oop: ['D/R', '2048'] },
  { index: 2, ip: ['D/CR', '16777216'], oop: ['D/CR', '8'] },
  { index: 3, ip: ['D/CL', '2'], oop: ['D/CL', '8'] },
  { index: 4, ip: ['D/L', '17592186044416'], oop: ['D/L', '512'] },
  { index: 5, ip: ['M/CR', '72057594037927936'], oop: ['M/CR', '1048576'] },
  { index: 6, ip: ['DM/C', '16'], oop: ['DM/C', '65536'] },
  { index: 7, ip: ['AM/R', '134217728'], oop: ['AM/R', '549755813888'] },
  { index: 8, ip: ['M/CL', '131072'], oop: ['M/CL', '134217728'] },
  { index: 9, ip: ['AM/L', '134217728'], oop: ['AM/L', '549755813888'] },
  { index: 10, ip: ['ST/C', '1024'], oop: ['ST/C', '4398046511104'] }
]
/** 저장할 때 놓는 순서(점유 시 칸의 줄 위 → 아래, 줄 안은 왼쪽 → 오른쪽)로 본 자리 순번 */
const CANONICAL = [10, 9, 7, 8, 5, 6, 4, 3, 2, 1, 0]

const cellText = (cell: { line: string; lane: string }): string => `${cell.line}/${cell.lane}`

describe('parseTacticAnswer: 플러그인 /tactic의 답 읽기', () => {
  it('견본을 읽는다: 국면마다 이름과 자리 11줄, 자리별 역할 목록 22개', () => {
    const answer = parseTacticAnswer(fresh())!
    expect(answer.ip.rows).toHaveLength(11)
    expect(answer.oop.rows).toHaveLength(11)
    expect(answer.ip.name).toBe('가상 4-3-3 전술')
    expect(answer.ip.formation).toBe('가상 4-1-2-3')
    expect(answer.ip.failedConditions).toEqual([])
    expect(answer.ip.rows[2]).toEqual({ position: '2097168', role: '16777216', index: '2', goalkeeper: 'False' })
    expect(answer.ip.rows[0].goalkeeper).toBe('True')
    expect(answer.roleLists).toHaveLength(22)
    const first = answer.roleLists[0]
    expect(first).toMatchObject({ index: 0, phase: 'ip', position: '1', role: '4096' })
    expect(first.options.map((option) => option.id)).toEqual(['1', '4096', '9007199254740992'])
    expect(first.options.filter((option) => option.selected).map((option) => option.id)).toEqual(['4096'])
  })

  it('roles가 없는 답(roles=1을 주지 않았을 때)은 역할 목록이 빈 채로 읽힌다', () => {
    const json = fresh()
    delete json.roles
    expect(parseTacticAnswer(json)!.roleLists).toEqual([])
  })

  it('모양이 틀린 roles 항목은 건너뛰고 나머지는 읽는다', () => {
    const json = fresh()
    json.roles = [json.roles[0], { index: 'x' }, 7, null, json.roles[1], { index: 1, phase: 'both', probe: json.roles[2].probe }]
    expect(parseTacticAnswer(json)!.roleLists.map((list) => `${list.index}/${list.phase}`)).toEqual(['0/ip', '0/oop'])
  })

  it('숫자로 온 역할 번호와 포지션은 받지 않는다(64비트 값이 깨졌을 수 있다)', () => {
    const asNumber = fresh()
    asNumber.ip.items[2].PositionRole = 16777216
    expect(parseTacticAnswer(asNumber)).toBeNull()
    const positionNumber = fresh()
    positionNumber.oop.items[0].Position = 1
    expect(parseTacticAnswer(positionNumber)).toBeNull()
    const indexNumber = fresh()
    indexNumber.ip.items[0].Index = 0
    expect(parseTacticAnswer(indexNumber)).toBeNull()
  })

  it('모양이 틀린 응답은 null이다', () => {
    for (const bad of [null, undefined, 7, 'x', [], {}, { ip: {}, oop: {} }, { ip: fixture.ip }, { oop: fixture.oop }, { ip: fixture.ip, oop: { fields: 'x' } }, { ip: fixture.ip, oop: { ...fixture.oop, items: 'x' } }, { ip: fixture.ip, oop: { ...fixture.oop, items: [7] } }]) {
      expect(parseTacticAnswer(bad), JSON.stringify(bad)?.slice(0, 40)).toBeNull()
    }
  })

  it('읽기 조건을 게임에 전달하지 못한 국면은 그 이름을 알려 준다', () => {
    const json = fresh()
    json.oop.notes.InPossession = 'failed: 비밀 경로'
    expect(parseTacticAnswer(json)!.oop.failedConditions).toEqual(['InPossession'])
  })
})

describe('cellOfPosition: 포지션 비트 → 칸(부록 D)', () => {
  const left = 1048576
  const right = 2097152
  const CASES: Array<[number, string]> = [
    [1, 'GK/C'],
    [4, 'D/R'],
    [8, 'D/L'],
    [16, 'D/C'],
    [16 + right, 'D/CR'],
    [16 + left, 'D/CL'],
    [32, 'DM/R'],
    [64, 'DM/L'],
    [128, 'DM/C'],
    [128 + right, 'DM/CR'],
    [128 + left, 'DM/CL'],
    [256, 'M/R'],
    [512, 'M/L'],
    [1024, 'M/C'],
    [1024 + right, 'M/CR'],
    [1024 + left, 'M/CL'],
    [2048, 'AM/R'],
    [4096, 'AM/L'],
    [8192, 'AM/C'],
    [8192 + right, 'AM/CR'],
    [8192 + left, 'AM/CL'],
    [16384, 'ST/C'],
    [16384 + right, 'ST/CR'],
    [16384 + left, 'ST/CL']
  ]

  it('포지션 14개와 가운데 포지션의 왼쪽·오른쪽을 모두 칸으로 푼다', () => {
    for (const [bits, cell] of CASES) {
      const read = cellOfPosition(String(bits), row)
      expect('cell' in read ? cellText(read.cell) : read, String(bits)).toBe(cell)
    }
  })

  it('넓은 포지션에 같은 쪽 비트가 붙어 와도 같은 칸이고, 반대쪽이면 풀지 못한다', () => {
    const same = cellOfPosition(String(8 + left), row)
    expect('cell' in same && cellText(same.cell)).toBe('D/L')
    const conflict = cellOfPosition(String(8 + right), row)
    expect('problem' in conflict && conflict.problem).toContain('어긋납니다')
  })

  it('최전방 왼쪽·오른쪽 비트(확인하지 못한 옛 방식)는 가운데 왼쪽·오른쪽 칸으로 읽고 알린다', () => {
    const attackerRight = cellOfPosition('32768', row)
    expect('cell' in attackerRight && cellText(attackerRight.cell)).toBe('ST/CR')
    expect('cell' in attackerRight && attackerRight.note).toContain('확인하지 못한 값')
    const attackerLeft = cellOfPosition('65536', row)
    expect('cell' in attackerLeft && cellText(attackerLeft.cell)).toBe('ST/CL')
  })

  it('스위퍼 칸, 모르는 비트, 왼쪽·오른쪽이 함께 붙은 값, 골키퍼 옆의 비트는 풀지 못하고 값을 알린다', () => {
    for (const text of ['2', '3', '0', String(left), '16385', '1' + '0'.repeat(10), String(16 + left + right), String(1 + left)]) {
      const read = cellOfPosition(text, row)
      expect('problem' in read, text).toBe(true)
      expect('problem' in read && read.unknown, text).toBe(`포지션 ${text}`)
      expect('problem' in read && read.problem, text).toContain(text)
    }
    expect((cellOfPosition('2', row) as { problem: string }).problem).toContain('스위퍼')
  })

  it('오지 않았거나 10진 글자가 아닌 값은 풀지 못하고, 앱이 모르는 값으로는 세지 않는다', () => {
    for (const text of [null, '', 'abc', '-1', '1.5', ' 1']) {
      const read = cellOfPosition(text, row)
      expect('problem' in read, String(text)).toBe(true)
      expect('problem' in read && read.unknown, String(text)).toBeUndefined()
    }
  })
})

describe('tacticFromGame: 견본 → 전술 초안', () => {
  it('11자리로 풀리고 두 국면의 칸과 역할이 기대와 같다', () => {
    const result = convert()
    expect(result.problems).toEqual([])
    expect(result.unknownBits).toEqual([])
    expect(result.ok).toBe(true)
    const tactic = result.tactic!
    expect(tactic).toMatchObject({ id: 'game:test', name: '가상 4-3-3 전술', preset: null, sharePct: null, source: 'game', catalog: 'fm26' })
    expect(tactic.slots).toHaveLength(11)
    // 저장할 때 놓는 순서: 점유 시 칸의 위(공격) → 아래(골키퍼), 줄 안은 왼쪽 → 오른쪽
    expect(tactic.slots.map((slot) => cellText(slot.ip.cell))).toEqual(CANONICAL.map((index) => EXPECTED[index].ip[0]))
    tactic.slots.forEach((slot, at) => {
      const expected = EXPECTED[CANONICAL[at]]
      expect(cellText(slot.ip.cell), `${expected.index} 점유 시 칸`).toBe(expected.ip[0])
      expect(cellText(slot.oop.cell), `${expected.index} 비점유 시 칸`).toBe(expected.oop[0])
      expect(slot.ip.roleId, `${expected.index} 점유 시 역할`).toBe(`ip.${expected.ip[1]}`)
      expect(slot.oop.roleId, `${expected.index} 비점유 시 역할`).toBe(`oop.${expected.oop[1]}`)
    })
    // 저장 검사(validateTactic)를 통과하는 전술이다
    expect(validateTactic(tactic, catalog)).toEqual([])
  })

  it('입력(답)을 바꾸지 않는다', () => {
    const answer = parseTacticAnswer(fresh())!
    const before = JSON.stringify(answer)
    tacticFromGame(answer, catalog, row, 'game:x')
    expect(JSON.stringify(answer)).toBe(before)
  })

  it('줄 순서를 섞어 와도 자리 순번(Index)으로 짝지어 같은 전술이 나온다', () => {
    const baseline = convert().tactic
    const shuffled = fresh()
    shuffled.ip.items.reverse()
    shuffled.oop.items = [...shuffled.oop.items.slice(4), ...shuffled.oop.items.slice(0, 4)]
    const result = convert(shuffled)
    expect(result.ok).toBe(true)
    expect(result.tactic).toEqual(baseline)
  })

  it('점유 시와 비점유 시의 포지션이 다른 자리를 그대로 담는다(측면 공격수가 비점유 시 측면 미드로 내려오는 전술)', () => {
    const json = fresh()
    // 자리 7(오른쪽 공격형 미드 AMR → 측면 미드 MR), 자리 9(AML → ML)
    json.oop.items[7].Position = '256'
    json.oop.items[9].Position = '512'
    const widened = fakeCatalogFromTactic(fresh() as never, { '549755813888': ['MR', 'ML'] })
    const result = convert(json, widened)
    expect(result.problems).toEqual([])
    const slots = result.tactic!.slots
    const right = slots.find((slot) => cellText(slot.ip.cell) === 'AM/R')!
    expect(cellText(right.oop.cell)).toBe('M/R')
    expect(right.ip.roleId).toBe('ip.134217728')
    expect(right.oop.roleId).toBe('oop.549755813888')
    expect(cellText(slots.find((slot) => cellText(slot.ip.cell) === 'AM/L')!.oop.cell)).toBe('M/L')
  })

  it('임무 비트가 붙은 역할도 찾는다(여섯 임무를 하나씩, 그리고 모두)', () => {
    for (const duty of [...row.dutyBits, 'all']) {
      const json = fresh()
      const bits = duty === 'all' ? row.dutyBits.reduce((sum, each) => sum | BigInt(each), 0n) : BigInt(duty)
      json.ip.items[6].PositionRole = (BigInt(json.ip.items[6].PositionRole) | bits).toString()
      json.oop.items[2].PositionRole = (BigInt(json.oop.items[2].PositionRole) | bits).toString()
      const result = convert(json)
      expect(result.problems, duty).toEqual([])
      const slots = result.tactic!.slots
      expect(slots.find((slot) => cellText(slot.ip.cell) === 'DM/C')!.ip.roleId).toBe('ip.16')
      expect(slots.find((slot) => cellText(slot.ip.cell) === 'D/CR')!.oop.roleId).toBe('oop.8')
    }
  })

  it('2^57 값(임무 비트가 붙은 것)을 숫자로 바꾸지 않고 찾는다', () => {
    const json = fresh()
    // 자리 5는 중앙 미드(MC)라서 이 역할(2^57, 점유 시 목록에 있다)을 고를 수 있다
    const big = (2n ** 57n + 4194304n).toString()
    expect(String(Number(big))).not.toBe(big)
    json.ip.items[5].PositionRole = big
    expect(roleGameId(big, row)).toBe('144115188075855872')
    const result = convert(json)
    expect(result.problems).toEqual([])
    expect(result.tactic!.slots.find((slot) => cellText(slot.ip.cell) === 'M/CR')!.ip.roleId).toBe('ip.144115188075855872')
  })

  it('앱이 모르는 역할 비트는 문제와 모르는 값으로 남고, 전술은 만들지 않는다', () => {
    const json = fresh()
    json.ip.items[2].PositionRole = '5'
    json.oop.items[8].PositionRole = '77'
    const result = convert(json)
    expect(result.ok).toBe(false)
    expect(result.tactic).toBeUndefined()
    expect(result.unknownBits).toEqual(['점유 시 역할 5', '비점유 시 역할 77'])
    expect(result.problems.some((text) => text.includes('(값 5)'))).toBe(true)
    expect(result.problems.some((text) => text.includes('(값 77)'))).toBe(true)
  })

  it('앱이 모르는 포지션 비트도 문제와 모르는 값으로 남고, 전술은 만들지 않는다', () => {
    const json = fresh()
    json.ip.items[4].Position = '3'
    json.oop.items[10].Position = '2'
    const result = convert(json)
    expect(result.ok).toBe(false)
    expect(result.tactic).toBeUndefined()
    expect(result.unknownBits).toEqual(['포지션 3', '포지션 2'])
    expect(result.problems.join('\n')).toContain('스위퍼')
  })

  it('역할 번호의 국면을 바꾼 자료는 풀리지 않는다(점유 시 번호로 비점유 시 역할을 찾지 않는다)', () => {
    // 자리 0의 비점유 시 역할 자리에 점유 시 번호(볼 플레잉 골키퍼 4096)를 넣는다: 비점유 시 번호 4096은 다른 역할이거나 없다
    const json = fresh()
    json.oop.items[0].PositionRole = '4096'
    const result = convert(json)
    expect(result.ok).toBe(false)
    expect(result.tactic).toBeUndefined()
    expect(result.unknownBits).toContain('비점유 시 역할 4096')
    // 두 국면의 답을 통째로 바꿔 보내도 문제 없이 통과하지 않는다
    const swapped = fresh()
    ;[swapped.ip, swapped.oop] = [swapped.oop, swapped.ip]
    expect(convert(swapped).ok).toBe(false)
  })

  it('자리가 10개이거나 12개인 답은 거절한다', () => {
    const ten = fresh()
    ten.ip.items.pop()
    const tenResult = convert(ten)
    expect(tenResult.ok).toBe(false)
    expect(tenResult.tactic).toBeUndefined()
    expect(tenResult.problems.join('\n')).toContain('10개가 왔습니다')
    const twelve = fresh()
    twelve.oop.items.push({ ...twelve.oop.items[0], Index: '11' })
    const twelveResult = convert(twelve)
    expect(twelveResult.ok).toBe(false)
    expect(twelveResult.tactic).toBeUndefined()
    expect(twelveResult.problems.join('\n')).toContain('12개가 왔습니다')
  })

  it('두 국면의 자리 번호가 짝이 안 맞거나, 겹치거나, 읽을 수 없으면 거절한다', () => {
    const unmatched = fresh()
    unmatched.oop.items[10].Index = '11'
    const unmatchedResult = convert(unmatched)
    expect(unmatchedResult.ok).toBe(false)
    expect(unmatchedResult.tactic).toBeUndefined()
    expect(unmatchedResult.problems.join('\n')).toContain('서로 맞지 않습니다')

    const duplicated = fresh()
    duplicated.ip.items[3].Index = '2'
    const duplicatedResult = convert(duplicated)
    expect(duplicatedResult.ok).toBe(false)
    expect(duplicatedResult.problems.join('\n')).toContain('두 번 왔습니다')

    const unreadable = fresh()
    unreadable.ip.items[0].Index = 'x'
    delete unreadable.oop.items[1].Index
    const unreadableResult = convert(unreadable)
    expect(unreadableResult.ok).toBe(false)
    expect(unreadableResult.problems.join('\n')).toContain('자리 번호를 읽지 못한 줄이 1개')
  })

  it('포지션이나 역할 값이 오지 않은 자리도 문제로 적고 거절한다', () => {
    const json = fresh()
    delete json.ip.items[1].Position
    delete json.oop.items[2].PositionRole
    const result = convert(json)
    expect(result.ok).toBe(false)
    expect(result.tactic).toBeUndefined()
    expect(result.problems.join('\n')).toContain('포지션 값이 오지 않았거나')
    expect(result.problems.join('\n')).toContain('역할 값이 오지 않았거나')
    expect(result.unknownBits).toEqual([])
  })

  it('게임이 알려 준 골키퍼 여부와 포지션이 어긋나면 문제로 적는다', () => {
    const json = fresh()
    json.ip.items[0].IsGoalkeeper = 'False'
    const result = convert(json)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toContain('골키퍼 여부')
  })

  it('읽기 조건을 게임에 전달하지 못했으면 문제로 적되 게임이 준 글을 그대로 보이지 않는다', () => {
    const json = fresh()
    json.oop.notes.InPossession = 'failed: C:\\비밀\\경로'
    const result = convert(json)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toContain('읽기 조건을 전달하지 못했습니다')
    expect(result.problems.join('\n')).not.toContain('비밀')
  })

  it('최전방 왼쪽·오른쪽 비트는 칸으로 읽되 확인할 것으로 알려 ok를 거짓으로 둔다(전술은 함께 준다)', () => {
    const json = fresh()
    json.ip.items[10].Position = '32768'
    const result = convert(json)
    expect(result.ok).toBe(false)
    expect(result.tactic).toBeDefined()
    expect(result.problems.join('\n')).toContain('확인하지 못한 값')
    expect(result.unknownBits).toEqual([])
    expect(cellText(result.tactic!.slots.find((slot) => slot.oop.roleId === 'oop.4398046511104')!.ip.cell)).toBe('ST/CR')
  })

  it('같은 칸에 자리가 둘이면 전술과 함께 저장 검사의 문제를 준다', () => {
    const json = fresh()
    json.ip.items[3].Position = '16'
    json.ip.items[2].Position = '16'
    const result = convert(json)
    expect(result.ok).toBe(false)
    expect(result.tactic).toBeDefined()
    expect(result.problems.join('\n')).toContain('같은 칸')
  })

  it('전술 이름: 너무 길면 40글자로 줄이고, 없으면 포메이션 이름, 그것도 없으면 기본 이름이다', () => {
    const long = fresh()
    long.ip.fields['Team.Tactic.Name'] = '가'.repeat(60)
    expect(Array.from(convert(long).tactic!.name)).toHaveLength(40)
    const formation = fresh()
    formation.ip.fields['Team.Tactic.Name'] = ''
    // 점유 시 이름이 비면 비점유 시 이름을 쓴다
    expect(convert(formation).tactic!.name).toBe('가상 4-3-3 전술')
    formation.oop.fields['Team.Tactic.Name'] = ''
    expect(convert(formation).tactic!.name).toBe('가상 4-1-2-3')
    const none = fresh()
    for (const phase of [none.ip, none.oop]) {
      delete phase.fields['Team.Tactic.Name']
      delete phase.fields['Team.Tactic.FormationName']
    }
    expect(convert(none).tactic!.name).toBe('게임에서 가져온 전술')
  })

  it('쓰는 카탈로그가 이 판의 역할 번호를 풀 수 없는 것이면(옛 14역할, 다른 판) 거절한다', () => {
    for (const other of [LEGACY_CATALOG, { ...catalog, dataVersion: '26.4.0' }]) {
      const result = convert(fresh(), other)
      expect(result.ok).toBe(false)
      expect(result.tactic).toBeUndefined()
      expect(result.problems[0]).toContain('풀 수 없습니다')
    }
  })
})

describe('roleListReport: 자리별 역할 목록을 앱의 목록과 견준다', () => {
  const answer = parseTacticAnswer(fresh())!
  const tactic = convert().tactic!

  it('견본의 목록은 견본으로 만든 카탈로그와 모두 같다(22곳)', () => {
    const report = roleListReport(answer, catalog, row, tactic)
    expect(report).toEqual({ compared: 22, different: 0, lines: [] })
  })

  it('게임에만 있는 역할과 앱에만 있는 역할을 자리와 칸 종류와 함께 적는다', () => {
    const edited = fresh()
    // 앱의 목록에서 DM 자리 점유 시의 하프백(34359738368)을 빼고, 앱에만 있는 역할(999)을 더한다
    const dm = edited.roles.find((list: Json) => list.index === 6 && list.phase === 'ip')
    dm.probe.items = dm.probe.items.filter((item: Json) => item['RowData.DisplayValue.Role'] !== '34359738368')
    dm.probe.items.push({ 'RowData.DisplayValue.Role': '999', 'RowData.DisplayValue.TacticsRoleName': '가상 역할 999', 'RowData.DisplayValue.Selected': 'False' })
    const report = roleListReport(answer, fakeCatalogFromTactic(edited as never), row, tactic)
    expect(report.compared).toBe(22)
    expect(report.different).toBe(1)
    expect(report.lines).toHaveLength(1)
    expect(report.lines[0]).toContain('점유 시(DM.single)')
    expect(report.lines[0]).toContain('게임에만 있음 [가상 역할 34359738368(값 34359738368)]')
    expect(report.lines[0]).toContain('앱에만 있음 [가상 역할 999]')
  })

  it('사용자 역할은 앱에만 있는 것으로 세지 않는다', () => {
    const withUser = withCustomRoles(catalog, [{ id: 'user.내역할', phase: 'ip', name: '내 역할', positions: ['DM'], weights: { passing: 3 } }])
    expect(withUser.choicesAt('DM', 'ip', 'DM.single').some((choice) => choice.evidence === 'user')).toBe(true)
    expect(roleListReport(answer, withUser, row, tactic).different).toBe(0)
  })

  it('일부만 읽었거나 자리를 찾을 수 없는 목록은 건너뛴다', () => {
    const partial = fresh()
    partial.roles = partial.roles.slice(0, 5)
    partial.roles[1].probe.fields['Team.Tactic.PositionValue'] = '3'
    const report = roleListReport(parseTacticAnswer(partial)!, catalog, row, tactic)
    expect(report).toEqual({ compared: 4, different: 0, lines: [] })
  })
})

describe('실제 FM26 카탈로그: 견본의 모든 역할이 찾아진다', () => {
  const filled = FM26_CATALOG.roles.length > 0
  // 카탈로그 자료(src/shared/data/fm26-roles.json)는 2단계의 U4가 채운다. 아직 빈 틀(역할 0개)인 동안에는 이 시험을 건너뛰고,
  // 채워진 뒤에는(리드가 U4를 합친 main에서) 저절로 돈다. 건너뛴 까닭: "카탈로그가 빈 틀이다"
  it.skipIf(!filled)(`견본의 역할 번호(자리 ${EXPECTED.length}개 × 두 국면, 고를 수 있는 목록 포함)가 모두 실제 FM26 카탈로그에서 찾아지고, 견본이 전술 초안으로 풀린다`, () => {
    const ids = new Set<string>()
    for (const phase of ['ip', 'oop'] as const) for (const item of fixture[phase].items) ids.add(`${phase}:${roleGameId(item.PositionRole, row)}`)
    for (const list of fixture.roles as Json[]) for (const item of list.probe.items) ids.add(`${list.phase}:${roleGameId(item['RowData.DisplayValue.Role'], row)}`)
    const missing = [...ids].filter((text) => {
      const [phase, gameId] = text.split(':') as ['ip' | 'oop', string]
      return FM26_CATALOG.roleByGameId(phase, gameId) === undefined
    })
    expect(missing).toEqual([])
    const result = tacticFromGame(parseTacticAnswer(fresh())!, FM26_CATALOG, row, 'game:real')
    expect(result.unknownBits).toEqual([])
    expect(result.tactic?.slots).toHaveLength(11)
  })
})
