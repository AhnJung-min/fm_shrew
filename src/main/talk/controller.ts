import { globalShortcut, type BrowserWindow } from 'electron'
import { guessOwnTeam, type GameScene } from '@shared/gameUi'
import { LOW_CONFIDENCE, type TalkCapture, type TalkLine, type TalkPressResult, type TalkReadResult, type TalkSayResult, type TalkScene, type TalkStatus, type TalkUsage } from '@shared/talk'
import type { SettingsStore } from '../settings'
import { readScene, respond, type AdvisorConfig } from './advisor'
import { bridgeAlive, pressInGame, readFromGame, readMatchFromGame, sendReply, waitForWords, type GameReply, type GameWords } from './bridge'
import { captureGame, previewOf } from './capture'
import type { KeyStore } from './keyStore'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 두 장면이 같은 질문·같은 선택지인지 */
function sameScene(a: Pick<TalkScene, 'question' | 'options'>, b: Pick<TalkScene, 'question' | 'options'>): boolean {
  return a.question === b.question && a.options.length === b.options.length && a.options.every((o, i) => o.text === b.options[i].text)
}

/**
 * 토크·협상 도우미의 메인 프로세스 쪽: 단축키, 장면 읽기, AI 호출, 게임에서 누르기를 묶는다.
 * 게임 안 플러그인이 있으면 질문과 선택지를 게임에서 바로 읽고, 없으면 화면을 찍어 AI가 읽는다.
 */
export class TalkController {
  /** 가장 최근에 찍은 화면. 메모리에만 두고 파일로 남기지 않는다 */
  private held: { meta: TalkCapture; jpeg: Buffer } | null = null
  /** 게임에서 직접 읽어 둔 장면(캡처 없이 바로 쓴다) */
  private heldGame: TalkScene | null = null
  /** 읽어 둔 장면들(대화가 참조한다). 오래된 것은 버린다 */
  private scenes = new Map<number, TalkScene>()
  private nextId = 1
  private registered: string | null = null
  /** 게임 안 "직접 답변" 칸에서 이어지는 대화. 질문이 바뀌면 비운다 */
  private gameTalk: { scene: TalkScene; history: TalkLine[] } | null = null
  private disposed = false
  private hotkeyError: string | undefined

  constructor(
    private keys: KeyStore,
    private settings: SettingsStore,
    private getWindow: () => BrowserWindow | null,
    /** 세이브에서 읽은 내 팀 선수 이름. AI가 이름 표기를 맞추는 데 쓴다 */
    private getSquadNames: () => string[]
  ) {}

  async status(): Promise<TalkStatus> {
    return { hasKey: this.keys.has(), hotkey: this.registered, hotkeyError: this.hotkeyError, game: await bridgeAlive() }
  }

  /** 설정의 단축키를 등록한다. 다른 프로그램이 이미 쓰고 있으면 실패할 수 있다. */
  registerHotkey(): void {
    if (this.registered) globalShortcut.unregister(this.registered)
    this.registered = null
    this.hotkeyError = undefined
    const accelerator = this.settings.get().talkHotkey
    if (!accelerator) return
    try {
      const ok = globalShortcut.register(accelerator, () => void this.onHotkey())
      if (ok) this.registered = accelerator
      else this.hotkeyError = `${accelerator} 단축키를 등록하지 못했습니다. 다른 프로그램이 쓰고 있을 수 있습니다.`
    } catch {
      this.hotkeyError = `${accelerator}는 단축키로 쓸 수 없는 조합입니다.`
    }
  }

  /** 게임 중에 단축키를 누르면: 그 순간의 화면을 찍고 앱을 앞으로 가져온다. */
  private async onHotkey(): Promise<void> {
    const result = await this.capture()
    const win = this.getWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    // 테두리 없는 전체 화면 게임 위에도 뜨도록 잠시 맨 위에 둔다
    win.setAlwaysOnTop(true, 'screen-saver')
    win.focus()
    win.webContents.send('talk:captured', result.ok ? { capture: result.capture } : { message: result.message })
  }

  /** 게임에서 읽은 장면을 대화가 쓸 수 있게 받아 둔다. */
  private holdGame(game: GameScene): TalkCapture {
    const id = this.nextId++
    this.held = null
    this.heldGame = {
      id,
      screen: game.screen,
      readable: true,
      situation: game.situation,
      speaker: game.speaker,
      question: game.question,
      options: game.options,
      facts: game.facts,
      source: 'game'
    }
    return { id, preview: '', capturedAt: new Date().toISOString(), source: 'game', width: 0, height: 0 }
  }

  private remember(scene: TalkScene): void {
    this.scenes.set(scene.id, scene)
    for (const id of this.scenes.keys()) {
      if (this.scenes.size <= 8) break
      this.scenes.delete(id)
    }
  }

  async capture(): Promise<{ ok: boolean; capture?: TalkCapture; message?: string }> {
    // 게임 안 플러그인이 토크 화면을 읽어 주면 캡처가 필요 없다
    const game = await readFromGame()
    if (game && game.options.length > 0) return { ok: true, capture: this.holdGame(game) }

    try {
      const { image, source } = await captureGame(this.settings.get().talkAllowScreen)
      const size = image.getSize()
      const meta: TalkCapture = {
        id: this.nextId++,
        preview: previewOf(image),
        capturedAt: new Date().toISOString(),
        source,
        width: size.width,
        height: size.height
      }
      this.held = { meta, jpeg: image.toJPEG(88) }
      this.heldGame = null
      return { ok: true, capture: meta }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  private config(): AdvisorConfig | null {
    const apiKey = this.keys.read()
    if (!apiKey) return null
    const { talkModel, talkEffort } = this.settings.get()
    return { apiKey, model: talkModel, effort: talkEffort }
  }

  private count(usage: TalkUsage | undefined): void {
    if (!usage) return
    const stats = this.settings.get().talkStats
    this.settings.set({
      talkStats: {
        requests: stats.requests + 1,
        inputTokens: stats.inputTokens + usage.inputTokens,
        outputTokens: stats.outputTokens + usage.outputTokens
      }
    })
  }

  /** 찍어 둔 화면에서 상대의 말과 선택지를 읽는다. */
  async read(captureId: number): Promise<TalkReadResult> {
    if (this.heldGame?.id === captureId) {
      this.remember(this.heldGame)
      return { ok: true, scene: this.heldGame }
    }
    if (!this.held || this.held.meta.id !== captureId) {
      return { ok: false, message: '찍어 둔 화면이 없습니다. 게임 화면을 다시 캡처해 주세요.' }
    }
    const config = this.config()
    if (!config) return { ok: false, message: 'Claude API 키가 없습니다. 키를 먼저 넣어 주세요.' }

    const result = await readScene(config, this.held.jpeg, captureId)
    if (result.ok && result.scene) this.remember(result.scene)
    if (result.ok) this.count(result.usage)
    return result
  }

  /** 읽어 둔 장면을 놓고, 내가 한 말을 선택지로 옮기고 상대의 반응을 받는다. */
  async say(sceneId: number, history: TalkLine[], words: string): Promise<TalkSayResult> {
    const text = words.trim()
    if (!text) return { ok: false, message: '하고 싶은 말을 적어 주세요.' }
    const scene = this.scenes.get(sceneId)
    if (!scene) return { ok: false, message: '이 장면을 다시 읽어야 합니다. 게임 화면을 다시 캡처해 주세요.' }
    const config = this.config()
    if (!config) return { ok: false, message: 'Claude API 키가 없습니다. 키를 먼저 넣어 주세요.' }

    const result = await respond(config, scene, history, text, this.getSquadNames())
    if (result.ok) this.count(result.usage)
    return result
  }

  /**
   * 장면의 선택지를 게임에서 누른다. 누른 뒤 게임이 다음 질문으로 넘어가면 그 장면도 읽어 돌려준다.
   */
  async press(sceneId: number, optionIndex: number): Promise<TalkPressResult> {
    const scene = this.scenes.get(sceneId)
    const option = scene?.options[optionIndex]
    if (!scene || !option) return { ok: false, message: '이 장면을 다시 읽어야 합니다.' }
    if (option.ref === undefined) return { ok: false, message: '캡처로 읽은 장면은 게임에서 직접 눌러야 합니다.' }

    const pressed = await pressInGame(option.ref, option.text)
    if (!pressed.ok) return pressed

    // 게임이 다음 질문을 띄울 시간을 준다
    for (let attempt = 0; attempt < 5; attempt++) {
      await wait(600)
      const game = await readFromGame()
      if (game && game.options.length > 0 && !sameScene(game, scene)) return { ok: true, next: this.holdGame(game) }
      if (!game && attempt >= 1) break
    }
    return { ok: true }
  }

  /**
   * 게임 안 "직접 답변" 칸을 맡는다. 게임이 켜져 있는 동안 계속 돌면서,
   * 칸에 말이 적히면 AI에게 물어 상대의 반응과 적용할 선택지를 게임으로 돌려보낸다.
   */
  async serveGame(): Promise<void> {
    let after = 0
    while (!this.disposed) {
      const got = await waitForWords(after)
      if (got === 'offline') {
        // 게임이 꺼져 있다. 켜질 때까지 가끔 확인한다
        after = 0
        await wait(4000)
        continue
      }
      if (!got) continue
      after = got.seq
      let reply: GameReply
      try {
        reply = await this.answerInGame(got.words, got.kind)
      } catch (error) {
        reply = { pick: 0, pickText: '', note: '', replies: [], error: error instanceof Error ? error.message : String(error) }
      }
      await sendReply(got.seq, reply)
    }
  }

  private async answerInGame(words: string, kind: GameWords['kind']): Promise<GameReply> {
    const fail = (error: string): GameReply => ({ pick: 0, pickText: '', note: '', replies: [], error })
    const config = this.config()
    if (!config) return fail('Claude API 키가 없습니다. FM 보좌관 앱의 토크 도우미에서 키를 넣어 주세요.')
    const shout = kind === 'shout'
    const game = shout ? await readMatchFromGame() : await readFromGame()
    if (!game || game.options.length === 0) {
      return fail(shout ? '외침 목록을 읽지 못했습니다. 다시 말해 주세요.' : '지금 화면에서 고를 선택지를 찾지 못했습니다.')
    }

    const scene: TalkScene = {
      id: this.nextId++,
      readable: true,
      source: 'game',
      screen: game.screen,
      situation: game.situation,
      speaker: game.speaker,
      question: game.question,
      options: game.options,
      facts: game.teams ? [...game.facts, this.ownTeamFact(game.teams)] : game.facts
    }
    if (!this.gameTalk || !sameScene(this.gameTalk.scene, scene)) this.gameTalk = { scene, history: [] }
    const talk = this.gameTalk
    talk.scene = scene

    const result = await respond(config, scene, talk.history, words, this.getSquadNames())
    if (!result.ok || !result.turn) return fail(result.message ?? '답을 받지 못했습니다.')
    this.count(result.usage)
    const turn = result.turn
    talk.history.push({ from: 'me', speaker: '감독', text: words })
    for (const line of turn.replies) talk.history.push({ from: 'them', speaker: line.speaker, text: line.text })

    const option = turn.pickIndex === null ? undefined : scene.options[turn.pickIndex]
    if (!option || option.ref === undefined) {
      return { pick: 0, pickText: '', note: turn.reason || '맞는 선택지를 찾지 못했습니다.', replies: turn.replies }
    }
    const what = shout ? '외침' : '선택지'
    const lead = turn.confidence < LOW_CONFIDENCE ? `딱 맞는 ${what}이 없어 가장 가까운 것` : `적용할 ${what}`
    const tone = option.tone ? ` (${option.tone})` : ''
    return { pick: option.ref, pickText: option.text, note: `${lead}${tone}: ${option.text}`, replies: turn.replies }
  }

  /**
   * 점수판의 두 팀 가운데 어느 쪽이 우리 팀인지 AI에게 알려 줄 문장.
   * 게임 화면에는 그 표시가 없어서, 여러 경기에 계속 나오는 약칭을 우리 팀으로 본다.
   */
  private ownTeamFact(teams: [string, string]): string {
    const pair = teams.join('|')
    const seen = this.settings.get().matchPairs
    if (!seen.includes(pair)) this.settings.set({ matchPairs: [...seen, pair].slice(-12) })
    const own = guessOwnTeam(this.settings.get().matchPairs)
    if (own && teams.includes(own)) return `우리 팀은 ${own}입니다.`
    return '점수판의 두 팀 가운데 어느 쪽이 우리 팀인지는 알 수 없습니다. 이기고 있다거나 지고 있다고 단정하지 마세요.'
  }

  /** 앱을 내려 게임으로 돌아간다. */
  hideWindow(): void {
    const win = this.getWindow()
    if (!win) return
    win.setAlwaysOnTop(false)
    win.minimize()
  }

  dispose(): void {
    this.disposed = true
    if (this.registered) globalShortcut.unregister(this.registered)
    this.registered = null
  }
}
