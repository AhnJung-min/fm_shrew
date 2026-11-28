import { activeCatalog } from '@shared/catalogs'
import { SEARCH_MAX_ROUNDS } from '@shared/limits'
import type { RoleNorms } from '@shared/norms'
import type { SlotProfile } from '@shared/slotProfile'
import { tacticRecommendFailed, type TacticRecommendResult } from '@shared/tacticApi'
import { blockingProblems, PRESET_IDS, presetTactic, validateTactic, type Tactic } from '@shared/tacticModel'
import { RECOMMEND_NOTE, searchTacticsSteps } from '@shared/tacticSearch'
import type { Phase2Deps } from './tacticIpc'

/**
 * 전술 추천(A-20). 적용해 둔 세이브의 내 팀 선수단과 쓰는 카탈로그, 사용자가 고친 역할 가중치로 순수 계산(shared/tacticSearch.ts)을 돌려
 * 순위(지금 전술 포함)와 지금 전술의 자리별 제안을 돌려준다. 기준 분포는 deps.norms(본체가 world.normsFor로 이어 주는 함수)로 받는다.
 * 읽기만 한다: 설정과 세이브와 게임에 아무것도 쓰지 않는다. 결과에는 선수 이름이나 번호가 없다(전술과 프로파일뿐).
 *
 * 추천이 도는 동안 본체가 막히지 않게, 시작점(지금 전술, 프리셋 하나) 하나를 끝낼 때마다 이벤트 루프에 양보한다(setImmediate).
 * 시작점마다 그 시작점의 기준 분포를 따로 받으므로(이미 받은 열쇠는 본체의 캐시가 대신한다) 무거운 계산도 그 사이사이에 나뉜다.
 */

/** 기준 분포를 받지 못했다(본체의 계산이 아직 준비되지 않았거나 실패했다). 까닭 글을 담는다 */
class NormsUnavailable extends Error {}

/** 이벤트 루프에 한 번 양보한다(다른 창구 요청과 화면 갱신이 끼어들 수 있다) */
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

export async function recommendTactics(deps: Phase2Deps, tactic: Tactic): Promise<TacticRecommendResult> {
  const started = Date.now()
  const failed = (message: string): TacticRecommendResult => ({ ...tacticRecommendFailed(message), elapsedMs: Date.now() - started })

  const settings = deps.settings.get()
  const catalog = activeCatalog(settings)
  // 화면이 보낸 전술을 본체가 다시 검사한다. 저장을 막는 문제(오류)가 없으면 확인 전인 칸의 알림은 있어도 추천할 수 있다
  const problems = blockingProblems(validateTactic(tactic, catalog))
  if (problems.length > 0) return failed(`이 전술로는 추천을 만들 수 없습니다. ${problems[0].message}`)

  const squad = deps.world.squad()
  if (!squad.ok) return failed(squad.message ?? '먼저 시작 화면에서 세이브를 골라 적용해 주세요.')
  if (squad.rows.length === 0) return failed('내 팀에 선수가 없어 추천을 만들 수 없습니다.')

  const normsFor = (profiles: SlotProfile[]): RoleNorms => {
    const result = deps.norms(profiles)
    if (!result.ok) throw new NormsUnavailable(result.message ?? '')
    return result.norms
  }
  try {
    const steps = searchTacticsSteps({
      rows: squad.rows,
      columns: squad.columns,
      today: squad.today,
      catalog,
      overrides: settings.roleWeights ?? {},
      current: tactic,
      presets: PRESET_IDS.map((id) => presetTactic(id, catalog)),
      normsFor,
      maxRounds: SEARCH_MAX_ROUNDS
    })
    let step = steps.next()
    while (!step.done) {
      await yieldToLoop()
      step = steps.next()
    }
    // 성공한 결과의 글은 고정 문구다(순위를 "강한 전술"이라는 뜻으로 읽지 않게)
    return { ok: true, message: RECOMMEND_NOTE, ranked: step.value.ranked, suggestions: step.value.suggestions, elapsedMs: Date.now() - started }
  } catch (error) {
    if (error instanceof NormsUnavailable) return failed(`기준 분포를 아직 구하지 못해 추천을 만들 수 없습니다.${error.message ? ` ${error.message}` : ''}`)
    throw error
  }
}
