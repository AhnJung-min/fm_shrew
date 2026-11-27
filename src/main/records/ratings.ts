import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { POSITION_KEYS } from '@shared/positions'
import { groupOfKey, GROWTH_GROUPS } from './growth'
import { RATINGS_FILE, type RecordStore } from './store'

/**
 * 경기 평점 기록(F-10 기록, 앱 쪽). 플러그인이 내 팀의 끝난 경기마다 한 줄(JSON)을 plugin 기록 폴더의 ratings.jsonl에 덧붙인다.
 * 앱은 새로 생긴 줄만 읽어, 적용한 세이브의 내 팀 경기를 그 세이브의 기록 폴더(ratings.jsonl)에 옮겨 적는다.
 *
 * 줄 형식 v1:
 *   {"v":1,"gameDate":"2025-12-30","comp":"<대회 이름>","compUid":11,
 *    "home":{"id":533,"uid":676,"name":"<구단>","goals":3},"away":{"id":528,"uid":671,"name":"<구단>","goals":1},
 *    "myTeamId":533,"full":90,
 *    "players":[{"uid":19058734,"side":"home","pos":1,"min":90,"rating":6.49,"inc":0,"t":0,"slot":0}]}
 * - id는 팀 기록 번호로, 앱의 world.teamId와 같은 수다(myTeamId와 견준다). uid는 게임의 고유 번호(덤). 모두 모르면 null.
 * - full은 경기 시간(분. 연장이면 120). 안 뛴 후보는 적지 않는다.
 * - pos는 PositionMask 비트(positionFromMask). min은 뛴 시간(분), 모르면 null. rating은 소수 둘째 자리까지.
 * - inc(게임의 IncidentType: 0 없음, 1 교체 투입, 2 교체 아웃), t(그 분), slot(선발 칸 번호, 이미 나갔으면 -1)은 나중에 확인하려고 그대로 둔 값이다.
 */

export interface RatingPlayer {
  uid: number | null
  side: 'home' | 'away'
  /** PositionMask. 0이면 모름 */
  pos: number
  min: number | null
  rating: number
  inc?: number
  t?: number
  slot?: number
}

export interface RatingTeam {
  id: number | null
  uid?: number | null
  name: string
  goals: number | null
}

export interface RatingMatch {
  v: 1
  gameDate: string
  comp: string
  compUid?: number | null
  home: RatingTeam
  away: RatingTeam
  myTeamId: number | null
  full?: number
  players: RatingPlayer[]
}

/** PositionMask의 자리 비트: 낮은 비트부터 POSITION_KEYS의 이름 */
const MASK_KEYS: Array<[number, (typeof POSITION_KEYS)[number]]> = [
  [1, 'GK'],
  [2, 'SW'],
  [4, 'DR'],
  [8, 'DL'],
  [16, 'DC'],
  [32, 'WBR'],
  [64, 'WBL'],
  [128, 'DM'],
  [256, 'MR'],
  [512, 'ML'],
  [1024, 'MC'],
  [2048, 'AMR'],
  [4096, 'AML'],
  [8192, 'AMC'],
  [16384, 'ST']
]
const FLAG_LEFT = 1048576
const FLAG_RIGHT = 2097152

export interface DecodedPosition {
  /** 자리 이름(POSITION_KEYS) */
  key: (typeof POSITION_KEYS)[number]
  /** 위치군 순번(growth.ts의 GROWTH_GROUPS)과 그 이름 */
  group: number
  groupName: string
  /** 왼쪽·오른쪽·가운데. 골키퍼와 스위퍼는 null. 쪽 표시 비트가 있으면 그것을, 없으면 자리 이름에서 정한다 */
  side: 'L' | 'R' | 'C' | null
}

/** 경기 기록의 pos(PositionMask 비트에 쪽 표시 비트가 더해진 정수)를 읽는다. 0이거나 모르는 값이면 null */
export function positionFromMask(code: number): DecodedPosition | null {
  if (!Number.isInteger(code) || code <= 0) return null
  const found = MASK_KEYS.find(([bit]) => (code & bit) !== 0)
  if (!found) return null
  const key = found[1]
  const group = groupOfKey(key)
  let side: DecodedPosition['side'] = key === 'GK' || key === 'SW' ? null : key.endsWith('L') ? 'L' : key.endsWith('R') ? 'R' : 'C'
  if (side !== null) {
    if (code & FLAG_LEFT) side = 'L'
    else if (code & FLAG_RIGHT) side = 'R'
  }
  return { key, group, groupName: GROWTH_GROUPS[group], side }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const numOrNull = (value: unknown): boolean => value === null || num(value)

function validTeam(value: unknown): value is RatingTeam {
  return isObject(value) && typeof value.name === 'string' && numOrNull(value.id) && (value.uid === undefined || numOrNull(value.uid)) && (value.goals === undefined || numOrNull(value.goals))
}

function validPlayer(value: unknown): value is RatingPlayer {
  return (
    isObject(value) &&
    numOrNull(value.uid) &&
    (value.side === 'home' || value.side === 'away') &&
    Number.isInteger(value.pos) &&
    numOrNull(value.min) &&
    num(value.rating)
  )
}

/** 한 줄을 읽는다. 형식이 맞지 않거나 모르는 버전이면 null */
export function parseRatingLine(line: string): RatingMatch | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!isObject(value) || value.v !== 1) return null
  if (typeof value.gameDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.gameDate)) return null
  if (!validTeam(value.home) || !validTeam(value.away) || !numOrNull(value.myTeamId)) return null
  if (!Array.isArray(value.players) || !value.players.every(validPlayer)) return null
  return value as unknown as RatingMatch
}

/** 같은 경기를 가리는 키: (날짜, 홈 uid 또는 이름, 원정 uid 또는 이름) */
export const matchKey = (match: RatingMatch): string => `${match.gameDate}|${match.home.uid ?? match.home.name}|${match.away.uid ?? match.away.name}`

export interface RatingsImport {
  /** 새로 옮겨 적은 경기 수 */
  imported: number
  /** 이미 있어서 건너뛴 경기 수 */
  duplicates: number
  /** 다른 팀(다른 세이브)의 경기라 건너뛴 수 */
  otherTeam: number
  /** 읽을 수 없는 줄 수(깨졌거나 모르는 버전) */
  malformed: number
}

const NOTHING: RatingsImport = { imported: 0, duplicates: 0, otherTeam: 0, malformed: 0 }

/**
 * 플러그인의 평점 파일(source)에서 아직 읽지 않은 줄만 읽어, 내 팀 번호가 teamId인 경기를 label 세이브의 기록 폴더에 옮겨 적는다.
 * 읽은 곳(바이트)은 그 폴더의 meta.json에 적어 둔다. 끝이 줄바꿈으로 끝나지 않은 마지막 줄은 아직 쓰는 중이라 다음에 읽는다.
 * 파일이 전보다 작아졌으면(지우고 다시 만들었음) 처음부터 읽는다. 경기가 같은지는 matchKey(날짜, 홈·원정의 uid 또는 이름)로 가린다.
 */
export function importRatings(store: RecordStore, label: string, teamId: number | null | undefined, source: string): RatingsImport {
  if (teamId === undefined || teamId === null || !existsSync(source)) return NOTHING
  const meta = store.ensure(label, teamId)
  const size = statSync(source).size
  let from = meta.ratingsOffset
  if (from > size) from = 0
  if (from === size) return NOTHING

  const buffer = Buffer.alloc(size - from)
  const fd = openSync(source, 'r')
  let got = 0
  try {
    got = readSync(fd, buffer, 0, buffer.length, from)
  } finally {
    closeSync(fd)
  }
  const end = buffer.subarray(0, got).lastIndexOf(0x0a)
  if (end < 0) return NOTHING
  const lines = buffer.subarray(0, end).toString('utf8').split('\n')
  if (from === 0 && lines.length > 0) lines[0] = lines[0].replace(/^﻿/, '')

  const target = join(store.dir(label), RATINGS_FILE)
  const known = new Set<string>()
  if (existsSync(target)) {
    for (const old of readFileSync(target, 'utf8').split('\n')) {
      const match = old.trim() === '' ? null : parseRatingLine(old)
      if (match) known.add(matchKey(match))
    }
  }

  const result: RatingsImport = { imported: 0, duplicates: 0, otherTeam: 0, malformed: 0 }
  const fresh: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    const match = parseRatingLine(line)
    if (!match) result.malformed++
    else if (match.myTeamId !== teamId) result.otherTeam++
    else if (known.has(matchKey(match))) result.duplicates++
    else {
      known.add(matchKey(match))
      fresh.push(line)
      result.imported++
    }
  }
  if (fresh.length > 0) appendFileSync(target, fresh.join('\n') + '\n', 'utf8')
  store.saveMeta(label, { ...meta, ratingsOffset: from + end + 1, ratedMatches: meta.ratedMatches + result.imported })
  return result
}
