import type { PositionKey } from './roles'

/**
 * 포메이션 5개의 정의. depth.ts에 있던 것을 옮겼다: 전술 모델(tacticModel.ts)과 배정 엔진(depth.ts)이 서로를 불러오지 않고
 * 둘 다 이 파일을 읽게 하려는 것이다(순환 방지). depth.ts는 같은 이름으로 다시 내보내므로 부르는 쪽은 바꾸지 않아도 된다.
 *
 * 자리 순서가 곧 배정의 동점 처리 순서라서 순서를 바꾸지 않는다(위에서 아래로, 줄 안은 왼쪽에서 오른쪽으로).
 * 이 모듈은 위치 이름 타입 말고는 다른 모듈을 불러오지 않는다.
 */

export interface Formation {
  id: string
  label: string
  /** 위(공격)에서 아래(골키퍼)로, 각 줄은 왼쪽에서 오른쪽으로 */
  rows: PositionKey[][]
}

export const FORMATIONS: Formation[] = [
  { id: '4-2-3-1', label: '4-2-3-1', rows: [['ST'], ['AML', 'AMC', 'AMR'], ['DM', 'DM'], ['DL', 'DC', 'DC', 'DR'], ['GK']] },
  { id: '4-3-3', label: '4-3-3', rows: [['ST'], ['AML', 'AMR'], ['MC', 'MC'], ['DM'], ['DL', 'DC', 'DC', 'DR'], ['GK']] },
  { id: '4-4-2', label: '4-4-2', rows: [['ST', 'ST'], ['ML', 'MC', 'MC', 'MR'], ['DL', 'DC', 'DC', 'DR'], ['GK']] },
  { id: '3-5-2', label: '3-5-2', rows: [['ST', 'ST'], ['MC', 'MC'], ['WBL', 'DM', 'WBR'], ['DC', 'DC', 'DC'], ['GK']] },
  { id: '3-4-3', label: '3-4-3', rows: [['AML', 'ST', 'AMR'], ['MC', 'MC'], ['WBL', 'WBR'], ['DC', 'DC', 'DC'], ['GK']] }
]

export const FORMATION_BY_ID: Record<string, Formation> = Object.fromEntries(FORMATIONS.map((f) => [f.id, f]))
