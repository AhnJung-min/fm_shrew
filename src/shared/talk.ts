/** 토크·협상 도우미가 화면에서 알아본 장면 */
export type TalkScreen =
  | 'press_conference'
  | 'player_talk'
  | 'team_talk'
  | 'touchline_shout'
  | 'transfer_negotiation'
  | 'contract_negotiation'
  | 'other'

export const TALK_SCREEN_LABEL: Record<TalkScreen, string> = {
  press_conference: '기자회견',
  player_talk: '선수 면담',
  team_talk: '락커룸 토크',
  touchline_shout: '경기 중 외치기',
  transfer_negotiation: '이적 협상',
  contract_negotiation: '계약 협상',
  other: '그 밖의 화면'
}

export function isNegotiation(screen: TalkScreen): boolean {
  return screen === 'transfer_negotiation' || screen === 'contract_negotiation'
}

/** 확신도가 이 값보다 낮으면 "딱 맞는 선택지가 없었다"고 알린다 */
export const LOW_CONFIDENCE = 0.4

/** AI가 캡처에서 읽어 낸 장면. 대화는 이 장면을 놓고 이어진다 */
export interface TalkScene {
  id: number
  screen: TalkScreen
  /** 질문과 선택지(또는 협상 조건)를 읽을 수 있었는지 */
  readable: boolean
  /** 상황 요약 */
  situation: string
  /** 말을 거는 상대(기자·매체, 선수, 에이전트). 없으면 빈 문자열 */
  speaker: string
  /** 상대가 한 말이나 질문. 화면에 적힌 그대로 */
  question: string
  /** 화면에 보이는 선택지 전부, 놓인 순서대로 */
  options: Array<{ text: string; tone: string }>
  /** 협상 화면에서 읽은 숫자와 조건(예: "요구 이적료 950억 원") */
  facts: string[]
}

/** 대화 한 줄 */
export interface TalkLine {
  /** 'me'는 감독(사용자), 'them'은 상대 */
  from: 'me' | 'them'
  speaker: string
  text: string
}

/** 내 말에 대한 AI의 처리 결과 */
export interface TalkTurn {
  /** 장면의 options에서 고른 순번. 고를 것이 없으면 null */
  pickIndex: number | null
  /** 고른 선택지가 내 말과 얼마나 맞는지(0~1) */
  confidence: number
  /** 왜 그 선택지인지, 내 말과 다른 점 */
  reason: string
  /** 상대의 반응 대사. 분위기를 위한 연출이고 게임에는 반영되지 않는다 */
  replies: Array<{ speaker: string; text: string }>
  /** 협상 화면에서 지금 할 일. 아니면 빈 문자열 */
  nextAction: string
  /** 협상 제안. 협상이 아니면 빈 문자열들 */
  offer: { opening: string; structure: string; walkAway: string }
  /** 알아야 할 주의점. 없으면 빈 문자열 */
  caution: string
}

export interface TalkUsage {
  inputTokens: number
  outputTokens: number
  /** 실제로 답한 모델 */
  model: string
}

export interface TalkReadResult {
  ok: boolean
  scene?: TalkScene
  usage?: TalkUsage
  message?: string
}

export interface TalkSayResult {
  ok: boolean
  turn?: TalkTurn
  usage?: TalkUsage
  message?: string
}

export interface TalkCapture {
  id: number
  /** 화면에 보여 줄 축소 이미지(data URL) */
  preview: string
  capturedAt: string
  /** 게임 창을 찍었는지, 화면 전체를 찍었는지 */
  source: 'window' | 'screen'
  width: number
  height: number
}

export interface TalkStatus {
  hasKey: boolean
  /** 등록된 단축키. 등록에 실패했으면 null */
  hotkey: string | null
  hotkeyError?: string
}

/** 누적 사용량 */
export interface TalkStats {
  requests: number
  inputTokens: number
  outputTokens: number
}

export const TALK_MODELS: Array<{ id: string; label: string; inputPerMTok: number; outputPerMTok: number }> = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (기본)', inputPerMTok: 2, outputPerMTok: 10 },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (가장 정확, 요금 약 2배)', inputPerMTok: 4, outputPerMTok: 20 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (가장 빠르고 저렴)', inputPerMTok: 0.1, outputPerMTok: 0.5 }
]

/** 생각의 깊이 */
export type TalkEffort = 'low' | 'medium' | 'high'

export const TALK_EFFORTS: Array<{ id: TalkEffort; label: string }> = [
  { id: 'low', label: '낮음 (가장 빠름)' },
  { id: 'medium', label: '중간 (기본)' },
  { id: 'high', label: '높음 (느리지만 꼼꼼함)' }
]

/** 대략의 요금(달러). 2026-11 기준 공개 단가로 계산한 어림값이다. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = TALK_MODELS.find((m) => m.id === model)
  if (!price) return null
  return (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000
}
