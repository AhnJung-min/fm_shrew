/**
 * 게임 역할 별점의 앱 쪽 해독과 순위 상관(F-05). 견본 tests/fixtures/plugin/rolestars.json은 켜진 게임에서 읽은 역할 번호와 별점의 꼴이고
 * 선수 번호는 지어낸 값이다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FM26_CATALOG } from '../src/shared/catalogFm26'
import { SUPPORTED_VERSIONS } from '../src/shared/compat'
import { K } from '../src/shared/ledger'
import { parseRoleStars, rankTable, spearman } from '../src/shared/roleStars'

type Json = Record<string, any>
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'plugin', 'rolestars.json'), 'utf8')) as Json
const fresh = (): Json => structuredClone(fixture)
const row = SUPPORTED_VERSIONS[0]

describe('parseRoleStars: 플러그인 /rolestars의 답 읽기', () => {
  it('견본을 줄로 푼다: 선수 5명의 점유 시와 비점유 시 표가 모두 들어온다', () => {
    const rows = parseRoleStars(fresh())!
    const expected = fixture.players.reduce((sum: number, player: Json) => sum + player.ip.items.length + player.oop.items.length, 0)
    expect(rows).toHaveLength(expected)
    expect(new Set(rows.map((each) => each.uid))).toEqual(new Set([90000001, 90000002, 90000003, 90000004, 90000005]))
    // 첫 줄: 첫 선수의 점유 시 첫 역할(역할 번호는 2^57 값이라 글자로만 다룬다)
    expect(rows[0]).toEqual({ uid: 90000001, phase: 'ip', gameId: '144115188075855872', min: 16, max: 16 })
    expect(rows.every((each) => typeof each.gameId === 'string' && /^\d+$/.test(each.gameId))).toBe(true)
    expect(rows.every((each) => each.min >= 0 && each.max <= 20 && each.min <= each.max)).toBe(true)
    // 점유 시 줄과 비점유 시 줄이 모두 있다
    expect(rows.some((each) => each.phase === 'ip')).toBe(true)
    expect(rows.some((each) => each.phase === 'oop')).toBe(true)
  })

  it('선수가 없는 답은 빈 목록이다', () => {
    expect(parseRoleStars({ players: [] })).toEqual([])
  })

  it('모양이 틀린 응답이나, 값이 글자가 아닌 줄이 있는 응답은 null이다', () => {
    for (const bad of [null, undefined, 7, 'x', [], {}, { players: 'x' }, { players: [{ uid: 0, ip: {}, oop: {} }] }, { players: [{ uid: -3, ip: {}, oop: {} }] }, { players: [{ uid: 1.5, ip: {}, oop: {} }] }, { players: [{ uid: 1, ip: {} }] }, { players: [{ uid: 1, ip: { items: 'x' }, oop: {} }] }]) {
      expect(parseRoleStars(bad), JSON.stringify(bad)?.slice(0, 50)).toBeNull()
    }
    const numberRole = fresh()
    numberRole.players[0].ip.items[0].TacticsRoleID = 32
    expect(parseRoleStars(numberRole)).toBeNull()
    const numberStar = fresh()
    numberStar.players[1].oop.items[0]['CurrentAbilityStars.MaxValue'] = 15
    expect(parseRoleStars(numberStar)).toBeNull()
  })

  it('역할 번호나 별점을 읽을 수 없는 줄, 표의 국면과 다른 줄은 뺀다', () => {
    const json = fresh()
    const total = parseRoleStars(fresh())!.length
    const items = json.players[0].ip.items
    items[0].TacticsRoleID = 'abc' // 역할 번호가 10진 글자가 아니다
    items[1]['CurrentAbilityStars.MinValue'] = '21' // 20점 만점을 넘는다
    items[2]['CurrentAbilityStars.MaxValue'] = '-1'
    items[3]['CurrentAbilityStars.MaxValue'] = '15.5'
    delete items[4]['CurrentAbilityStars.MinValue']
    items[5].IsInPossession = 'False' // 점유 시 표인데 줄은 비점유 시라고 한다
    expect(parseRoleStars(json)!).toHaveLength(total - 6)
    expect(parseRoleStars(json)!.some((each) => each.uid === 90000001 && each.phase === 'ip' && each.gameId === '144115188075855872')).toBe(false)
  })

  it('같은 역할이 한 선수의 표에 여러 줄 있으면 줄을 모두 준다(어느 줄을 쓸지는 대조를 만드는 쪽이 고른다)', () => {
    const rows = parseRoleStars(fresh())!.filter((each) => each.uid === 90000001 && each.phase === 'ip')
    const count = rows.filter((each) => each.gameId === '131072').length
    expect(count).toBeGreaterThan(1)
  })

  it('지원 표의 줄을 주면 역할 번호에서 임무 비트를 지운다', () => {
    const json = fresh()
    json.players[2].ip.items[0].TacticsRoleID = (BigInt(json.players[2].ip.items[0].TacticsRoleID) | BigInt(row.dutyBits[1])).toString()
    const plain = parseRoleStars(json)!.find((each) => each.uid === 90000003 && each.phase === 'ip')!
    const stripped = parseRoleStars(json, row)!.find((each) => each.uid === 90000003 && each.phase === 'ip')!
    expect(plain.gameId).toBe(json.players[2].ip.items[0].TacticsRoleID)
    expect(stripped.gameId).toBe(fixture.players[2].ip.items[0].TacticsRoleID)
  })
})

/** 시험용 느린 계산: 순위 = 1 + (더 작은 값의 수) + (같은 값의 수 − 1) / 2, 상관은 합으로 쓴 식(spearman의 구현과 다른 길) */
function naiveSpearman(xs: number[], ys: number[]): number | null {
  const rank = (values: number[]): number[] =>
    values.map((value) => 1 + values.filter((other) => other < value).length + (values.filter((other) => other === value).length - 1) / 2)
  const [rx, ry] = [rank(xs), rank(ys)]
  const n = xs.length
  const sum = (values: number[]): number => values.reduce((total, each) => total + each, 0)
  const numerator = n * sum(rx.map((each, at) => each * ry[at])) - sum(rx) * sum(ry)
  const denominator = Math.sqrt((n * sum(rx.map((each) => each * each)) - sum(rx) ** 2) * (n * sum(ry.map((each) => each * each)) - sum(ry) ** 2))
  return denominator === 0 ? null : numerator / denominator
}

describe('spearman: 순위 상관(같은 값은 평균 순위)', () => {
  it('손으로 계산한 사례: 같은 값이 섞인 다섯 쌍', () => {
    // x 순위 1, 2.5, 2.5, 4, 5 / y 순위 1, 3, 2, 5, 4. 평균 3, 편차 곱의 합 8.5, 편차 제곱합 9.5와 10 → 8.5 / √95
    const rho = spearman([10, 20, 20, 40, 50], [1, 3, 2, 5, 4])!
    expect(rho).toBeCloseTo(8.5 / Math.sqrt(95), 12)
    expect(rho).toBeCloseTo(0.8720815992723809, 12)
  })

  it('손으로 계산한 사례: 양쪽에 같은 값이 있는 네 쌍', () => {
    // x 순위 1.5, 1.5, 3.5, 3.5 / y 순위 1, 2.5, 2.5, 4. 편차 x -1, -1, 1, 1 / y -1.5, 0, 0, 1.5 → 곱의 합 1.5+0+0+1.5 = 3
    // 제곱합 x 4, y 4.5 → 3 / √18 = 0.7071067811865476
    expect(spearman([5, 5, 9, 9], [1, 2, 2, 3])).toBeCloseTo(3 / Math.sqrt(18), 12)
  })

  it('순위가 같으면 1, 반대면 -1이고, 값이 얼마나 벌어졌는지는 보지 않는다', () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBe(1)
    expect(spearman([1, 2, 3, 4, 5], [1, 4, 9, 16, 1000])).toBe(1)
    expect(spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])).toBe(-1)
    expect(spearman([3, 1, 2], [30, 10, 20])).toBe(1)
  })

  it('두 열을 바꿔도 같고, 같은 변환(순위를 지키는)을 해도 같다', () => {
    const xs = [4, 8, 8, 15, 16, 23, 42]
    const ys = [2, 7, 1, 8, 2, 8, 1]
    expect(spearman(xs, ys)).toBe(spearman(ys, xs))
    expect(spearman(xs.map((each) => each * 3 + 100), ys.map((each) => Math.exp(each)))).toBeCloseTo(spearman(xs, ys)!, 12)
  })

  it('만들 수 없으면 null이다: 둘 미만, 길이가 다름, 한쪽이 모두 같음, 숫자가 아님', () => {
    expect(spearman([], [])).toBeNull()
    expect(spearman([1], [1])).toBeNull()
    expect(spearman([1, 2, 3], [1, 2])).toBeNull()
    expect(spearman([4, 4, 4], [1, 2, 3])).toBeNull()
    expect(spearman([1, 2, 3], [7, 7, 7])).toBeNull()
    expect(spearman([1, Number.NaN, 3], [1, 2, 3])).toBeNull()
    expect(spearman([1, 2, Infinity], [1, 2, 3])).toBeNull()
  })

  it('무작위 쌍 2000개에서 따로 만든 느린 계산과 1e-12 안으로 같고 -1과 1 사이다(같은 값이 많은 별점 꼴 포함)', () => {
    // 고정된 씨앗의 간단한 난수(시험이 매번 같게)
    let seed = 12345
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let trial = 0; trial < 2000; trial++) {
      const n = 2 + Math.floor(next() * 11)
      const levels = 2 + Math.floor(next() * 18)
      const xs = Array.from({ length: n }, () => Math.floor(next() * levels))
      const ys = Array.from({ length: n }, () => Math.floor(next() * 20) + 1)
      const fast = spearman(xs, ys)
      const slow = naiveSpearman(xs, ys)
      if (slow === null) expect(fast, `${xs} / ${ys}`).toBeNull()
      else {
        expect(fast, `${xs} / ${ys}`).not.toBeNull()
        expect(Math.abs(fast! - slow), `${xs} / ${ys}`).toBeLessThan(1e-12)
        expect(fast!).toBeGreaterThanOrEqual(-1)
        expect(fast!).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('rankTable: 역할마다 순위 상관 표', () => {
  const pairs = (roleId: string, apps: number[], games: number[]): Array<{ roleId: string; app: number; game: number }> => apps.map((app, at) => ({ roleId, app, game: games[at] }))

  it('인원이 문턱 이상이면 상관을 내고, 문턱 미만이면 rho가 null이다(표본 부족)', () => {
    const table = rankTable([...pairs('a', [1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), ...pairs('b', [1, 2, 3, 4], [4, 3, 2, 1])], 5, 0.7)
    expect(table).toEqual([
      { roleId: 'a', n: 5, rho: 1, flagged: false },
      { roleId: 'b', n: 4, rho: null, flagged: false }
    ])
  })

  it('상관이 문턱 미만이면 가중치 점검 대상이고, 문턱과 같으면 아니다', () => {
    const table = rankTable([...pairs('역', [1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), ...pairs('정', [1, 2, 3, 4, 5], [1, 2, 3, 4, 5])], 5, 0.7)
    expect(table[0]).toMatchObject({ roleId: '역', n: 5, rho: -1, flagged: true })
    expect(table[1]).toMatchObject({ roleId: '정', n: 5, rho: 1, flagged: false })
    // 상관이 정확히 문턱이면 점검 대상이 아니다(미만만)
    const edge = rankTable(pairs('x', [1, 2, 3, 4, 5], [1, 2, 3, 4, 5]), 5, 1)
    expect(edge[0].flagged).toBe(false)
    const above = rankTable(pairs('x', [1, 2, 3, 4, 5], [1, 2, 3, 5, 4]), 5, 0.9)
    expect(above[0].rho).toBeCloseTo(0.9, 12)
    expect(above[0].flagged).toBe(false)
    expect(rankTable(pairs('x', [1, 2, 3, 4, 5], [1, 2, 3, 5, 4]), 5, 0.95)[0].flagged).toBe(true)
  })

  it('순위가 서지 않으면(한 열이 모두 같음) 인원이 충분해도 rho는 null이고 점검 대상으로 세지 않는다', () => {
    const table = rankTable(pairs('c', [3, 3, 3, 3, 3, 3], [1, 2, 3, 4, 5, 6]), 5, 0.7)
    expect(table).toEqual([{ roleId: 'c', n: 6, rho: null, flagged: false }])
  })

  it('역할은 처음 나온 순서로 내고, 짝이 없으면 빈 표다', () => {
    const table = rankTable([{ roleId: 'z', app: 1, game: 1 }, { roleId: 'a', app: 1, game: 1 }, { roleId: 'z', app: 2, game: 2 }], 2, 0.7)
    expect(table.map((each) => each.roleId)).toEqual(['z', 'a'])
    expect(table.map((each) => each.n)).toEqual([2, 1])
    expect(rankTable([], 5, 0.7)).toEqual([])
  })

  it('대장의 문턱(최소 인원, 상관 하한)으로 부른다', () => {
    const table = rankTable(pairs('d', [1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), K.ROLE_STAR_MIN_PLAYERS, K.ROLE_STAR_RANK_MIN)
    expect(table[0]).toMatchObject({ n: 5, rho: -1, flagged: true })
    expect(rankTable(pairs('d', [1, 2, 3, 4], [4, 3, 2, 1]), K.ROLE_STAR_MIN_PLAYERS, K.ROLE_STAR_RANK_MIN)[0].rho).toBeNull()
  })
})

describe('실제 FM26 카탈로그: 견본의 모든 역할이 찾아진다', () => {
  // 카탈로그 자료(src/shared/data/fm26-roles.json)는 2단계의 U4가 채운다. 아직 빈 틀(역할 0개)인 동안에는 건너뛰고(까닭을 알린다),
  // 채워진 뒤에는(리드가 U4를 합친 main에서) 저절로 돈다
  it('견본의 역할 번호(점유 시·비점유 시 표)가 모두 실제 FM26 카탈로그에서 찾아진다', (context) => {
    if (FM26_CATALOG.roles.length === 0) context.skip('FM26 카탈로그가 아직 빈 틀입니다(역할 0개). U4가 data/fm26-roles.json을 채운 뒤에 돕니다.')
    const missing = parseRoleStars(fresh(), row)!.filter((each) => FM26_CATALOG.roleByGameId(each.phase, each.gameId) === undefined)
    expect(missing.map((each) => `${each.phase}:${each.gameId}`)).toEqual([])
  })
})
