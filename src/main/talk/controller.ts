import { globalShortcut, type BrowserWindow } from 'electron'
import type { TalkCapture, TalkLine, TalkReadResult, TalkSayResult, TalkScene, TalkStatus, TalkUsage } from '@shared/talk'
import type { SettingsStore } from '../settings'
import { readScene, respond, type AdvisorConfig } from './advisor'
import { captureGame, previewOf } from './capture'
import type { KeyStore } from './keyStore'

/** 토크·협상 도우미의 메인 프로세스 쪽: 단축키, 화면 캡처, AI 호출을 묶는다. */
export class TalkController {
  /** 가장 최근에 찍은 화면. 메모리에만 두고 파일로 남기지 않는다 */
  private held: { meta: TalkCapture; jpeg: Buffer } | null = null
  /** 읽어 둔 장면들(대화가 참조한다). 오래된 것은 버린다 */
  private scenes = new Map<number, TalkScene>()
  private nextId = 1
  private registered: string | null = null
  private hotkeyError: string | undefined

  constructor(
    private keys: KeyStore,
    private settings: SettingsStore,
    private getWindow: () => BrowserWindow | null,
    /** 세이브에서 읽은 내 팀 선수 이름. AI가 이름 표기를 맞추는 데 쓴다 */
    private getSquadNames: () => string[]
  ) {}

  status(): TalkStatus {
    return { hasKey: this.keys.has(), hotkey: this.registered, hotkeyError: this.hotkeyError }
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

  async capture(): Promise<{ ok: boolean; capture?: TalkCapture; message?: string }> {
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
    if (!this.held || this.held.meta.id !== captureId) {
      return { ok: false, message: '찍어 둔 화면이 없습니다. 게임 화면을 다시 캡처해 주세요.' }
    }
    const config = this.config()
    if (!config) return { ok: false, message: 'Claude API 키가 없습니다. 키를 먼저 넣어 주세요.' }

    const result = await readScene(config, this.held.jpeg, captureId)
    if (result.ok && result.scene) {
      this.scenes.set(result.scene.id, result.scene)
      for (const id of this.scenes.keys()) {
        if (this.scenes.size <= 8) break
        this.scenes.delete(id)
      }
    }
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

  /** 앱을 내려 게임으로 돌아간다. */
  hideWindow(): void {
    const win = this.getWindow()
    if (!win) return
    win.setAlwaysOnTop(false)
    win.minimize()
  }

  dispose(): void {
    if (this.registered) globalShortcut.unregister(this.registered)
    this.registered = null
  }
}
