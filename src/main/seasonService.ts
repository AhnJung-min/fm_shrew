import { basename } from 'node:path'
import { NO_SEASON, type SeasonMatch, type SeasonResult, type SeasonTableRow } from '@shared/season'
import { NameBook } from './names'
import { calendar, dateKey } from './save/contracts'
import { kickOffTime, type SaveFixture } from './save/fixtures'
import type { LeagueTable } from './save/leagueTable'
import { SaveFormatError } from './save/reader'
import { readSeason, type SaveSeason } from './save/season'
import type { SaveWorld } from './save/world'
import { NO_TEAM_MESSAGE } from './worldService'

/** 화면에 보여 주는 지난 경기·앞으로 할 경기 수 */
const SHOWN = 5

/** 팀 이름과 그 구단의 엠블럼 번호(구단을 알아내지 못했으면 null) */
export interface TeamLabel {
  name: string
  clubUid: number | null
}

export interface SeasonDeps {
  /** 적용해 둔 세이브와 읽어 둔 자료. 적용한 것이 없으면 null */
  current(): { path: string; world: SaveWorld } | null
  /** 게임에 물어 알게 된 이름을 적어 두는 폴더 */
  namesDir: string
}

interface Cached {
  path: string
  world: SaveWorld
  season: Promise<SaveSeason | null>
}

/**
 * 적용한 세이브에서 내 팀의 지난 경기와 앞으로 할 경기, 리그 순위표를 읽어 둔다.
 * 읽는 데 반 초쯤 걸리고(압축을 푸는 일은 다른 스레드에서 한다), 세이브를 다시 읽어 적용할 때만 다시 읽는다.
 */
export class SeasonService {
  private cached: Cached | null = null

  constructor(private readonly deps: SeasonDeps) {}

  async season(): Promise<SeasonResult> {
    let current: ReturnType<SeasonDeps['current']>
    try {
      current = this.deps.current()
    } catch (error) {
      return { ...NO_SEASON, message: error instanceof Error ? error.message : String(error) }
    }
    if (!current) return { ...NO_SEASON, message: '먼저 세이브를 골라 적용해 주세요.' }
    const { path, world } = current
    if (world.teamId === undefined) {
      return { ...NO_SEASON, message: NO_TEAM_MESSAGE }
    }
    const today = world.gameDate
    if (!today) return { ...NO_SEASON, teamId: world.teamId, message: '세이브에서 게임 속 오늘 날짜를 읽지 못했습니다.' }

    if (!this.cached || this.cached.path !== path || this.cached.world !== world) {
      const season = readSeason(path, world.teamId, today)
      this.cached = { path, world, season }
      // 읽다가 실패하면 다음에 다시 읽어 보도록 기억하지 않는다
      season.catch(() => {
        if (this.cached?.season === season) this.cached = null
      })
    }
    let season: SaveSeason | null
    try {
      season = await this.cached.season
    } catch (error) {
      const message = error instanceof SaveFormatError ? error.message : '세이브 파일을 읽지 못했습니다. 게임이 저장하는 중이면 잠시 뒤에 다시 시도해 주세요.'
      return { ...NO_SEASON, teamId: world.teamId, message }
    }
    if (!season) return { ...NO_SEASON, teamId: world.teamId, message: '이 세이브에서 경기 기록을 찾지 못했습니다. 게임이 업데이트되어 형식이 바뀌었을 수 있습니다.' }
    return this.build(season, world, world.teamId, basename(path))
  }

  private build(season: SaveSeason, world: SaveWorld, teamId: number, saveName: string): SeasonResult {
    const today = world.gameDate!
    const wanted = new Set<number>()
    for (const fixture of season.fixtures) wanted.add(fixture.homeId === teamId ? fixture.awayId : fixture.homeId)
    for (const row of season.table?.rows ?? []) wanted.add(row.teamId)
    const nameOf = teamNames(world, wanted, this.deps.namesDir, saveName)

    const league = leagueStage(season.fixtures, season.table, teamId)
    const matches = season.fixtures.map((fixture) => toMatch(fixture, teamId, league, nameOf))
    const now = dateKey(today)
    const key = (fixture: SaveFixture): number => dateKey(fixture.date) * 100 + fixture.slot
    const recent = season.fixtures
      .map((fixture, i) => ({ fixture, match: matches[i] }))
      .filter(({ match }) => match.played)
      .sort((a, b) => key(b.fixture) - key(a.fixture))
      .slice(0, SHOWN)
      .map(({ match }) => match)
    const upcoming = season.fixtures
      .map((fixture, i) => ({ fixture, match: matches[i] }))
      .filter(({ fixture, match }) => !match.played && fixture.played === false && dateKey(fixture.date) >= now)
      .sort((a, b) => key(a.fixture) - key(b.fixture))
      .slice(0, SHOWN)
      .map(({ match }) => match)

    const result: SeasonResult = {
      ok: recent.length + upcoming.length > 0 || season.table !== null,
      teamId,
      today: calendar(today),
      recent,
      upcoming
    }
    if (season.table) result.table = toTable(season.table, teamId, nameOf)
    else result.tableMessage = '이 세이브에서 리그 순위표를 찾지 못했습니다. 시즌이 아직 시작하지 않았거나 리그가 없는 팀일 수 있습니다.'
    if (recent.length + upcoming.length === 0) result.message = '이 세이브에서 내 팀의 경기 일정을 찾지 못했습니다.'
    return result
  }
}

/**
 * 내 팀의 경기 가운데 리그의 단계 번호. 리그 순위표에 든 팀과 가장 많이 겨루는 단계를 리그로 본다.
 * 순위표가 없으면 알 수 없다(null).
 */
export function leagueStage(fixtures: SaveFixture[], table: LeagueTable | null, teamId: number): number | null {
  if (!table) return null
  const members = new Set(table.rows.map((row) => row.teamId))
  const counts = new Map<number, number>()
  for (const fixture of fixtures) {
    const opponent = fixture.homeId === teamId ? fixture.awayId : fixture.homeId
    if (members.has(opponent)) counts.set(fixture.stageId, (counts.get(fixture.stageId) ?? 0) + 1)
  }
  let best: number | null = null
  let bestCount = 0
  for (const [stage, count] of counts) {
    if (count > bestCount) {
      best = stage
      bestCount = count
    }
  }
  // 리그라면 같은 팀과 홈·원정으로 두 번씩은 만난다
  return bestCount >= Math.min(2 * table.roundsPerVenue, 2 * (table.rows.length - 1)) ? best : null
}

function toMatch(fixture: SaveFixture, teamId: number, league: number | null, nameOf: (id: number) => TeamLabel): SeasonMatch {
  const home = fixture.homeId === teamId
  const opponentId = home ? fixture.awayId : fixture.homeId
  const played = fixture.played === true
  const scored = played && fixture.homeGoals !== null && fixture.awayGoals !== null
  const goalsFor = scored ? (home ? fixture.homeGoals : fixture.awayGoals) : null
  const goalsAgainst = scored ? (home ? fixture.awayGoals : fixture.homeGoals) : null
  return {
    date: calendar(fixture.date),
    time: kickOffTime(fixture.slot),
    opponentId,
    opponent: nameOf(opponentId).name,
    clubUid: nameOf(opponentId).clubUid,
    home,
    league: league !== null && fixture.stageId === league,
    round: fixture.round === null ? null : fixture.round + 1,
    played,
    goalsFor,
    goalsAgainst,
    result: goalsFor === null || goalsAgainst === null ? null : goalsFor > goalsAgainst ? 'win' : goalsFor < goalsAgainst ? 'loss' : 'draw'
  }
}

function toTable(table: LeagueTable, teamId: number, nameOf: (id: number) => TeamLabel): SeasonTableRow[] {
  return table.rows.map((row, i) => ({
    position: i + 1,
    teamId: row.teamId,
    name: nameOf(row.teamId).name,
    clubUid: nameOf(row.teamId).clubUid,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDiff: row.goalsFor - row.goalsAgainst,
    points: row.points,
    mine: row.teamId === teamId
  }))
}

/**
 * 팀 번호 → 이름과 구단 번호. 세이브에서 구단을 알아낸 선수의 소속에서 먼저 찾고(스쿼드·영입 후보와 같은 이름),
 * 없으면 게임에 물어 적어 둔 이름을 쓴다. 모르면 빈 글자.
 */
export function teamNames(world: SaveWorld, ids: ReadonlySet<number>, namesDir: string, saveName: string): (id: number) => TeamLabel {
  const found = new Map<number, number>()
  for (let k = 0; k < world.count && found.size < ids.size; k++) {
    const team = world.teamIds[k]
    if (world.club[k] >= 0 && ids.has(team) && !found.has(team)) found.set(team, world.club[k])
  }
  const book = new NameBook(namesDir)
  book.open(saveName)
  return (id) => {
    const club = found.get(id)
    if (club !== undefined) return { name: world.clubs[club].name, clubUid: world.clubs[club].uid || null }
    const learned = book.team(id)
    return { name: learned ? learned.club || learned.name : '', clubUid: null }
  }
}
