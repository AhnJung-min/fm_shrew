import { basename } from 'node:path'
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
  WAGE_MODEL_MIN_SAMPLE,
  type ClubTeam,
  type DashboardData,
  type LoanEntry,
  type RecommendRow,
  type WageModelInfo
} from '@shared/dashboard'
import { positionsLabel } from '@shared/positions'
import type { SeasonResult } from '@shared/season'
import { analyseTactic } from '@shared/tactic'
import type { Settings } from '@shared/types'
import { NameBook } from './names'
import { calendar } from './save/contracts'
import { POSITION_COUNT } from './save/reader'
import { ageAt, NO_TEAM, SEX_FEMALE, type SaveWorld } from './save/world'
import type { SeasonService } from './seasonService'
import type { WorldService } from './worldService'

/** 임대를 읽는 규칙이 맞다고 믿으려면 세이브 전체에서 이만큼은 임대 선수가 나와야 한다(게임 데이터베이스에는 수천 명이 임대 중이다) */
const MIN_LOANS_IN_SAVE = 100
/** 영입 추천으로 보여 주는 후보 수 */
const RECOMMEND_SHOWN = 3
/** 같은 리그 순위표가 이 팀 수 이상이어야 "내 리그"의 주급으로 기준을 세운다 */
const MIN_LEAGUE_TEAMS = 8

export interface DashboardDeps {
  world: WorldService
  season: SeasonService
  settings(): Pick<Settings, 'formation' | 'slotRoles' | 'roleWeights'>
  /** 게임에 물어 알게 된 이름(팀 이름)을 적어 둔 폴더 */
  namesDir: string
}

interface Cached {
  world: SaveWorld
  key: string
  data: Promise<DashboardData>
}

/** 선수 나이로 볼 수 없는 값(생일을 잘못 읽은 기록)은 모르는 것으로 둔다 */
const plausibleAge = (age: number | null): number | null => (age !== null && age >= 14 && age <= 50 ? age : null)

const fail = (message: string): DashboardData => ({ ...NO_DASHBOARD, message })

/**
 * 적용한 세이브 하나에서 대시보드에 필요한 모든 값을 계산한다.
 * 같은 세이브 자료(그리고 같은 전술 설정, 같은 게임 값)면 계산한 것을 다시 쓴다.
 */
export class DashboardService {
  private cached: Cached | null = null

  constructor(private readonly deps: DashboardDeps) {}

  dashboard(): Promise<DashboardData> {
    const world = this.deps.world.world
    if (!world || !this.deps.world.path) return Promise.resolve(fail('먼저 세이브를 골라 적용해 주세요.'))
    if (world.teamId === undefined) {
      return Promise.resolve(fail('이 세이브에서 내 팀을 아직 찾지 못했습니다. 게임을 켜고 이 세이브를 불러오면 내 팀을 찾습니다.'))
    }
    const settings = this.deps.settings()
    // 게임의 지금 값을 받으면 능력치가 바뀌므로, 받은 시각이 달라지면 다시 계산한다
    const key = JSON.stringify([this.deps.world.status().liveAt, settings.formation, settings.slotRoles, settings.roleWeights])
    if (this.cached && this.cached.world === world && this.cached.key === key) return this.cached.data
    const data = this.build(world, settings)
    const entry: Cached = { world, key, data }
    this.cached = entry
    // 계산하다 실패하면 다음에 다시 계산하도록 기억하지 않는다
    data.catch(() => {
      if (this.cached === entry) this.cached = null
    })
    return data
  }

  private async build(world: SaveWorld, settings: ReturnType<DashboardDeps['settings']>): Promise<DashboardData> {
    const teamId = world.teamId!
    const path = this.deps.world.path!
    const status = this.deps.world.status()
    const squad = this.deps.world.squad()
    if (!squad.ok) return fail(squad.message ?? '내 팀 선수 표를 만들지 못했습니다.')
    const season: SeasonResult = await this.deps.season.season()

    const book = new NameBook(this.deps.namesDir)
    book.open(basename(path))

    const players = firstTeamPlayers(squad.rows, squad.columns)
    const today = squad.today
    const table = season.ok && season.table ? season.table : null

    // 내 구단과 그 구단의 팀들(1군, 2군·유스)
    let myClub = -1
    for (let k = 0; k < world.count; k++) {
      if (world.teamIds[k] === teamId && world.club[k] >= 0) {
        myClub = world.club[k]
        break
      }
    }
    const clubName = myClub >= 0 ? world.clubs[myClub].name : status.club
    const teamClub = new Map<number, number>()
    const mineCount = new Map<number, { count: number; ageSum: number; aged: number }>()
    for (let k = 0; k < world.count; k++) {
      const team = world.teamIds[k]
      if (team === NO_TEAM || !world.names[k]) continue
      const club = world.club[k]
      if (club >= 0 && !teamClub.has(team)) teamClub.set(team, club)
      if (myClub >= 0 && club === myClub) {
        const entry = mineCount.get(team) ?? { count: 0, ageSum: 0, aged: 0 }
        entry.count++
        const age = ageAt(world, k)
        if (age !== null) {
          entry.ageSum += age
          entry.aged++
        }
        mineCount.set(team, entry)
      }
    }
    const teams: ClubTeam[] = [...mineCount]
      .map(([id, entry]): ClubTeam => ({
        teamId: id,
        name: id === teamId ? clubName : (book.team(id)?.name ?? ''),
        first: id === teamId,
        players: entry.count,
        averageAge: entry.aged > 0 ? Math.round((entry.ageSum / entry.aged) * 10) / 10 : null
      }))
      .sort((a, b) => Number(b.first) - Number(a.first) || b.players - a.players || a.teamId - b.teamId)
    const teamLabel = (id: number): string => {
      if (id === teamId) return clubName
      const found = teams.find((team) => team.teamId === id)
      return found?.name || (found ? '산하 팀' : '')
    }

    // 임대: 선수의 소속 팀(임대받은 팀)과 원 소속 팀(world.loanFrom)이 서로 다른 구단이면 임대다
    let loansInSave = 0
    for (let k = 0; k < world.count; k++) if (world.loanFrom[k] !== NO_TEAM) loansInSave++
    let loans: DashboardData['squad']['loans'] = null
    let loanNote: string | undefined
    if (myClub < 0) {
      loanNote = '이 세이브에서 내 구단의 산하 팀을 알아내지 못해 임대 선수를 가리지 못했습니다.'
    } else if (loansInSave < MIN_LOANS_IN_SAVE) {
      loanNote = '이 세이브에서 임대 기록을 읽지 못해 임대 선수 수를 보여 주지 않습니다.'
    } else {
      const entry = (k: number, team: string, club: number | undefined, teamOfClub: number): LoanEntry => {
        const other = club !== undefined && club >= 0 ? world.clubs[club] : null
        const learned = other ? null : book.team(teamOfClub)
        return {
          uid: world.uids[k],
          name: world.names[k],
          age: plausibleAge(ageAt(world, k)),
          position: positionsLabel([...world.positions.subarray(k * POSITION_COUNT, (k + 1) * POSITION_COUNT)]),
          ca: world.ca[k],
          pa: world.pa[k],
          team,
          otherClub: other ? other.name : (learned ? learned.club || learned.name : ''),
          otherClubUid: other ? other.uid || null : null
        }
      }
      const incoming: LoanEntry[] = []
      const outgoing: LoanEntry[] = []
      for (let k = 0; k < world.count; k++) {
        const lender = world.loanFrom[k]
        if (lender === NO_TEAM || !world.names[k] || world.uids[k] === 0 || world.sex[k] === SEX_FEMALE) continue
        const host = world.club[k]
        const lenderClub = teamClub.get(lender)
        if (host === myClub && lenderClub !== myClub) incoming.push(entry(k, teamLabel(world.teamIds[k]), lenderClub, lender))
        else if (lenderClub === myClub && host !== myClub) outgoing.push(entry(k, host >= 0 ? world.clubs[host].name : '', host, world.teamIds[k]))
      }
      const byCa = (a: LoanEntry, b: LoanEntry): number => (b.ca ?? 0) - (a.ca ?? 0) || a.name.localeCompare(b.name, 'ko')
      loans = { in: incoming.sort(byCa), out: outgoing.sort(byCa) }
    }

    // 전술 분석(스쿼드 전술판과 같은 계산). 역할별 기준 분포(roleNorms)와 함께
    const analysis = analyseTactic({
      rows: squad.rows,
      columns: squad.columns,
      today,
      formation: settings.formation,
      slotRoles: settings.slotRoles,
      roleWeights: settings.roleWeights,
      norms: squad.roleNorms
    })

    const ages = ageStructure(players)
    const contracts = contractWindows(players, today)

    // 정리 후보
    let surplus: DashboardData['surplus'] = { ok: false, message: '전술을 분석하지 못해 정리 후보를 가리지 못했습니다.', formation: settings.formation, medianWage: null, rows: [], prospects: [] }
    if (analysis) {
      surplus = {
        ok: true,
        formation: analysis.formation.label,
        ...surplusReport({ players, rows: squad.rows, columns: squad.columns, analysis, roleWeights: settings.roleWeights })
      }
    }

    // 주급 과다 의심: 내 리그(순위표의 팀들) 선수들의 주급으로 ln(주급) = a + b × 현재 능력을 구한다
    const model = this.wageModel(world, table)
    const over = model ? overpaidPlayers(players, model) : { rows: [], total: 0 }
    const overpaid: DashboardData['overpaid'] = model
      ? { ok: true, model, rows: over.rows, total: over.total }
      : { ok: false, message: '주급 기준을 세울 만큼 선수의 주급을 읽지 못했습니다.', model: null, rows: [], total: 0 }

    // 영입 추천: 가장 보강이 급한 자리의 즉시 전력 후보(영입 후보 화면의 첫 화면과 같은 조건)
    const need = analysis?.byNeed[0] ?? null
    const slot = analysis && need ? recommendSlotOf(analysis.formation.id, need) : null
    let recommend: DashboardData['recommend'] = { ok: false, message: '전술을 분석하지 못해 영입 후보를 고르지 못했습니다.', slot: null, rows: [], matched: 0 }
    if (analysis && need && slot) {
      const found = this.deps.world.candidates({
        roleId: need.slot.roleId,
        category: 'starter',
        maxAge: null,
        onlyEligible: true,
        includeUnknownClub: false,
        search: '',
        expiringWithinMonths: null,
        slot: { formation: analysis.formation.id, slotRoles: settings.slotRoles, index: need.slot.index }
      })
      const rows: RecommendRow[] = found.rows.slice(0, RECOMMEND_SHOWN).map((row) => ({
        uid: row.uid,
        name: row.name,
        age: row.age,
        position: row.position,
        club: row.club,
        clubUid: row.clubUid,
        ca: row.ca,
        pa: row.pa,
        total: row.recommend.total,
        tier: row.tier,
        score: row.score,
        gap: row.gap
      }))
      recommend = {
        ok: found.ok,
        message: found.ok ? (rows.length === 0 ? '이 자리에 조건이 맞는 선수를 찾지 못했습니다.' : undefined) : found.message,
        slot,
        rows,
        matched: found.matched
      }
    }

    const brief = buildBrief({
      table,
      recent: season.recent,
      next: season.upcoming[0] ?? null,
      need: slot
        ? { label: slot.label, roleLabel: slot.roleLabel, need: slot.need, level: slot.level, levelLabel: slot.levelLabel, reason: slot.reason, formation: analysis!.formation.label }
        : null,
      expiring: contracts.known > 0 ? { known: contracts.known, count: contracts.within1y.length, names: contracts.within1y.map((row) => row.name) } : null
    })

    return {
      ok: true,
      meta: {
        saveName: status.save?.name ?? basename(path),
        savedAt: status.save?.savedAt ?? '',
        gameDate: world.gameDate ? calendar(world.gameDate) : null,
        abilitySource: status.source,
        liveAt: status.liveAt,
        club: clubName,
        clubUid: status.clubUid
      },
      brief,
      squad: { firstTeam: players.length, teams, loans, loanNote, ages },
      contracts: {
        known: contracts.known,
        within1y: contracts.within1y,
        within2y: contracts.within2y,
        wageWithin1y: contracts.wageWithin1y
      },
      surplus,
      overpaid,
      recommend
    }
  }

  /** 주급 기준선. 순위표의 팀들(내 리그)이 있으면 그 선수들로, 표본이 모자라면 구단이 있는 모든 남자 선수로 */
  private wageModel(world: SaveWorld, table: SeasonResult['table'] | null): WageModelInfo | null {
    const league = table && table.length >= MIN_LEAGUE_TEAMS ? new Set(table.map((row) => row.teamId)) : null
    const collect = (only: Set<number> | null): Array<{ ca: number; wage: number }> => {
      const points: Array<{ ca: number; wage: number }> = []
      for (let k = 0; k < world.count; k++) {
        const wage = world.wage[k]
        const ca = world.ca[k]
        if (wage <= 0 || ca <= 0 || world.club[k] < 0 || world.clubs[world.club[k]].women || world.sex[k] === SEX_FEMALE) continue
        if (only && !only.has(world.teamIds[k])) continue
        points.push({ ca, wage })
      }
      return points
    }
    if (league) {
      const points = collect(league)
      const fit = fitWageModel(points)
      if (fit) return { ...fit, scope: 'league', teams: league.size }
    }
    const all = collect(null)
    const fit = fitWageModel(all, WAGE_MODEL_MIN_SAMPLE)
    return fit ? { ...fit, scope: 'all', teams: 0 } : null
  }
}
