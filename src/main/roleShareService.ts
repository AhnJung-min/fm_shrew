import { randomUUID } from 'node:crypto'
import { closeSync, openSync, readSync, statSync, writeFileSync } from 'node:fs'
import { activeCatalog } from '@shared/catalogs'
import { ROLE_BUNDLE_MAX_BYTES } from '@shared/limits'
import type { CustomRole } from '@shared/roleCatalog'
import { bundleToText, exportBundle, parseBundle, previewImport, type RoleBundle } from '@shared/roleShare'
import { NOT_READY, roleBundlePreviewFailed, simpleFailed, type RoleBundlePreview, type SimpleResult } from '@shared/tacticApi'
import type { Phase2Deps } from './tacticIpc'

/**
 * 역할 가중치 묶음 내보내기·가져오기(A-45, 백업 용도). 저장·열기 대화상자는 본체가 연다(deps.pickSavePath, deps.pickOpenPath):
 * 파일 경로는 화면이 정하지도 받지도 않는다(N-03). 가져오기는 파일을 읽기 전에 크기를 보고, 미리 보기에서 표(token)를 주고,
 * 사용자가 합치기나 바꾸기를 고른 뒤(apply)에만 설정에 쓴다. 쓰는 것은 roleWeights뿐이다.
 *
 * 사용자 역할 저장(saveCustomRoles)은 아직 만들지 않았다(사용자 역할 만들기는 뒤로 미룬 기능). 지금은 아무것도 쓰지 않고 "준비되지 않았습니다"를 돌려준다.
 */

/** 저장 대화상자의 처음 파일 이름 */
const DEFAULT_FILE = 'fmb-role-weights.json'

/** 미리 보기로 읽어 둔 묶음. 서비스(deps)마다 하나이고, 새 파일을 고르면 앞의 것은 버린다 */
const pending = new WeakMap<Phase2Deps, { token: string; bundle: RoleBundle }>()

export async function saveCustomRoles(_deps: Phase2Deps, _roles: CustomRole[]): Promise<SimpleResult> {
  return simpleFailed(NOT_READY)
}

export async function exportRoleBundle(deps: Phase2Deps): Promise<SimpleResult> {
  const settings = deps.settings.get()
  const bundle = exportBundle(settings, activeCatalog(settings))
  const text = bundleToText(bundle)
  // 내보낸 파일을 이 앱이 다시 읽을 수 있어야 한다. 손으로 고친 설정에 0~5 정수가 아닌 값이 있으면 파일을 만들기 전에 막는다
  const check = parseBundle(text)
  if (!check.ok) return simpleFailed(`가중치를 파일로 내보낼 수 없습니다. ${check.reason} 역할 가중치 화면에서 고친 뒤 다시 해 주세요.`)
  const path = await deps.pickSavePath(DEFAULT_FILE)
  if (path === null) return simpleFailed('내보내기를 취소했습니다.')
  try {
    writeFileSync(path, text, 'utf8')
  } catch (error) {
    console.error('[roles:export]', error)
    return simpleFailed('파일을 저장하지 못했습니다. 다른 위치를 골라 다시 해 주세요.')
  }
  return { ok: true, message: `역할 ${Object.keys(bundle.weights).length}개의 가중치를 파일로 저장했습니다.` }
}

/** 고른 파일을 읽는다. 크기를 먼저 보고, 읽을 때도 한도 하나 더까지만 읽어 한도를 넘는 파일을 통째로 올리지 않는다 */
function readBundleFile(path: string): { ok: true; text: string } | { ok: false; message: string } {
  const tooBig = `파일이 너무 큽니다(${ROLE_BUNDLE_MAX_BYTES / 1024}KB까지 가져올 수 있습니다).`
  let fd: number | null = null
  try {
    const info = statSync(path)
    if (!info.isFile()) return { ok: false, message: '고른 것이 파일이 아닙니다.' }
    if (info.size > ROLE_BUNDLE_MAX_BYTES) return { ok: false, message: tooBig }
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(ROLE_BUNDLE_MAX_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const got = readSync(fd, buffer, length, buffer.length - length, length)
      if (got === 0) break
      length += got
    }
    if (length > ROLE_BUNDLE_MAX_BYTES) return { ok: false, message: tooBig }
    return { ok: true, text: buffer.toString('utf8', 0, length) }
  } catch (error) {
    console.error('[roles:preview]', error)
    return { ok: false, message: '파일을 읽지 못했습니다. 파일이 지워지지 않았는지, 다른 프로그램이 열고 있지 않은지 확인해 주세요.' }
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

export async function previewRoleBundle(deps: Phase2Deps): Promise<RoleBundlePreview> {
  const path = await deps.pickOpenPath()
  if (path === null) return roleBundlePreviewFailed('가져올 파일을 고르지 않았습니다.')
  // 새 파일을 골랐으면 앞에 읽어 둔 묶음은 더 쓰지 않는다
  pending.delete(deps)
  const read = readBundleFile(path)
  if (!read.ok) return roleBundlePreviewFailed(read.message)
  const parsed = parseBundle(read.text)
  if (!parsed.ok) return roleBundlePreviewFailed(`가져올 수 없는 파일입니다. ${parsed.reason}`)
  const settings = deps.settings.get()
  // 합치기와 바꾸기는 묶음에 없는 역할에서만 다르고, 그 차이는 경고 글이 알린다. 바뀔 역할 목록은 두 방식이 같다
  const { changes, warnings } = previewImport(parsed.bundle, settings, activeCatalog(settings), 'merge')
  const token = randomUUID()
  pending.set(deps, { token, bundle: parsed.bundle })
  return {
    ok: true,
    message: changes.length > 0 ? `역할 ${changes.length}개의 가중치가 바뀝니다. 아래를 확인한 뒤 합치기나 바꾸기를 골라 주세요.` : '이 파일로 바뀌는 가중치가 없습니다.',
    token,
    changes,
    warnings
  }
}

export async function applyRoleBundle(deps: Phase2Deps, token: string, mode: 'merge' | 'replace'): Promise<SimpleResult> {
  const held = pending.get(deps)
  if (!held || token.length === 0 || held.token !== token) return simpleFailed('가져올 파일을 다시 골라 주세요.')
  // 미리 보고 난 사이에 설정이 바뀌었을 수 있어서, 지금 설정에 다시 맞춰 적용한다
  const settings = deps.settings.get()
  const { patch, changes } = previewImport(held.bundle, settings, activeCatalog(settings), mode === 'replace' ? 'replace' : 'merge')
  const next = deps.settings.set(patch)
  pending.delete(deps)
  return {
    ok: true,
    message: changes.length > 0 ? `역할 ${changes.length}개의 가중치를 ${mode === 'replace' ? '바꾸었' : '합쳤'}습니다.` : '바뀐 가중치가 없습니다.',
    settings: next
  }
}
