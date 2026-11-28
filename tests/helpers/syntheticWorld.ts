/**
 * 합성 골든(tests/golden.test.ts)이 쓰는 지어낸 자료: 정해진 씨앗으로 늘 같은 선수단 줄과 같은 세이브 세계를 만든다.
 * 선수와 구단 이름은 모두 지어낸 것이다(공개 저장소). 세이브 파일이나 게임 자료는 읽지 않는다.
 *
 * 만드는 꼴은 지금 시험 파일에서 복사했다(고치지 않는다): 선수단 줄은 tests/tactic.test.ts의 player(),
 * 세이브 세계와 서비스는 tests/world5.test.ts의 build()와 service(), 후보 찾기 요청은 tests/helpers/baselineWorld.ts의 groupQuery().
 * 2단계 뒤에 그 파일들이 바뀌어도 이 골든은 바뀌지 않는다(옛 14역할로 못 박은 기준이다).
 *
 * 일부러 넣은 경우: 숙련 20·16·12·9인 선수, 숙련 숫자가 없는 줄, 31세 이상 주전, 23세 이하 후계자, 골키퍼 5명(세이브 쪽은 구단마다 3명),
 * 임대로 온 선수, 임대 보낸 선수, 여자 선수, 소속이 없는 선수, 다른 구단과 계약을 마친 선수, 계약이 끝난 선수, 소속 구단을 모르는 선수,
 * 임시 주전(숙련 10~14)만 있는 자리, 아무도 뛸 수 없는 자리, 범위로 나온 능력치, 전술에 뛸 자리가 없는 선수.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from '../../src/main/save/reader'
import { NO_TEAM, SEX_FEMALE, SEX_MALE, type SaveWorld } from '../../src/main/save/world'
import { WorldService } from '../../src/main/worldService'
import { FIELDS } from '../../src/shared/fields'
import type { RoleNorms } from '../../src/shared/norms'
import { parsePositions, POSITION_KEYS } from '../../src/shared/positions'
import { DEFAULT_ROLE, ROLE_BY_ID, ROLES, type PositionKey } from '../../src/shared/roles'
import type { SlotGroup } from '../../src/shared/tactic'
import type { CellValue, ColumnInfo, PlayerRow } from '../../src/shared/types'
import { SAVE_ATTRIBUTE_ORDER, type CandidateCategory, type CandidateQuery } from '../../src/shared/world'

/** 정해진 씨앗에서 0 이상 1 미만의 수열을 만든다(mulberry32). 어느 환경에서나 같다 */
export function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

// ---------- (가) 선수단 줄: 내 팀 30명 ----------

/** 게임 속 오늘(계약이 얼마나 남았는지 셀 때 쓴다) */
export const SYNTHETIC_TODAY = { year: 2026, month: 7, day: 1 }

const ATTRIBUTE_FIELDS = FIELDS.filter((field) => field.isAttr)
const info = (header: string, field: string): ColumnInfo => ({ header, field, group: 'info', short: header, label: header, isAttr: false, numeric: field !== 'name' && field !== 'position' })

/** 선수단 표의 열: 이름, 포지션, 나이, 현재·잠재 능력, 계약 만료, 주급, 그리고 눈에 보이는 능력치 */
export const SQUAD_COLUMNS: ColumnInfo[] = [
  info('이름', 'name'),
  info('포지션', 'position'),
  info('나이', 'age'),
  info('현재 능력', 'ability'),
  info('잠재 능력', 'potential'),
  info('계약 만료', 'contractEnd'),
  info('주급', 'wage'),
  ...ATTRIBUTE_FIELDS.map((field): ColumnInfo => ({ header: field.label, field: field.id, group: field.group, short: field.short, label: field.label, isAttr: true, numeric: true }))
]

type RatingKey = (typeof POSITION_KEYS)[number]

interface SquadSpec {
  name: string
  /** 게임 표기("D (RC), WB (R)") */
  position: string
  /** 능력치 바탕(1~20). 이 선수의 포지션에 중요한 능력치는 더 높다 */
  level: number
  age: number
  ca: number
  pa: number
  /** 계약 만료(20290630 꼴). 없으면 null */
  end: number | null
  wage: number
  /** 포지션 숙련. 안 적은 자리는 1이고, 이 칸 자체가 없으면 숙련 숫자를 모르는 줄이다 */
  ratings?: Partial<Record<RatingKey, number>>
  /** 임대로 온 선수 */
  loan?: { end: { year: number; month: number; day: number }; from: string }
  /** 범위로 나온 능력치(스카우트 정보가 모자라 12-15 꼴) */
  ranged?: string[]
}

/**
 * 내 팀 30명. 포지션마다 둘 이상이 있게 하되, 일부러 비워 둔 자리가 있다.
 * - 왼쪽 윙백(WBL)은 자연스러운 선수가 없고 숙련 12~14인 선수만 있다(임시 주전).
 * - 오른쪽 윙백(WBR)은 숙련 10 이상인 선수가 없다(주전이 없는 자리).
 * - 숙련 숫자가 없는 줄이 둘 있다.
 */
const SQUAD: SquadSpec[] = [
  { name: '시험 선수 01', position: 'GK', level: 14, age: 35, ca: 138, pa: 138, end: 20260930, wage: 90000, ratings: { GK: 20 } },
  { name: '시험 선수 02', position: 'GK', level: 13, age: 21, ca: 126, pa: 160, end: 20290630, wage: 30000, ratings: { GK: 20 } },
  { name: '시험 선수 03', position: 'GK', level: 10, age: 27, ca: 108, pa: 112, end: 20280630, wage: 15000, ratings: { GK: 20 } },
  { name: '시험 선수 04', position: 'GK', level: 9, age: 19, ca: 96, pa: 150, end: 20300630, wage: 8000, ratings: { GK: 16 } },
  { name: '시험 선수 05', position: 'GK', level: 8, age: 31, ca: 94, pa: 94, end: 20270630, wage: 9000, ratings: { GK: 20 } },
  { name: '시험 선수 06', position: 'D (L)', level: 13, age: 25, ca: 132, pa: 140, end: 20290630, wage: 60000, ratings: { DL: 20, WBL: 12, ML: 9 } },
  { name: '시험 선수 07', position: 'D (L)', level: 11, age: 22, ca: 118, pa: 150, end: 20290630, wage: 25000, ratings: { DL: 18, WBL: 14, ML: 8 } },
  { name: '시험 선수 08', position: 'D (R)', level: 13, age: 33, ca: 128, pa: 128, end: 20261231, wage: 70000, ratings: { DR: 20, WBR: 9 } },
  { name: '시험 선수 09', position: 'D (R)', level: 12, age: 21, ca: 122, pa: 152, end: 20300630, wage: 22000, ratings: { DR: 19, MR: 11 } },
  { name: '시험 선수 10', position: 'D (C)', level: 14, age: 29, ca: 140, pa: 142, end: 20290630, wage: 95000, ratings: { DC: 20, DM: 12 } },
  { name: '시험 선수 11', position: 'D (C)', level: 13, age: 27, ca: 133, pa: 136, end: 20280630, wage: 75000, ratings: { DC: 20 } },
  { name: '시험 선수 12', position: 'D (C)', level: 12, age: 21, ca: 120, pa: 158, end: 20300630, wage: 20000, ratings: { DC: 17, DM: 10 } },
  { name: '시험 선수 13', position: 'D (C)', level: 11, age: 32, ca: 112, pa: 112, end: 20260401, wage: 40000, ratings: { DC: 20 } },
  { name: '시험 선수 14', position: 'D (LC)', level: 12, age: 26, ca: 124, pa: 126, end: 20290630, wage: 50000, ratings: { DL: 16, DC: 20, WBL: 10 } },
  { name: '시험 선수 15', position: 'M (L), AM (L)', level: 12, age: 24, ca: 126, pa: 134, end: 20290630, wage: 45000, ratings: { ML: 20, AML: 16, WBL: 13 } },
  { name: '시험 선수 16', position: 'M (R)', level: 12, age: 27, ca: 125, pa: 128, end: 20280630, wage: 44000, ratings: { MR: 20, WBR: 9, AMR: 12 }, loan: { end: { year: 2027, month: 6, day: 30 }, from: '시험 FC' } },
  { name: '시험 선수 17', position: 'DM', level: 13, age: 30, ca: 134, pa: 134, end: 20270630, wage: 85000, ratings: { DM: 20, MC: 15, DC: 11 } },
  { name: '시험 선수 18', position: 'DM', level: 11, age: 22, ca: 116, pa: 148, end: 20300630, wage: 18000, ratings: { DM: 20, MC: 12 } },
  { name: '시험 선수 19', position: 'M (C)', level: 14, age: 27, ca: 142, pa: 144, end: 20290630, wage: 110000, ratings: { MC: 20, DM: 14, AMC: 15 } },
  { name: '시험 선수 20', position: 'M (C)', level: 13, age: 28, ca: 135, pa: 136, end: 20280630, wage: 80000, ratings: { MC: 20, DM: 14 }, ranged: ['passing', 'vision'] },
  { name: '시험 선수 21', position: 'M (C)', level: 12, age: 31, ca: 124, pa: 124, end: 20261130, wage: 65000 },
  { name: '시험 선수 22', position: 'M (L)', level: 13, age: 25, ca: 130, pa: 136, end: 20290630, wage: 62000, ratings: { ML: 20, AML: 14, WBL: 12 } },
  { name: '시험 선수 23', position: 'M (R), AM (R)', level: 13, age: 26, ca: 131, pa: 134, end: 20290630, wage: 64000, ratings: { MR: 20, AMR: 16 } },
  { name: '시험 선수 24', position: 'AM (C)', level: 13, age: 26, ca: 133, pa: 138, end: 20290630, wage: 72000, ratings: { AMC: 20, MC: 12, ST: 11 }, ranged: ['finishing'] },
  { name: '시험 선수 25', position: 'AM (L)', level: 12, age: 20, ca: 122, pa: 165, end: 20300630, wage: 28000, ratings: { AML: 20, ML: 13 } },
  { name: '시험 선수 26', position: 'AM (R)', level: 13, age: 23, ca: 129, pa: 156, end: 20300630, wage: 52000, ratings: { AMR: 20, MR: 14 } },
  { name: '시험 선수 27', position: 'ST (C)', level: 14, age: 27, ca: 141, pa: 143, end: 20290630, wage: 105000, ratings: { ST: 20, AMC: 12 } },
  { name: '시험 선수 28', position: 'ST (C)', level: 13, age: 34, ca: 130, pa: 130, end: 20260630, wage: 88000, ratings: { ST: 20 } },
  { name: '시험 선수 29', position: 'ST (C)', level: 11, age: 19, ca: 105, pa: 160, end: 20300630, wage: 12000, ratings: { ST: 20, AMC: 9 } },
  { name: '시험 선수 30', position: 'M (C)', level: 12, age: 26, ca: 118, pa: 122, end: 20270630, wage: 20000 }
]

const num = (value: number): CellValue => ({ raw: String(value), num: value })

/** 지어낸 내 팀 30명의 표 줄(고유 번호는 9000001부터). 시드가 같으면 늘 같다 */
export function syntheticSquad(): PlayerRow[] {
  const draw = seeded(2026)
  return SQUAD.map((spec, p): PlayerRow => {
    const keeper = spec.position === 'GK'
    // 이 선수의 첫 포지션의 기본 역할에 걸린 능력치를 더 높게 둔다
    const weights = ROLE_BY_ID[DEFAULT_ROLE[parsePositions(spec.position)[0] as PositionKey]].weights
    const cells: Record<string, CellValue> = {
      이름: { raw: spec.name, num: null },
      포지션: { raw: spec.position, num: null },
      나이: num(spec.age),
      '현재 능력': num(spec.ca),
      '잠재 능력': num(spec.pa),
      '계약 만료': spec.end === null ? { raw: '', num: null } : num(spec.end),
      주급: num(spec.wage)
    }
    for (const field of ATTRIBUTE_FIELDS) {
      const goalkeeping = field.group === 'goalkeeping'
      // 골키퍼는 골키퍼 능력치가 높고 나머지는 낮다. 필드 선수는 반대로, 이 포지션 역할에 걸린 능력치를 더 높게 둔다
      const base = goalkeeping !== keeper ? 4 + Math.floor(draw() * 3) : spec.level + (weights[field.id] ?? 0) * 0.6 - 1.5 + (draw() * 5 - 2.5)
      const value = clamp(Math.round(base), 1, 20)
      cells[field.label] = spec.ranged?.includes(field.id) ? { raw: `${value - 1}-${value + 2}`, num: value + 0.5, range: [value - 1, value + 2] } : num(value)
    }
    const ratings = spec.ratings ? POSITION_KEYS.map((key) => spec.ratings![key] ?? 1) : undefined
    return { idx: 9_000_001 + p, name: spec.name, cells, ...(ratings ? { ratings } : {}), ...(spec.loan ? { loan: spec.loan } : {}) }
  })
}

/** 지어낸 역할별 기준 분포(14개 모두). 역할마다 값이 달라서 눈금이 다른 것이 결과에 드러난다 */
export function syntheticNorms(): RoleNorms {
  return Object.fromEntries(
    ROLES.map((role, i) => [
      role.id,
      { mu: 57 + (i % 5) * 1.7, sigma: 3.1 + (i % 4) * 0.45, beta: 0.24 + (i % 3) * 0.02, betaGrow: 0.26 + (i % 4) * 0.015, n: 240 + i * 13, caRef: 112, poolCa: 100 + (i % 3) * 5, shift: (i % 4) * 0.4 }
    ])
  )
}

/** 일부 역할만 기준 분포가 있는 경우(없는 역할은 고정 기준으로 대신한다) */
export function partialNorms(): RoleNorms {
  const all = syntheticNorms()
  return Object.fromEntries(Object.entries(all).filter((_, i) => i % 2 === 0))
}

/** 사용자가 고친 역할 가중치의 예(센터백의 대인 마크 5, 태클 끔, 침착성 3 / 스트라이커의 골 결정력 1 / 골키퍼의 반사 신경 끔) */
export const EDITED_WEIGHTS: Record<string, Record<string, number>> = { cb: { marking: 5, tackling: 0, composure: 3 }, st: { finishing: 1 }, gk: { reflexes: 0 } }

// ---------- (나) 세이브 세계: 선수 370명 남짓 ----------

const CLUB_NAMES = ['가온 시티', '나루 유나이티드', '다온 FC', '라온 타운', '마루 스포츠', '바다 FC', '사랑 시티', '아람 유나이티드', '자람 FC', '차오름 타운', '카누 FC', '여울 걸스']
/** 구단마다 1군 28명의 포지션 */
const ROSTER: PositionKey[] = ['GK', 'GK', 'GK', 'DL', 'DL', 'DR', 'DR', 'DC', 'DC', 'DC', 'DC', 'WBL', 'WBR', 'DM', 'DM', 'MC', 'MC', 'MC', 'ML', 'MR', 'AML', 'AMR', 'AMC', 'AMC', 'ST', 'ST', 'ST', 'ST']
/** 자연스러운 자리 말고 어느 자리를 어느 정도 뛰는가 */
const NEIGHBORS: Record<PositionKey, PositionKey[]> = {
  GK: [],
  DL: ['WBL', 'ML'],
  DR: ['WBR', 'MR'],
  DC: ['DM'],
  WBL: ['DL', 'ML'],
  WBR: ['DR', 'MR'],
  DM: ['MC', 'DC'],
  MC: ['DM', 'AMC'],
  ML: ['WBL', 'AML'],
  MR: ['WBR', 'AMR'],
  AML: ['ML', 'ST'],
  AMR: ['MR', 'ST'],
  AMC: ['MC', 'ST'],
  ST: ['AMC']
}
const POSITION_AT = new Map<string, number>(POSITION_KEYS.map((key, i) => [key, i]))
const ATTRIBUTE_AT = new Map<string, number>(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))
const GOALKEEPING = new Set(ATTRIBUTE_FIELDS.filter((field) => field.group === 'goalkeeping').map((field) => field.id))

interface Draft {
  name: string
  team: number
  club: number
  position: PositionKey
  ca: number
  age: number
  sex?: number
  status?: number
  wage?: number
  end?: number
  loanFrom?: number
  contractTeam?: number
}

/** 세이브 세계의 "게임 속 오늘"(1월 3일)과 먼 계약 */
const TODAY = { year: 2026, day: 3 }

/**
 * 지어낸 세이브 세계. 팀 100이 내 1군(구단 0)이고, 구단 0~10의 1군(팀 100, 200, ..., 1100)은 28명씩, 여자 구단(11)은 22명이다.
 * 내 구단의 2군(팀 101) 12명, 소속 구단을 모르는 팀(1300) 10명, 소속이 없는 선수 17명(자유 계약 12, 다른 구단과 계약을 마침 3, 계약이 끝남 2)과
 * 임대 선수 여럿이 있다. 모두 정해진 씨앗에서 나온다.
 */
export function syntheticWorld(): SaveWorld {
  const draw = seeded(77)
  const drafts: Draft[] = []
  const strength = [140, 150, 146, 138, 133, 130, 128, 124, 120, 116, 112]
  for (let club = 0; club <= 10; club++) {
    const team = 100 + club * 100
    ROSTER.forEach((position) => {
      const ca = Math.round(strength[club] + (draw() * 36 - 20))
      drafts.push({ name: '', team, club, position, ca: clamp(ca, 60, 190), age: 17 + Math.floor(draw() * 20) })
    })
  }
  // 내 구단 2군: 아직 어린 선수들
  ROSTER.slice(0, 12).forEach((position) => drafts.push({ name: '', team: 101, club: 0, position, ca: 80 + Math.floor(draw() * 25), age: 16 + Math.floor(draw() * 4) }))
  // 여자 구단: 기준 분포와 후보에서 빠진다
  ROSTER.slice(3, 25).forEach((position) => drafts.push({ name: '', team: 1200, club: 11, position, ca: 100 + Math.floor(draw() * 40), age: 18 + Math.floor(draw() * 14), sex: SEX_FEMALE }))
  // 소속 구단을 알아내지 못한 팀
  ROSTER.slice(8, 18).forEach((position) => drafts.push({ name: '', team: 1300, club: -1, position, ca: 110 + Math.floor(draw() * 40), age: 19 + Math.floor(draw() * 14) }))
  // 소속이 없는 선수: 자유 계약 12, 다른 구단과 계약을 마침 3, 계약이 끝남 2
  const FUTURE = 2029 * 1000 + 181
  const free: PositionKey[] = ['GK', 'DC', 'DC', 'DL', 'DR', 'MC', 'MC', 'AML', 'AMR', 'ST', 'ST', 'DM']
  free.forEach((position) => drafts.push({ name: '', team: NO_TEAM, club: -1, position, ca: 100 + Math.floor(draw() * 55), age: 20 + Math.floor(draw() * 15), wage: 0, end: 0, contractTeam: NO_TEAM }))
  for (const position of ['DC', 'MC', 'ST'] as PositionKey[]) {
    drafts.push({ name: '', team: NO_TEAM, club: -1, position, ca: 140 + Math.floor(draw() * 10), age: 24, wage: 18_398, end: FUTURE, contractTeam: 200 })
  }
  for (const position of ['DC', 'AMC'] as PositionKey[]) {
    drafts.push({ name: '', team: NO_TEAM, club: -1, position, ca: 135 + Math.floor(draw() * 10), age: 26, wage: 15_000, end: 2025 * 1000 + 100, contractTeam: 200 })
  }
  // 임대: 내가 데려온 선수(원 소속 400), 내 2군에서 올라온 선수(원 소속 101), 내가 보낸 선수(지금 팀 300, 원 소속 100), 다른 구단 사이의 임대
  drafts.push({ name: '', team: 100, club: 0, position: 'MC', ca: 128, age: 24, loanFrom: 400 })
  drafts.push({ name: '', team: 100, club: 0, position: 'ST', ca: 122, age: 19, loanFrom: 101 })
  drafts.push({ name: '', team: 300, club: 2, position: 'DC', ca: 148, age: 25, loanFrom: 100 })
  drafts.push({ name: '', team: 300, club: 2, position: 'AMR', ca: 156, age: 22, loanFrom: 400 })
  drafts.push({ name: '', team: 500, club: 4, position: 'DM', ca: 141, age: 27, loanFrom: 700 })
  drafts.push({ name: '', team: 800, club: 7, position: 'ST', ca: 133, age: 20, loanFrom: 200 })

  const count = drafts.length
  const world: SaveWorld = {
    count,
    names: drafts.map((_, k) => `시험 선수 ${String(k + 1).padStart(3, '0')}`),
    uids: Uint32Array.from(drafts, (_, k) => 1000 + k),
    teamIds: Uint32Array.from(drafts, (each) => each.team),
    club: Int32Array.from(drafts, (each) => each.club),
    clubs: CLUB_NAMES.map((name, i) => ({ uid: 9000 + i, name, short: name.split(' ')[0], women: i === 11 })),
    ca: Uint16Array.from(drafts, (each) => each.ca),
    pa: Uint16Array.from(drafts, (each) => clamp(each.ca + (each.age <= 23 ? 5 + Math.floor(draw() * 30) : Math.floor(draw() * 7)), 1, 200)),
    value: Uint32Array.from(drafts, (each) => 1_000_000 + each.ca * 30_000 + Math.floor(draw() * 400_000)),
    wage: Uint32Array.from(drafts, (each) => each.wage ?? 20_000 + each.ca * 100 + Math.floor(draw() * 9_000)),
    contractEnd: Uint32Array.from(drafts, (each) => each.end ?? (2026 + Math.floor(draw() * 5)) * 1000 + 100 + Math.floor(draw() * 260)),
    loanFrom: Uint32Array.from(drafts, (each) => each.loanFrom ?? NO_TEAM),
    contractTeam: Uint32Array.from(drafts, (each) => each.contractTeam ?? each.loanFrom ?? each.team),
    squadStatus: Uint8Array.from(drafts, () => [1, 2, 3, 3, 4, 4, 5, 7, 9][Math.floor(draw() * 9)]),
    nationId: new Uint16Array(count),
    sex: Uint8Array.from(drafts, (each) => each.sex ?? SEX_MALE),
    birthYear: Uint16Array.from(drafts, (each) => 2026 - each.age),
    birthDay: new Uint16Array(count).fill(1),
    positions: new Uint8Array(count * POSITION_COUNT).fill(1),
    attributes: new Uint8Array(count * ATTRIBUTE_COUNT),
    teamId: 100,
    gameDate: TODAY
  }
  drafts.forEach((each, k) => {
    // 숙련: 자연스러운 자리는 대개 20(가끔 16~19), 이웃 자리는 8~19에서 하나나 둘
    world.positions[k * POSITION_COUNT + POSITION_AT.get(each.position)!] = draw() < 0.7 ? 20 : 16 + Math.floor(draw() * 4)
    for (const neighbor of NEIGHBORS[each.position]) {
      if (draw() < 0.7) world.positions[k * POSITION_COUNT + POSITION_AT.get(neighbor)!] = 8 + Math.floor(draw() * 12)
    }
    // 능력치: 현재 능력으로 바탕을 정하고, 이 포지션의 기본 역할에 걸린 능력치를 더 높게 둔다. 골키퍼 능력치는 골키퍼만 높다
    const role = ROLE_BY_ID[DEFAULT_ROLE[each.position]]
    const level = clamp((each.ca - 60) / 6.5, 1, 20)
    for (const id of SAVE_ATTRIBUTE_ORDER) {
      const goalkeeping = GOALKEEPING.has(id)
      const base = goalkeeping !== (each.position === 'GK') ? 3 + draw() * 4 : level + (role.weights[id] ?? 0) * 0.7 - 1.5 + (draw() * 6 - 3)
      world.attributes[k * ATTRIBUTE_COUNT + ATTRIBUTE_AT.get(id)!] = clamp(Math.round(base), 1, 20) * 5
    }
  })
  return world
}

// ---------- 서비스와 후보 찾기 요청 ----------

/** 세이브 세계를 끼운 WorldService(임대 기록은 믿는 것으로 정해 둔다). 이름 저장소는 임시 폴더이고, 만든 폴더를 함께 돌려준다 */
export function syntheticService(world: SaveWorld, roleWeights: Record<string, Record<string, number>> = {}): { ws: WorldService; namesDir: string } {
  const namesDir = mkdtempSync(join(tmpdir(), 'fmb-golden-names-'))
  const ws = new WorldService({
    knownTeam: () => 100,
    rosterNames: () => [],
    rememberTeam: () => undefined,
    roleWeights: () => roleWeights,
    namesDir
  })
  ;(ws as unknown as { loaded: unknown }).loaded = { path: '가상.fm', mtimeMs: 1, size: 1, world, byUid: new Map(), live: null, note: '' }
  // 임대 기록을 믿으려면 세이브 전체에서 임대가 100명 넘게 읽혀야 한다. 시험 세계는 작아서 믿는 것으로 정해 둔다
  const index = (ws as unknown as { loanIndex(world: SaveWorld): { trusted: boolean } }).loanIndex(world)
  index.trusted = true
  return { ws, namesDir }
}

/** 자리 묶음 하나, 유형 하나의 후보 찾기 요청. widest가 참이면 자격 없는 선수와 소속 모르는 구단 선수도 넣는 가장 넓은 조건 */
export function groupAsk(group: SlotGroup, formation: string, category: CandidateCategory, widest = false): CandidateQuery {
  return {
    roleId: group.roleId,
    category,
    maxAge: null,
    onlyEligible: !widest,
    includeUnknownClub: widest,
    search: '',
    expiringWithinMonths: null,
    slot: { formation, slotRoles: {}, index: group.slots[0] }
  }
}

/** 역할만 고른 후보 찾기 요청(전술의 자리를 기준으로 하지 않는다) */
export function roleAsk(roleId: string, category: CandidateCategory, over: Partial<CandidateQuery> = {}): CandidateQuery {
  return { roleId, category, maxAge: null, onlyEligible: true, includeUnknownClub: false, search: '', expiringWithinMonths: null, ...over }
}
