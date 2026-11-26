/** 선수 정보 화면이 쓰는 순수한 도우미들(값을 글자와 단계로 바꾸는 일) */

import { FIELDS } from './fields'
import { HIDDEN_ATTRIBUTE_LABEL, SAVE_ATTRIBUTE_ORDER, type ProfileAttribute, type SaveAttributeId } from './world'

/** 포지션 숙련도(1~20)의 단계: 20 주 포지션, 15~19 능숙, 10~14 어느 정도, 그 아래 서툼 */
export type PositionLevel = 'main' | 'good' | 'fair' | 'poor'

export function positionLevel(rating: number): PositionLevel {
  if (rating >= 20) return 'main'
  if (rating >= 15) return 'good'
  if (rating >= 10) return 'fair'
  return 'poor'
}

export const POSITION_LEVEL_LABEL: Record<PositionLevel, string> = {
  main: '주 포지션',
  good: '능숙',
  fair: '어느 정도',
  poor: '서툼'
}

/** 포지션 한 자리의 쉬운 이름(세이브의 순서 POSITION_KEYS와 같은 키) */
export const POSITION_NAME: Record<string, string> = {
  GK: '골키퍼',
  SW: '스위퍼',
  DL: '왼쪽 수비수',
  DC: '중앙 수비수',
  DR: '오른쪽 수비수',
  DM: '수비형 미드필더',
  ML: '왼쪽 미드필더',
  MC: '중앙 미드필더',
  MR: '오른쪽 미드필더',
  AML: '왼쪽 공격형 미드필더',
  AMC: '중앙 공격형 미드필더',
  AMR: '오른쪽 공격형 미드필더',
  ST: '스트라이커',
  WBL: '왼쪽 윙백',
  WBR: '오른쪽 윙백'
}

/** 능력치(1~20)를 말로 */
export function abilityWord(value: number): string {
  if (value >= 16) return '뛰어남'
  if (value >= 11) return '좋음'
  if (value >= 6) return '보통'
  return '약함'
}

/** 발 능력(1~20)을 말로 */
export function footWord(value: number): string {
  if (value >= 18) return '매우 강함'
  if (value >= 15) return '강함'
  if (value >= 10) return '보통'
  if (value >= 6) return '약함'
  return '매우 약함'
}

export interface FootSummary {
  /** 주발: "오른발", "왼발", "양발" */
  main: string
  mainNote: string
  /** 약발. 양발이면 null */
  weak: string | null
  weakNote: string
}

/** 왼발·오른발 능력(1~20)에서 주발과 약발을 가린다 */
export function footSummary(left: number, right: number): FootSummary {
  if (Math.min(left, right) >= 15 && Math.abs(left - right) <= 2) {
    return { main: '양발', mainNote: '양쪽 모두 강함', weak: null, weakNote: '' }
  }
  const rightMain = right >= left
  const strong = rightMain ? right : left
  const weak = rightMain ? left : right
  return {
    main: rightMain ? '오른발' : '왼발',
    mainNote: footWord(strong),
    weak: rightMain ? '왼발' : '오른발',
    weakNote: footWord(weak)
  }
}

/** 파운드 금액을 짧게. 모르면 빈 글자 */
export function formatPounds(value: number | null | undefined): string {
  if (!value || value <= 0) return ''
  if (value >= 10_000_000) return `£${Math.round(value / 1_000_000)}M`
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `£${Math.round(value / 1_000)}K`
  return `£${value}`
}

export function formatDate(date: { year: number; month: number; day: number } | null): string {
  return date ? `${date.year}년 ${date.month}월 ${date.day}일` : ''
}

export interface HiddenHelp {
  /** 값이 높을수록 좋은지 */
  higherIsBetter: boolean
  /** 한 줄 설명 */
  help: string
}

/** 게임 화면에는 안 보이는 능력치의 뜻. 부상 빈도와 비매너 플레이는 낮을수록 좋다. */
export const HIDDEN_HELP: Partial<Record<SaveAttributeId, HiddenHelp>> = {
  consistency: { higherIsBetter: true, help: '높을수록 경기마다 꾸준히 제 실력을 냅니다.' },
  importantMatches: { higherIsBetter: true, help: '높을수록 결승 같은 큰 경기에서 잘합니다.' },
  injuryProneness: { higherIsBetter: false, help: '낮을수록 부상을 덜 당합니다.' },
  versatility: { higherIsBetter: true, help: '높을수록 여러 포지션과 전술에 잘 적응합니다.' },
  dirtiness: { higherIsBetter: false, help: '낮을수록 깨끗하게 뜁니다. 높으면 반칙과 경고가 잦습니다.' }
}

/** 값(1~20)이 선수에게 좋은 쪽인지 나쁜 쪽인지에 맞춘 단계(a1 나쁨 ~ a4 뛰어남). 낮을수록 좋은 값은 뒤집는다 */
export function hiddenBand(value: number, higherIsBetter: boolean): 'a1' | 'a2' | 'a3' | 'a4' {
  const good = higherIsBetter ? value : 21 - value
  if (good >= 16) return 'a4'
  if (good >= 11) return 'a3'
  if (good >= 6) return 'a2'
  return 'a1'
}

/** 현재 능력과 잠재 능력에서 "성장 여지". 10 이상일 때만 숫자를, 아니면 null */
export function growthRoom(ca: number, pa: number): number | null {
  const room = pa - ca
  return room >= 10 ? room : null
}

const ATTRIBUTE_AT = new Map<string, number>(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))

/** 포지션 숙련도에서 골키퍼인지: 골키퍼 자리가 능숙 이상이면 골키퍼로 본다 */
export function isGoalkeeper(positions: number[]): boolean {
  return (positions[0] ?? 0) >= 15
}

/**
 * 게임 표시값 54개(SAVE_ATTRIBUTE_ORDER 순서)에서 화면에 보이는 능력치를 묶어 준다.
 * 필드 선수는 기술 → 정신 → 신체, 골키퍼는 골키퍼 → 정신 → 신체. 반대 쪽 묶음은 넣지 않는다.
 */
export function visibleAttributes(shown: number[], goalkeeper: boolean): ProfileAttribute[] {
  const skip = goalkeeper ? 'technical' : 'goalkeeping'
  const rank = (group: string): number => (group === 'technical' || group === 'goalkeeping' ? 0 : group === 'mental' ? 1 : 2)
  return FIELDS.filter((field) => field.isAttr && field.group !== skip)
    .map((field) => ({
      id: field.id,
      label: field.label,
      group: field.group as ProfileAttribute['group'],
      value: shown[ATTRIBUTE_AT.get(field.id) ?? -1] ?? 1
    }))
    .sort((a, b) => rank(a.group) - rank(b.group))
}

/** 게임 화면에는 안 보이는 능력치(일관성 등) */
export function hiddenAttributes(shown: number[]): Array<{ id: string; label: string; value: number }> {
  return (Object.keys(HIDDEN_ATTRIBUTE_LABEL) as SaveAttributeId[]).map((id) => ({
    id,
    label: HIDDEN_ATTRIBUTE_LABEL[id]!,
    value: shown[ATTRIBUTE_AT.get(id)!] ?? 1
  }))
}

/** 왼발·오른발 능력(게임 표시값 1~20) */
export function footValues(shown: number[]): { left: number; right: number } {
  return { left: shown[ATTRIBUTE_AT.get('leftFoot')!] ?? 1, right: shown[ATTRIBUTE_AT.get('rightFoot')!] ?? 1 }
}

/** 사진이 없는 자리에 쓰는 머리글자. 한글 이름은 첫 글자, 영문 이름은 성과 이름의 첫 글자 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = Array.from(words[0])[0] ?? '?'
  if (/[가-힣]/.test(first) || words.length === 1) return first.toUpperCase()
  const last = Array.from(words[words.length - 1])[0] ?? ''
  return (first + last).toUpperCase()
}
