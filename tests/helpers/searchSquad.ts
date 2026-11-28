/**
 * 전술 추천 시험(tests/tacticSearch*.test.ts)이 쓰는 지어낸 선수단과 고정 기준 분포. 세이브나 게임 자료를 읽지 않는다.
 * 선수 이름은 모두 지어낸 것이다(공개 저장소). 같은 씨앗이면 늘 같은 선수단이 나온다.
 */
import { FIELDS } from '../../src/shared/fields'
import type { RoleNorms } from '../../src/shared/norms'
import { positionsLabel, POSITION_KEYS } from '../../src/shared/positions'
import type { RoleCatalog } from '../../src/shared/roleCatalog'
import type { PositionKey } from '../../src/shared/roles'
import type { SlotProfile } from '../../src/shared/slotProfile'
import type { CellValue, ColumnInfo, PlayerRow } from '../../src/shared/types'

/** 씨앗에서 0 이상 1 미만의 수열을 만든다(mulberry32) */
export function seededDraw(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ATTRIBUTES = FIELDS.filter((field) => field.isAttr)
const info = (header: string, field: string): ColumnInfo => ({ header, field, group: 'info', short: header, label: header, isAttr: false, numeric: field !== 'name' && field !== 'position' })

/** 선수단 표의 열: 이름, 포지션, 나이, 현재 능력, 그리고 능력치 47개 */
export const SEARCH_COLUMNS: ColumnInfo[] = [
  info('이름', 'name'),
  info('포지션', 'position'),
  info('나이', 'age'),
  info('현재 능력', 'ability'),
  ...ATTRIBUTES.map((field): ColumnInfo => ({ header: field.label, field: field.id, group: field.group, short: field.short, label: field.label, isAttr: true, numeric: true }))
]

/** 포지션마다 몇 명을 두는가(합 52명) */
const HEADCOUNT: Array<[PositionKey, number]> = [
  ['GK', 4], ['DL', 3], ['DC', 7], ['DR', 3], ['WBL', 2], ['WBR', 2], ['DM', 4], ['ML', 3], ['MC', 6], ['MR', 3], ['AML', 3], ['AMC', 3], ['AMR', 3], ['ST', 6]
]
/** 그 포지션 선수가 보조로 뛰는 포지션(숙련을 10~18로 준다) */
const NEIGHBORS: Record<PositionKey, PositionKey[]> = {
  GK: [], DL: ['WBL', 'ML'], DC: ['DM'], DR: ['WBR', 'MR'], WBL: ['DL', 'ML'], WBR: ['DR', 'MR'], DM: ['MC', 'DC'], ML: ['WBL', 'AML'], MC: ['DM', 'AMC'], MR: ['WBR', 'AMR'],
  AML: ['ML', 'ST'], AMC: ['MC', 'ST'], AMR: ['MR', 'ST'], ST: ['AMC']
}
/** 선수마다 한 가지 색(잘하는 능력치 묶음). 같은 포지션이어도 어울리는 역할이 갈리게 한다 */
const STYLES: string[][] = [
  ['passing', 'vision', 'technique', 'firstTouch', 'decisions', 'composure'],
  ['strength', 'stamina', 'pace', 'acceleration', 'jumping', 'bravery'],
  ['tackling', 'marking', 'positioning', 'anticipation', 'concentration', 'aggression'],
  ['finishing', 'offTheBall', 'dribbling', 'flair', 'longShots', 'crossing']
]
const GOALKEEPING = new Set(ATTRIBUTES.filter((field) => field.group === 'goalkeeping').map((field) => field.id))
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))
const num = (value: number): CellValue => ({ raw: String(value), num: value })

/**
 * 지어낸 선수단 52명(고유 번호 9100001부터). 모든 포지션에 둘 이상이 있고, 선수마다 숙련 숫자가 있다.
 * 골키퍼는 골키퍼 능력치만 높고 나머지는 낮다. shuffle이 참이면 줄 순서만 바꾼다(번호는 그대로).
 */
export function searchSquad(seed = 31, shuffle = false): PlayerRow[] {
  const draw = seededDraw(seed)
  const rows: PlayerRow[] = []
  for (const [position, count] of HEADCOUNT) {
    for (let at = 0; at < count; at++) {
      const idx = 9_100_001 + rows.length
      const style = STYLES[Math.floor(draw() * STYLES.length)]
      const level = 7 + draw() * 7
      const ratings = POSITION_KEYS.map((key) => {
        if (key === position) return draw() < 0.7 ? 20 : 16 + Math.floor(draw() * 4)
        return NEIGHBORS[position].includes(key as PositionKey) && draw() < 0.6 ? 10 + Math.floor(draw() * 9) : 1
      })
      const name = `시험 선수 ${String(rows.length + 1).padStart(2, '0')}`
      const cells: Record<string, CellValue> = {
        이름: { raw: name, num: null },
        포지션: { raw: positionsLabel(ratings), num: null },
        나이: num(19 + Math.floor(draw() * 16)),
        '현재 능력': num(100 + Math.floor(draw() * 60))
      }
      for (const field of ATTRIBUTES) {
        const keeper = position === 'GK'
        const base = GOALKEEPING.has(field.id) !== keeper ? 3 + draw() * 3 : level + (style.includes(field.id) ? 3.5 : 0) + (draw() * 5 - 2.5)
        cells[field.label] = num(clamp(Math.round(base), 1, 20))
      }
      rows.push({ idx, name, cells, ratings })
    }
  }
  if (!shuffle) return rows
  const order = seededDraw(seed + 1)
  return rows
    .map((row) => ({ row, key: order() }))
    .sort((a, b) => a.key - b.key)
    .map((each) => each.row)
}

/**
 * 포지션마다 한 명씩만 두는 선수단: 선수는 자기 포지션에서만 숙련 20이고 다른 포지션은 1이라서, 포지션이 모두 다른 전술이면 배정이 하나로 정해진다
 * (누가 어느 자리의 주전인지가 역할 짝에 따라 바뀌지 않는다). 능력치는 6~17에서 씨앗대로 흩어진다.
 */
export function soloSquad(positions: PositionKey[], seed = 5): PlayerRow[] {
  const draw = seededDraw(seed)
  return positions.map((position, at): PlayerRow => {
    const ratings = POSITION_KEYS.map((key) => (key === position ? 20 : 1))
    const name = `시험 선수 ${String(at + 1).padStart(2, '0')}`
    const cells: Record<string, CellValue> = {
      이름: { raw: name, num: null },
      포지션: { raw: positionsLabel(ratings), num: null },
      나이: num(25),
      '현재 능력': num(130)
    }
    for (const field of ATTRIBUTES) {
      const keeper = position === 'GK'
      cells[field.label] = num(GOALKEEPING.has(field.id) !== keeper ? 4 : 6 + Math.floor(draw() * 12))
    }
    return { idx: 9_200_001 + at, name, cells, ratings }
  })
}

/** 문자열을 32비트 수로(FNV-1a) */
function hashOf(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  return hash
}

/**
 * 고정 기준 분포: 프로파일 열쇠에서만 정해지는 평균·표준편차(평균 54~63, 표준편차 3~5.4). 같은 열쇠는 늘 같은 값이고, 요청 차례나 묶음과 상관없다.
 * 호출 기록을 남기려면 calls를 준다(부를 때마다 받은 열쇠 목록을 더한다).
 */
export function fixedNorms(catalog: RoleCatalog, calls?: string[][]): (profiles: SlotProfile[]) => RoleNorms {
  return (profiles) => {
    const norms: RoleNorms = {}
    const keys: string[] = []
    for (const profile of profiles) {
      const key = catalog.normKey(profile)
      keys.push(key)
      const hash = hashOf(key)
      norms[key] = { mu: 54 + (hash % 90) / 10, sigma: 3 + ((hash >>> 8) % 25) / 10, beta: 0.25, n: 300, caRef: 110 }
    }
    calls?.push(keys)
    return norms
  }
}

/** 모든 프로파일이 같은 기준 분포인 경우(역할 사이의 눈금 차이가 없을 때의 선호를 본다) */
export function flatNorms(catalog: RoleCatalog): (profiles: SlotProfile[]) => RoleNorms {
  return (profiles) => Object.fromEntries(profiles.map((profile) => [catalog.normKey(profile), { mu: 58, sigma: 4, beta: 0.25, n: 300, caRef: 110 }]))
}
