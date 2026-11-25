import type { CellValue, SnapshotKind } from '@shared/types'

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso))
}

export const KIND_LABEL: Record<SnapshotKind, string> = {
  squad: '스쿼드',
  search: '선수 검색'
}

/** 세이브 파일에서 읽은 기록인지(게임에서 내보낸 CSV와 구분) */
export function isFromSave(fileName: string): boolean {
  return /\.fm$/i.test(fileName)
}

/** 능력치 값(1~20)을 네 단계로 나눈다: 1~7, 8~11, 12~15, 16~20 */
export function attrBand(value: number | null): string {
  if (value === null) return 'a1'
  if (value >= 16) return 'a4'
  if (value >= 12) return 'a3'
  if (value >= 8) return 'a2'
  return 'a1'
}

export function attrTitle(label: string, cell: CellValue | undefined): string {
  if (!cell || cell.raw === '') return `${label}: 값 없음`
  if (cell.range) {
    return `${label}: ${cell.range[0]}~${cell.range[1]} (스카우트 정보 부족, 중간값 ${cell.num}로 계산)`
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
  if (cell.range) return `${cell.range[0]}–${cell.range[1]}`
  return cell.raw
}
