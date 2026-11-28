/**
 * 전술 추천 서비스(2단계 U8, src/main/tacticSearchService.ts): 가짜 의존물(설정, 세계, 기준 분포)을 끼워 본체의 길을 시험한다.
 * 계산 자체는 tests/tacticSearch.test.ts가 보고, 여기서는 서비스가 입력을 검사하고 결과를 정해진 모양으로 주는지,
 * 기준 분포를 받지 못하면 까닭과 함께 실패하는지, 시작점 사이에 양보하는지, 결과에 선수 정보가 없는지를 본다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerTacticIpc, type Phase2Deps } from '../src/main/tacticIpc'
import { recommendTactics } from '../src/main/tacticSearchService'
import { FM26_CATALOG } from '../src/shared/catalogFm26'
import { SEARCH_MAX_ROUNDS, TACTIC_SLOTS, TACTICS_PER_SAVE } from '../src/shared/limits'
import { LEGACY_CATALOG } from '../src/shared/roleCatalog'
import { normsFailed, TACTIC_CHANNELS, type NormsResult } from '../src/shared/tacticApi'
import { legacyTactic, PRESET_IDS, presetTactic, type Tactic } from '../src/shared/tacticModel'
import { RECOMMEND_NOTE, searchTactics } from '../src/shared/tacticSearch'
import type { Settings } from '../src/shared/types'
import { fixedNorms, flatNorms, SEARCH_COLUMNS, searchSquad } from './helpers/searchSquad'

const catalog = FM26_CATALOG
const squad = searchSquad()
const TODAY = { year: 2026, month: 7, day: 1 }

interface FakeOptions {
  settings?: Partial<Settings>
  squad?: { ok: boolean; message?: string; rows?: typeof squad }
  norms?: Phase2Deps['norms']
}

function deps(options: FakeOptions = {}): Phase2Deps {
  const settings = { roleWeights: {}, catalog: 'fm26', ...options.settings } as Settings
  const norm = fixedNorms(catalog)
  return {
    settings: { get: () => settings, set: () => settings } as never,
    world: { squad: () => ({ ok: true, columns: SEARCH_COLUMNS, rows: squad, today: TODAY, ...options.squad }) } as never,
    link: {} as never,
    norms: options.norms ?? ((profiles): NormsResult => ({ ok: true, norms: norm(profiles) })),
    pickSavePath: async () => null,
    pickOpenPath: async () => null,
    dataDir: ''
  }
}

afterEach(() => vi.restoreAllMocks())

describe('전술 추천 서비스', () => {
  const current = presetTactic('4-2-3-1', catalog)

  it('순수 계산과 같은 순위와 제안을 주고, 글은 고정 문구이며, 걸린 시간을 담는다', async () => {
    const result = await recommendTactics(deps(), current)
    expect(result.ok).toBe(true)
    expect(result.message).toBe(RECOMMEND_NOTE)
    expect(result.message).toBe('선수에게 맞는 전술이라는 뜻이지, 강한 전술이라는 뜻은 아닙니다.')
    expect(Number.isInteger(result.elapsedMs) && result.elapsedMs >= 0).toBe(true)
    // 같은 입력으로 순수 계산을 직접 돌린 것과 같다
    const direct = searchTactics({
      rows: squad,
      columns: SEARCH_COLUMNS,
      today: TODAY,
      catalog,
      overrides: {},
      current,
      presets: PRESET_IDS.map((id) => presetTactic(id, catalog)),
      normsFor: fixedNorms(catalog),
      maxRounds: SEARCH_MAX_ROUNDS
    })
    expect(result.ranked).toEqual(direct.ranked)
    expect(result.suggestions).toEqual(direct.suggestions)
    expect(result.ranked.filter((candidate) => candidate.current)).toHaveLength(1)
    expect(result.ranked[0].objective).toBeGreaterThanOrEqual(result.ranked.find((candidate) => candidate.current)!.objective)
  })

  it('사용자가 고친 역할 가중치(설정)로 계산한다', async () => {
    const plain = await recommendTactics(deps(), current)
    const edited = await recommendTactics(deps({ settings: { roleWeights: { 'ip.CentreForward': { finishing: 0, offTheBall: 5 }, 'ip.Goalkeeper': { handling: 1 } } } }), current)
    expect(edited.ok).toBe(true)
    expect(edited.ranked.find((candidate) => candidate.current)!.objective).not.toBe(plain.ranked.find((candidate) => candidate.current)!.objective)
  })

  it('결과에는 선수 이름이나 번호가 없다(전술과 프로파일뿐이다)', async () => {
    const text = JSON.stringify(await recommendTactics(deps(), current))
    for (const row of squad.slice(0, 20)) {
      expect(text).not.toContain(row.name)
      expect(text).not.toContain(String(row.idx))
    }
  })

  it('옛 14역할 카탈로그를 쓰는 설정에서도 옛 전술로 추천한다', async () => {
    const legacy = legacyTactic('4-2-3-1', {})
    const result = await recommendTactics(deps({ settings: { catalog: 'legacy14' }, norms: (profiles) => ({ ok: true, norms: flatNorms(LEGACY_CATALOG)(profiles) }) }), legacy)
    expect(result.ok).toBe(true)
    expect(result.ranked.find((candidate) => candidate.current)!.tactic).toBe(legacy)
  })

  it('시작점 하나를 끝낼 때마다 이벤트 루프에 양보한다(setImmediate)', async () => {
    const spy = vi.spyOn(globalThis, 'setImmediate')
    const before = spy.mock.calls.length
    await recommendTactics(deps(), current)
    // 기본 4-2-3-1은 프리셋과 같은 모양이라 시작점이 5개다
    expect(spy.mock.calls.length - before).toBeGreaterThanOrEqual(PRESET_IDS.length)
  })

  it('기준 분포는 시작점마다 전술 하나의 자리 수 이하씩 나눠 받고, 이미 받은 열쇠는 다시 묻지 않는다(큰 계산을 한 번에 하지 않는다)', async () => {
    const calls: string[][] = []
    const norm = fixedNorms(catalog, calls)
    await recommendTactics(deps({ norms: (profiles) => ({ ok: true, norms: norm(profiles) }) }), current)
    const keys = calls.flat()
    // 시작점마다 묻는 것이 전술 하나의 자리 수보다 많아서 시작점의 수보다 여러 번에 나뉜다
    expect(calls.length).toBeGreaterThan(PRESET_IDS.length)
    for (const call of calls) expect(call.length).toBeLessThanOrEqual(TACTIC_SLOTS)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('본체의 기준 분포 함수에는 한 번에 받는 수의 한도가 있어서, 나눠 묻는다', () => {
  const current = presetTactic('4-2-3-1', catalog)
  /** 본체(src/main/index.ts)가 deps.norms에 거는 한도(전술 하나의 자리 수 × 저장하는 전술 수). 한 번에 이보다 많이 물으면 거절한다 */
  const CAP = TACTIC_SLOTS * TACTICS_PER_SAVE

  /** 순수 계산을 한도 없는 기준 분포로 돌린 것(비교 기준)과 시작점마다 물은 프로파일 수 */
  function direct(): { out: ReturnType<typeof searchTactics>; asked: number[] } {
    const asked: number[] = []
    const norm = fixedNorms(catalog)
    const out = searchTactics({
      rows: squad,
      columns: SEARCH_COLUMNS,
      today: TODAY,
      catalog,
      overrides: {},
      current,
      presets: PRESET_IDS.map((id) => presetTactic(id, catalog)),
      normsFor: (profiles) => (asked.push(profiles.length), norm(profiles)),
      maxRounds: SEARCH_MAX_ROUNDS
    })
    return { out, asked }
  }

  it('시험 자료가 의미가 있다: 한 시작점의 후보 짝(서로 다른 프로파일)은 본체의 한도를 넘는다', () => {
    expect(Math.max(...direct().asked)).toBeGreaterThan(CAP)
  })

  it('한도를 넘는 요청을 거절하는 본체에서도 추천이 나오고, 한도 없는 계산과 결과가 같다', async () => {
    const sizes: number[] = []
    const norm = fixedNorms(catalog)
    const capped: Phase2Deps['norms'] = (profiles) => {
      sizes.push(profiles.length)
      return profiles.length > CAP ? normsFailed('한 번에 구할 수 있는 자리 수를 넘었습니다.') : { ok: true, norms: norm(profiles) }
    }
    const result = await recommendTactics(deps({ norms: capped }), current)
    expect(result.ok, result.message).toBe(true)
    // 나눠 물었다: 한 번에 전술 하나의 자리 수 이하이고, 모두 합치면 한도를 넘는다(나누지 않았다면 거절당했을 양이다)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(TACTIC_SLOTS)
    expect(sizes.length).toBeGreaterThan(CAP / TACTIC_SLOTS)
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeGreaterThan(CAP)
    // 프로파일마다 답이 따로라 나눠 물어도 결과는 같다
    const same = direct().out
    expect(result.ranked).toEqual(same.ranked)
    expect(result.suggestions).toEqual(same.suggestions)
  })

  it('한 번 묻는 크기는 늘 전술 하나의 자리 수 이하다(옛 14역할 전술도 같다)', async () => {
    const sizes: number[] = []
    const norm = flatNorms(LEGACY_CATALOG)
    const result = await recommendTactics(deps({ settings: { catalog: 'legacy14' }, norms: (profiles) => (sizes.push(profiles.length), { ok: true, norms: norm(profiles) }) }), legacyTactic('4-4-2', {}))
    expect(result.ok, result.message).toBe(true)
    expect(sizes.length).toBeGreaterThan(0)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(TACTIC_SLOTS)
  })
})

describe('추천을 만들 수 없을 때는 까닭과 함께 실패하고, 결과 모양은 그대로다', () => {
  const current = presetTactic('4-2-3-1', catalog)
  const expectFailed = (result: Awaited<ReturnType<typeof recommendTactics>>): void => {
    expect(result.ok).toBe(false)
    expect(result.message && result.message.length).toBeGreaterThan(0)
    expect(result.ranked).toEqual([])
    expect(result.suggestions).toEqual([])
    expect(typeof result.elapsedMs).toBe('number')
  }

  it('세이브를 적용하지 않았거나 내 팀을 모르면 선수단 표가 주는 글을 그대로 준다', async () => {
    const result = await recommendTactics(deps({ squad: { ok: false, message: '먼저 시작 화면에서 세이브를 골라 적용해 주세요.' } }), current)
    expectFailed(result)
    expect(result.message).toBe('먼저 시작 화면에서 세이브를 골라 적용해 주세요.')
    expectFailed(await recommendTactics(deps({ squad: { ok: false } }), current))
  })

  it('내 팀에 선수가 없으면 실패한다', async () => {
    expectFailed(await recommendTactics(deps({ squad: { ok: true, rows: [] } }), current))
  })

  it('기준 분포를 받지 못하면(준비 중이거나 실패) 그 까닭을 덧붙여 실패하고, 글에 내부 낱말(기준 분포)을 쓰지 않는다', async () => {
    const result = await recommendTactics(deps({ norms: () => ({ ok: false, message: '준비 중', norms: {} }) }), current)
    expectFailed(result)
    expect(result.message).toContain('선수를 견줄 기준(같은 자리 상위권 평균)을 아직 구하지 못해 추천을 만들 수 없습니다.')
    expect(result.message).toContain('준비 중')
    expect(result.message).not.toContain('기준 분포')
  })

  it('나눠 묻는 도중 한 번이라도 실패하면(앞 요청은 받았어도) 그 까닭과 함께 실패한다', async () => {
    const norm = fixedNorms(catalog)
    let calls = 0
    const result = await recommendTactics(deps({ norms: (profiles) => (++calls >= 3 ? normsFailed('계산하다가 멈췄습니다.') : { ok: true, norms: norm(profiles) }) }), current)
    expectFailed(result)
    expect(calls).toBe(3)
    expect(result.message).toContain('견줄 기준')
    expect(result.message).toContain('계산하다가 멈췄습니다.')
  })

  describe('답에 없는 열쇠가 하나라도 있으면 대신 값으로 채우지 않고 실패한다(진짜 기준과 대신 값이 섞인 순위를 만들지 않는다)', () => {
    const norm = fixedNorms(catalog)
    const missingOne = (which: 'first' | 'last'): Phase2Deps['norms'] => {
      let dropped = false
      return (profiles) => {
        const norms = norm(profiles)
        if (!dropped && profiles.length > 0) {
          dropped = true
          delete norms[catalog.normKey(profiles[which === 'first' ? 0 : profiles.length - 1])]
        }
        return { ok: true, norms }
      }
    }
    const expectPartial = (result: Awaited<ReturnType<typeof recommendTactics>>): void => {
      expectFailed(result)
      expect(result.message).toBe('선수를 견줄 기준(같은 자리 상위권 평균) 일부를 구하지 못해 추천을 만들 수 없습니다.')
      expect(result.message).not.toContain('기준 분포')
    }

    it.each(['first', 'last'] as const)('요청 하나의 %s 열쇠가 빠져도 실패한다', async (which) => {
      expectPartial(await recommendTactics(deps({ norms: missingOne(which) }), current))
    })

    it('답이 비어 있거나(ok인데 norms가 {}), norms 칸이 없어도 실패한다', async () => {
      expectPartial(await recommendTactics(deps({ norms: () => ({ ok: true, norms: {} }) }), current))
      expectPartial(await recommendTactics(deps({ norms: () => ({ ok: true }) as unknown as NormsResult }), current))
    })

    it('값이 비어(null) 온 열쇠도 빠진 것으로 본다', async () => {
      const nulled: Phase2Deps['norms'] = (profiles) => {
        const norms = norm(profiles)
        norms[catalog.normKey(profiles[0])] = null as never
        return { ok: true, norms }
      }
      expectPartial(await recommendTactics(deps({ norms: nulled }), current))
    })

    it('쓰는 카탈로그와 다른 목록으로 세계를 연 본체(물은 프로파일을 건너뛰고 답하는 본체)에서도 실패한다', async () => {
      // 본체는 카탈로그에 없는 역할의 프로파일을 건너뛰고 답한다. 옛 14역할 목록으로 열린 세계에 FM26 프로파일을 물으면 빈 답이 온다
      const legacyWorld: Phase2Deps['norms'] = (profiles) => ({ ok: true, norms: flatNorms(LEGACY_CATALOG)(profiles.filter((profile) => LEGACY_CATALOG.role(profile.ip.roleId))) })
      expectPartial(await recommendTactics(deps({ norms: legacyWorld }), current))
    })

    it('순수 계산은 같은 빈 답을 고정 기준으로 채워 돌린다(그 길은 미리보기 목업과 시험용이고, 본체의 서비스는 쓰지 않는다)', () => {
      const out = searchTactics({
        rows: squad,
        columns: SEARCH_COLUMNS,
        today: TODAY,
        catalog,
        overrides: {},
        current,
        presets: PRESET_IDS.map((id) => presetTactic(id, catalog)),
        normsFor: () => ({}),
        maxRounds: SEARCH_MAX_ROUNDS
      })
      expect(out.ranked.length).toBeGreaterThan(1)
    })
  })

  it('저장을 막는 문제가 있는 전술은 받지 않는다: 다른 역할 목록의 전술, 자리 수가 모자란 전술, 올바르지 않은 값', async () => {
    expectFailed(await recommendTactics(deps(), legacyTactic('4-2-3-1', {})))
    expectFailed(await recommendTactics(deps(), { ...current, slots: current.slots.slice(0, 10) }))
    expectFailed(await recommendTactics(deps(), null as unknown as Tactic))
    expectFailed(await recommendTactics(deps(), { slots: 7 } as unknown as Tactic))
    const odd = { ...current, slots: current.slots.map((slot, at) => (at === 0 ? { ...slot, ip: { ...slot.ip, roleId: '없는 역할' } } : slot)) }
    expectFailed(await recommendTactics(deps(), odd))
  })

  it('게임에서 확인 전인 칸의 알림만 있는 전술은 받는다', async () => {
    // 4-2-3-1 기본에는 확인 전인 칸 종류(수비형 미드 둘 자리 등)가 있지만 막지 않는다
    const result = await recommendTactics(deps(), current)
    expect(result.ok).toBe(true)
    expect(result.ranked.find((candidate) => candidate.current)!.unconfirmed).toBeGreaterThan(0)
  })

  it('예기치 않은 오류(기준 분포 함수가 던짐)는 서비스 밖으로 나가고, 창구가 실패 결과로 막는다', async () => {
    const boom = deps({
      norms: () => {
        throw new Error('C:\\비밀\\경로 때문에 깨졌다')
      }
    })
    await expect(recommendTactics(boom, current)).rejects.toThrow()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
    registerTacticIpc({ handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as never, boom)
    const result = (await handlers.get(TACTIC_CHANNELS.tacticRecommend)!({}, current)) as { ok: boolean; message: string; ranked: unknown[] }
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain('비밀')
    expect(result.ranked).toEqual([])
    expect(spy).toHaveBeenCalled()
  })
})

describe('창구를 거쳐서도 같다', () => {
  it('tactics:recommend 창구가 서비스를 부른다', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
    registerTacticIpc({ handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as never, deps())
    const result = (await handlers.get(TACTIC_CHANNELS.tacticRecommend)!({}, presetTactic('4-3-3', catalog))) as { ok: boolean; ranked: unknown[]; suggestions: unknown[]; elapsedMs: number }
    expect(result.ok).toBe(true)
    expect(result.ranked.length).toBeGreaterThan(1)
    expect(typeof result.elapsedMs).toBe('number')
  })
})
