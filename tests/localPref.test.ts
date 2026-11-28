import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPref, writePref } from '../src/renderer/src/lib/localPref'

/** 시험용 저장소(브라우저의 localStorage 대신) */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, String(value))
  }
}

/** 열 때마다 던지는 저장소(개인 창이나 사이트 데이터 차단) */
function brokenStorage(): Storage {
  const fail = (): never => {
    throw new DOMException('막혀 있음', 'SecurityError')
  }
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail }
}

const parseBool = (raw: string): boolean | undefined => (raw === 'true' ? true : raw === 'false' ? false : undefined)

describe('localPref: 이 PC에 기억하는 작은 취향', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('쓴 값을 읽는다', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    expect(readPref('fmb.sidebar.collapsed', parseBool, false)).toBe(false)
    writePref('fmb.sidebar.collapsed', 'true')
    expect(readPref('fmb.sidebar.collapsed', parseBool, false)).toBe(true)
  })

  it('null을 쓰면 지워서 기본값으로 돌아간다', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'fmb.sidebar.collapsed': 'true' }))
    writePref('fmb.sidebar.collapsed', null)
    expect(readPref('fmb.sidebar.collapsed', parseBool, false)).toBe(false)
  })

  it('기억해 둔 값을 알아보지 못하면(parse가 undefined) 기본값이다', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'fmb.sidebar.collapsed': '엉뚱한 글' }))
    expect(readPref('fmb.sidebar.collapsed', parseBool, true)).toBe(true)
  })

  it('parse가 던져도 기본값이다', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'fmb.squad.positionView': '{깨진' }))
    expect(readPref('fmb.squad.positionView', (raw) => JSON.parse(raw) as string, 'all')).toBe('all')
  })

  it('저장소가 막혀 있어도 읽기와 쓰기가 던지지 않고 기본값을 돌려준다', () => {
    vi.stubGlobal('localStorage', brokenStorage())
    expect(readPref('fmb.sidebar.collapsed', parseBool, true)).toBe(true)
    expect(() => writePref('fmb.sidebar.collapsed', 'true')).not.toThrow()
    expect(() => writePref('fmb.sidebar.collapsed', null)).not.toThrow()
  })

  it('저장소가 아예 없어도(화면 밖에서 불러도) 기본값이다', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readPref('fmb.sidebar.collapsed', parseBool, true)).toBe(true)
    expect(() => writePref('fmb.sidebar.collapsed', 'true')).not.toThrow()
  })
})
