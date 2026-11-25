import { Camera, CircleAlert, CornerDownLeft, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  estimateCostUsd,
  LOW_CONFIDENCE,
  TALK_SCREEN_LABEL,
  type TalkCapture,
  type TalkResult,
  type TalkStatus
} from '@shared/talk'
import type { Settings } from '@shared/types'
import { api } from '@/api'
import { formatTime } from '@/lib/format'

/** Electron 가속기 표기를 사람이 읽는 키 이름으로 */
export function hotkeyLabel(accelerator: string | null): string {
  if (!accelerator) return '단축키 없음'
  return accelerator.replace('CommandOrControl', 'Ctrl').replace('Control', 'Ctrl').split('+').join(' + ')
}

function KeySetup(props: { onSaved: (status: TalkStatus) => void }) {
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = async (): Promise<void> => {
    try {
      props.onSaved(await api.talkSetKey(key))
      setKey('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <section className="panel talk-setup">
      <div className="panel-head">
        <h2>먼저 Claude API 키가 필요합니다</h2>
      </div>
      <div className="panel-body">
        <ol className="steps">
          <li>
            <a href="https://platform.claude.com" target="_blank" rel="noreferrer">
              Claude 콘솔(platform.claude.com)
            </a>
            에 로그인해 결제 수단을 등록합니다. Claude 구독(Pro·Max)과는 별도이고, 쓴 만큼만 요금이 나옵니다.
          </li>
          <li>콘솔의 API 키 메뉴에서 새 키를 만들어 복사합니다.</li>
          <li>아래 칸에 붙여 넣고 저장합니다. 키는 이 PC에 암호화해 보관하고 화면에 다시 보여 주지 않습니다.</li>
        </ol>
        <div className="talk-key-row">
          <input
            className="field"
            type="password"
            placeholder="sk-ant-로 시작하는 키"
            aria-label="Claude API 키"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && key.trim() && void save()}
          />
          <button className="btn primary" disabled={!key.trim()} onClick={() => void save()}>
            키 저장
          </button>
        </div>
        {error && <p className="talk-error">{error}</p>}
      </div>
    </section>
  )
}

function ResultCard(props: { result: TalkResult; model: string }) {
  const { result } = props
  if (!result.ok || !result.advice) {
    return (
      <div className="talk-error" role="alert">
        <CircleAlert size={16} />
        <span>{result.message ?? '답을 받지 못했습니다.'}</span>
      </div>
    )
  }
  const { advice, usage } = result
  const isDeal = advice.offer.opening !== '' || advice.offer.structure !== '' || advice.offer.walkAway !== ''
  const cost = usage ? estimateCostUsd(usage.model, usage.inputTokens, usage.outputTokens) : null

  return (
    <article className="talk-result">
      <header>
        <span className="tag squad">{TALK_SCREEN_LABEL[advice.screen]}</span>
        <p className="muted">{advice.situation}</p>
      </header>

      {!advice.readable && (
        <div className="talk-error" role="alert">
          <CircleAlert size={16} />
          <span>화면을 다 읽지 못했습니다. 아래 추천은 참고만 하고, 선택지가 다 보이게 한 뒤 다시 캡처해 보세요.</span>
        </div>
      )}

      <section className="talk-pick">
        <h2>
          {isDeal
            ? '지금 할 일'
            : advice.pickIndex !== null
              ? `이 선택지를 고르세요 (화면에서 ${advice.pickIndex + 1}번째)`
              : '고를 선택지를 찾지 못했습니다'}
        </h2>
        {advice.recommendation.option && <p className="talk-option">{advice.recommendation.option}</p>}
        {advice.recommendation.tone && <p className="talk-tone">어조: {advice.recommendation.tone}</p>}
        <p className="muted">{advice.recommendation.reason}</p>
        {!isDeal && advice.pickIndex !== null && advice.confidence < LOW_CONFIDENCE && (
          <p className="talk-caution">
            <CircleAlert size={15} />딱 맞는 선택지가 없어 가장 가까운 것을 골랐습니다. 아래 목록에서 직접 확인해 보세요.
          </p>
        )}
      </section>

      {advice.options.length > 1 && (
        <section className="talk-alts">
          <h3>화면에서 읽은 선택지</h3>
          <ol className="talk-options">
            {advice.options.map((option, i) => (
              <li key={i} className={i === advice.pickIndex ? 'picked' : undefined}>
                <span>{option.text}</span>
                {option.tone && <span className="faint"> ({option.tone})</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {isDeal && (
        <dl className="talk-offer">
          <dt>처음 제안</dt>
          <dd>{advice.offer.opening || '–'}</dd>
          <dt>구성</dt>
          <dd>{advice.offer.structure || '–'}</dd>
          <dt>물러설 선</dt>
          <dd>{advice.offer.walkAway || '–'}</dd>
        </dl>
      )}

      {advice.alternatives.length > 0 && (
        <section className="talk-alts">
          <h3>뜻이 조금 다른 차선책</h3>
          <ul>
            {advice.alternatives.map((alt) => (
              <li key={alt.index}>
                <strong>
                  {alt.index + 1}번째: {alt.option}
                </strong>
                {alt.tone && <span className="talk-tone"> (어조: {alt.tone})</span>}
                <span className="muted"> {alt.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {advice.caution && (
        <p className="talk-caution">
          <CircleAlert size={15} />
          {advice.caution}
        </p>
      )}

      {isDeal && (
        <p className="faint talk-note">
          게임의 협상 계산식을 아는 것이 아니라 화면에 보이는 숫자로 판단한 제안입니다. 그대로 해도 거절될 수 있습니다.
        </p>
      )}
      {usage && (
        <p className="faint talk-note num">
          이번 요청: 입력 {usage.inputTokens.toLocaleString()} + 출력 {usage.outputTokens.toLocaleString()} 토큰
          {cost !== null && `, 약 $${cost.toFixed(4)}`}
        </p>
      )}
    </article>
  )
}

export function Talk(props: {
  settings: Settings
  capture: TalkCapture | null
  captureError: string | null
  onCapture: (capture: TalkCapture | null, error: string | null) => void
  onGoSettings: () => void
}) {
  const { settings, capture, captureError, onCapture, onGoSettings } = props
  const [status, setStatus] = useState<TalkStatus | null>(null)
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TalkResult | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void api.talkStatus().then(setStatus)
  }, [])

  // 새 화면이 찍히면 이전 답은 지우고 바로 입력할 수 있게 한다
  useEffect(() => {
    setResult(null)
    input.current?.focus()
  }, [capture?.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void api.hideWindow()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const shoot = async (): Promise<void> => {
    const shot = await api.talkCapture()
    onCapture(shot.capture ?? null, shot.ok ? null : (shot.message ?? '화면을 캡처하지 못했습니다.'))
  }

  const ask = async (text = intent): Promise<void> => {
    if (!capture || !text.trim() || busy) return
    setBusy(true)
    setResult(null)
    try {
      setResult(await api.talkAsk(capture.id, text))
    } finally {
      setBusy(false)
    }
  }

  const hotkey = hotkeyLabel(status?.hotkey ?? settings.talkHotkey)

  return (
    <>
      <header className="page-head">
        <h1>토크 도우미</h1>
        <span className="page-sub">
          게임에서 <kbd>{hotkey}</kbd>를 누르면 그 화면을 찍어 여기로 가져옵니다.
        </span>
        <div className="spacer" />
        <button className="btn ghost" onClick={() => void api.hideWindow()} title="Esc">
          <Undo2 size={16} />
          게임으로 돌아가기
        </button>
      </header>

      <div className="page-body">
        {status && !status.hasKey ? (
          <KeySetup onSaved={setStatus} />
        ) : (
          <div className="talk">
            <section className="panel talk-shot">
              <div className="panel-head">
                <h2>찍어 둔 화면</h2>
                <div className="spacer" />
                <button className="btn" onClick={() => void shoot()}>
                  <Camera size={16} />
                  지금 캡처
                </button>
              </div>
              <div className="panel-body">
                {capture ? (
                  <>
                    {capture.preview ? (
                      <img src={capture.preview} alt="찍어 둔 게임 화면" />
                    ) : (
                      <div className="talk-shot-empty">미리보기 없음</div>
                    )}
                    <p className="faint num">
                      {formatTime(capture.capturedAt)}, {capture.source === 'window' ? '게임 창만' : '화면 전체'}, {capture.width}×
                      {capture.height}
                    </p>
                  </>
                ) : (
                  <div className="talk-shot-empty">
                    <strong>아직 찍은 화면이 없습니다</strong>
                    게임에서 기자회견, 락커룸 토크, 외치기, 협상 화면을 띄우고 <kbd>{hotkey}</kbd>를 누르세요.
                  </div>
                )}
                {captureError && (
                  <div className="talk-error" role="alert">
                    <CircleAlert size={16} />
                    <span>{captureError}</span>
                  </div>
                )}
                {status?.hotkeyError && (
                  <div className="talk-error" role="alert">
                    <CircleAlert size={16} />
                    <span>
                      {status.hotkeyError}{' '}
                      <button className="link" onClick={onGoSettings}>
                        설정에서 바꾸기
                      </button>
                    </span>
                  </div>
                )}
              </div>
            </section>

            <section className="talk-ask">
              <label className="talk-label" htmlFor="talk-intent">
                이 장면에서 하고 싶은 말이나 조건
              </label>
              <textarea
                id="talk-intent"
                ref={input}
                className="field talk-input"
                rows={3}
                placeholder="예: 실망했지만 후반에 뒤집을 수 있다고 믿는다 / 최대 800억까지, 분할 지급을 선호"
                value={intent}
                onChange={(event) => setIntent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void ask()
                  }
                }}
              />
              <div className="talk-actions">
                <div className="chips">
                  {settings.talkPhrases.map((phrase) => (
                    <button
                      key={phrase}
                      className="chip"
                      disabled={!capture || busy}
                      title="이 말로 바로 물어보기"
                      onClick={() => {
                        setIntent(phrase)
                        void ask(phrase)
                      }}
                    >
                      {phrase}
                    </button>
                  ))}
                </div>
                <button className="btn primary" disabled={!capture || !intent.trim() || busy} onClick={() => void ask()}>
                  <CornerDownLeft size={16} />
                  {busy ? '화면을 읽는 중' : '선택지 찾기'}
                </button>
              </div>

              {busy && <p className="muted talk-wait">AI가 화면을 읽고 있습니다. 몇 초 걸립니다.</p>}
              {result && <ResultCard result={result} model={settings.talkModel} />}
            </section>
          </div>
        )}
      </div>
    </>
  )
}
