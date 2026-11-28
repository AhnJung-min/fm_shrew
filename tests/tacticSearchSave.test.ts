/**
 * 전술 추천을 고정 시험 세이브에서 돌린다(2단계 U8, N-01·A-20). 환경 변수가 없으면 건너뛴다(저장소에는 세이브를 두지 않는다).
 *   FMB_TEST_SAVE  고정해 둔 세이브 사본의 경로
 *   FMB_TEST_TEAM  그 세이브에서 내 팀 번호
 *
 * 받아들이는 조건: 빈 캐시(새로 읽은 세이브, 한 번도 기준 분포를 구하지 않은 상태)에서 전술 추천 한 번이 2,000ms 이하다. 이것이 실패 조건이다.
 * 잰 시간은 서비스 전체(내 선수단 표, 기준 분포, 탐색)다. 따뜻한 상태(같은 세계에서 다시 돌린 것)와 다른 프리셋에서 시작한 시간은 찍기만 한다.
 *
 * 본체의 기준 분포 함수(WorldService.normsFor, 2단계 U5)가 아직 없으면 이 시간은 의미가 없다. 그때는 고정 기준 분포로 탐색이 실제 선수단에서
 * 돌아가는지(1위가 지금 전술 이상, 제안의 이득이 문턱 이상)와 탐색만의 시간을 찍고, 2,000ms 검사는 건너뛴다고 적는다(normsFor가 들어오면 같은 시험이 바로 검사한다).
 */
import { describe, expect, it } from 'vitest'
import type { Phase2Deps } from '../src/main/tacticIpc'
import { recommendTactics } from '../src/main/tacticSearchService'
import { activeCatalog } from '../src/shared/catalogs'
import { K } from '../src/shared/ledger'
import type { RoleNorms } from '../src/shared/norms'
import type { SlotProfile } from '../src/shared/slotProfile'
import { presetTactic, PRESET_IDS } from '../src/shared/tacticModel'
import type { Settings } from '../src/shared/types'
import { openBaselineWorld } from './helpers/baselineWorld'

const SAVE = process.env.FMB_TEST_SAVE
const TEAM = Number(process.env.FMB_TEST_TEAM)
/** 빈 캐시에서 전술 추천 한 번의 예산(ms) */
const BUDGET_MS = 2000

type NormsFor = (profiles: SlotProfile[]) => RoleNorms

describe.skipIf(!SAVE)('전술 추천: 시험 세이브', () => {
  it(`빈 캐시에서 ${BUDGET_MS}ms 이하로 끝나고, 순위와 제안이 맞는다`, async () => {
    const { ws, readMs } = await openBaselineWorld(SAVE!, TEAM)
    const world = ws as unknown as { normsFor?: NormsFor; clearScoringCaches?: () => void }
    // 새로 읽은 세계라 캐시는 비어 있다. 비우는 함수가 있으면 한 번 더 비운다
    world.clearScoringCaches?.()
    const real = typeof world.normsFor === 'function' ? (profiles: SlotProfile[]): RoleNorms => world.normsFor!(profiles) : null
    const standIn: NormsFor = (profiles) => Object.fromEntries(profiles.map((profile) => [catalog.normKey(profile), { mu: 58, sigma: 4, beta: 0.25, n: 300, caRef: 110 }]))
    const settings = { roleWeights: {}, catalog: 'fm26' } as unknown as Settings
    const catalog = activeCatalog(settings)
    const deps: Phase2Deps = {
      settings: { get: () => settings, set: () => settings } as never,
      world: ws,
      link: {} as never,
      norms: (profiles) => ({ ok: true, norms: (real ?? standIn)(profiles) }),
      pickSavePath: async () => null,
      pickOpenPath: async () => null,
      dataDir: ''
    }

    const current = presetTactic('4-2-3-1', catalog)
    const started = performance.now()
    const cold = await recommendTactics(deps, current)
    const coldMs = performance.now() - started
    console.log(`세이브 읽기 ${Math.round(readMs)}ms. 전술 추천(빈 캐시, ${real ? '본체의 기준 분포' : '고정 기준 분포(normsFor 없음)'}): ${Math.round(coldMs)}ms, 서비스가 잰 ${cold.elapsedMs}ms, 예산 ${BUDGET_MS}ms`)

    expect(cold.ok, cold.message).toBe(true)
    expect(cold.ranked.length).toBeGreaterThan(1)
    // 1위는 지금 전술 이상이고, 목적 값이 큰 순서다
    const now = cold.ranked.find((candidate) => candidate.current)!
    expect(cold.ranked[0].objective).toBeGreaterThanOrEqual(now.objective)
    for (let at = 1; at < cold.ranked.length; at++) expect(cold.ranked[at - 1].objective).toBeGreaterThanOrEqual(cold.ranked[at].objective)
    // 지금 전술은 11자리를 모두 채운다(1군에 모든 포지션의 선수가 있다)
    expect(now.filled).toBe(11)
    for (const suggestion of cold.suggestions) expect(suggestion.gain).toBeGreaterThanOrEqual(K.ROLE_SWAP_MIN_GAIN)

    if (real) expect(coldMs, `빈 캐시에서 ${BUDGET_MS}ms 안에 끝나야 한다`).toBeLessThanOrEqual(BUDGET_MS)
    else console.log('기준 분포 함수(WorldService.normsFor)가 아직 없어 2,000ms 검사는 건너뜁니다(고정 기준 분포로 탐색만 쟀습니다).')

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
  }, 180_000)
})
