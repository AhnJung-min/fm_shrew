import { NOT_READY, tacticImportFailed, tacticRecommendFailed } from '@shared/tacticApi'
import type { Api, Settings } from '@shared/types'

/**
 * 미리보기의 게임 전술 가져오기와 전술 추천 목업(빈 틀). 2단계의 U8이 채운다: 전술 추천은 진짜 계산을 가짜 선수단과 대신 기준 분포로 돌리고,
 * 가져오기는 지어낸 초안(모르는 값 하나 포함)을 준다. 지금은 "준비되지 않았습니다"를 돌려준다(던지지 않는다).
 */
export function mockTacticToolsApi(_state: { getSettings(): Settings; setSettings(next: Settings): void }): Pick<Api, 'tacticImport' | 'tacticRecommend'> {
  return {
    tacticImport: async () => tacticImportFailed(NOT_READY),
    tacticRecommend: async () => tacticRecommendFailed(NOT_READY)
  }
}
