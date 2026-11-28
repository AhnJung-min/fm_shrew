import { NOT_READY, roleBundlePreviewFailed, roleStarFailed, simpleFailed } from '@shared/tacticApi'
import type { Api, Settings } from '@shared/types'

/**
 * 미리보기의 사용자 역할, 가중치 묶음, 별점 대조 목업(빈 틀). 2단계의 U8이 채운다: 사용자 역할은 설정 상태에 쓰고,
 * 묶음과 별점 표는 지어낸 값으로 보여 준다. 지금은 "준비되지 않았습니다"를 돌려준다(던지지 않는다).
 */
export function mockRoleToolsApi(
  _state: { getSettings(): Settings; setSettings(next: Settings): void }
): Pick<Api, 'customRolesSave' | 'roleBundleExport' | 'roleBundlePreview' | 'roleBundleApply' | 'roleStarCheck'> {
  return {
    customRolesSave: async () => simpleFailed(NOT_READY),
    roleBundleExport: async () => simpleFailed(NOT_READY),
    roleBundlePreview: async () => roleBundlePreviewFailed(NOT_READY),
    roleBundleApply: async () => simpleFailed(NOT_READY),
    roleStarCheck: async () => roleStarFailed(NOT_READY)
  }
}
