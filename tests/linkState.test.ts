import { afterEach, describe, expect, it, vi } from 'vitest'
import { NO_DATA, NO_GAME, type DataStatus, type GameStatus, type LinkStatus, type SaveFileInfo } from '../src/shared/game'
import { formatTime } from '../src/renderer/src/lib/format'
import { linkViewOf, type LinkKind } from '../src/renderer/src/lib/linkState'

const SAVE: SaveFileInfo = { path: 'saves/a.fm', name: 'a.fm', savedAt: '2026-11-28T13:07:00.000Z', bytes: 1_000 }

const game = (over: Partial<GameStatus> = {}): GameStatus => ({
  connected: true,
  pluginVersion: '0.14.0',
  pluginOld: false,
  loaded: true,
  manager: '가상 감독',
  team: '가온 시티',
  teamShort: 'GAO',
  ...over
})
const data = (over: Partial<DataStatus> = {}): DataStatus => ({
  ...NO_DATA,
  save: SAVE,
  players: 1_000,
  hasTeam: true,
  club: '가온 시티',
  source: 'game',
  liveAt: SAVE.savedAt,
  liveMatched: 990,
  ...over
})
const link = (g: GameStatus, d: DataStatus, busy = false): LinkStatus => ({ game: g, data: d, busy })

interface Case {
  kind: LinkKind
  link: LinkStatus
  /** 이번 실행에서 플러그인이 대답한 적이 있는가 */
  seen: boolean
  tone: 'neutral' | 'good' | 'warn'
  icon: 'check' | 'pause' | 'alert' | 'dot'
  title: string
}

/** 여덟 종류: 세이브 없음, 읽는 중, 내 팀 모름, 옛 플러그인, 연결됨(팀 이름), 메인 메뉴, 연결됐다 끊김, 한 번도 없음 */
const CASES: Case[] = [
  { kind: 'noSave', link: link(NO_GAME, NO_DATA), seen: false, tone: 'neutral', icon: 'dot', title: '세이브 고르기' },
  { kind: 'busy', link: link(NO_GAME, NO_DATA, true), seen: false, tone: 'neutral', icon: 'dot', title: '세이브 읽는 중입니다' },
  { kind: 'noTeam', link: link(game(), data({ hasTeam: false, club: '' })), seen: true, tone: 'neutral', icon: 'dot', title: '내 팀 확인' },
  { kind: 'pluginOld', link: link(game({ pluginOld: true, pluginVersion: '0.8.0' }), data({ source: 'save', liveAt: null })), seen: true, tone: 'warn', icon: 'alert', title: '플러그인을 바꿔야 합니다' },
  { kind: 'connected', link: link(game(), data()), seen: true, tone: 'good', icon: 'check', title: '가온 시티와 연결됨' },
  { kind: 'mainMenu', link: link(game({ loaded: false, team: '' }), data({ source: 'save', liveAt: null })), seen: true, tone: 'neutral', icon: 'dot', title: 'FM이 켜져 있음' },
  { kind: 'gameOff', link: link(NO_GAME, data({ source: 'save', liveAt: null })), seen: true, tone: 'neutral', icon: 'pause', title: 'FM이 꺼져 있음' },
  { kind: 'notConnected', link: link(NO_GAME, data({ source: 'save', liveAt: null })), seen: false, tone: 'neutral', icon: 'pause', title: '게임과 연결되지 않음' }
]

describe('linkViewOf: 연결 상태의 종류와 말', () => {
  for (const each of CASES) {
    it(`${each.kind}: 종류, 말, 색조, 아이콘`, () => {
      const view = linkViewOf(each.link, each.seen)
      expect(view.kind).toBe(each.kind)
      expect(view.title).toBe(each.title)
      expect(view.tone).toBe(each.tone)
      expect(view.icon).toBe(each.icon)
      expect(view.detail.length).toBeGreaterThan(0)
      expect(view.label).toBe(`${view.title}, ${view.detail}`)
    })
  }

  it('여덟 종류가 모두 시험에 있다', () => {
    expect(CASES.map((each) => each.kind).sort()).toEqual(['busy', 'connected', 'gameOff', 'mainMenu', 'noSave', 'noTeam', 'notConnected', 'pluginOld'])
  })

  it('주황(warn)은 옛 플러그인에만, 좋음(good)은 연결됨에만 쓴다', () => {
    for (const each of CASES) {
      const view = linkViewOf(each.link, each.seen)
      expect(view.tone === 'warn', each.kind).toBe(each.kind === 'pluginOld')
      expect(view.tone === 'good', each.kind).toBe(each.kind === 'connected')
    }
  })

  it('FM이 꺼져 있음과 게임과 연결되지 않음은 둘 다 중립색이다(평소 상태)', () => {
    const off = link(NO_GAME, data({ source: 'save', liveAt: null }))
    expect(linkViewOf(off, true)).toMatchObject({ kind: 'gameOff', title: 'FM이 꺼져 있음', tone: 'neutral' })
    expect(linkViewOf(off, false)).toMatchObject({ kind: 'notConnected', title: '게임과 연결되지 않음', tone: 'neutral' })
  })

  it('적용한 세이브가 있는 동안 busy가 참이어도 종류와 말이 바뀌지 않는다(3분마다 값을 다시 받는 때 깜빡이지 않는다)', () => {
    for (const each of CASES) {
      if (each.kind === 'busy' || each.kind === 'noSave') continue
      expect(linkViewOf({ ...each.link, busy: true }, each.seen), each.kind).toEqual(linkViewOf(each.link, each.seen))
    }
  })

  it('세이브가 아직 없을 때만 busy가 읽는 중이 된다', () => {
    expect(linkViewOf(link(NO_GAME, NO_DATA, false), false).kind).toBe('noSave')
    expect(linkViewOf(link(NO_GAME, NO_DATA, true), false).kind).toBe('busy')
    expect(linkViewOf(link(game(), NO_DATA, true), true).kind).toBe('busy')
  })

  it('차례: 세이브 없음이 연결 상태보다 먼저, 내 팀 모름이 옛 플러그인보다 먼저다', () => {
    expect(linkViewOf(link(game(), NO_DATA), true).kind).toBe('noSave')
    expect(linkViewOf(link(game({ pluginOld: true }), data({ hasTeam: false })), true).kind).toBe('noTeam')
  })

  it('연결됨은 팀 이름에 받침에 맞는 조사를 붙이고, 팀을 모르면 이름 없이 쓴다', () => {
    expect(linkViewOf(link(game({ team: '가온 시티' }), data()), true).title).toBe('가온 시티와 연결됨')
    expect(linkViewOf(link(game({ team: '북악' }), data()), true).title).toBe('북악과 연결됨')
    expect(linkViewOf(link(game({ team: '' }), data()), true).title).toBe('연결됨')
  })

  it('연결됨의 작은 글: 게임의 값을 쓰는 중이면 저장한 때를 적고, 세이브 값을 쓰는 중이면 그렇다고 적는다', () => {
    const live = linkViewOf(link(game(), data({ source: 'game' })), true)
    expect(live.detail).toContain('능력치는 게임의 지금 값')
    expect(live.detail).toContain('마지막 저장분')
    expect(live.detail).toContain(formatTime(SAVE.savedAt))
    expect(linkViewOf(link(game(), data({ source: 'save', liveAt: null })), true).detail).toBe('세이브 값으로 보는 중')
  })

  it('화면 글에 옛 말과 통계 말이 없다', () => {
    for (const each of CASES) {
      const view = linkViewOf(each.link, each.seen)
      for (const old of ['FM이 꺼져 있습니다', '알 수 없음', '확인 못 함', '읽지 못함', '표준편차', 'σ']) expect(`${view.title} ${view.detail}`, each.kind).not.toContain(old)
    }
  })
})

describe('useLinkView: 이번 실행에서 연결된 적이 있는지 모듈 안에 기억한다', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  const off = link(NO_GAME, data({ source: 'save', liveAt: null }))

  it('한 번도 연결된 적이 없으면 게임과 연결되지 않음, 연결된 link를 한 번 본 뒤에는 끊기면 FM이 꺼져 있음', async () => {
    vi.resetModules()
    const { useLinkView } = await import('../src/renderer/src/lib/linkState')
    expect(useLinkView(off).kind).toBe('notConnected')
    expect(useLinkView(link(game(), data())).kind).toBe('connected')
    expect(useLinkView(off).kind).toBe('gameOff')
    // 한 번 참이 되면 그대로다
    expect(useLinkView(off).kind).toBe('gameOff')
  })

  it('미리보기 주소에 ?seen이 있으면 처음부터 연결된 적이 있다(?off&seen에서 FM이 꺼져 있음)', async () => {
    vi.resetModules()
    vi.stubGlobal('window', { location: { search: '?off&seen' } })
    const { useLinkView } = await import('../src/renderer/src/lib/linkState')
    expect(useLinkView(off).kind).toBe('gameOff')
  })

  it('?seen이 없는 미리보기와 앱(window.api가 있음)에서는 연결된 적이 없는 것으로 시작한다', async () => {
    vi.resetModules()
    vi.stubGlobal('window', { location: { search: '?off' } })
    const preview = await import('../src/renderer/src/lib/linkState')
    expect(preview.useLinkView(off).kind).toBe('notConnected')

    vi.resetModules()
    vi.stubGlobal('window', { api: {}, location: { search: '?off&seen' } })
    const app = await import('../src/renderer/src/lib/linkState')
    expect(app.useLinkView(off).kind).toBe('notConnected')
  })
})
