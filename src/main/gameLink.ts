import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { checkGameVersion, SUPPORTED_VERSIONS } from '@shared/compat'
import type { ExtendedLinkStatus } from '@shared/connect'
import { MARKET_PLUGIN, NEEDED_PLUGIN, NO_GAME, versionOlder, type ApplyResult, type GameStatus, type SaveFileInfo } from '@shared/game'
import { oldPluginNotice } from '@shared/pluginGates'
import { peekSaveVersion } from './save/peek'
import { gameNames, gameState, liveAll, NAMES_PER_REQUEST } from './talk/bridge'
import { isSaveFile } from './watcher'
import type { WorldService } from './worldService'
import { WON_RATE_TEXT } from '@shared/playerView'

/** 게임이 켜져 있는지 묻는 간격 */
const POLL_MS = 3000
/** 게임이 켜져 있는 동안 모든 선수의 지금 값을 다시 받는 간격 */
const LIVE_EVERY_MS = 180_000

const GAME_OFF = '게임이 꺼져 있어 세이브에 저장된 값을 보여 줍니다.'
/** 옛 플러그인 안내. 앱이 요구하는 버전은 shared/pluginGates.ts의 표에서 만든다(숫자를 여기 적지 않는다) */
const oldPluginNote = (version: string): string => `${oldPluginNotice(version)} 그 전까지는 세이브에 저장된 값을 보여 줍니다.`

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
  private learning = false
  /** 세이브 파일마다 엿본 게임 판 글자. 파일이 같으면(저장 시각과 크기가 같으면) 다시 읽지 않는다 */
  private readonly versions = new Map<string, { stamp: string; text: string | null }>()
  /** 게임 판을 확인하지 못해 적용하지 않은 세이브의 안내. 적용한 세이브가 없는 동안 상태의 note로 보인다(앱을 켤 때 자동 적용을 건너뛴 까닭) */
  private skipped: string | null = null

  constructor(
    private readonly world: WorldService,
    private readonly saveDir: () => string,
    private readonly notify: (status: ExtendedLinkStatus) => void
  ) {}

  /** 게임이 알려 준 내 팀 선수 이름 */
  rosterNames(): string[] {
    return this.roster
  }

  status(): ExtendedLinkStatus {
    const data = this.world.status()
    // 적용한 세이브가 없는 동안에는 적용을 건너뛴 까닭(게임 판을 확인하지 못함)을 상태 글에 싣는다
    return { game: this.game, data: this.skipped && !data.save ? { ...data, note: this.skipped } : data, busy: this.busy, ...this.world.extras() }
  }

  private changed(): void {
    this.notify(this.status())
  }

  /** 세이브를 저장한 게임의 판 글자(세이브 요약에서 엿본다). 읽지 못했으면 null. 같은 파일은 다시 읽지 않는다 */
  private versionOf(path: string, mtimeMs: number, bytes: number): string | null {
    const stamp = `${mtimeMs}|${bytes}`
    const known = this.versions.get(path)
    if (known && known.stamp === stamp) return known.text
    const text = peekSaveVersion(path)
    this.versions.set(path, { stamp, text })
    return text
  }

  /** 세이브 폴더의 세이브 파일들, 최근에 저장한 것부터. 파일마다 저장한 게임의 판과 앱이 확인한 판인지를 싣는다 */
  saves(): SaveFileInfo[] {
    const dir = this.saveDir()
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(isSaveFile)
      .map((name): SaveFileInfo => {
        const path = join(dir, name)
        const info = statSync(path)
        const check = checkGameVersion(this.versionOf(path, info.mtimeMs, info.size))
        return {
          path,
          name,
          savedAt: new Date(info.mtimeMs).toISOString(),
          bytes: info.size,
          ...(check.version === null ? {} : { gameVersion: check.version }),
          versionStatus: check.status
        }
      })
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  /** 이 세이브를 저장한 게임의 판을 앱이 확인하지 않았거나 읽지 못했을 때의 안내. 확인한 판이면 null */
  private versionProblem(path: string): string | null {
    const info = statSync(path)
    const check = checkGameVersion(this.versionOf(path, info.mtimeMs, info.size))
    if (check.status === 'ok') return null
    const known = SUPPORTED_VERSIONS.map((row) => row.game).join(', ')
    return check.status === 'unsupported'
      ? `이 세이브는 게임 판 ${check.version}에서 저장한 것으로 보이는데, 앱이 확인한 판(${known})이 아닙니다. 세이브 형식이 달라졌을 수 있어 값이 틀리게 보일 수 있습니다. 그래도 읽으려면 한 번 더 확인해 주세요.`
      : `이 세이브를 저장한 게임의 판을 읽지 못했습니다(확인 못 함). 앱이 확인한 판은 ${known}입니다. 세이브 형식이 달라졌을 수 있어 값이 틀리게 보일 수 있습니다. 그래도 읽으려면 한 번 더 확인해 주세요.`
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
          teamShort: state.teamShort,
          // 게임 판은 플러그인 0.14.0부터 알려 준다. 옛 플러그인이면 이 칸이 없다
          ...(state.gameVersion === undefined ? {} : { gameVersion: state.gameVersion })
        }
      : NO_GAME
    this.roster = state?.players ?? []
    this.world.setLiveOff(!next.connected ? GAME_OFF : next.pluginOld ? oldPluginNote(next.pluginVersion) : null)
    this.world.setMarketOff(
      !next.connected
        ? `게임이 꺼져 있어 몸값과 주급은 세이브에 적힌 값(파운드)을 원화로 바꿔(${WON_RATE_TEXT}) 보여 줍니다.`
        : versionOlder(next.pluginVersion, MARKET_PLUGIN)
          ? `몸값과 주급은 세이브에 적힌 값(파운드)을 원화로 바꿔(${WON_RATE_TEXT}) 보여 줍니다. 게임이 보여 주는 금액과 나라·구단 이름은 FM을 완전히 껐다가 다시 켜면 채워집니다(게임에 올라가 있는 플러그인 ${next.pluginVersion}, 필요한 버전 ${MARKET_PLUGIN}).`
          : !next.loaded
            ? '게임에서 세이브를 불러오면 게임이 보여 주는 금액과 나라·구단 이름이 채워집니다.'
            : null
    )
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

  /**
   * 세이브를 골라 적용한다. 게임이 켜져 있으면 지금 값도 바로 받는다.
   * 그 세이브를 저장한 게임의 판이 앱이 확인한 판(shared/compat.ts의 지원 표)이 아니거나 읽을 수 없으면, 적용하지 않고 needsConfirm으로 돌려준다.
   * 사용자가 확인한 뒤 allowUnknownVersion으로 다시 부르면 적용한다. 앱을 켤 때의 자동 적용은 이 선택값 없이 불러서 그런 세이브를 저절로 건너뛴다.
   */
  apply(path: string, options: { allowUnknownVersion?: boolean } = {}): Promise<ApplyResult> {
    return this.working(async () => {
      try {
        if (!isSaveFile(path) || !existsSync(path)) return { ok: false, message: '세이브 파일을 찾지 못했습니다.' }
        const unconfirmed = this.versionProblem(path)
        if (unconfirmed !== null && options.allowUnknownVersion !== true) {
          this.skipped = unconfirmed
          return { ok: false, needsConfirm: true, message: unconfirmed }
        }
        this.skipped = null
        const world = this.world.apply(path)
        // 세이브를 다 읽었으면 바로 알린다. 게임의 지금 값을 받는 데는 몇 초 더 걸릴 수 있어, 그동안 화면이 비어 있지 않게
        this.changed()
        await this.pullLive(false)
        const team = world.teamId === undefined ? ' 내 팀은 아직 모릅니다. 아래에서 내 구단을 고르거나, 게임을 켜고 이 세이브를 불러오세요.' : ''
        const format = this.world.blocked() ? ' 세이브 형식이 바뀐 것 같아 점수 화면은 막았습니다.' : ''
        return { ok: true, message: `“${basename(path)}”을 적용했습니다. 선수 ${world.count.toLocaleString()}명을 읽었습니다.${format}${team}` }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  /** 사용자가 고른 구단을 이 세이브의 내 구단으로 정한다. 게임이 켜져 있으면 지금 값도 다시 받는다 */
  chooseTeam(teamId: number): Promise<ApplyResult> {
    return this.working(async () => {
      try {
        const result = this.world.chooseTeam(Number(teamId))
        if (!result.ok) return result
        this.changed()
        await this.pullLive(false)
        return result
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
    // 게임이 이 세이브의 다른 구단으로 들어가 있으면 게임이 맞다(사용자가 직접 고른 구단이 틀렸을 수 있다)
    this.world.followGame()
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
      return
    }
    // 게임이 이 세이브를 불러와 있는 것이 확인됐다. 세이브에 번호만 있는 이름들을 뒤에서 조금씩 물어 채운다
    void this.learnNames()
  }

  /**
   * 나라 이름, 그리고 팀의 이름·구단·여자 팀 여부를 게임에 물어 적어 둔다(한 번 알아낸 것은 파일에 남는다).
   * 순서: 나라 → 세이브에서 구단을 알아내지 못한 팀 → 나머지 팀. 한 단계가 끝날 때마다 화면에 알린다.
   */
  private async learnNames(): Promise<void> {
    if (this.learning || versionOlder(this.game.pluginVersion, MARKET_PLUGIN)) return
    this.learning = true
    try {
      const missing = this.world.missingNames()
      const steps: Array<['team' | 'nation', number[]]> = [
        ['nation', missing.nations],
        ['team', missing.urgentTeams],
        ['team', missing.otherTeams]
      ]
      for (const [step, [kind, ids]] of steps.entries()) {
        for (let from = 0; from < ids.length; from += NAMES_PER_REQUEST) {
          if (this.stopped || !this.game.loaded) return
          const batch = ids.slice(from, from + NAMES_PER_REQUEST)
          const answers = await gameNames(kind, batch)
          // 게임이 바쁘거나 꺼졌다. 다음에 값을 다시 받을 때 이어서 한다
          if (answers === null) return
          this.world.learnNames(kind, batch, answers)
          await wait(120)
        }
        this.world.namesReached(step + 1)
        this.changed()
      }
    } catch (error) {
      console.error('[game link] names', error)
    } finally {
      this.learning = false
    }
  }
}
