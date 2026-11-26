import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { NEEDED_PLUGIN, NO_GAME, versionOlder, type ApplyResult, type GameStatus, type LinkStatus, type SaveFileInfo } from '@shared/game'
import { gameState, liveAll } from './talk/bridge'
import { isSaveFile } from './watcher'
import type { WorldService } from './worldService'

/** 게임이 켜져 있는지 묻는 간격 */
const POLL_MS = 3000
/** 게임이 켜져 있는 동안 모든 선수의 지금 값을 다시 받는 간격 */
const LIVE_EVERY_MS = 180_000

const GAME_OFF = '게임이 꺼져 있어 세이브에 저장된 값을 보여 줍니다.'
const oldPluginNote = (version: string): string =>
  `게임에 올라가 있는 연결 플러그인이 옛 버전(${version || '알 수 없음'})이라 세이브에 저장된 값을 보여 줍니다. ` +
  `FM을 완전히 껐다가 다시 켜면 새 버전(${NEEDED_PLUGIN})으로 바뀌고, 그때부터 게임의 지금 값을 읽고 고칠 수 있습니다.`

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 앱과 게임을 잇는 중심.
 *
 * - 게임이 켜져 있는지, 어느 팀으로 들어가 있는지를 계속 확인한다.
 * - 사용자가 고른 세이브를 적용한다(그 세이브의 자료로 모든 화면이 돈다).
 * - 게임이 켜져 있고 적용한 세이브의 팀으로 들어가 있으면, 게임에서 모든 선수의 지금 값을 받아 덮어쓴다.
 * 바뀔 때마다 notify로 화면에 알린다.
 */
export class GameLink {
  private game: GameStatus = NO_GAME
  private roster: string[] = []
  private busy = false
  private stopped = false
  private lastLive = 0

  constructor(
    private readonly world: WorldService,
    private readonly saveDir: () => string,
    private readonly notify: (status: LinkStatus) => void
  ) {}

  /** 게임이 알려 준 내 팀 선수 이름 */
  rosterNames(): string[] {
    return this.roster
  }

  status(): LinkStatus {
    return { game: this.game, data: this.world.status(), busy: this.busy }
  }

  private changed(): void {
    this.notify(this.status())
  }

  /** 세이브 폴더의 세이브 파일들, 최근에 저장한 것부터 */
  saves(): SaveFileInfo[] {
    const dir = this.saveDir()
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(isSaveFile)
      .map((name) => {
        const info = statSync(join(dir, name))
        return { path: join(dir, name), name, savedAt: new Date(info.mtimeMs).toISOString(), bytes: info.size }
      })
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  /** 게임이 켜져 있는 동안 계속 돈다. */
  async run(): Promise<void> {
    while (!this.stopped) {
      await this.check()
      await wait(POLL_MS)
    }
  }

  stop(): void {
    this.stopped = true
  }

  private async check(): Promise<void> {
    const state = await gameState()
    const next: GameStatus = state
      ? {
          connected: true,
          pluginVersion: state.version,
          pluginOld: versionOlder(state.version, NEEDED_PLUGIN),
          loaded: state.loaded,
          manager: state.manager,
          team: state.team,
          teamShort: state.teamShort
        }
      : NO_GAME
    this.roster = state?.players ?? []
    this.world.setLiveOff(!next.connected ? GAME_OFF : next.pluginOld ? oldPluginNote(next.pluginVersion) : null)
    const before = this.game
    this.game = next
    const entered = next.loaded && (!before.loaded || before.team !== next.team)
    if (JSON.stringify(before) !== JSON.stringify(next)) this.changed()
    if (this.busy || !this.world.path) return
    // 게임에 막 들어갔거나, 지금 값을 받은 지 오래됐으면 다시 받는다
    if (next.loaded && (entered || Date.now() - this.lastLive > LIVE_EVERY_MS)) await this.refresh(false)
  }

  private async working<T>(work: () => Promise<T>): Promise<T> {
    this.busy = true
    this.changed()
    // 세이브를 읽는 동안 앱이 잠깐 멈춘다. 화면이 "읽는 중"을 먼저 그릴 틈을 준다
    await wait(40)
    try {
      return await work()
    } finally {
      this.busy = false
      this.changed()
    }
  }

  /** 세이브를 골라 적용한다. 게임이 켜져 있으면 지금 값도 바로 받는다. */
  apply(path: string): Promise<ApplyResult> {
    return this.working(async () => {
      try {
        if (!isSaveFile(path) || !existsSync(path)) return { ok: false, message: '세이브 파일을 찾지 못했습니다.' }
        const world = this.world.apply(path)
        await this.pullLive(false)
        const team = world.teamId === undefined ? ' 내 팀은 아직 찾지 못했습니다. 게임을 켜고 이 세이브를 불러오면 찾습니다.' : ''
        return { ok: true, message: `“${basename(path)}”을 적용했습니다. 선수 ${world.count.toLocaleString()}명을 읽었습니다.${team}` }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  /** 적용한 세이브 파일을 게임이 다시 저장했을 때 */
  async saved(path: string): Promise<void> {
    if (this.busy || this.world.path !== path) return
    await this.working(async () => {
      try {
        if (this.world.reloadIfChanged()) await this.pullLive(false)
      } catch (error) {
        console.error('[game link] reload', error)
      }
    })
  }

  /** 게임에서 지금 값을 다시 받는다. rescan이면 게임이 메모리를 처음부터 다시 훑는다. */
  refresh(rescan: boolean): Promise<void> {
    if (this.busy) return Promise.resolve()
    return this.working(() => this.pullLive(rescan))
  }

  private async pullLive(rescan: boolean): Promise<void> {
    if (!this.world.path) return
    this.lastLive = Date.now()
    if (!this.game.connected) {
      this.world.setNote(GAME_OFF)
      return
    }
    if (this.game.pluginOld) {
      this.world.setNote(oldPluginNote(this.game.pluginVersion))
      return
    }
    if (!this.game.loaded) {
      this.world.setNote('게임에서 아직 세이브를 불러오지 않아, 세이브에 저장된 값을 보여 줍니다.')
      return
    }
    this.world.retryTeam()
    const data = this.world.status()
    // 게임이 다른 팀의 세이브를 불러와 있으면 값을 섞지 않는다
    const sameTeam = data.club.includes(this.game.team) || this.game.team.includes(data.club)
    if (data.hasTeam && data.club && this.game.team && !sameTeam) {
      this.world.setNote(`게임은 지금 ${this.game.team}(으)로 들어가 있습니다. 적용한 세이브의 팀(${data.club})과 달라 세이브에 저장된 값을 보여 줍니다.`)
      return
    }
    const packed = await liveAll(rescan)
    if (packed === null) {
      this.world.setNote('게임에서 지금 값을 받지 못해 세이브에 저장된 값을 보여 줍니다. 게임 안 플러그인이 옛 버전이면 게임을 다시 켜 주세요.')
      return
    }
    const matched = this.world.useLive(packed)
    if (matched === 0) {
      this.world.setNote('게임의 메모리에서 이 세이브의 선수들을 찾지 못해 세이브에 저장된 값을 보여 줍니다.')
    }
  }
}
