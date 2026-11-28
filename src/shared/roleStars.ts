import { z } from 'zod'
import { roleGameId, type SupportedVersion } from './compat'
import type { Phase } from './slotProfile'

/**
 * 게임이 매긴 역할 별점의 앱 쪽 해독과 순위 상관(F-05). 플러그인 /rolestars의 답을 (선수, 국면, 역할 번호, 별점) 줄로 풀고,
 * 앱 적합도와 게임 별점의 순위 상관(스피어만)을 역할마다 낸다. 순수 계산이다. 결과는 점수에 넣지 않고 "가중치 점검 대상"을 알리는 데만 쓴다.
 * 별점은 20점 만점이고 2가 별 반 개다. 값은 1점 단위로 온다. 한 선수의 표에 같은 역할이 포지션만 달리해 여러 번 나올 수 있다
 * (어느 줄을 쓸지는 역할 대조를 만드는 쪽이 정한다. 이 모듈은 줄을 모두 준다).
 */

/** 게임 역할 별점 표의 한 줄 */
export interface StarRow {
  uid: number
  phase: Phase
  /** 게임 역할 비트(10진 글자. 숫자로 바꾸지 않는다) */
  gameId: string
  min: number
  max: number
}

const Strings = z.record(z.string(), z.string())
const Probe = z.object({ items: z.array(Strings).optional() })
const Answer = z.object({ players: z.array(z.object({ uid: z.number().int().positive(), ip: Probe, oop: Probe })) })

const ROLE_ID = 'TacticsRoleID'
const IN_POSSESSION = 'IsInPossession'
const STAR_MIN = 'CurrentAbilityStars.MinValue'
const STAR_MAX = 'CurrentAbilityStars.MaxValue'

/** 별점 글자 → 수. 0 이상 20 이하의 정수 글자만 받는다 */
function starOf(text: string | undefined): number | null {
  if (text === undefined || !/^\d{1,2}$/.test(text)) return null
  const value = Number(text)
  return value <= 20 ? value : null
}

/**
 * 플러그인 /rolestars의 답을 줄로 푼다. 모양이 틀리거나 값이 글자가 아니면 null이다.
 * 역할 번호(TacticsRoleID)가 10진 글자가 아니거나 별점이 0~20의 정수가 아닌 줄, 줄이 말하는 국면(IsInPossession)이 그 표의 국면과 다른 줄은 뺀다.
 * row를 주면 역할 번호에서 임무 비트를 지운다(compat.ts의 roleGameId).
 */
export function parseRoleStars(json: unknown, row?: SupportedVersion): StarRow[] | null {
  const parsed = Answer.safeParse(json)
  if (!parsed.success) return null
  const rows: StarRow[] = []
  for (const player of parsed.data.players) {
    for (const phase of ['ip', 'oop'] as const) {
      for (const item of player[phase].items ?? []) {
        const flag = item[IN_POSSESSION]
        if ((flag === 'True' && phase !== 'ip') || (flag === 'False' && phase !== 'oop')) continue
        const given = item[ROLE_ID]
        const gameId = given === undefined ? null : row ? roleGameId(given, row) : /^\d{1,20}$/.test(given) ? given : null
        const min = starOf(item[STAR_MIN])
        const max = starOf(item[STAR_MAX])
        if (gameId === null || min === null || max === null) continue
        rows.push({ uid: player.uid, phase, gameId, min, max })
      }
    }
  }
  return rows
}

/** 같은 값은 평균 순위로 센 순위(1부터) */
function ranksOf(values: readonly number[]): number[] {
  const order = values.map((value, at) => ({ value, at })).sort((a, b) => a.value - b.value || a.at - b.at)
  const ranks = new Array<number>(values.length).fill(0)
  for (let from = 0; from < order.length; ) {
    let to = from
    while (to + 1 < order.length && order[to + 1].value === order[from].value) to++
    // from..to가 같은 값이다: 평균 순위 = (처음 순위 + 끝 순위) / 2
    const average = (from + to) / 2 + 1
    for (let at = from; at <= to; at++) ranks[order[at].at] = average
    from = to + 1
  }
  return ranks
}

/**
 * 스피어만 순위 상관: 두 열의 순위(같은 값은 평균 순위)의 피어슨 상관. 길이가 다르거나 둘 미만이거나 숫자가 아닌 값이 있거나
 * 한 열의 값이 모두 같아 순위가 서지 않으면 null이다.
 */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  const count = xs.length
  if (count < 2 || ys.length !== count || !xs.every(Number.isFinite) || !ys.every(Number.isFinite)) return null
  const rx = ranksOf(xs)
  const ry = ranksOf(ys)
  const mean = (count + 1) / 2
  let cross = 0
  let spreadX = 0
  let spreadY = 0
  for (let at = 0; at < count; at++) {
    const dx = rx[at] - mean
    const dy = ry[at] - mean
    cross += dx * dy
    spreadX += dx * dx
    spreadY += dy * dy
  }
  if (spreadX === 0 || spreadY === 0) return null
  return Math.max(-1, Math.min(1, cross / Math.sqrt(spreadX * spreadY)))
}

export interface RankRow {
  roleId: string
  /** 짝의 수(선수 수) */
  n: number
  /** 순위 상관. 인원이 minPlayers보다 적거나 순위가 서지 않으면 null */
  rho: number | null
  /** 순위 상관이 rhoMin 미만이라 가중치를 점검해 볼 역할 */
  flagged: boolean
}

/**
 * 역할마다 (앱 값, 게임 별점) 짝의 순위 상관 표. 역할은 처음 나온 순서대로 낸다.
 * 인원(짝의 수)이 minPlayers보다 적으면 rho는 null("표본 부족")이고 flagged는 거짓이다. rho가 rhoMin 미만이면 flagged다.
 */
export function rankTable(pairs: ReadonlyArray<{ roleId: string; app: number; game: number }>, minPlayers: number, rhoMin: number): RankRow[] {
  const groups = new Map<string, { app: number[]; game: number[] }>()
  for (const pair of pairs) {
    const group = groups.get(pair.roleId) ?? { app: [], game: [] }
    group.app.push(pair.app)
    group.game.push(pair.game)
    groups.set(pair.roleId, group)
  }
  return [...groups.entries()].map(([roleId, group]) => {
    const n = group.app.length
    const rho = n >= minPlayers ? spearman(group.app, group.game) : null
    return { roleId, n, rho, flagged: rho !== null && rho < rhoMin }
  })
}
