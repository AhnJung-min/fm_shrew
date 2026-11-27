import {
  ageStructure,
  buildBrief,
  contractWindows,
  firstTeamPlayers,
  fitWageModel,
  NO_DASHBOARD,
  overpaidPlayers,
  recommendSlotOf,
  surplusReport,
  type DashboardData,
  type LoanEntry
} from '@shared/dashboard'
import { buildSnapshot, emptySnapshot, type ClubSnapshot, type GameFields } from '@shared/club'
import { FIELD_BY_ID, FIELDS } from '@shared/fields'
import { footValues, formatPounds, hiddenAttributes, isGoalkeeper, visibleAttributes } from '@shared/playerView'
import { POSITION_KEYS, PLAYABLE_RATING, positionsLabel } from '@shared/positions'
import { FALLBACK_NORM, type RoleNorms } from '@shared/norms'
import { capTierByRealism, recommend, squadMoney, tierRanker, TRAIT_WEIGHTS, type RecommendContext, type RecommendInput, type TraitId, type Traits } from '@shared/recommend'
import { ROLE_BY_ID, ROLES } from '@shared/roles'
import { analyseTactic, slotBench } from '@shared/tactic'
import type { SeasonMatch, SeasonResult, SeasonTableRow } from '@shared/season'
import type { ColumnInfo, SquadResult } from '@shared/types'
import {
  categoriesOf,
  effectiveScore,
  SAVE_ATTRIBUTE_ORDER,
  shownValue,
  type CandidateBench,
  type CandidateCategory,
  type CandidateQuery,
  type CandidateResult,
  type EditorListItem,
  type EditorPlayer,
  type PlayerProfile
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

/** 미리보기에는 세이브 전체가 없어 역할별 기준 분포를 구하지 못한다: 모든 역할에 대신하는 값을 주어 실제 앱과 같은 식을 돌린다 */
const MOCK_NORMS: RoleNorms = Object.fromEntries(ROLES.map((role) => [role.id, FALLBACK_NORM]))

export function mockCandidates(query: CandidateQuery, empty: boolean): CandidateResult {
  const counts: Record<CandidateCategory, number> = { all: 0, starter: 0, rotation: 0, prospect: 0, free: 0 }
  if (empty) {
    return { ok: false, message: '세이브 폴더에 세이브가 없습니다. 게임에서 한 번 저장해 주세요.', bench: { starter: null, backup: null }, counts, rows: [], matched: 0 }
  }
  // 전술의 한 자리를 기준으로 찾으면 그 자리의 역할·주전·두 번째 선수·보강 필요도를 쓴다(실제 앱과 같은 계산)
  const squad = mockSquad(false)
  const analysis = query.slot
    ? analyseTactic({ rows: squad.rows, columns: squad.columns, today: squad.today, formation: query.slot.formation, slotRoles: query.slot.slotRoles, roleWeights: {}, norms: squad.roleNorms })
    : null
  const slotFound = analysis?.slots[query.slot?.index ?? -1] ?? null
  const role = ROLE_BY_ID[slotFound ? slotFound.slot.roleId : query.roleId]
  const slots = (slotFound ? [slotFound.slot.position] : role.positions).map((key) => POSITION_KEYS.indexOf(key))
  const eligible = (player: MockPlayer): boolean => slots.some((slot) => player.positions[slot] >= PLAYABLE_RATING)
  const weights = Object.entries(role.weights)
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0)
  const scoreOf = (player: MockPlayer): number =>
    Math.round((weights.reduce((sum, [id, weight]) => sum + shownValue(player.attributes[ATTRIBUTE_INDEX.get(id)!]) * weight, 0) / total / 20) * 1000) / 10

  const ratingOf = (player: MockPlayer): number => Math.max(...slots.map((slot) => player.positions[slot]))
  const mine = PLAYERS.filter((player) => player.mine && eligible(player))
    .map((player) => {
      const score = scoreOf(player)
      return { player, score, eff: effectiveScore(score, ratingOf(player), null, FALLBACK_NORM.sigma) }
    })
    .sort((a, b) => b.eff - a.eff)
  const bench: CandidateBench =
    (analysis && slotFound ? slotBench(analysis, slotFound.slot.index) : null) ?? {
      starter: mine[0] ? { name: mine[0].player.name, score: mine[0].eff, shownScore: mine[0].score, ca: mine[0].player.ca, age: mine[0].player.age } : null,
      backup: mine[1] ? { name: mine[1].player.name, score: mine[1].eff, shownScore: mine[1].score } : null
    }
  const mineAll = PLAYERS.filter((player) => player.mine)
  const money = squadMoney(
    mineAll.map((player) => player.ca * 900),
    mineAll.map((player) => Math.round(player.ca ** 3 * 2.2))
  )
  const group = slotFound ? slotFound.group : null
  const need = group ? group.need : null
  const context: RecommendContext = {
    starter: bench.starter,
    backup: bench.backup ? { score: bench.backup.score, shownScore: bench.backup.shownScore } : null,
    today: { year: 2026, day: 182 },
    money,
    need,
    groupSlots: group?.slots.length
  }
  // 미리보기에는 세이브 전체가 없어 기준 분포를 구하지 못한다: 대신하는 값으로 같은 식을 돌린다
  const norm = FALLBACK_NORM
  const goalkeeper = role.positions.includes('GK')
  const statusCode = (player: MockPlayer): number => (player.club === '자유 계약' ? 0 : [1, 2, 3, 4][player.uid % 4])
  const inputOf = (player: MockPlayer, score: number): RecommendInput => {
    const free = player.club === '자유 계약'
    const traits = {} as Traits
    for (const id of Object.keys(TRAIT_WEIGHTS) as TraitId[]) traits[id] = shownValue(player.attributes[ATTRIBUTE_INDEX.get(id)!])
    return {
      category: query.category,
      goalkeeper,
      roleScore: score,
      roleRating: ratingOf(player),
      age: player.age,
      ca: player.ca,
      pa: player.pa,
      value: Math.round(player.ca ** 3 * 2.2),
      wage: free ? null : player.ca * 900,
      contractEnd: free ? null : (2026 + (player.uid % 4)) * 1000 + 181,
      squadStatus: statusCode(player),
      hasClub: !free,
      traits
    }
  }
  const search = query.search.trim()
  const picked = PLAYERS.filter((player) => !player.mine)
    .filter((player) => !query.onlyEligible || eligible(player))
    .filter((player) => query.maxAge === null || (player.age ?? 99) <= query.maxAge)
    .filter((player) => !search || player.name.includes(search))
    .map((player) => {
      const score = scoreOf(player)
      const categories = categoriesOf({ score, age: player.age, ca: player.ca, pa: player.pa, hasClub: player.club !== '자유 계약', rating: ratingOf(player) }, bench, norm, goalkeeper)
      if (categories.length > 0) counts.all++
      for (const category of categories) counts[category]++
      return { player, score, categories }
    })
    .filter((row) => (query.category === 'all' ? row.categories.length > 0 : row.categories.includes(query.category)))
    .map((row) => ({ ...row, recommend: recommend(inputOf(row.player, row.score), { ...context, norm }) }))
    .sort((a, b) => b.recommend.total - a.recommend.total || b.score - a.score)
  const tierOf = tierRanker(picked.map((row) => row.recommend.total))

  return {
    ok: true,
    saveName: '리버풀 2025.fm',
    bench,
    counts,
    matched: picked.length,
    ranked: picked.length,
    norm,
    need,
    group: group ? { label: group.label, slots: group.slots.length } : null,
    baseline: money,
    rows: picked.map(({ player, score, categories, recommend: recommendation }) => {
      // 지어낸 임대 선수: 원 소속(club)과 지금 뛰는 구단(loanedTo)을 따로 보여 준다
      const loanedTo = player.club !== '자유 계약' && player.uid % 11 === 0 ? CLUBS[(player.uid + 1) % (CLUBS.length - 1)] : null
      return {
        uid: player.uid,
        clubUid: null,
        loanedTo: loanedTo === player.club ? null : loanedTo,
        recommend: recommendation,
        value: Math.round(player.ca ** 3 * 2.2),
        wage: player.club === '자유 계약' ? null : player.ca * 900,
        contractEnd: player.club === '자유 계약' ? null : { year: 2026 + (player.uid % 4), month: 6, day: 30 },
        squadStatus: player.club === '자유 계약' ? '' : ['핵심 선수', '중요 선수', '주전', '로테이션'][player.uid % 4],
        nation: ['대한민국', '브라질', '프랑스', '잉글랜드'][player.uid % 4],
        name: player.name,
        age: player.age,
        position: player.position,
        club: player.club,
        ca: player.ca,
        pa: player.pa,
        score,
        gap: bench.starter ? Math.round((score - (bench.starter.shownScore ?? bench.starter.score)) * 10) / 10 : null,
        categories,
        tier: capTierByRealism(tierOf(recommendation.total), recommendation.realism),
        attributes: player.attributes.map(shownValue)
      }
    })
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

/** 선수 정보 화면 미리보기용: 지어낸 선수의 값을 정보 화면의 모양으로 */
export function mockProfile(uid: number, gameOn: boolean): PlayerProfile | null {
  const found = PLAYERS.find((player) => player.uid === uid)
  if (!found) return null
  const shown = found.attributes.map(shownValue)
  const free = found.club === '자유 계약'
  const goalkeeper = isGoalkeeper(found.positions)
  return {
    uid,
    name: found.name,
    age: found.age,
    birth: found.age === null ? null : { year: 2026 - found.age, month: 1 + (uid % 12), day: 1 + ((uid * 3) % 28) },
    position: found.position,
    positions: [...found.positions],
    goalkeeper,
    ca: found.ca,
    pa: found.pa,
    club: found.club,
    clubUid: null,
    nation: ['대한민국', '브라질', '프랑스', '잉글랜드'][uid % 4],
    value: gameOn ? `${60 + (uid % 90)}억 원 - ${80 + (uid % 90)}억 원` : formatPounds(Math.round(found.ca ** 3 * 2.2)),
    wage: free ? '' : gameOn ? `${(0.3 + (uid % 50) / 10).toFixed(1)}억 원` : formatPounds(found.ca * 900),
    moneyFrom: gameOn ? 'game' : 'save',
    contractEnd: free ? null : { year: 2026 + (uid % 4), month: 6, day: 30 },
    squadStatus: free ? '' : ['핵심 선수', '중요 선수', '주전', '로테이션'][uid % 4],
    foot: footValues(shown),
    attributes: visibleAttributes(shown, goalkeeper),
    hidden: hiddenAttributes(shown),
    source: gameOn ? 'game' : 'save',
    sourceNote: gameOn ? undefined : '게임이 꺼져 있거나 게임 안 플러그인이 대답하지 않아, 세이브의 값을 보여 줍니다.'
  }
}

/** 내 팀 선수 표 */
export function mockSquad(empty: boolean): SquadResult {
  if (empty) return { ok: false, message: '먼저 시작 화면에서 세이브를 골라 적용해 주세요.', columns: [], rows: [] }
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
    })),
    ...(['value', 'wage', 'contractEnd', 'squadStatus'] as const).map((id): ColumnInfo => {
      const field = FIELD_BY_ID[id]
      return { header: field.label, field: id, group: 'contract', short: field.short, label: field.label, isAttr: false, numeric: id !== 'squadStatus' }
    })
  ]
  const num = (value: number | null): { raw: string; num: number | null } => ({ raw: value === null ? '' : String(value), num: value })
  const text = (raw: string): { raw: string; num: null } => ({ raw, num: null })
  // 지어낸 "오늘"과, 선수마다 1~30개월 뒤에 끝나는 계약
  const today = { year: 2026, month: 7, day: 1 }
  const endOf = (uid: number): { year: number; month: number; day: number } => {
    const at = new Date(Date.UTC(today.year, today.month - 1 + 1 + ((uid * 7) % 30), 30))
    return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() }
  }
  const rows = PLAYERS.filter((player) => player.mine).map((player) => {
    const end = endOf(player.uid)
    return {
      idx: player.uid,
      name: player.name,
      ratings: player.positions,
      cells: {
        이름: text(player.name),
        포지션: text(player.position),
        나이: num(player.age),
        '현재 능력': num(player.ca),
        '잠재 능력': num(player.pa),
        ...Object.fromEntries(attributes.map((field) => [field.label, num(shownValue(player.attributes[ATTRIBUTE_INDEX.get(field.id)!]))])),
        몸값: { raw: formatPounds(Math.round(player.ca ** 3 * 2.2)), num: Math.round(player.ca ** 3 * 2.2) },
        주급: { raw: formatPounds(player.ca * 900), num: player.ca * 900 },
        '계약 만료': { raw: `${end.year}.${end.month}.${end.day}`, num: end.year * 10000 + end.month * 100 + end.day },
        '계약상 입지': text(['핵심 선수', '중요 선수', '주전', '로테이션'][player.uid % 4])
      }
    }
  })
  return { ok: true, columns, rows, today, roleNorms: MOCK_NORMS }
}

/** 지어낸 경기 일정과 순위표(미리보기용). 팀 이름과 점수는 모두 꾸며 낸 것이다. */
export function mockSeason(empty: boolean): SeasonResult {
  if (empty) return { ok: false, message: '먼저 세이브를 골라 적용해 주세요.', recent: [], upcoming: [] }
  const opponents = ['북악 시티', '남해 FC', '동해 로버스', '서천 애슬레틱', '중원 스타즈', '낙동 레인저스', '금강 타운']
  const day = (month: number, date: number): { year: number; month: number; day: number } => ({ year: 2026, month, day: date })
  const played = (index: number, month: number, date: number, home: boolean, goalsFor: number, goalsAgainst: number, round: number | null): SeasonMatch => ({
    date: day(month, date),
    time: home ? '15:00' : '20:00',
    opponentId: 200 + index,
    opponent: opponents[index],
    clubUid: null,
    home,
    league: round !== null,
    round,
    played: true,
    goalsFor,
    goalsAgainst,
    result: goalsFor > goalsAgainst ? 'win' : goalsFor < goalsAgainst ? 'loss' : 'draw'
  })
  const coming = (index: number, month: number, date: number, home: boolean, round: number | null): SeasonMatch => ({
    ...played(index, month, date, home, 0, 0, round),
    played: false,
    goalsFor: null,
    goalsAgainst: null,
    result: null
  })
  // [이름, 승, 무, 패, 득점, 실점]
  const standings: Array<[string, number, number, number, number, number]> = [
    ['북악 시티', 17, 4, 3, 48, 19],
    ['한강 유나이티드', 16, 5, 3, 44, 20],
    ['남해 FC', 13, 7, 4, 37, 23],
    ['동해 로버스', 11, 8, 5, 33, 24],
    ['서천 애슬레틱', 9, 7, 8, 30, 31],
    ['중원 스타즈', 7, 8, 9, 26, 32],
    ['낙동 레인저스', 5, 6, 13, 21, 38],
    ['금강 타운', 3, 5, 16, 16, 44]
  ]
  const table: SeasonTableRow[] = standings.map(([name, won, drawn, lost, goalsFor, goalsAgainst], i) => ({
    position: i + 1,
    teamId: 100 + i,
    name,
    clubUid: null,
    played: won + drawn + lost,
    won,
    drawn,
    lost,
    goalsFor,
    goalsAgainst,
    goalDiff: goalsFor - goalsAgainst,
    points: won * 3 + drawn,
    mine: name === '한강 유나이티드'
  }))
  return {
    ok: true,
    teamId: 101,
    today: day(7, 1),
    recent: [
      played(1, 6, 28, true, 2, 1, 24),
      played(3, 6, 24, false, 1, 1, 23),
      played(4, 6, 20, true, 3, 0, 22),
      played(2, 6, 15, false, 0, 2, null),
      played(5, 6, 11, true, 2, 0, 21)
    ],
    upcoming: [
      coming(6, 7, 5, true, 25),
      coming(0, 7, 12, false, 26),
      coming(2, 7, 19, true, null),
      coming(1, 7, 26, false, 27),
      coming(3, 8, 2, true, 28)
    ],
    table
  }
}

/** 대시보드 미리보기용: 지어낸 선수단과 경기 기록에 실제 앱과 같은 순수 계산을 적용한다 */
export function mockDashboard(empty: boolean, settings: { formation: string; slotRoles: Record<string, string> }): DashboardData {
  if (empty) return { ...NO_DASHBOARD, message: '먼저 세이브를 골라 적용해 주세요.' }
  const squad = mockSquad(false)
  const season = mockSeason(false)
  const players = firstTeamPlayers(squad.rows, squad.columns)
  const analysis = analyseTactic({ rows: squad.rows, columns: squad.columns, today: squad.today, formation: settings.formation, slotRoles: settings.slotRoles, roleWeights: {}, norms: squad.roleNorms })!
  const contracts = contractWindows(players, squad.today)
  const need = analysis.byNeed[0]
  const slot = recommendSlotOf(analysis.formation.id, need)

  // 지어낸 주급 기준선: 선수마다 주급이 능력(과 나이)의 지수 함수에 가깝게 흩어지도록 만든 표본
  const points = Array.from({ length: 400 }, (_, i) => {
    const random = rng(i + 901)
    const ca = 60 + Math.floor(random() * 110)
    const age = 17 + Math.floor(random() * 20)
    return { ca, age, wage: Math.exp(3.4 + 0.052 * ca - (age < 21 ? 0.5 : 0) + (age >= 30 ? 0.2 : 0) + (random() - 0.5) * 1.2) }
  })
  const fit = fitWageModel(points)!
  const loanedIn = new Set([1030])
  const over = overpaidPlayers(players, fit, loanedIn)

  const candidates = mockCandidates(
    {
      roleId: need.slot.roleId, category: 'starter', maxAge: null, onlyEligible: true, includeUnknownClub: false, search: '', expiringWithinMonths: null,
      slot: { formation: analysis.formation.id, slotRoles: settings.slotRoles, index: need.slot.index }
    },
    false
  )
  const loan = (uid: number, team: string, club: string): LoanEntry => {
    const found = PLAYERS.find((player) => player.uid === uid)!
    return { uid, name: found.name, age: found.age, position: found.position, ca: found.ca, pa: found.pa, team, otherClub: club, otherClubUid: null }
  }
  return {
    ok: true,
    meta: { saveName: '리버풀 2025.fm', savedAt: new Date(Date.now() - 0.4 * 3_600_000).toISOString(), gameDate: { year: 2026, month: 7, day: 1 }, abilitySource: 'save', liveAt: null, club: '한강 유나이티드', clubUid: null },
    brief: buildBrief({
      table: season.table ?? null,
      recent: season.recent,
      next: season.upcoming[0] ?? null,
      need: { label: slot.label, roleLabel: slot.roleLabel, need: slot.need, level: slot.level, levelLabel: slot.levelLabel, reason: slot.reason, formation: analysis.formation.label },
      expiring: { known: contracts.known, count: contracts.within1y.length, names: contracts.within1y.map((row) => row.name) }
    }),
    squad: {
      firstTeam: players.length,
      teams: [
        { teamId: 101, name: '한강 유나이티드', first: true, players: players.length, averageAge: ageStructure(players).average },
        { teamId: 102, name: '한강 유나이티드 U21', first: false, players: 19, averageAge: 19.8 },
        { teamId: 103, name: '', first: false, players: 18, averageAge: 16.9 }
      ],
      loans: { in: [loan(1030, '한강 유나이티드', '북악 시티')], out: [loan(1040, '남해 FC', '남해 FC'), loan(1050, '서천 애슬레틱', '서천 애슬레틱')] },
      ages: ageStructure(players)
    },
    contracts: { known: contracts.known, within1y: contracts.within1y, within2y: contracts.within2y, wageWithin1y: contracts.wageWithin1y },
    surplus: { ok: true, formation: analysis.formation.label, ...surplusReport({ players, rows: squad.rows, columns: squad.columns, analysis, roleWeights: {}, norms: squad.roleNorms, wageModel: fit, loanedIn }) },
    overpaid: { ok: true, model: { ...fit, scope: 'league', teams: 8 }, rows: over.rows, total: over.total },
    recommend: {
      ok: true,
      matched: candidates.matched,
      slot,
      rows: candidates.rows.slice(0, 3).map((row) => ({
        uid: row.uid, name: row.name, age: row.age, position: row.position, club: row.club, clubUid: null, ca: row.ca, pa: row.pa, total: row.recommend.total, tier: row.tier, score: row.score, gap: row.gap,
        loanedTo: row.loanedTo, realism: row.recommend.realism
      }))
    }
  }
}

/**
 * 구단 프로필·시설·재정과 선수단 건강(미리보기용). 플러그인이 돌려주는 것과 같은 모양의 글자를 지어 만들어,
 * 실제 앱과 같은 변환(shared/club.ts)을 거치게 한다. 구단·경기장·금액은 모두 꾸며 낸 것이다.
 */
export function mockClub(state: { empty: boolean; off: boolean; old: boolean }): ClubSnapshot {
  if (state.empty) return emptySnapshot('noSave', '먼저 홈 화면에서 세이브를 골라 적용해 주세요.')
  if (state.off) return emptySnapshot('off', 'FM이 켜져 있어야 구단 재정·시설과 선수단 건강을 읽을 수 있습니다. 게임을 켜고 세이브를 불러와 주세요.')
  if (state.old) return emptySnapshot('old', '이 정보는 게임 안 플러그인 0.11.0 이상에서 읽습니다(지금 올라가 있는 것은 0.8.0). FM을 완전히 껐다가 다시 켜 주세요.')
  const club: GameFields = {
    name: '한강 유나이티드',
    club: '한강 유나이티드 FC',
    division: '한국 1부 리그',
    leaguePosition: '3위',
    stadium: '한강 시티 스타디움',
    capacity: '38,420',
    averageAttendance: '33,905',
    seasonTickets: '21,400',
    founded: '1946',
    training: '우수',
    trainingStars: '4',
    youthFacilities: '좋음',
    youthFacilitiesStars: '3',
    youthCoaching: '우수',
    youthCoachingStars: '4.5',
    youthRecruitment: '평균',
    youthRecruitmentStars: '2.5',
    transferBudget: '3200000',
    wageBudget: '1450000',
    wageSpend: '1388000',
    wageRemaining: '62000',
    balance: '12400000',
    balanceStatus: '안정적'
  }
  const mine = PLAYERS.filter((player) => player.mine)
  const health: GameFields[] = mine.map((player, i) => {
    const random = rng(player.uid + 99)
    const moraleOf = (share: number): { morale: number; moraleText: string } => ({
      morale: Math.round(4 + share * 16),
      moraleText: ['매우 낮음', '낮음', '보통', '좋음', '매우 좋음'][Math.min(4, Math.floor(share * 5))]
    })
    const hurt = i === 3 || i === 11 || i === 17
    const banned = i === 8
    const condition = Math.round((hurt ? 6200 : 7600 + random() * 2400))
    return {
      uid: player.uid,
      injured: hurt ? 'True' : 'False',
      ...(hurt ? { injuryName: ['햄스트링 염좌', '발목 인대 손상', '근육 피로 누적'][i % 3], injuryDuration: ['3주', '6주', '10일'][i % 3], injuryDays: [21, 42, 10][i % 3] } : {}),
      ...(banned ? { banReason: '레드카드 퇴장', banLeft: '2' } : { banLeft: '0' }),
      condition,
      conditionText: `${Math.round(condition / 100)}%`,
      sharpness: Math.round(5500 + random() * 4500),
      ...moraleOf(random()),
      appearances: String(Math.floor(random() * 14)),
      goals: String(Math.floor(random() * 6)),
      assists: String(Math.floor(random() * 5)),
      rating: (6.2 + random() * 1.5).toFixed(2),
      lastRating: (5.5 + random() * 3).toFixed(1)
    }
  })
  const roster = mine.map((player) => ({ uid: player.uid, name: player.name, position: player.position }))
  return buildSnapshot({
    club: { records: [club], paths: {}, skipped: [] },
    health: { records: health, paths: {}, skipped: [] },
    roster,
    readAt: new Date().toISOString()
  })
}
