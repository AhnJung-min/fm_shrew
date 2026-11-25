/** 토크·협상 도우미가 화면에서 알아본 장면 */
export type TalkScreen =
  | 'press_conference'
  | 'team_talk'
  | 'touchline_shout'
  | 'transfer_negotiation'
  | 'contract_negotiation'
  | 'other'

export const TALK_SCREEN_LABEL: Record<TalkScreen, string> = {
  press_conference: '기자회견',
  team_talk: '락커룸 토크',
  touchline_shout: '경기 중 외치기',
  transfer_negotiation: '이적 협상',
  contract_negotiation: '계약 협상',
  other: '그 밖의 화면'
}

export interface TalkOption {
  /** 화면에 적힌 선택지 문구 그대로 */
  option: string
  /** 어조가 따로 있으면(예: 단호하게) 그 이름, 없으면 빈 문자열 */
  tone: string
  /** 왜 이 선택지인지 */
  reason: string
}

export interface TalkAdvice {
  screen: TalkScreen
  /** 화면에서 읽은 상황 요약 */
  situation: string
  /** 화면의 질문과 선택지를 읽을 수 있었는지 */
  readable: boolean
  recommendation: TalkOption
  alternatives: TalkOption[]
  /** 협상 화면일 때의 제안. 협상이 아니면 빈 문자열들 */
  offer: {
    /** 처음 부를 금액이나 조건 */
    opening: string
    /** 분할 지급, 옵션, 조항 구성 */
    structure: string
    /** 여기까지 오면 물러설 선 */
    walkAway: string
  }
  /** 사용자가 알아야 할 주의점. 없으면 빈 문자열 */
  caution: string
}

export interface TalkUsage {
  inputTokens: number
  outputTokens: number
  /** 실제로 답한 모델 */
  model: string
}

export interface TalkResult {
  ok: boolean
  advice?: TalkAdvice
  usage?: TalkUsage
  /** 실패했을 때 사용자에게 보여 줄 말 */
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
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (기본, 가장 정확)', inputPerMTok: 4, outputPerMTok: 20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (더 빠르고 저렴)', inputPerMTok: 2, outputPerMTok: 10 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (가장 빠르고 저렴)', inputPerMTok: 0.1, outputPerMTok: 0.5 }
]

/** 대략의 요금(달러). 2026-11 기준 공개 단가로 계산한 어림값이다. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = TALK_MODELS.find((m) => m.id === model)
  if (!price) return null
  return (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000
}
