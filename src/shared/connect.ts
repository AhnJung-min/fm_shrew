import type { LinkStatus } from './game'
import type { EditorApplyResult, EditorEdit } from './world'

/**
 * 연결·시작 화면이 쓰는 값들: 세이브 형식 점검(A-16), 내 구단 고르기(A-14), 에디터 반영 결과(A-15).
 * 기존 LinkStatus·Api 모양을 건드리지 않으려고 따로 둔다. 실행할 때 main이 LinkStatus에 LinkExtras를 얹어 보내고(extrasOf로 읽는다),
 * 새 창구는 ExtraApi로 더한다.
 */

/** 세이브 형식 자가 점검 결과. ok가 아니면 점수 화면을 막고 problems를 보여 준다 */
export interface SaveCheck {
  ok: boolean
  /** 무엇이 이상했는지(한 줄씩) */
  problems: string[]
}

export const SAVE_CHECK_OK: SaveCheck = { ok: true, problems: [] }

/** LinkStatus에 얹어 보내는 값 */
export interface LinkExtras {
  check: SaveCheck
  /** 게임이 알려 준 구단으로 내 구단을 바꿨을 때 한 줄 안내. 없으면 빈 글자 */
  teamNote: string
}

export type ExtendedLinkStatus = LinkStatus & LinkExtras

/** 화면이 받은 LinkStatus에서 얹힌 값을 꺼낸다(없으면 이상 없음) */
export function extrasOf(link: LinkStatus): LinkExtras {
  const extra = link as Partial<LinkExtras>
  return { check: extra.check ?? SAVE_CHECK_OK, teamNote: extra.teamNote ?? '' }
}

/** 내 구단을 고를 때 보여 주는 구단 하나 */
export interface ClubChoice {
  /** 구단의 대표 팀(1군) 번호. 고르면 이 번호를 내 팀으로 기억한다 */
  teamId: number
  /** 구단 고유 번호(엠블럼). 모르면 0 */
  uid: number
  name: string
  short: string
  /** 나라 이름. 게임에 물어 알아 둔 것이 없으면 빈 글자 */
  nation: string
  women: boolean
  /** 1군 선수 수 */
  players: number
  /** 상위 22명의 현재 능력 평균(반올림). 구단 체급을 가늠하는 값 */
  strength: number
  /** 세이브 요약에 감독이 맡은 구단으로 적힌 곳 */
  human: boolean
}

export interface ClubChoices {
  ok: boolean
  message?: string
  clubs: ClubChoice[]
}

/** 에디터 반영 때 한 선수에서 값을 넣는 항목 */
export type EditorField = 'ca' | 'pa' | 'positions' | 'attributes'

export const EDITOR_FIELD_LABEL: Record<EditorField, string> = {
  ca: '현재 능력',
  pa: '잠재 능력',
  positions: '포지션 숙련도',
  attributes: '능력치'
}

/**
 * 한 선수의 반영 결과.
 * written: 게임이 돌려준 값이 보낸 값과 같아 들어간 것을 확인한 항목. failed: 들어가지 않았거나 확인하지 못한 항목.
 * skipped: 앞 선수에서 멈춰 보내지 않은 선수(값은 그대로다).
 */
export interface EditorPlayerResult {
  uid: number
  name: string
  status: 'written' | 'partial' | 'failed' | 'skipped'
  written: EditorField[]
  failed: EditorField[]
  /** 쓰다가 실패해 플러그인이 썼던 값을 원래대로 되돌린 항목(플러그인 0.13.0부터 알려 준다) */
  rolledBack?: EditorField[]
  /** 되돌림이 끝났는지. false면 되돌리지도 못해 게임에 값이 섞여 있을 수 있다. 모르면(옛 플러그인) 없다 */
  restored?: boolean
  /** 온라인(네트워크) 게임이라 플러그인이 쓰기를 막은 경우 */
  online?: boolean
  note?: string
}

export interface EditorApplyReport extends EditorApplyResult {
  /** 선수별 결과. 보낸 선수 순서대로. 값을 보내기 전에 막힌 경우(게임이 꺼져 있음 등)에는 모두 skipped다 */
  players?: EditorPlayerResult[]
}

/** 기존 Api에 더하는 창구 */
export interface ExtraApi {
  /** 세이브의 구단 목록(내 구단 고르기). 감독이 맡았던 구단을 맨 앞에 */
  worldClubs(): Promise<ClubChoices>
  /** 내 구단을 고른다. 그 세이브의 구단으로 기억하고 세이브를 다시 읽는다 */
  chooseTeam(teamId: number): Promise<{ ok: boolean; message: string }>
  /** 고친 값을 게임에 넣고 선수·항목별 결과를 받는다(editorApply와 같은 창구) */
  editorApplyReport(edits: EditorEdit[]): Promise<EditorApplyReport>
}
