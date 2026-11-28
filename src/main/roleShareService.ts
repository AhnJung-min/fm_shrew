import { NOT_READY, roleBundlePreviewFailed, simpleFailed, type RoleBundlePreview, type SimpleResult } from '@shared/tacticApi'
import type { CustomRole } from '@shared/roleCatalog'
import type { Phase2Deps } from './tacticIpc'

/**
 * 사용자 역할 저장과 역할 가중치 묶음 내보내기·가져오기(빈 틀). 2단계의 U8이 채운다: 사용자 역할은 검사한 뒤 설정에 쓰고,
 * 묶음 파일의 저장·열기 대화상자는 본체가 연다(deps.pickSavePath, deps.pickOpenPath. 파일 경로는 화면이 주지 않는다). 읽기 전에 크기를 보고,
 * 미리 보기에 표(token)를 주고, 확인한 뒤에만 적용한다. 지금은 아무것도 쓰거나 열지 않고 "준비되지 않았습니다"를 돌려준다.
 */

export async function saveCustomRoles(_deps: Phase2Deps, _roles: CustomRole[]): Promise<SimpleResult> {
  return simpleFailed(NOT_READY)
}

export async function exportRoleBundle(_deps: Phase2Deps): Promise<SimpleResult> {
  return simpleFailed(NOT_READY)
}

export async function previewRoleBundle(_deps: Phase2Deps): Promise<RoleBundlePreview> {
  return roleBundlePreviewFailed(NOT_READY)
}

export async function applyRoleBundle(_deps: Phase2Deps, _token: string, _mode: 'merge' | 'replace'): Promise<SimpleResult> {
  return simpleFailed(NOT_READY)
}
