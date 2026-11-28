/**
 * 전술 추천을 고정 시험 세이브에서 돌린다(2단계 U8, N-01·A-20). 환경 변수가 없으면 건너뛴다(저장소에는 세이브를 두지 않는다).
 *   FMB_TEST_SAVE  고정해 둔 세이브 사본의 경로
 *   FMB_TEST_TEAM  그 세이브에서 내 팀 번호
 *
 * 시험은 둘이다.
 *  1. 탐색이 실제 선수단에서 돈다: 고정 기준 분포로 순위와 제안이 맞는지만 본다. 본체의 기준 분포 함수와 상관없이 늘 돈다.
 *  2. 빈 캐시에서 전술 추천 한 번이 2,000ms 이하다(실패 조건). 본체의 진짜 기준 분포 함수(WorldService.normsFor, 2단계 U5)로 잰다.
 *     그 함수가 없는 브랜치에서는 잴 수 없어서 이 시험은 "건너뜀"으로 보인다. 통과로 찍히지 않는다(U5가 합쳐지면 저절로 돈다).
 *
 * 시간을 재는 세계는 FM26 카탈로그로 연다. tests/helpers/baselineWorld.ts의 openBaselineWorld는 카탈로그 없이 세계를 만들어 옛 14역할이 되고,
 * 그러면 본체가 FM26 프로파일을 모두 건너뛰어 기준 분포를 하나도 구하지 못한다(그 빈 답을 대신 값으로 채우면 아주 빨리 끝나서 시간이 의미 없다).
 * 그래서 요청한 열쇠가 답에 빠짐없이 있는지(빠진 수 0)도 함께 본다.
 * 본체(src/main/index.ts)가 deps.norms에 거는 "한 번에 받는 프로파일 수" 한도도 같은 값으로 흉내 내서, 서비스가 나눠 묻는지 실제 길로 본다.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Phase2Deps } from '../src/main/tacticIpc'
import { recommendTactics } from '../src/main/tacticSearchService'
import { WorldService } from '../src/main/worldService'
import { activeCatalog } from '../src/shared/catalogs'
import { K } from '../src/shared/ledger'
import { TACTIC_SLOTS, TACTICS_PER_SAVE } from '../src/shared/limits'
import type { RoleNorms } from '../src/shared/norms'
import type { SlotProfile } from '../src/shared/slotProfile'
import { normsFailed, type TacticRecommendResult } from '../src/shared/tacticApi'
import { presetTactic, PRESET_IDS } from '../src/shared/tacticModel'
import type { Settings } from '../src/shared/types'

const SAVE = process.env.FMB_TEST_SAVE
const TEAM = Number(process.env.FMB_TEST_TEAM)
/** 빈 캐시에서 전술 추천 한 번의 예산(ms) */
const BUDGET_MS = 2000
/** 본체가 기준 분포 요청 하나에 받아 주는 프로파일 수(src/main/index.ts의 NORMS_PROFILES_MAX와 같은 값: 전술 하나의 자리 수 × 저장하는 전술 수) */
const NORMS_PROFILES_MAX = TACTIC_SLOTS * TACTICS_PER_SAVE
/** 본체의 기준 분포 함수가 이 브랜치에 있는가(없으면 시간 시험은 건너뛴다) */
const HAS_NORMS_FOR = typeof (WorldService.prototype as unknown as { normsFor?: unknown }).normsFor === 'function'

type WorldDeps = ConstructorParameters<typeof WorldService>[0]
type NormsFor = (profiles: SlotProfile[]) => RoleNorms

const settings = { roleWeights: {}, catalog: 'fm26' } as unknown as Settings
const catalog = activeCatalog(settings)

describe.skipIf(!SAVE)('전술 추천: 시험 세이브', () => {
  const tempDirs: string[] = []
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  })
  if (SAVE && !HAS_NORMS_FOR) console.log('본체의 기준 분포 함수(WorldService.normsFor)가 이 브랜치에 없어 "빈 캐시 2,000ms" 시험은 건너뜁니다(고정 기준 분포로 탐색만 시험합니다).')

  /** 세이브를 FM26 카탈로그로 적용한 세계(읽는 데 4초쯤 걸린다). 캐시는 비어 있다 */
  function openWorld(): { ws: WorldService; readMs: number } {
    const namesDir = mkdtempSync(join(tmpdir(), 'fmb-search-names-'))
    tempDirs.push(namesDir)
    // 이 브랜치의 WorldDeps에는 catalog가 없을 수 있다(U5가 더한다). 그때는 무시되고, 어차피 normsFor가 없어 시간 시험은 건너뛴다
    const deps: WorldDeps & { catalog(): typeof catalog } = {
      knownTeam: () => TEAM,
      rosterNames: () => [],
      rememberTeam: () => undefined,
      roleWeights: () => ({}),
      catalog: () => catalog,
      namesDir
    }
    const ws = new WorldService(deps)
    const started = performance.now()
    ws.apply(SAVE!)
    return { ws, readMs: performance.now() - started }
  }

  const baseDeps = (world: unknown, norms: Phase2Deps['norms']): Phase2Deps => ({
    settings: { get: () => settings, set: () => settings } as never,
    world: world as never,
    link: {} as never,
    norms,
    pickSavePath: async () => null,
    pickOpenPath: async () => null,
    dataDir: ''
  })

  /** 순위는 목적 값 순이고 1위는 지금 전술 이상이며, 지금 전술은 11자리를 모두 채우고, 제안의 이득은 문턱 이상이다 */
  function expectSane(result: TacticRecommendResult): void {
    expect(result.ok, result.message).toBe(true)
    expect(result.ranked.length).toBeGreaterThan(1)
    const now = result.ranked.find((candidate) => candidate.current)!
    expect(result.ranked[0].objective).toBeGreaterThanOrEqual(now.objective)
    for (let at = 1; at < result.ranked.length; at++) expect(result.ranked[at - 1].objective).toBeGreaterThanOrEqual(result.ranked[at].objective)
    // 1군에 모든 포지션의 선수가 있어 지금 전술은 11자리를 모두 채운다
    expect(now.filled).toBe(11)
    for (const suggestion of result.suggestions) expect(suggestion.gain).toBeGreaterThanOrEqual(K.ROLE_SWAP_MIN_GAIN)
  }

  it('탐색이 실제 선수단에서 돈다(고정 기준 분포): 순위와 제안이 맞는다', async () => {
    const { ws, readMs } = openWorld()
    // 요청한 프로파일마다 같은 고정 기준을 준다(본체의 기준 분포 함수와 상관없이 탐색만 본다)
    const standIn: NormsFor = (profiles) => Object.fromEntries(profiles.map((profile) => [catalog.normKey(profile), { mu: 58, sigma: 4, beta: 0.25, n: 300, caRef: 110 }]))
    const deps = baseDeps(ws, (profiles) => ({ ok: true, norms: standIn(profiles) }))
    const started = performance.now()
    const result = await recommendTactics(deps, presetTactic('4-2-3-1', catalog))
    console.log(`세이브 읽기 ${Math.round(readMs)}ms. 전술 추천(고정 기준 분포, 탐색만): ${Math.round(performance.now() - started)}ms, 순위 ${result.ranked.length}개, 제안 ${result.suggestions.length}개`)
    expectSane(result)
  }, 180_000)

  it.skipIf(!HAS_NORMS_FOR)(
    `빈 캐시에서 ${BUDGET_MS}ms 이하로 끝나고(본체의 진짜 기준 분포 함수), 물은 열쇠가 빠짐없이 답에 있으며, 순위와 제안이 맞는다`,
    async () => {
      const { ws, readMs } = openWorld()
      const world = ws as unknown as { normsFor(profiles: SlotProfile[]): RoleNorms; clearScoringCaches?: () => void }
      // 새로 읽은 세계라 캐시는 비어 있다. 비우는 함수가 있으면 한 번 더 비운다
      world.clearScoringCaches?.()

      // 서비스 시간의 안쪽을 가른다: 선수단 표, 기준 분포(본체), 나머지(탐색)
      const stats = { squadMs: 0, normsMs: 0, calls: 0, asked: 0, missing: 0, biggest: 0 }
      const norms: Phase2Deps['norms'] = (profiles) => {
        // 본체(src/main/index.ts)가 deps.norms로 잇는 것과 같은 모양: 한 번에 받는 수에 한도를 두고, 세계의 기준 분포 함수로 구한다
        if (profiles.length > NORMS_PROFILES_MAX) return normsFailed('한 번에 구할 수 있는 자리 수를 넘었습니다.')
        const started = performance.now()
        const answer = world.normsFor(profiles)
        stats.normsMs += performance.now() - started
        stats.calls++
        stats.asked += profiles.length
        stats.biggest = Math.max(stats.biggest, profiles.length)
        for (const profile of profiles) if (!Object.hasOwn(answer, catalog.normKey(profile))) stats.missing++
        return { ok: true, norms: answer }
      }
      const timedWorld = {
        squad: () => {
          const started = performance.now()
          const table = ws.squad()
          stats.squadMs += performance.now() - started
          return table
        }
      }
      const deps = baseDeps(timedWorld, norms)

      const current = presetTactic('4-2-3-1', catalog)
      const started = performance.now()
      const cold = await recommendTactics(deps, current)
      const coldMs = performance.now() - started
      const rest = coldMs - stats.squadMs - stats.normsMs
      console.log(
        `세이브 읽기 ${Math.round(readMs)}ms. 전술 추천(빈 캐시, 본체의 기준 분포): ${Math.round(coldMs)}ms(서비스가 잰 ${cold.elapsedMs}ms), 예산 ${BUDGET_MS}ms. ` +
          `안쪽: 선수단 표 ${Math.round(stats.squadMs)}ms, 기준 분포 ${Math.round(stats.normsMs)}ms(${stats.calls}번에 프로파일 ${stats.asked}개, 한 번에 가장 많이 ${stats.biggest}개), 나머지(탐색) ${Math.round(rest)}ms`
      )

      // 물은 열쇠가 하나라도 답에 없으면 대신 값으로 채워져 시간이 의미 없어진다(서비스는 이때 실패하지만, 까닭이 보이게 먼저 센다)
      expect(stats.asked, '기준 분포를 한 번도 묻지 않았다').toBeGreaterThan(0)
      expect(stats.missing, '물은 프로파일 가운데 답에 없는 열쇠의 수').toBe(0)
      expect(cold.ok, cold.message).toBe(true)
      expectSane(cold)
      expect(coldMs, `빈 캐시에서 ${BUDGET_MS}ms 안에 끝나야 한다`).toBeLessThanOrEqual(BUDGET_MS)

      // 따뜻한 상태와 다른 프리셋에서 시작한 시간은 찍기만 한다
      const warmStarted = performance.now()
      const warm = await recommendTactics(deps, current)
      console.log(`전술 추천(따뜻한 상태): ${Math.round(performance.now() - warmStarted)}ms`)
      expect(warm.ranked).toEqual(cold.ranked)
      expect(warm.suggestions).toEqual(cold.suggestions)
      for (const id of PRESET_IDS.filter((each) => each !== '4-2-3-1')) {
        const t0 = performance.now()
        const other = await recommendTactics(deps, presetTactic(id, catalog))
        console.log(`전술 추천(${id}에서 시작, 따뜻한 상태): ${Math.round(performance.now() - t0)}ms, 순위 ${other.ranked.length}개, 제안 ${other.suggestions.length}개`)
        expect(other.ok, other.message).toBe(true)
        expect(other.ranked[0].objective).toBeGreaterThanOrEqual(other.ranked.find((candidate) => candidate.current)!.objective)
      }
      expect(stats.missing).toBe(0)
    },
    180_000
  )
})
