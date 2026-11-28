import { rangeText } from '@shared/numberFormat'
import type { CellValue } from '@shared/types'

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso))
}

/** 능력치 값(1~20)을 네 단계로 나눈다: 1~5 약함, 6~10 보통, 11~15 좋음, 16~20 뛰어남. 값이 없으면 빈 글자 */
export function attrBand(value: number | null): string {
  if (value === null) return ''
  if (value >= 16) return 'a4'
  if (value >= 11) return 'a3'
  if (value >= 6) return 'a2'
  return 'a1'
}

/** 능력치 단계의 이름(풍선 도움말과 범례에 쓴다) */
export const BAND_LABEL: Record<string, string> = { a1: '약함', a2: '보통', a3: '좋음', a4: '뛰어남' }

export function attrTitle(label: string, cell: CellValue | undefined): string {
  if (!cell || cell.raw === '') return `${label}: 정보 없음`
  if (cell.range) {
    return `${label}: ${rangeText(cell.range[0], cell.range[1])} (스카우트 정보 부족, 중간값 ${cell.num}로 계산)`
  }
  return `${label}: ${cell.raw}`
}

/** 능력치가 아닌 칸의 표시. 쉼표 소수(2,5)는 점 소수(2.5)로 바꿔 보여 준다. */
export function plainText(cell: CellValue | undefined): string {
  if (!cell || cell.raw === '') return '–'
  if (cell.num !== null && /^-?\d+,\d{1,2}$/.test(cell.raw)) return String(cell.num)
  return cell.raw
}

export function attrText(cell: CellValue | undefined): string {
  if (!cell || cell.raw === '') return '–'
  if (cell.range) return rangeText(cell.range[0], cell.range[1])
  return cell.raw
}

/** 파일 크기를 MB·GB로 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GB`
  return `${Math.round(bytes / 1024 ** 2)}MB`
}
