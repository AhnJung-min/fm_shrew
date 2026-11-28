/**
 * 미리보기(`npm run web`)의 도구 목업(2단계 U8): 전술 추천과 역할 가중치 묶음은 본체와 같은 진짜 계산을 지어낸 자료로 돌리고,
 * 게임 전술 가져오기는 지어낸 초안을 주며, 사용자 역할 저장과 별점 대조는 "준비되지 않았습니다"를 돌려준다(던지지 않는다).
 * 이 시험은 목업이 브라우저와 같은 길(공유 계산, 목업 선수단)로 도는지만 본다. 결과 모양은 tests/phase2Contract.test.ts도 본다.
 */
import { describe, expect, it } from 'vitest'
import { mockRoleToolsApi } from '../src/renderer/src/lib/mock/roleTools'
import { mockTacticToolsApi } from '../src/renderer/src/lib/mock/tacticTools'
import { FM26_CATALOG } from '../src/shared/catalogFm26'
import { exportBundle } from '../src/shared/roleShare'
import { NOT_READY } from '../src/shared/tacticApi'
import { blockingProblems, cellPosition, legacyTactic, presetTactic, validateTactic } from '../src/shared/tacticModel'
import { RECOMMEND_NOTE } from '../src/shared/tacticSearch'
import type { Settings } from '../src/shared/types'

function state(initial: Partial<Settings> = {}): { getSettings(): Settings; setSettings(next: Settings): void } {
  let settings = { roleWeights: {}, ...initial } as Settings
  return { getSettings: () => settings, setSettings: (next) => void (settings = next) }
}

const fm26 = (): Partial<Settings> => ({ catalog: 'fm26' })

describe('전술 추천 목업', () => {
  it('진짜 탐색을 지어낸 선수단과 대신 기준 분포로 돌려 순위와 제안을 주고, 글에 그렇다고 적는다', async () => {
    const api = mockTacticToolsApi(state(fm26()))
    const current = presetTactic('4-2-3-1', FM26_CATALOG)
    const result = await api.tacticRecommend(current)
    expect(result.ok).toBe(true)
    expect(result.message?.startsWith(RECOMMEND_NOTE)).toBe(true)
    expect(result.message).toContain('미리보기')
    expect(result.ranked.length).toBeGreaterThan(1)
    expect(result.ranked.filter((candidate) => candidate.current)).toHaveLength(1)
    expect(result.ranked[0].objective).toBeGreaterThanOrEqual(result.ranked.find((candidate) => candidate.current)!.objective)
    for (const candidate of result.ranked) expect(blockingProblems(validateTactic(candidate.tactic, FM26_CATALOG)), candidate.tactic.name).toEqual([])
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('같은 입력이면 늘 같은 결과다(걸린 시간만 다르다)', async () => {
    const api = mockTacticToolsApi(state(fm26()))
    const current = presetTactic('3-5-2', FM26_CATALOG)
    const a = await api.tacticRecommend(current)
    const b = await api.tacticRecommend(current)
    expect({ ...a, elapsedMs: 0 }).toEqual({ ...b, elapsedMs: 0 })
  })

  it('옛 14역할 설정(미리보기의 지금 기본)에서도 옛 전술로 돈다', async () => {
    const api = mockTacticToolsApi(state())
    const result = await api.tacticRecommend(legacyTactic('4-2-3-1', {}))
    expect(result.ok).toBe(true)
    expect(result.ranked.length).toBeGreaterThan(1)
  })

  it('저장할 수 없는 전술이면 까닭과 함께 실패하고 던지지 않는다', async () => {
    const api = mockTacticToolsApi(state(fm26()))
    for (const bad of [null, { slots: 1 }, legacyTactic('4-2-3-1', {})]) {
      const result = await api.tacticRecommend(bad as never)
      expect(result.ok).toBe(false)
      expect(result.ranked).toEqual([])
      expect(result.message?.length).toBeGreaterThan(0)
    }
  })
})

describe('게임 전술 가져오기 목업', () => {
  it('지어낸 초안을 준다: 저장할 수 있는 전술이고, 앱이 모르는 게임 값이 하나 있으며, 공 미소유 시에 한 자리가 다른 칸에 있다', async () => {
    const api = mockTacticToolsApi(state(fm26()))
    const result = await api.tacticImport()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('확인할 것이 있습니다')
    expect(result.draft).toBeDefined()
    const draft = result.draft!
    expect(draft.source).toBe('game')
    expect(draft.catalog).toBe('fm26')
    expect(blockingProblems(validateTactic(draft, FM26_CATALOG))).toEqual([])
    expect(result.unknownBits).toHaveLength(1)
    expect(result.unknownBits[0]).toMatch(/^공 미소유 시 역할 \d+$/)
    expect(result.problems[0]).toContain(result.unknownBits[0].replace('공 미소유 시 역할 ', '값 '))
    expect(result.gameName).toBe('미리보기 전술')
    expect(result.formationName).toBe('4-2-3-1')
    const moved = draft.slots.filter((slot) => cellPosition(slot.ip.cell) !== cellPosition(slot.oop.cell))
    expect(moved).toHaveLength(1)
    expect([cellPosition(moved[0].ip.cell), cellPosition(moved[0].oop.cell)]).toEqual(['AMR', 'MR'])
  })

  it('자리별 역할 목록 읽기를 켜면 그 견줌 한 줄이 더 붙는다', async () => {
    const api = mockTacticToolsApi(state(fm26()))
    const plain = await api.tacticImport()
    const withLists = await api.tacticImport({ readRoleLists: true })
    expect(withLists.problems).toHaveLength(plain.problems.length + 1)
    expect(withLists.problems[withLists.problems.length - 1]).toContain('자리별 역할 목록')
  })

  it('옛 14역할 설정이면 실제 앱과 같은 글로 막는다', async () => {
    const result = await mockTacticToolsApi(state()).tacticImport()
    expect(result.ok).toBe(false)
    expect(result.draft).toBeUndefined()
    expect(result.message).toContain('옛 14역할')
  })
})

describe('역할 도구 목업', () => {
  it('사용자 역할 저장과 게임 별점 대조는 아직 준비되지 않았다(던지지 않는다)', async () => {
    const api = mockRoleToolsApi(state())
    expect(await api.customRolesSave([])).toEqual({ ok: false, message: NOT_READY })
    expect(await api.roleStarCheck()).toEqual({ ok: false, message: NOT_READY, rows: [], players: 0, readAt: null })
  })

  it('가져오기 미리 보기: 파일이 없으니 지어낸 묶음을 보여 주고, 바뀔 역할과 경고(판이 다름, 모르는 역할)가 나온다', async () => {
    const api = mockRoleToolsApi(state(fm26()))
    const preview = await api.roleBundlePreview()
    expect(preview.ok).toBe(true)
    expect(preview.token).toBeTruthy()
    expect(preview.changes.length).toBeGreaterThan(0)
    expect(preview.message).toContain('지어낸 묶음')
    expect(preview.warnings.join(' ')).toContain('26.2.5')
    expect(preview.warnings.join(' ')).toContain('건너뛴 역할 1개')
  })

  it('적용하면 설정(roleWeights)이 바뀌고 결과가 바뀐 설정을 돌려준다. 같은 표는 한 번만 쓴다', async () => {
    const s = state(fm26())
    const api = mockRoleToolsApi(s)
    const preview = await api.roleBundlePreview()
    expect(await api.roleBundleApply('엉뚱한 표', 'merge')).toMatchObject({ ok: false })
    const applied = await api.roleBundleApply(preview.token!, 'merge')
    expect(applied.ok).toBe(true)
    expect(applied.message).toContain('합쳤습니다')
    expect(applied.settings).toBe(s.getSettings())
    expect(Object.keys(s.getSettings().roleWeights).length).toBeGreaterThan(0)
    expect(await api.roleBundleApply(preview.token!, 'merge')).toMatchObject({ ok: false })
  })

  it('내보낸 묶음은 파일 대신 화면에 기억하고, 되돌린 뒤 가져오면 같은 가중치로 돌아온다', async () => {
    const s = state({ ...fm26(), roleWeights: { 'ip.Goalkeeper': { handling: 1 }, 'oop.OPCentreBack': { tackling: 5 } } })
    const api = mockRoleToolsApi(s)
    const exported = await api.roleBundleExport()
    expect(exported.ok).toBe(true)
    expect(exported.message).toContain('기억')
    const mine = s.getSettings().roleWeights
    s.setSettings({ ...s.getSettings(), roleWeights: {} })
    const preview = await api.roleBundlePreview()
    expect(preview.message).not.toContain('지어낸 묶음')
    expect(preview.changes.length).toBe(2)
    expect((await api.roleBundleApply(preview.token!, 'replace')).ok).toBe(true)
    expect(s.getSettings().roleWeights).toEqual(mine)
    // 기억해 둔 것이 지금 설정과 같으면 바뀌는 것이 없다
    expect((await api.roleBundlePreview()).changes).toEqual([])
    expect(exportBundle(s.getSettings(), FM26_CATALOG).weights['ip.Goalkeeper']).toBeDefined()
  })
})
