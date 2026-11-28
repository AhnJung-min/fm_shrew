import { NOT_READY, tacticImportFailed, type TacticImportResult } from '@shared/tacticApi'
import type { Phase2Deps } from './tacticIpc'

/**
 * 게임에서 전술 가져오기(빈 틀). 2단계의 U2(게임 읽기 창구)가 채운다: 게임이 켜져 있고 플러그인이 0.14.0 이상이고 게임 버전이 지원 표에 있을 때,
 * 세이브의 내 팀 선수 번호와 팀 번호로 게임의 지금 전술을 읽어 쓰는 카탈로그의 전술 초안으로 바꾼다(저장하지 않는다).
 * 지금은 게임에 아무것도 묻지 않고 "준비되지 않았습니다"를 돌려준다.
 */

export async function importTactic(_deps: Phase2Deps, _options?: { readRoleLists?: boolean }): Promise<TacticImportResult> {
  return tacticImportFailed(NOT_READY)
}
