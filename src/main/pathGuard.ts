import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'

/**
 * 화면(렌더러)이 보내는 이름과 경로를 앱 본체에서 한 번 더 검사한다(N-03).
 * 화면이 이미 믿을 만해도, 폴더 밖 파일을 지우거나 열게 만드는 요청은 여기서 막는다.
 */

/**
 * 백업 사본 이름으로 쓸 수 있는 글자인가. 폴더 이름이나 경로가 섞이면 안 된다.
 * 경로 구분자(/ \), 드라이브 표시와 스트림 표시(:), 널 글자, 절대 경로, ".." 칸을 모두 거절한다.
 * 이름의 모양(<세이브 이름>__<시각>.fm)은 backup.ts의 parseBackupName이 따로 본다.
 */
export function isPlainFileName(name: unknown): name is string {
  if (typeof name !== 'string' || name === '' || name.length > 255) return false
  if (/[\\/:\0]/.test(name)) return false
  if (isAbsolute(name)) return false
  return name !== '.' && name !== '..'
}

/** child가 root와 같거나 그 안쪽인가(둘 다 실제 경로로 푼 값이어야 한다. Windows에서는 대소문자를 가리지 않는다) */
function inside(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (!isAbsolute(rel) && rel.split(sep)[0] !== '..')
}

/**
 * "폴더 열기"로 열어도 되는 폴더인가. 열어도 되면 그 실제 경로를, 아니면 null을 준다.
 * - 글자이고, 널 글자와 ".." 칸이 없어야 한다.
 * - 실제로 있는 폴더여야 한다(파일을 열면 그 프로그램이 실행되므로 파일은 거절한다).
 * - 바로가기(심볼릭 링크, 정션)를 풀어 낸 실제 경로가 roots(백업 폴더, 세이브 폴더 등) 가운데 하나이거나 그 안쪽이어야 한다.
 */
export function openableFolder(path: unknown, roots: ReadonlyArray<string>): string | null {
  if (typeof path !== 'string' || path === '' || path.length > 1024 || path.includes('\0')) return null
  if (path.split(/[\\/]/).includes('..')) return null
  if (!isAbsolute(path)) return null
  try {
    if (!existsSync(path) || !statSync(path).isDirectory()) return null
    const real = realpathSync(path)
    for (const root of roots) {
      if (!root || !existsSync(root)) continue
      if (inside(realpathSync(root), real)) return real
    }
  } catch {
    // 읽을 수 없는 경로는 거절한다
  }
  return null
}
