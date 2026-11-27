import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { isPlainFileName, openableFolder } from '../src/main/pathGuard'

let root: string
let saves: string
let backups: string
let data: string
let outside: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'fmb-guard-'))
  saves = join(root, 'games')
  data = join(root, 'appdata')
  backups = join(data, 'backups')
  outside = join(root, 'outside')
  for (const dir of [saves, join(saves, 'sub'), data, backups, outside]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(saves, 'a.fm'), 'x')
  writeFileSync(join(data, 'claude-key.bin'), 'secret')
})

describe('N-03: 이름 검사', () => {
  it('경로 구분자, 드라이브·스트림 표시, 절대 경로, ".."는 파일 이름이 아니다', () => {
    for (const bad of ['', '.', '..', 'a/b.fm', 'a\\b.fm', '../a.fm', '..\\a.fm', '/a.fm', 'C:\\a.fm', 'C:a.fm', 'a.fm:stream', 'a\0.fm', 'x'.repeat(256)]) {
      expect(isPlainFileName(bad), JSON.stringify(bad)).toBe(false)
    }
    for (const bad of [undefined, null, 5, {}, ['a.fm']]) expect(isPlainFileName(bad)).toBe(false)
    expect(isPlainFileName('내 세이브__20261101-120000.fm')).toBe(true)
    // 이름 속의 점은 경로가 아니다
    expect(isPlainFileName('a..b.fm')).toBe(true)
  })
})

describe('N-03: 폴더 열기 경로 검사', () => {
  const roots = (): string[] => [saves, backups, data]

  it('세이브 폴더, 백업 폴더, 앱 데이터 폴더와 그 안의 폴더는 연다', () => {
    expect(openableFolder(saves, roots())).not.toBeNull()
    expect(openableFolder(backups, roots())).not.toBeNull()
    expect(openableFolder(data, roots())).not.toBeNull()
    expect(openableFolder(join(saves, 'sub'), roots())).not.toBeNull()
  })

  it('폴더 밖과 그 밖의 경로는 거절한다', () => {
    expect(openableFolder(outside, roots())).toBeNull()
    expect(openableFolder(root, roots())).toBeNull()
    expect(openableFolder(tmpdir(), roots())).toBeNull()
    expect(openableFolder('C:\\Windows', roots())).toBeNull()
    expect(openableFolder('C:\\', roots())).toBeNull()
  })

  it('".." 칸이 든 경로, 상대 경로, 글자가 아닌 값, 널 글자는 거절한다', () => {
    expect(openableFolder(join(saves, 'sub', '..', '..', 'outside'), roots())).toBeNull()
    expect(openableFolder(`${saves}\\..\\outside`, roots())).toBeNull()
    expect(openableFolder(`${saves}/../outside`, roots())).toBeNull()
    // 안쪽으로만 가는 ".."도 받지 않는다(화면이 만들어 주는 경로에는 없다)
    expect(openableFolder(`${saves}\\sub\\..`, roots())).toBeNull()
    expect(openableFolder('games', roots())).toBeNull()
    expect(openableFolder('.', roots())).toBeNull()
    for (const bad of [undefined, null, 7, {}, [saves], '']) expect(openableFolder(bad, roots())).toBeNull()
    expect(openableFolder(`${saves}\0`, roots())).toBeNull()
  })

  it('파일은 거절한다(열면 그 프로그램이 실행된다). 없는 경로도 거절한다', () => {
    expect(openableFolder(join(saves, 'a.fm'), roots())).toBeNull()
    expect(openableFolder(join(data, 'claude-key.bin'), roots())).toBeNull()
    expect(openableFolder(join(saves, 'missing'), roots())).toBeNull()
  })

  it('비슷한 이름의 옆 폴더는 안쪽으로 치지 않는다', () => {
    const sibling = join(root, 'games-evil')
    mkdirSync(sibling)
    expect(openableFolder(sibling, roots())).toBeNull()
  })

  it('바로가기로 폴더 밖을 가리키면 풀어 본 실제 경로로 판단한다', () => {
    const link = join(saves, 'link-out')
    try {
      symlinkSync(outside, link, 'junction')
    } catch {
      return // 이 PC에서 바로가기를 만들 수 없으면 건너뛴다
    }
    expect(openableFolder(link, roots())).toBeNull()
  })

  it('세이브 폴더를 아직 정하지 않았거나 없으면 그 폴더는 허용 목록에서 빠진다', () => {
    expect(openableFolder(saves, ['', join(root, 'nope')])).toBeNull()
    expect(openableFolder(saves, ['', join(root, 'nope'), saves])).not.toBeNull()
  })
})
