import { globalShortcut, type BrowserWindow } from 'electron'
import type { TalkCapture, TalkResult, TalkStatus } from '@shared/talk'
import type { SettingsStore } from '../settings'
import { advise } from './advisor'
import { captureGame, previewOf } from './capture'
import type { KeyStore } from './keyStore'

interface Held {
  meta: TalkCapture
  jpeg: Buffer
}

/** 토크·협상 도우미의 메인 프로세스 쪽: 단축키, 화면 캡처, AI 호출을 묶는다. */
export class TalkController {
  private held: Held | null = null
  private nextId = 1
  private registered: string | null = null
  private hotkeyError: string | undefined

  constructor(
    private keys: KeyStore,
    private settings: SettingsStore,
    private getWindow: () => BrowserWindow | null
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

  async ask(captureId: number, intent: string): Promise<TalkResult> {
    const text = intent.trim()
    if (!text) return { ok: false, message: '하고 싶은 말을 적어 주세요.' }
    if (!this.held || this.held.meta.id !== captureId) {
      return { ok: false, message: '찍어 둔 화면이 없습니다. 게임 화면을 다시 캡처해 주세요.' }
    }
    const apiKey = this.keys.read()
    if (!apiKey) return { ok: false, message: 'Claude API 키가 없습니다. 설정에서 키를 입력해 주세요.' }

    const result = await advise({
      apiKey,
      model: this.settings.get().talkModel,
      imageJpeg: this.held.jpeg,
      intent: text
    })
    if (result.ok && result.usage) {
      const stats = this.settings.get().talkStats
      this.settings.set({
        talkStats: {
          requests: stats.requests + 1,
          inputTokens: stats.inputTokens + result.usage.inputTokens,
          outputTokens: stats.outputTokens + result.usage.outputTokens
        }
      })
    }
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
