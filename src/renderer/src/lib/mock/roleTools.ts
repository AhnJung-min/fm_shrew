import { activeCatalog } from '@shared/catalogs'
import { bundleAppliedMessage, bundlePreviewMessage, exportBundle, previewImport, type RoleBundle } from '@shared/roleShare'
import { NOT_READY, roleStarFailed, simpleFailed } from '@shared/tacticApi'
import type { Api, Settings } from '@shared/types'

/**
 * 미리보기(`npm run web`)의 역할 가중치 묶음 목업. 가중치 묶음의 내보내기·가져오기는 본체와 같은 진짜 계산(shared/roleShare.ts)을 돌린다:
 * 미리보기에는 파일 대화상자가 없어서 내보낸 묶음은 파일로 쓰지 않고 이 화면에 기억해 두고, 가져오기는 기억해 둔 묶음(없으면 지어낸 묶음)을 읽은 것처럼 보여 준다.
 * 사용자 역할 만들기와 게임 별점 대조는 아직 만들지 않은 기능이라 "준비되지 않았습니다"를 돌려준다(던지지 않는다).
 */

/** 지어낸 묶음: 지금 설정의 묶음에서 역할 셋의 가중치를 바꾸고, 게임 판을 달리하고, 이 앱에 없는 역할 하나를 더한 것(미리 보기의 바뀜·경고 목록이 보이게) */
function sampleBundle(settings: Settings): RoleBundle {
  const catalog = activeCatalog(settings)
  const bundle = exportBundle(settings, catalog)
  const weights = { ...bundle.weights }
  for (const role of catalog.roles.filter((each) => each.selectable).filter((_, at) => at % 12 === 3)) {
    const table = weights[role.id] ?? {}
    const first = Object.keys(table)[0]
    weights[role.id] = { ...table, ...(first ? { [first]: Math.min(5, (table[first] ?? 0) + 1) } : {}), composure: 3 }
  }
  weights['ip.PreviewOnlyRole'] = { finishing: 4 }
  return { ...bundle, catalogVersion: catalog.dataVersion === 'app' ? 'app' : '26.2.5', weights }
}

export function mockRoleToolsApi(
  state: { getSettings(): Settings; setSettings(next: Settings): void }
): Pick<Api, 'customRolesSave' | 'roleBundleExport' | 'roleBundlePreview' | 'roleBundleApply' | 'roleStarCheck'> {
  /** 마지막으로 내보낸 묶음(파일 대신 기억해 둔다) */
  let kept: RoleBundle | null = null
  /** 가져오기 미리 보기로 읽은 묶음과 그 표 */
  let pending: { token: string; bundle: RoleBundle } | null = null
  let count = 0
  return {
    customRolesSave: async () => simpleFailed(NOT_READY),
    roleStarCheck: async () => roleStarFailed(NOT_READY),

    roleBundleExport: async () => {
      const settings = state.getSettings()
      kept = exportBundle(settings, activeCatalog(settings))
      return { ok: true, message: `미리보기라 파일은 만들지 않고, 역할 ${Object.keys(kept.weights).length}개의 가중치를 이 화면에 기억해 두었습니다. 가져오기에서 불러 볼 수 있습니다.` }
    },

    roleBundlePreview: async () => {
      const settings = state.getSettings()
      const bundle = kept ?? sampleBundle(settings)
      const { changes, warnings } = previewImport(bundle, settings, activeCatalog(settings), 'merge')
      pending = { token: `preview-${++count}`, bundle }
      const source = kept ? '' : ' 미리보기라 지어낸 묶음입니다.'
      return { ok: true, message: `${bundlePreviewMessage(changes.length)}${source}`, token: pending.token, changes, warnings }
    },

    roleBundleApply: async (token, mode) => {
      if (!pending || pending.token !== token) return simpleFailed('가져올 파일을 다시 골라 주세요.')
      const settings = state.getSettings()
      const how = mode === 'replace' ? 'replace' : 'merge'
      const { patch, changes } = previewImport(pending.bundle, settings, activeCatalog(settings), how)
      const next: Settings = { ...settings, ...patch }
      state.setSettings(next)
      pending = null
      return { ok: true, message: bundleAppliedMessage(changes.length, how), settings: next }
    }
  }
}
