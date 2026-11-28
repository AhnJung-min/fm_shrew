import { activeCatalog } from '@shared/catalogs'
import { SEARCH_MAX_ROUNDS } from '@shared/limits'
import { FALLBACK_NORM, type RoleNorms } from '@shared/norms'
import type { SlotProfile } from '@shared/slotProfile'
import { tacticImportFailed, tacticRecommendFailed, type TacticImportResult, type TacticRecommendResult } from '@shared/tacticApi'
import { blockingProblems, canonicalOrder, PRESET_IDS, presetTactic, validateTactic, type Tactic } from '@shared/tacticModel'
import { RECOMMEND_NOTE, searchTactics } from '@shared/tacticSearch'
import type { Api, Settings } from '@shared/types'
import { mockSquad } from '../mockWorld'

/**
 * 미리보기(`npm run web`)의 게임 전술 가져오기와 전술 추천 목업.
 * 전술 추천은 본체와 같은 진짜 계산(shared/tacticSearch.ts)을 지어낸 선수단(mockWorld의 내 팀 24명)과 대신 기준 분포로 돌린다:
 * 미리보기에는 세이브 전체가 없어 기준 분포를 구하지 못하므로 모든 프로파일에 고정 기준(FALLBACK_NORM)을 주고, 결과 글에 그렇다고 적는다.
 * 가져오기는 지어낸 초안(공 미소유 시에 한 자리가 다른 칸으로 가는 4-2-3-1)과 앱이 모르는 게임 값 하나를 준다. 실제 게임을 읽지 않는다.
 */

/** 미리보기의 대신 기준 분포: 모든 프로파일에 같은 고정 기준 */
function previewNorms(profiles: SlotProfile[], key: (profile: SlotProfile) => string): RoleNorms {
  return Object.fromEntries(profiles.map((profile) => [key(profile), { mu: FALLBACK_NORM.mu, sigma: FALLBACK_NORM.sigma, beta: FALLBACK_NORM.beta, n: 0, caRef: FALLBACK_NORM.caRef }]))
}

/** 게임에 앱이 모르는 값이 있다고 보이게 지어낸 역할 번호(앱이 아는 가장 큰 번호보다 한 단계 위) */
const UNKNOWN_ROLE_BIT = '288230376151711744'

export function mockTacticToolsApi(state: { getSettings(): Settings; setSettings(next: Settings): void }): Pick<Api, 'tacticImport' | 'tacticRecommend'> {
  return {
    tacticImport: async (options): Promise<TacticImportResult> => {
      const catalog = activeCatalog(state.getSettings())
      if (catalog.id !== 'fm26') {
        return tacticImportFailed('지금은 옛 14역할 목록을 쓰고 있어 게임 전술을 가져올 수 없습니다. 게임의 역할은 FM26 역할 목록으로만 읽을 수 있습니다.')
      }
      // 지어낸 게임 전술: 4-2-3-1이고, 오른쪽 공격이 공 미소유 시에는 오른쪽 미드로 내려온다
      const base = presetTactic('4-2-3-1', catalog, 'game:preview')
      const slots = base.slots.map((slot) => {
        if (slot.ip.cell.line !== 'AM' || slot.ip.cell.lane !== 'R') return slot
        return { ...slot, oop: { cell: { line: 'M' as const, lane: 'R' as const }, roleId: catalog.defaultRole('MR', 'oop', 'MR') } }
      })
      const draft: Tactic = canonicalOrder({ ...base, name: '미리보기 전술', source: 'game', slots })
      // 앱이 모르는 값을 만난 자리는 앱의 기본 역할로 채워 보여 준다(실제 가져오기는 이 경우 초안을 만들지 않지만, 미리보기에서 문제 목록이 어떻게 보이는지 보려는 것이다)
      const unknownAt = draft.slots.findIndex((slot) => slot.ip.cell.line === 'ST') + 1
      const noted = validateTactic(draft, catalog).map((problem) => problem.message)
      const problems = [`${unknownAt}번째 자리의 공 미소유 시 역할(값 ${UNKNOWN_ROLE_BIT})을 앱이 모릅니다. 앱의 기본 역할로 채워 두었으니 편집기에서 확인해 주세요.`, ...noted]
      if (options?.readRoleLists) problems.push('자리별 역할 목록은 22곳(전체 22곳)을 읽어 22곳을 견주었고, 그 가운데 2곳이 앱의 목록과 달랐습니다.')
      return {
        ok: false,
        message: '게임의 지금 전술 “미리보기 전술”을 읽었지만 확인할 것이 있습니다. 아래를 살펴본 뒤 편집기에서 고쳐 저장해 주세요. 미리보기라 지어낸 전술입니다.',
        draft,
        problems,
        unknownBits: [`공 미소유 시 역할 ${UNKNOWN_ROLE_BIT}`],
        gameName: '미리보기 전술',
        formationName: '4-2-3-1',
        elapsedMs: 1800
      }
    },

    tacticRecommend: async (tactic): Promise<TacticRecommendResult> => {
      const started = Date.now()
      const settings = state.getSettings()
      const catalog = activeCatalog(settings)
      const problems = blockingProblems(validateTactic(tactic, catalog))
      if (problems.length > 0) return { ...tacticRecommendFailed(`이 전술로는 추천을 만들 수 없습니다. ${problems[0].message}`), elapsedMs: Date.now() - started }
      const squad = mockSquad(false)
      const out = searchTactics({
        rows: squad.rows,
        columns: squad.columns,
        today: squad.today,
        catalog,
        overrides: settings.roleWeights ?? {},
        current: tactic,
        presets: PRESET_IDS.map((id) => presetTactic(id, catalog)),
        normsFor: (profiles) => previewNorms(profiles, catalog.normKey),
        maxRounds: SEARCH_MAX_ROUNDS
      })
      return { ok: true, message: `${RECOMMEND_NOTE} 미리보기라 지어낸 선수단과 대신 기준 분포로 계산했습니다.`, ranked: out.ranked, suggestions: out.suggestions, elapsedMs: Date.now() - started }
    }
  }
}
