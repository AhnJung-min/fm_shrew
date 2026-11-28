import { activeCatalog } from '@shared/catalogs'
import { SEARCH_MAX_ROUNDS, TACTIC_SLOTS } from '@shared/limits'
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
 *
 * 기준 분포를 구하지 못한 프로파일이 하나라도 있으면 추천을 만들지 않고 까닭과 함께 실패한다. 진짜 기준과 대신 값(FALLBACK_NORM)이 섞인 순위는
 * 그럴듯해 보이는데 틀려서 가장 위험하다. 대신 값으로 채우는 것은 순수 계산(shared/tacticSearch.ts)과 미리보기 목업에만 남겨 둔다.
 */

/**
 * 본체의 기준 분포 함수(deps.norms)에 한 번에 묻는 프로파일 수의 상한. 본체는 요청 하나에 받아 주는 수에 한도를 둔다(전술 하나의 자리 수 × 저장하는 전술 수 = 33).
 * 그런데 한 시작점의 후보 짝은 그보다 훨씬 많아서(4-2-3-1 하나만 해도 서로 다른 프로파일이 100개를 넘는다) 한꺼번에 물으면 늘 거절된다.
 * 그래서 전술 하나의 자리 수씩 나눠 묻고 답을 합친다. 프로파일마다 답은 따로 구해지므로 나눠 물어도 결과는 같다.
 */
const NORMS_REQUEST_MAX = TACTIC_SLOTS

/** 기준 분포를 받지 못했다(본체의 계산이 아직 준비되지 않았거나 실패했거나, 물은 것 가운데 빠진 것이 있다). 화면에 줄 글을 담는다 */
class NormsUnavailable extends Error {}

/** 화면에 주는 글. "같은 자리 상위권 평균"은 선수의 점수를 견주는 눈금이다. 본체가 준 까닭(있으면)을 뒤에 붙인다 */
const normsMessage = (reason: string): string => `선수를 견줄 기준(같은 자리 상위권 평균)을 아직 구하지 못해 추천을 만들 수 없습니다.${reason ? ` ${reason}` : ''}`
const NORMS_PARTIAL = '선수를 견줄 기준(같은 자리 상위권 평균) 일부를 구하지 못해 추천을 만들 수 없습니다.'

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

  // 기준 분포 함수: 한도 이하로 나눠 묻고 답을 합친다. 물은 열쇠가 하나라도 답에 없으면 대신 값으로 채우지 않고 멈춘다
  const normsFor = (profiles: SlotProfile[]): RoleNorms => {
    const norms: RoleNorms = {}
    for (let at = 0; at < profiles.length; at += NORMS_REQUEST_MAX) {
      const result = deps.norms(profiles.slice(at, at + NORMS_REQUEST_MAX))
      if (!result.ok) throw new NormsUnavailable(normsMessage(result.message ?? ''))
      for (const [key, norm] of Object.entries(result.norms ?? {})) norms[key] = norm
    }
    for (const profile of profiles) {
      const key = catalog.normKey(profile)
      if (!Object.hasOwn(norms, key) || !norms[key]) throw new NormsUnavailable(NORMS_PARTIAL)
    }
    return norms
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
    if (error instanceof NormsUnavailable) return failed(error.message)
    throw error
  }
}
