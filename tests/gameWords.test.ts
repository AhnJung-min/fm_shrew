/**
 * 화면에 나오는 국면 이름은 게임 한국어판의 낱말 "공 소유 시"와 "공 미소유 시"다(리드 결정 2026-11-28 저녁. 게임의 역할 이름 "골키퍼(공 소유 시)"로 확인).
 * 옛 이름("점유 시", "비점유 시")은 코드 안 설명(주석)에만 남을 수 있다. 이 시험은 src의 코드(주석이 아닌 글)에 옛 이름이 되돌아오는 것을 막는다:
 * 낱말을 바꾸기 전에 갈라진 단위가 합쳐질 때 옛 글이 되돌아와도 글자를 보는 다른 시험이 없으면 놓치기 때문이다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', 'src')
/** 옛 낱말. "비점유 시"도 이 글자를 품고 있어 하나로 잡힌다 */
const OLD_WORD = '점유 시'

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

/** 코드 줄의 코드 부분. 주석 줄(맨 앞이 //, *, /*)은 비우고, 코드 줄 끝의 // 주석과 한 줄짜리 블록 주석은 지운다 */
function codeOf(line: string): string {
  const head = line.trimStart()
  if (head.startsWith('//') || head.startsWith('*') || head.startsWith('/*')) return ''
  return line.replace(/\/\*.*?\*\//g, '').replace(/(^|\s)\/\/.*$/, '$1')
}

/** 코드(주석이 아닌 글)에 옛 낱말이 있는 줄을 `파일:줄 번호 글`로 적는다 */
function oldWordLines(file: string, text: string): string[] {
  return text.split('\n').flatMap((line, index) => (codeOf(line).includes(OLD_WORD) ? [`${file}:${index + 1} ${line.trim()}`] : []))
}

const sources = filesUnder(SRC)
  .filter((path) => /\.tsx?$/.test(path))
  .map((path) => ({ file: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }))

describe('화면 글의 국면 이름은 게임 낱말이다', () => {
  it('src의 코드에 "점유 시"와 "비점유 시"가 없다(주석은 괜찮다). 있다면 "공 소유 시"와 "공 미소유 시"로 바꾼다', () => {
    expect(sources.flatMap((source) => oldWordLines(source.file, source.text))).toEqual([])
  })

  it('검사가 실제로 잡는다: 글, 템플릿 글, 화면 글에 둔 옛 낱말은 걸리고 주석에 둔 것은 걸리지 않는다', () => {
    const sample = [
      "const a = '점유 시 비중'",
      'return `비점유 시 ${x}`',
      '<p>점유 시</p>',
      '// 점유 시는 옛 이름',
      ' * 비점유 시 역할',
      '/** 점유 시 */',
      'const b = 1 // 점유 시',
      'const c = 2 /* 비점유 시 */',
      "const d = '공 소유 시'"
    ].join('\n')
    expect(oldWordLines('sample.ts', sample)).toEqual(["sample.ts:1 const a = '점유 시 비중'", 'sample.ts:2 return `비점유 시 ${x}`', 'sample.ts:3 <p>점유 시</p>'])
  })

  it('검사가 src의 .ts와 .tsx를 모두 훑는다(하위 폴더 포함)', () => {
    const files = sources.map((source) => source.file)
    expect(files).toEqual(expect.arrayContaining(['shared/tacticModel.ts', 'main/worldService.ts', 'renderer/src/lib/mockWorld.ts']))
    expect(files.some((file) => file.endsWith('.tsx'))).toBe(true)
    expect(files.length).toBeGreaterThan(100)
  })
})
