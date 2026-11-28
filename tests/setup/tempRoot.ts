/**
 * 시험이 쓰는 임시 폴더를 한 번의 실행마다 하나로 모으고, 끝나면 통째로 지운다.
 * 시험들은 os.tmpdir() 밑에 mkdtemp로 폴더를 만들고 대부분 지우지 않아, 실행할 때마다 사용자 PC의 임시 폴더에 스무 개 남짓 쌓였다.
 * 이 전역 준비는 일꾼을 띄우기 전에 돈다. 여기서 TEMP·TMP(Windows)와 TMPDIR(그 밖)을 이 실행의 폴더로 바꾸면 일꾼이 그 값을 물려받는다.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const KEYS = ['TEMP', 'TMP', 'TMPDIR'] as const

export default function setup(): () => void {
  const before = new Map(KEYS.map((key) => [key, process.env[key]]))
  const root = mkdtempSync(join(tmpdir(), 'fmb-vitest-'))
  for (const key of KEYS) process.env[key] = root
  return () => {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // 다른 프로그램이 파일을 잡고 있으면 남긴다(운영 체제의 임시 폴더 정리가 지운다)
    }
  }
}
