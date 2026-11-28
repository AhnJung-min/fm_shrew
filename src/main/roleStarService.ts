import { NOT_READY, roleStarFailed, type RoleStarReport } from '@shared/tacticApi'
import type { Phase2Deps } from './tacticIpc'

/**
 * 게임 역할 별점과 앱 적합도의 대조(빈 틀). 2단계의 U8이 채운다: 게임이 켜져 있고 플러그인이 0.14.0 이상이고 게임 버전이 지원 표에 있을 때,
 * 내 1군을 5명씩 게임에서 별점을 읽어 역할마다 순위 상관을 낸다(점수에는 넣지 않는다). 지금은 게임에 아무것도 묻지 않고 "준비되지 않았습니다"를 돌려준다.
 */

export async function checkRoleStars(_deps: Phase2Deps): Promise<RoleStarReport> {
  return roleStarFailed(NOT_READY)
}
