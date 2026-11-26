import { useEffect, useState } from 'react'
import { estimateCostUsd, TALK_EFFORTS, TALK_MODELS, type TalkEffort, type TalkStatus } from '@shared/talk'
import type { Settings } from '@shared/types'
import { api } from '@/api'

/** 게임 안 직접 답변이 쓰는 AI 설정: API 키, 모델, 누적 사용량 */
export function TalkSettings(props: { settings: Settings; onChange: (patch: Partial<Settings>) => Promise<void> }) {
  const { settings, onChange } = props
  const [status, setStatus] = useState<TalkStatus | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.talkStatus().then(setStatus)
  }, [])

  const saveKey = async (): Promise<void> => {
    try {
      setStatus(await api.talkSetKey(key))
      setKey('')
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
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
          <p className="muted">
            모델이 좋을수록, 생각의 깊이가 높을수록 정확하지만 느리고 요금이 더 나옵니다. 고른 선택지가 자주 틀리면 한 단계씩 올려
            보세요.
          </p>
        </div>
        <div className="setting-control">
          <select
            className="field"
            aria-label="생각의 깊이"
            value={settings.talkEffort}
            onChange={(event) => void onChange({ talkEffort: event.target.value as TalkEffort })}
            style={{ minWidth: 150 }}
          >
            {TALK_EFFORTS.map((effort) => (
              <option key={effort.id} value={effort.id}>
                {effort.label}
              </option>
            ))}
          </select>
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

      <p className="faint num">
        지금까지 {stats.requests.toLocaleString()}번 물어봤고, 입력 {stats.inputTokens.toLocaleString()} + 출력{' '}
        {stats.outputTokens.toLocaleString()} 토큰을 썼습니다
        {cost !== null && ` (지금 고른 모델 단가로 약 $${cost.toFixed(3)})`}.
      </p>
    </div>
  )
}
