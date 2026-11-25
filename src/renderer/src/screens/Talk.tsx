import { Camera, CircleAlert, CornerDownLeft, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  estimateCostUsd,
  isNegotiation,
  LOW_CONFIDENCE,
  TALK_MODELS,
  TALK_SCREEN_LABEL,
  type TalkStatus,
  type TalkUsage
} from '@shared/talk'
import type { Settings } from '@shared/types'
import { api } from '@/api'
import { talkStore, useTalk, type TalkEntry } from '@/lib/talkStore'

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
        {error && <p className="chat-error">{error}</p>}
      </div>
    </section>
  )
}

function UsageNote(props: { usage?: TalkUsage }) {
  if (!props.usage) return null
  const { inputTokens, outputTokens, model } = props.usage
  const cost = estimateCostUsd(model, inputTokens, outputTokens)
  return (
    <span className="chat-usage num">
      토큰 {inputTokens.toLocaleString()} + {outputTokens.toLocaleString()}
      {cost !== null && `, 약 $${cost.toFixed(4)}`}
    </span>
  )
}

function Entry(props: { entry: TalkEntry }) {
  const { entry } = props

  if (entry.kind === 'me') {
    return (
      <div className="msg me">
        <span className="who">감독</span>
        <p>{entry.text}</p>
      </div>
    )
  }

  if (entry.kind === 'them') {
    return (
      <div className="msg them">
        <span className="who">
          {entry.speaker || '상대'}
          {entry.staged && <span className="staged" title="분위기를 위해 AI가 만든 반응입니다. 게임에는 반영되지 않습니다."> 연출</span>}
        </span>
        <p>{entry.text}</p>
      </div>
    )
  }

  if (entry.kind === 'error') {
    return (
      <div className="chat-error" role="alert">
        <CircleAlert size={16} />
        <span>{entry.text}</span>
      </div>
    )
  }

  if (entry.kind === 'scene') {
    const { scene, capture } = entry
    return (
      <div className="scene">
        {capture.preview && <img src={capture.preview} alt="찍어 둔 게임 화면" />}
        <div className="scene-body">
          {entry.reading ? (
            <p className="muted">화면을 읽는 중입니다. 몇 초 걸립니다.</p>
          ) : scene ? (
            <>
              <p>
                <span className="tag squad">{TALK_SCREEN_LABEL[scene.screen]}</span> <span className="muted">{scene.situation}</span>
              </p>
              {!scene.readable && (
                <p className="chat-caution">
                  <CircleAlert size={15} />
                  화면을 다 읽지 못했습니다. 선택지가 다 보이게 한 뒤 다시 캡처해 보세요.
                </p>
              )}
              {scene.options.length > 0 && (
                <details>
                  <summary>화면의 선택지 {scene.options.length}개</summary>
                  <ol>
                    {scene.options.map((option, i) => (
                      <li key={i}>
                        {option.text}
                        {option.tone && <span className="faint"> ({option.tone})</span>}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {scene.facts.length > 0 && (
                <details open>
                  <summary>화면에서 읽은 조건</summary>
                  <ul>
                    {scene.facts.map((fact, i) => (
                      <li key={i}>{fact}</li>
                    ))}
                  </ul>
                </details>
              )}
              <UsageNote usage={entry.usage} />
            </>
          ) : (
            <p className="muted">이 화면은 읽지 못했습니다.</p>
          )}
        </div>
      </div>
    )
  }

  // 고른 선택지(게임에 실제로 반영되는 부분)
  const { scene, turn } = entry
  const deal = isNegotiation(scene.screen)
  const picked = turn.pickIndex === null ? null : scene.options[turn.pickIndex]
  return (
    <div className="pick">
      {deal ? (
        <>
          <h3>지금 할 일</h3>
          {turn.nextAction && <p className="pick-option">{turn.nextAction}</p>}
          <dl className="pick-offer">
            <dt>처음 제안</dt>
            <dd>{turn.offer.opening || '–'}</dd>
            <dt>구성</dt>
            <dd>{turn.offer.structure || '–'}</dd>
            <dt>물러설 선</dt>
            <dd>{turn.offer.walkAway || '–'}</dd>
          </dl>
          <p className="muted">{turn.reason}</p>
          <p className="faint pick-note">
            게임의 협상 계산식을 아는 것이 아니라 화면에 보이는 숫자로 판단한 제안입니다. 그대로 해도 거절될 수 있습니다.
          </p>
        </>
      ) : picked ? (
        <>
          <h3>게임에서 이 선택지를 누르세요 (화면에서 {turn.pickIndex! + 1}번째)</h3>
          <p className="pick-option">{picked.text}</p>
          {picked.tone && <p className="pick-tone">어조: {picked.tone}</p>}
          <p className="muted">{turn.reason}</p>
          {turn.confidence < LOW_CONFIDENCE && (
            <p className="chat-caution">
              <CircleAlert size={15} />딱 맞는 선택지가 없어 가장 가까운 것을 골랐습니다. 위의 선택지 목록을 직접 확인해 보세요.
            </p>
          )}
        </>
      ) : (
        <>
          <h3>고를 선택지를 찾지 못했습니다</h3>
          <p className="muted">{turn.reason || '선택지가 보이게 화면을 다시 캡처해 보세요.'}</p>
        </>
      )}
      {turn.caution && (
        <p className="chat-caution">
          <CircleAlert size={15} />
          {turn.caution}
        </p>
      )}
      <UsageNote usage={entry.usage} />
    </div>
  )
}

/** 대화형 토크 도우미. 상대의 말이 말풍선으로 뜨고, 감독으로서 자유롭게 답하면 맞는 선택지를 알려 준다. */
export function Talk(props: { settings: Settings; onGoSettings: () => void }) {
  const { settings, onGoSettings } = props
  const { entries, scene, busy } = useTalk()
  const [status, setStatus] = useState<TalkStatus | null>(null)
  const [words, setWords] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.talkStatus().then(setStatus)
  }, [])

  // 새 말이 오면 맨 아래로 내리고, 대답을 기다리는 동안이 아니면 바로 입력할 수 있게 한다
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
    if (!busy) input.current?.focus()
  }, [entries.length, busy])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void api.hideWindow()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const send = (text = words): void => {
    if (!text.trim() || !scene || busy) return
    setWords('')
    void talkStore.say(text)
  }

  const hotkey = hotkeyLabel(status?.hotkey ?? settings.talkHotkey)
  const modelLabel = TALK_MODELS.find((m) => m.id === settings.talkModel)?.label.split(' (')[0] ?? settings.talkModel

  return (
    <>
      <header className="page-head">
        <h1>토크 도우미</h1>
        <span className="pill">
          <kbd>{hotkey}</kbd> 게임 화면 가져오기
        </span>
        <button className="pill" onClick={onGoSettings} title="모델과 생각의 깊이 바꾸기">
          {modelLabel}
        </button>
        {status?.hotkeyError && <span className="pill bad">{status.hotkeyError}</span>}
        <div className="spacer" />
        <button className="btn" disabled={busy !== null} onClick={() => void talkStore.capture()}>
          <Camera size={16} />
          지금 캡처
        </button>
        <button className="btn ghost" onClick={() => void api.hideWindow()} title="Esc">
          <Undo2 size={16} />
          게임으로
        </button>
      </header>

      {status && !status.hasKey ? (
        <div className="page-body">
          <KeySetup onSaved={setStatus} />
        </div>
      ) : (
        <div className="chat">
          <div className="chat-log" ref={log} aria-live="polite">
            {entries.length === 0 ? (
              <div className="chat-ready">
                <h2>감독으로서 하고 싶은 말을 그대로 하세요</h2>
                <ol className="steps">
                  <li>
                    게임에서 기자회견, 선수 면담, 락커룸 토크, 외치기, 협상 화면을 띄우고 <kbd>{hotkey}</kbd>를 누릅니다.
                  </li>
                  <li>상대의 말이 여기에 뜨면, 아래 칸에 하고 싶은 말을 자유롭게 적습니다.</li>
                  <li>가장 가까운 선택지를 알려 드리면 게임에서 그것을 누릅니다. 다음 질문이 나오면 다시 단축키를 누릅니다.</li>
                </ol>
                <p className="muted">
                  상대의 반응 대사는 분위기를 위한 연출이고, 게임에 실제로 반영되는 것은 고른 선택지입니다.
                </p>
              </div>
            ) : (
              entries.map((entry) => <Entry key={entry.key} entry={entry} />)
            )}
            {busy === 'replying' && <p className="chat-wait muted">상대가 대답하는 중…</p>}
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault()
              send()
            }}
          >
            {scene && settings.talkPhrases.length > 0 && (
              <div className="chips">
                {settings.talkPhrases.map((phrase) => (
                  <button key={phrase} type="button" className="chip" disabled={busy !== null} onClick={() => send(phrase)}>
                    {phrase}
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={input}
              className="field"
              rows={3}
              placeholder={
                scene
                  ? '감독으로서 하고 싶은 말을 자유롭게 적으세요. 괄호 안은 행동으로 봅니다: (고개를 저으며) 그 질문엔 답하지 않겠습니다'
                  : '먼저 게임 화면을 가져와 주세요.'
              }
              aria-label="하고 싶은 말"
              disabled={!scene}
              value={words}
              onChange={(event) => setWords(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send()
                }
              }}
            />
            <div className="composer-actions">
              <button type="button" className="btn ghost" disabled={entries.length === 0 || busy !== null} onClick={() => talkStore.clear()}>
                기록 지우기
              </button>
              <span className="faint">Enter로 보내고, Shift + Enter로 줄을 바꿉니다.</span>
              <div className="spacer" />
              <button type="submit" className="btn primary" disabled={!scene || !words.trim() || busy !== null}>
                <CornerDownLeft size={16} />
                말하기
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
