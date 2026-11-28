/**
 * CSS 파일 나누기의 짜임새(디자인 적용 1차, 계획 2.3절).
 * app.css, player.css, squad.css, targets.css는 @import 줄만 든 목록 파일이고, 목록의 순서가 원래 줄 순서다.
 * CSS는 뒤에 온 같은 힘의 규칙이 이기므로 순서가 곧 화면이다. 그래서 목록 파일에 규칙을 쓰지 않고, 순서를 이 시험이 지킨다.
 * (순서를 바꾸거나 파일을 더하려면 이 시험의 목록도 함께 고치고 리드에게 알린다.)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER = join(__dirname, '..', 'src', 'renderer', 'src')
const STYLES = join(RENDERER, 'styles')

/** 목록 파일과 그 안의 순서 */
const LISTS: Record<string, string[]> = {
  'app.css': [
    'tokens.css',
    'base.css',
    'shell.css',
    'controls.css',
    'table.css',
    'depth.css',
    'compare.css',
    'talk.css',
    'drawer.css',
    'settings.css',
    'narrow.css',
    'backups.css',
    'editor.css',
    'connect.css',
    'guide.css'
  ],
  'player.css': ['player-panel.css', 'player-parts.css', 'editor-card.css', 'face.css'],
  'squad.css': ['tactics-board.css', 'insights.css', 'tactics-panel.css'],
  'targets.css': ['targets-tools.css', 'reco.css']
}

const IMPORT_LINE = /^@import '\.\/([\w-]+\.css)';$/

const read = (file: string): string => readFileSync(join(STYLES, file), 'utf8')

/** 목록 파일에서 비지 않은 줄들 */
const linesOf = (file: string): string[] => read(file).split('\n').filter((line) => line.trim() !== '')

/** 목록 파일이 부르는 파일들(적은 순서대로) */
const importsOf = (file: string): string[] => linesOf(file).flatMap((line) => IMPORT_LINE.exec(line)?.[1] ?? [])

/** 폴더 밑의 모든 파일 */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

/** 화면 코드(.ts, .tsx)가 직접 부르는 CSS 파일 이름들(`'@/styles/이름.css'`, `'./styles/이름.css'`) */
function importedByCode(): Set<string> {
  const found = new Set<string>()
  for (const path of filesUnder(RENDERER).filter((each) => /\.tsx?$/.test(each))) {
    for (const match of readFileSync(path, 'utf8').matchAll(/import\s+['"](?:@\/|\.\/|\.\.\/)+styles\/([\w-]+\.css)['"]/g)) found.add(match[1])
  }
  return found
}

describe('목록 파일(app, player, squad, targets)', () => {
  for (const [list, parts] of Object.entries(LISTS)) {
    it(`${list}에는 @import 줄만 있다(규칙도 주석도 없다)`, () => {
      const lines = linesOf(list)
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.filter((line) => !IMPORT_LINE.test(line))).toEqual([])
    })

    it(`${list}가 가리키는 파일이 모두 있다`, () => {
      for (const part of importsOf(list)) expect(existsSync(join(STYLES, part)), `${list}가 부르는 ${part}가 없다`).toBe(true)
    })

    it(`${list}는 계획의 순서대로 ${parts.length}개를 부른다(순서가 곧 CSS 계단 순서다)`, () => {
      expect(importsOf(list)).toEqual(parts)
    })
  }

  it('한 파일을 두 번 부르지 않는다(한 목록 안에서도, 목록끼리도)', () => {
    const all = Object.keys(LISTS).flatMap(importsOf)
    expect(all.filter((part, index) => all.indexOf(part) !== index)).toEqual([])
  })

  it('목록 파일은 다른 목록 파일을 부르지 않는다', () => {
    const all = Object.keys(LISTS).flatMap(importsOf)
    for (const list of Object.keys(LISTS)) expect(all, list).not.toContain(list)
  })
})

describe('나눈 파일들', () => {
  const listed = new Set(Object.keys(LISTS).flatMap(importsOf))
  const files = readdirSync(STYLES).filter((name) => name.endsWith('.css'))

  it('나눈 파일은 규칙을 담고 @import를 담지 않는다(@import는 목록 파일에만 있다)', () => {
    for (const part of listed) {
      const text = read(part)
      expect(text.trim().length, part).toBeGreaterThan(0)
      expect(text, part).not.toContain('@import')
    }
  })

  it('목록에 오르지 못한 채 남은 파일이 없다: 모든 CSS 파일은 목록 파일이거나, 목록이 부르거나, 그것을 쓰는 코드가 직접 부른다', () => {
    const direct = importedByCode()
    const orphans = files.filter((name) => !(name in LISTS) && !listed.has(name) && !direct.has(name))
    expect(orphans, '어디에서도 불리지 않는 CSS 파일(목록에 더하거나, 그것을 쓰는 부품 TSX가 import한다)').toEqual([])
  })

  it('목록 파일 넷은 코드가 부르던 그대로 불린다(app.css는 main.tsx, 나머지는 그 화면 코드. 옛 import가 그대로 돈다)', () => {
    const direct = importedByCode()
    for (const list of Object.keys(LISTS)) expect(direct.has(list), `${list}를 부르는 코드가 없다`).toBe(true)
  })
})
