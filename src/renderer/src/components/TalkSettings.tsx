import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { estimateCostUsd, TALK_MODELS, type TalkStatus } from '@shared/talk'
import type { Settings } from '@shared/types'
import { api } from '@/api'
import { hotkeyLabel } from '@/screens/Talk'

/** 토크·협상 도우미 설정: API 키, 모델, 단축키, 캡처 범위, 자주 쓰는 말, 누적 사용량 */
export function TalkSettings(props: { settings: Settings; onChange: (patch: Partial<Settings>) => Promise<void> }) {
  const { settings, onChange } = props
  const [status, setStatus] = useState<TalkStatus | null>(null)
  const [key, setKey] = useState('')
  const [hotkey, setHotkey] = useState(settings.talkHotkey)
  const [phrase, setPhrase] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.talkStatus().then(setStatus)
  }, [settings.talkHotkey])

  const saveKey = async (): Promise<void> => {
    try {
      setStatus(await api.talkSetKey(key))
      setKey('')
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const addPhrase = (): Promise<void> | undefined => {
    const text = phrase.trim()
    if (!text || settings.talkPhrases.includes(text)) return
    setPhrase('')
    return onChange({ talkPhrases: [...settings.talkPhrases, text] })
  }

  const stats = settings.talkStats
  const cost = estimateCostUsd(settings.talkModel, stats.inputTokens, stats.outputTokens)

  return (
    <div className="talk-settings">
      <div className="setting-row">
        <div>
          <strong>Claude API 키</strong>
          <p className="muted">
            {status?.hasKey
              ? '저장돼 있습니다. 이 PC에 암호화해 보관하며 화면에 다시 보여 주지 않습니다.'
              : '아직 없습니다. platform.claude.com에서 발급한 키를 넣어 주세요.'}
          </p>
        </div>
        <div className="setting-control">
          <input
            className="field"
            type="password"
            placeholder={status?.hasKey ? '새 키로 바꾸기' : 'sk-ant-로 시작하는 키'}
            aria-label="Claude API 키"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <button className="btn" disabled={!key.trim()} onClick={() => void saveKey()}>
            저장
          </button>
          {status?.hasKey && (
            <button className="btn ghost danger" onClick={() => void api.talkClearKey().then(setStatus)}>
              지우기
            </button>
          )}
        </div>
      </div>
      {error && <p className="talk-error">{error}</p>}

      <div className="setting-row">
        <div>
          <strong>AI 모델</strong>
          <p className="muted">기본값이 한글 화면을 가장 정확히 읽습니다. 응답이 느리게 느껴지면 더 빠른 모델로 바꿀 수 있습니다.</p>
        </div>
        <div className="setting-control">
          <select
            className="field"
            aria-label="AI 모델"
            value={settings.talkModel}
            onChange={(event) => void onChange({ talkModel: event.target.value })}
          >
            {TALK_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="setting-row">
        <div>
          <strong>부르는 단축키</strong>
          <p className="muted">
            지금: {hotkeyLabel(status?.hotkey ?? null)}. 예: CommandOrControl+Shift+Space, Alt+F10
            {status?.hotkeyError && <span className="talk-error-text"> {status.hotkeyError}</span>}
          </p>
        </div>
        <div className="setting-control">
          <input
            className="field"
            aria-label="단축키"
            value={hotkey}
            onChange={(event) => setHotkey(event.target.value)}
          />
          <button
            className="btn"
            disabled={hotkey.trim() === settings.talkHotkey}
            onClick={() => void onChange({ talkHotkey: hotkey.trim() })}
          >
            적용
          </button>
        </div>
      </div>

      <div className="setting-row">
        <div>
          <strong>화면 전체 캡처 허용</strong>
          <p className="muted">
            꺼 두면 게임 창만 찍습니다. 켜면 게임 창을 못 찾을 때 주 모니터 전체를 찍어 보내므로, 다른 창의 내용이 함께
            전송될 수 있습니다.
          </p>
        </div>
        <div className="setting-control">
          <label className="inline-field">
            <input
              type="checkbox"
              checked={settings.talkAllowScreen}
              onChange={(event) => void onChange({ talkAllowScreen: event.target.checked })}
            />
            <span>허용</span>
          </label>
        </div>
      </div>

      <div className="setting-block">
        <strong>자주 쓰는 말</strong>
        <ul className="phrase-list">
          {settings.talkPhrases.map((text) => (
            <li key={text}>
              <span>{text}</span>
              <button
                className="btn ghost icon"
                aria-label={`“${text}” 지우기`}
                onClick={() => void onChange({ talkPhrases: settings.talkPhrases.filter((p) => p !== text) })}
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
        <div className="setting-control">
          <input
            className="field"
            placeholder="새로 넣을 말"
            aria-label="자주 쓰는 말 추가"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void addPhrase()}
            style={{ flex: 1 }}
          />
          <button className="btn" disabled={!phrase.trim()} onClick={() => void addPhrase()}>
            넣기
          </button>
        </div>
      </div>

      <p className="faint num">
        지금까지 {stats.requests.toLocaleString()}번 물어봤고, 입력 {stats.inputTokens.toLocaleString()} + 출력{' '}
        {stats.outputTokens.toLocaleString()} 토큰을 썼습니다
        {cost !== null && ` (지금 고른 모델 단가로 약 $${cost.toFixed(3)})`}.
      </p>
    </div>
  )
}
