import { buildSnapshot, emptySnapshot, HEALTH_PER_REQUEST, type ClubSnapshot, type PluginAnswer, type RosterPlayer } from '@shared/club'
import { CLUB_PLUGIN, versionOlder, type LinkStatus } from '@shared/game'
import { positionOrder, positionsLabel } from '@shared/positions'
import { POSITION_COUNT } from './save/reader'
import type { SaveWorld } from './save/world'
import { gameClub, gameHealth } from './talk/bridge'
import type { WorldService } from './worldService'

/** 게임에서 받은 구단·선수단 상태를 다시 묻지 않고 쓰는 시간 */
const KEEP_MS = 3 * 60_000

/** 내 팀(세이브에서 찾은 팀 번호)의 1군 선수 */
export function firstTeam(world: SaveWorld): RosterPlayer[] {
  if (world.teamId === undefined) return []
  const rows: Array<{ player: RosterPlayer; order: number }> = []
  for (let k = 0; k < world.count; k++) {
    if (world.teamIds[k] !== world.teamId || !world.names[k] || world.uids[k] === 0) continue
    const positions = [...world.positions.subarray(k * POSITION_COUNT, (k + 1) * POSITION_COUNT)]
    rows.push({ player: { uid: world.uids[k], name: world.names[k], position: positionsLabel(positions) }, order: positionOrder(positions) })
  }
  return rows.sort((a, b) => a.order - b.order || a.player.name.localeCompare(b.player.name, 'ko')).map((row) => row.player)
}

/**
 * 대시보드의 "구단 프로필·시설·재정"과 "선수단 건강·경기력".
 * 세이브에 없는 값이라 켜져 있는 게임에 물어 받고(플러그인 /club, /health), 몇 분 동안 기억해 둔다.
 * 게임이 꺼져 있거나 플러그인이 옛 버전이거나 게임이 이 세이브를 불러오지 않았으면, 그 이유를 한 줄로 돌려준다.
 */
export class ClubService {
  private cache: { key: string; at: number; snapshot: ClubSnapshot } | null = null
  private pending: Promise<ClubSnapshot> | null = null

  constructor(
    private readonly world: WorldService,
    private readonly status: () => LinkStatus
  ) {}

  /** force가 true면 기억해 둔 것을 쓰지 않고 다시 묻는다 */
  snapshot(force = false): Promise<ClubSnapshot> {
    this.pending ??= this.read(force).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  private async read(force: boolean): Promise<ClubSnapshot> {
    const link = this.status()
    const { game } = link
    const world = this.world.world
    if (!game.connected) return emptySnapshot('off', 'FM이 켜져 있어야 구단 재정·시설과 선수단 건강을 읽을 수 있습니다. 게임을 켜고 세이브를 불러와 주세요.')
    if (versionOlder(game.pluginVersion, CLUB_PLUGIN)) {
      return emptySnapshot(
        'old',
        `이 정보는 게임 안 플러그인 ${CLUB_PLUGIN} 이상에서 읽습니다(지금 올라가 있는 것은 ${game.pluginVersion || '알 수 없는 버전'}). FM을 완전히 껐다가 다시 켜 주세요.`
      )
    }
    if (!world || !this.world.path) return emptySnapshot('noSave', '먼저 홈 화면에서 세이브를 골라 적용해 주세요.')
    if (world.teamId === undefined) {
      return emptySnapshot('noTeam', '이 세이브에서 내 팀을 아직 찾지 못했습니다. 게임을 켜고 이 세이브를 불러오면 내 팀을 찾습니다.')
    }
    if (!game.loaded) return emptySnapshot('notLoaded', '게임에서 세이브를 불러오면 구단 재정·시설과 선수단 건강이 채워집니다.')
    const club = link.data.club
    if (club && game.team && !club.includes(game.team) && !game.team.includes(club)) {
      return emptySnapshot('otherTeam', `게임은 지금 ${game.team}(으)로 들어가 있어 적용한 세이브의 팀(${club})과 다릅니다. 같은 세이브를 불러와 주세요.`)
    }

    const key = `${this.world.path}|${world.teamId}|${game.team}`
    if (!force && this.cache && this.cache.key === key && Date.now() - this.cache.at < KEEP_MS) return this.cache.snapshot

    const roster = firstTeam(world)
    const clubAnswer = await gameClub(world.teamId)
    let health: PluginAnswer | null = null
    if (clubAnswer !== null) {
      const records: PluginAnswer['records'] = []
      const paths: PluginAnswer['paths'] = {}
      let answered = false
      for (let from = 0; from < roster.length; from += HEALTH_PER_REQUEST) {
        const batch = await gameHealth(
          roster.slice(from, from + HEALTH_PER_REQUEST).map((player) => player.uid),
          world.teamId
        )
        if (batch === null) break
        answered = true
        records.push(...batch.records)
        Object.assign(paths, batch.paths)
      }
      if (answered) health = { records, paths, skipped: [] }
    }
    if (clubAnswer === null || (clubAnswer.records.length === 0 && (health?.records.length ?? 0) === 0)) {
      return emptySnapshot(
        'noAnswer',
        '게임이 구단과 선수 정보를 알려 주지 않았습니다. 게임이 날짜를 넘기는 중이거나 메뉴 화면이면 잠시 뒤에 다시 읽습니다. 계속 안 되면 게임에서 이 세이브를 불러왔는지 확인해 주세요.'
      )
    }
    const snapshot = buildSnapshot({ club: clubAnswer, health, roster, readAt: new Date().toISOString() })
    this.cache = { key, at: Date.now(), snapshot }
    return snapshot
  }
}
