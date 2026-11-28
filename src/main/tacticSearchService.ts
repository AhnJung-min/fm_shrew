import { NOT_READY, tacticRecommendFailed, type TacticRecommendResult } from '@shared/tacticApi'
import type { Tactic } from '@shared/tacticModel'
import type { Phase2Deps } from './tacticIpc'

/**
 * 전술 추천(빈 틀). 2단계의 U8(전술 추천·가중치 공유·사용자 역할·별점 대조)이 채운다: 세이브의 내 팀 선수단과 쓰는 카탈로그, 주 전술, 프리셋으로
 * 순수 계산(shared/tacticSearch.ts)을 돌려 순위와 자리별 제안을 돌려준다. 지금은 "준비되지 않았습니다"를 돌려준다.
 */

export async function recommendTactics(_deps: Phase2Deps, _tactic: Tactic): Promise<TacticRecommendResult> {
  return tacticRecommendFailed(NOT_READY)
}
