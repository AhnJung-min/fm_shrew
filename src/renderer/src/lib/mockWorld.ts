import { FIELDS } from '@shared/fields'
import { POSITION_KEYS, PLAYABLE_RATING, positionsLabel } from '@shared/positions'
import { ROLE_BY_ID } from '@shared/roles'
import type { ColumnInfo, SquadResult } from '@shared/types'
import {
  categoriesOf,
  SAVE_ATTRIBUTE_ORDER,
  shownValue,
  type CandidateBench,
  type CandidateCategory,
  type CandidateQuery,
  type CandidateResult,
  type EditorListItem,
  type EditorPlayer
} from '@shared/world'

/**
 * 브라우저 미리보기(`npm run web`)용으로 지어낸 선수들. 실제 앱에서는 세이브에서 읽는다.
 * 이름과 값은 모두 꾸며 낸 것이다.
 */

interface MockPlayer extends Omit<EditorPlayer, 'source'> {
  mine: boolean
}

const FAMILY = ['한', '서', '도', '윤', '백', '차', '류', '진', '모', '설']
const GIVEN = ['지후', '태윤', '민재', '서준', '하람', '건우', '시온', '도현', '유찬', '이안', '준서', '로운']
const CLUBS = ['한강 유나이티드', '남해 FC', '북악 시티', '동해 로버스', '서천 애슬레틱', '자유 계약']
const SPOTS: number[][] = [[0], [3], [3, 2], [4, 14], [5, 7], [7], [7, 10], [9, 11], [10, 12], [12], [6, 9], [8, 11]]

/** 같은 순번이면 늘 같은 값이 나오는 난수 */
function rng(seed: number): () => number {
  let state = seed * 2654435761
  return () => {
    state = (state ^ (state << 13)) >>> 0
    state = (state ^ (state >>> 17)) >>> 0
    state = (state ^ (state << 5)) >>> 0
    return state / 0xffffffff
  }
}

const PLAYERS: MockPlayer[] = Array.from({ length: 150 }, (_, i) => {
  const random = rng(i + 7)
  const mine = i < 24
  const level = mine ? 62 + random() * 22 : 38 + random() * 52
  const age = 16 + Math.floor(random() * 19)
  const positions = POSITION_KEYS.map(() => 1)
  for (const spot of SPOTS[i % SPOTS.length]) positions[spot] = spot === SPOTS[i % SPOTS.length][0] ? 20 : PLAYABLE_RATING
  const attributes = SAVE_ATTRIBUTE_ORDER.map(() => Math.max(5, Math.min(100, Math.round(level + (random() - 0.5) * 36))))
  const ca = Math.round(level * 1.9 + 20)
  const pa = Math.min(200, ca + Math.round(random() * (age <= 21 ? 45 : 6)))
  const club = mine ? '리버풀' : CLUBS[Math.floor(random() * CLUBS.length)]
  return {
    uid: 1000 + i,
    name: `${FAMILY[i % FAMILY.length]}${GIVEN[(i * 7) % GIVEN.length]}`,
    age,
    position: positionsLabel(positions),
    club,
    ca,
    pa,
    positions,
    attributes,
    mine
  }
})

const ATTRIBUTE_INDEX = new Map<string, number>(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))

export function mockCandidates(query: CandidateQuery, empty: boolean): CandidateResult {
  const counts: Record<CandidateCategory, number> = { all: 0, starter: 0, rotation: 0, prospect: 0, free: 0 }
  if (empty) {
    return { ok: false, message: '세이브 폴더에 세이브가 없습니다. 게임에서 한 번 저장해 주세요.', bench: { starter: null, backup: null }, counts, rows: [], matched: 0 }
  }
  const role = ROLE_BY_ID[query.roleId]
  const slots = role.positions.map((key) => POSITION_KEYS.indexOf(key))
  const eligible = (player: MockPlayer): boolean => slots.some((slot) => player.positions[slot] >= PLAYABLE_RATING)
  const weights = Object.entries(role.weights)
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0)
  const scoreOf = (player: MockPlayer): number =>
    Math.round((weights.reduce((sum, [id, weight]) => sum + shownValue(player.attributes[ATTRIBUTE_INDEX.get(id)!]) * weight, 0) / total / 20) * 1000) / 10

  const mine = PLAYERS.filter((player) => player.mine && eligible(player))
    .map((player) => ({ player, score: scoreOf(player) }))
    .sort((a, b) => b.score - a.score)
  const bench: CandidateBench = {
    starter: mine[0] ? { name: mine[0].player.name, score: mine[0].score, ca: mine[0].player.ca } : null,
    backup: mine[1] ? { name: mine[1].player.name, score: mine[1].score } : null
  }
  const search = query.search.trim()
  const picked = PLAYERS.filter((player) => !player.mine)
    .filter((player) => !query.onlyEligible || eligible(player))
    .filter((player) => query.maxAge === null || (player.age ?? 99) <= query.maxAge)
    .filter((player) => !search || player.name.includes(search))
    .map((player) => {
      const score = scoreOf(player)
      const categories = categoriesOf({ score, age: player.age, ca: player.ca, pa: player.pa, hasClub: player.club !== '자유 계약' }, bench)
      counts.all++
      for (const category of categories) counts[category]++
      return { player, score, categories }
    })
    .filter((row) => query.category === 'all' || row.categories.includes(query.category))
    .sort((a, b) => (query.category === 'prospect' ? b.player.pa - a.player.pa : b.score - a.score))

  return {
    ok: true,
    saveName: '리버풀 2025.fm',
    bench,
    counts,
    matched: picked.length,
    rows: picked.map(({ player, score, categories }) => ({
      uid: player.uid,
      value: Math.round(player.ca ** 3 * 2.2),
      name: player.name,
      age: player.age,
      position: player.position,
      club: player.club,
      ca: player.ca,
      pa: player.pa,
      score,
      gap: bench.starter ? Math.round((score - bench.starter.score) * 10) / 10 : null,
      categories,
      attributes: player.attributes.map(shownValue)
    }))
  }
}

const listItem = ({ uid, name, age, position, club, ca, pa }: MockPlayer): EditorListItem => ({ uid, name, age, position, club, ca, pa })

export function mockEditorList(search: string, empty: boolean): { ok: boolean; message?: string; saveName?: string; items: EditorListItem[] } {
  if (empty) return { ok: false, message: '세이브 폴더에 세이브가 없습니다. 게임에서 한 번 저장해 주세요.', items: [] }
  const wanted = search.trim()
  const found = wanted ? PLAYERS.filter((player) => player.name.includes(wanted)) : PLAYERS.filter((player) => player.mine)
  return { ok: true, saveName: '리버풀 2025.fm', items: found.map(listItem) }
}

export function mockEditorPlayer(uid: number, gameOn: boolean): EditorPlayer | null {
  const found = PLAYERS.find((player) => player.uid === uid)
  if (!found) return null
  const { mine: _mine, ...player } = found
  const values = { ...player, positions: [...player.positions], attributes: [...player.attributes] }
  return gameOn
    ? { ...values, source: 'game' }
    : { ...values, source: 'save', sourceNote: '게임이 꺼져 있거나 게임 안 플러그인이 대답하지 않아, 세이브의 값을 보여 줍니다.' }
}

/** 내 팀 선수 표 */
export function mockSquad(empty: boolean): SquadResult {
  if (empty) return { ok: false, message: '먼저 홈 화면에서 세이브를 골라 적용해 주세요.', columns: [], rows: [] }
  const info = (header: string, field: string, numeric: boolean): ColumnInfo => ({
    header, field, group: 'info', short: header, label: header, isAttr: false, numeric
  })
  const attributes = FIELDS.filter((field) => field.isAttr)
  const columns: ColumnInfo[] = [
    info('이름', 'name', false),
    info('포지션', 'position', false),
    info('나이', 'age', true),
    info('현재 능력', 'ability', true),
    info('잠재 능력', 'potential', true),
    ...attributes.map((field): ColumnInfo => ({
      header: field.label, field: field.id, group: field.group, short: field.short, label: field.label, isAttr: true, numeric: true
    }))
  ]
  const num = (value: number | null): { raw: string; num: number | null } => ({ raw: value === null ? '' : String(value), num: value })
  const rows = PLAYERS.filter((player) => player.mine).map((player) => ({
    idx: player.uid,
    name: player.name,
    cells: {
      이름: { raw: player.name, num: null },
      포지션: { raw: player.position, num: null },
      나이: num(player.age),
      '현재 능력': num(player.ca),
      '잠재 능력': num(player.pa),
      ...Object.fromEntries(attributes.map((field) => [field.label, num(shownValue(player.attributes[ATTRIBUTE_INDEX.get(field.id)!]))]))
    }
  }))
  return { ok: true, columns, rows }
}
