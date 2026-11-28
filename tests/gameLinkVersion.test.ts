/**
 * 세이브 목록의 게임 판 표시와 적용 전 확인(N-02): 앱이 확인하지 않은 게임 판의 세이브는 적용하기 전에 묻는다.
 * 목록은 파일마다 판을 엿봐 싣고(같은 파일은 다시 읽지 않는다), 적용은 확인한 판이 아니면 needsConfirm으로 돌려준다.
 * 앱을 켤 때의 자동 적용은 선택값 없이 부르므로 그런 세이브를 저절로 건너뛰고, 까닭을 상태의 note에 싣는다.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NO_DATA, type DataStatus } from '../src/shared/game'
import { saveWithVersion } from './helpers/saveBundle'

// 엿보는 함수를 그대로 부르면서 몇 번 불렸는지 센다
vi.mock('../src/main/save/peek', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/save/peek')>()
  return { peekSaveVersion: vi.fn(actual.peekSaveVersion) }
})

const { GameLink } = await import('../src/main/gameLink')
const { peekSaveVersion } = await import('../src/main/save/peek')

let dir: string
const at = (name: string): string => join(dir, name)

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fmb-link-'))
  writeFileSync(at('가-확인한판.fm'), saveWithVersion('26.3.2+2329565'))
  writeFileSync(at('나-새판.fm'), saveWithVersion('26.4.0+1000'))
  writeFileSync(at('다-판없음.fm'), saveWithVersion(null))
  writeFileSync(at('라-깨짐.fm'), Buffer.from('세이브가 아닌 파일입니다. 충분히 긴 내용을 채웁니다. '.repeat(5)))
  writeFileSync(at('메모.txt'), 'x')
  writeFileSync(at('last save overwrite backup.fm'), saveWithVersion('26.3.2+1'))
  // 저장 시각 순서를 정해 둔다(가 가장 최근)
  const base = Date.now() / 1000
  utimesSync(at('가-확인한판.fm'), base, base)
  utimesSync(at('나-새판.fm'), base - 10, base - 10)
  utimesSync(at('다-판없음.fm'), base - 20, base - 20)
  utimesSync(at('라-깨짐.fm'), base - 30, base - 30)
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 적용에 쓰는 세계의 가짜: 적용한 경로를 기록한다 */
function fakeWorld(applied: string[], data: DataStatus = NO_DATA): never {
  return {
    path: null,
    status: () => data,
    extras: () => ({ check: { ok: true, problems: [] }, teamNote: '' }),
    apply: (path: string) => {
      applied.push(path)
      return { teamId: 1, count: 1234 }
    },
    blocked: () => null
  } as never
}

const newLink = (applied: string[], data?: DataStatus): InstanceType<typeof GameLink> => new GameLink(fakeWorld(applied, data), () => dir, () => undefined)

describe('세이브 목록의 게임 판 표시', () => {
  it('세이브마다 저장한 게임의 판과 확인한 판인지를 싣는다(읽지 못한 것은 판을 싣지 않고 확인 못 함)', () => {
    const saves = newLink([]).saves()
    expect(saves.map((save) => save.name)).toEqual(['가-확인한판.fm', '나-새판.fm', '다-판없음.fm', '라-깨짐.fm'])
    const byName = Object.fromEntries(saves.map((save) => [save.name, save]))
    expect(byName['가-확인한판.fm']).toMatchObject({ gameVersion: '26.3.2', versionStatus: 'ok' })
    expect(byName['나-새판.fm']).toMatchObject({ gameVersion: '26.4.0', versionStatus: 'unsupported' })
    expect(byName['다-판없음.fm']).toMatchObject({ versionStatus: 'unknown' })
    expect(byName['라-깨짐.fm']).toMatchObject({ versionStatus: 'unknown' })
    expect(byName['다-판없음.fm']).not.toHaveProperty('gameVersion')
    expect(byName['라-깨짐.fm']).not.toHaveProperty('gameVersion')
    // 기존 칸은 그대로다
    expect(byName['가-확인한판.fm'].path).toBe(at('가-확인한판.fm'))
    expect(byName['가-확인한판.fm'].bytes).toBeGreaterThan(0)
    expect(typeof byName['가-확인한판.fm'].savedAt).toBe('string')
  })

  it('같은 파일(경로, 저장 시각, 크기가 같음)은 다시 읽지 않고, 파일이 바뀌면 다시 읽는다', () => {
    const link = newLink([])
    const peek = vi.mocked(peekSaveVersion)
    link.saves()
    const afterFirst = peek.mock.calls.length
    expect(afterFirst).toBeGreaterThanOrEqual(4)
    link.saves()
    link.saves()
    expect(peek.mock.calls.length).toBe(afterFirst)
    // 게임이 다시 저장해 파일이 바뀐 것처럼 고친다
    const path = at('가-확인한판.fm')
    writeFileSync(path, saveWithVersion('26.9.9+7'))
    const later = Date.now() / 1000 + 100
    utimesSync(path, later, later)
    const changed = link.saves().find((save) => save.name === '가-확인한판.fm')
    expect(peek.mock.calls.length).toBe(afterFirst + 1)
    expect(changed).toMatchObject({ gameVersion: '26.9.9', versionStatus: 'unsupported' })
    // 다른 시험을 위해 되돌린다
    writeFileSync(path, saveWithVersion('26.3.2+2329565'))
    utimesSync(path, later + 1, later + 1)
  })
})

describe('적용 전 확인', () => {
  it('확인한 판의 세이브는 바로 적용한다', async () => {
    const applied: string[] = []
    const result = await newLink(applied).apply(at('가-확인한판.fm'))
    expect(result.ok).toBe(true)
    expect(result.needsConfirm).toBeUndefined()
    expect(applied).toEqual([at('가-확인한판.fm')])
  })

  it('확인하지 않은 판의 세이브는 적용하지 않고 확인을 요구한다(선택값을 주지 않은 호출, 곧 앱을 켤 때의 자동 적용도 같다)', async () => {
    const applied: string[] = []
    const link = newLink(applied)
    const result = await link.apply(at('나-새판.fm'))
    expect(result.ok).toBe(false)
    expect(result.needsConfirm).toBe(true)
    expect(result.message).toContain('26.4.0')
    expect(result.message).toContain('26.3.2')
    expect(result.message).toContain('확인')
    expect(applied).toEqual([])
    // 선택값을 거짓으로 줘도 같다
    expect((await link.apply(at('나-새판.fm'), { allowUnknownVersion: false })).needsConfirm).toBe(true)
    expect(applied).toEqual([])
  })

  it('판을 읽지 못한 세이브도 확인을 요구한다(확인 못 함)', async () => {
    const applied: string[] = []
    for (const name of ['다-판없음.fm', '라-깨짐.fm']) {
      const result = await newLink(applied).apply(at(name))
      expect(result.needsConfirm, name).toBe(true)
      expect(result.message, name).toContain('확인 못 함')
    }
    expect(applied).toEqual([])
  })

  it('사용자가 확인한 뒤(allowUnknownVersion)에는 적용한다', async () => {
    const applied: string[] = []
    const result = await newLink(applied).apply(at('나-새판.fm'), { allowUnknownVersion: true })
    expect(result.ok).toBe(true)
    expect(result.needsConfirm).toBeUndefined()
    expect(applied).toEqual([at('나-새판.fm')])
  })

  it('없는 파일이나 세이브가 아닌 이름은 확인을 요구하지 않고 찾지 못했다고 알린다', async () => {
    const applied: string[] = []
    for (const path of [at('없는.fm'), at('메모.txt'), at('last save overwrite backup.fm')]) {
      const result = await newLink(applied).apply(path, { allowUnknownVersion: true })
      expect(result, path).toMatchObject({ ok: false, message: '세이브 파일을 찾지 못했습니다.' })
      expect(result.needsConfirm).toBeUndefined()
    }
    expect(applied).toEqual([])
  })

  it('적용한 세이브가 없는 동안에는 건너뛴 까닭이 상태의 note에 실리고, 적용에 성공하면 사라진다', async () => {
    const link = newLink([])
    expect(link.status().data.note).toBe('')
    const refused = await link.apply(at('나-새판.fm'))
    expect(link.status().data.note).toBe(refused.message)
    expect(link.status().data.save).toBeNull()
    // 확인한 판을 적용하면 까닭이 사라진다
    await link.apply(at('가-확인한판.fm'))
    expect(link.status().data.note).toBe('')
  })

  it('이미 다른 세이브를 적용해 둔 동안에는 상태의 note를 덮어쓰지 않는다(적용 결과로만 알린다)', async () => {
    const applied: DataStatus = { ...NO_DATA, save: { path: at('가-확인한판.fm'), name: '가-확인한판.fm', savedAt: '2026-11-28T00:00:00.000Z', bytes: 1 }, note: '게임의 값을 쓰지 못했습니다' }
    const link = newLink([], applied)
    const refused = await link.apply(at('나-새판.fm'))
    expect(refused.needsConfirm).toBe(true)
    expect(link.status().data.note).toBe('게임의 값을 쓰지 못했습니다')
  })
})
