import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPreview, sceneParam } from '../src/renderer/src/lib/preview'

/** 시험용 창: 주소의 ?뒷부분(search)만 있으면 된다. api가 있으면 앱이다 */
const page = (search: string, app = false): void => {
  vi.stubGlobal('window', app ? { api: {}, location: { search } } : { location: { search } })
}

describe('preview: 미리보기의 장면 열쇠', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('주소의 열쇠 값을 읽는다: ?open=123#targets에서 open은 123', () => {
    page('?open=123')
    expect(isPreview()).toBe(true)
    expect(sceneParam('open')).toBe('123')
  })

  it('값이 없는 열쇠는 빈 글자, 없는 열쇠는 null', () => {
    page('?off&seen&theme=black')
    expect(sceneParam('seen')).toBe('')
    expect(sceneParam('off')).toBe('')
    expect(sceneParam('theme')).toBe('black')
    expect(sceneParam('tick')).toBeNull()
  })

  it('여러 열쇠를 함께 읽는다', () => {
    page('?scale=1.25&density=comfortable&tick=5')
    expect([sceneParam('scale'), sceneParam('density'), sceneParam('tick')]).toEqual(['1.25', 'comfortable', '5'])
  })

  it('앱(preload가 window.api를 넣은 때)에서는 열쇠가 있어도 늘 null이다', () => {
    page('?open=123&seen', true)
    expect(isPreview()).toBe(false)
    expect(sceneParam('open')).toBeNull()
    expect(sceneParam('seen')).toBeNull()
  })

  it('화면이 없는 곳(시험, 본체)에서는 미리보기가 아니고 null이다', () => {
    expect(isPreview()).toBe(false)
    expect(sceneParam('open')).toBeNull()
  })
})
