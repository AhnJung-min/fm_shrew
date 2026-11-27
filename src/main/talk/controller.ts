import { guessOwnTeam } from '@shared/gameUi'
import { type TalkLine, type TalkScene, type TalkStatus, type TalkUsage } from '@shared/talk'
import type { SettingsStore } from '../settings'
import { respond, type AdvisorConfig } from './advisor'
import { bridgeAlive, readFromGame, readMatchFromGame, sendReply, waitForWords, type GameReply, type GameWords } from './bridge'
import type { KeyStore } from './keyStore'
import { K } from '@shared/ledger'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 두 장면이 같은 질문·같은 선택지인지 */
function sameScene(a: Pick<TalkScene, 'question' | 'options'>, b: Pick<TalkScene, 'question' | 'options'>): boolean {
  return a.question === b.question && a.options.length === b.options.length && a.options.every((o, i) => o.text === b.options[i].text)
}

/**
 * 게임 안 "직접 답변" 칸의 앱 쪽 일꾼.
 * 게임 안 플러그인이 칸에 적힌 말을 넘겨주면, 게임에서 읽은 질문·선택지와 함께 AI에게 물어 답을 돌려보낸다.
 */
export class TalkController {
  private nextId = 1
  /** 게임 안 칸에서 이어지는 대화. 질문이 바뀌면 비운다 */
  private gameTalk: { scene: TalkScene; history: TalkLine[] } | null = null
  private disposed = false

  constructor(
    private keys: KeyStore,
    private settings: SettingsStore,
    /** 세이브에서 읽은 내 팀 선수 이름. AI가 이름 표기를 맞추는 데 쓴다 */
    private getSquadNames: () => string[]
  ) {}

  async status(): Promise<TalkStatus> {
    return { hasKey: this.keys.has(), game: await bridgeAlive() }
  }

  private config(): AdvisorConfig | null {
    const apiKey = this.keys.read()
    if (!apiKey) return null
    const { talkModel, talkEffort } = this.settings.get()
    return { apiKey, model: talkModel, effort: talkEffort }
  }

  private count(usage: TalkUsage | undefined): void {
    if (!usage) return
    const stats = this.settings.get().talkStats
    this.settings.set({
      talkStats: {
        requests: stats.requests + 1,
        inputTokens: stats.inputTokens + usage.inputTokens,
        outputTokens: stats.outputTokens + usage.outputTokens
      }
    })
  }

  /**
   * 게임이 켜져 있는 동안 계속 돌면서,
   * 칸에 말이 적히면 AI에게 물어 상대의 반응과 적용할 선택지를 게임으로 돌려보낸다.
   */
  async serveGame(): Promise<void> {
    let after = 0
    while (!this.disposed) {
      const got = await waitForWords(after)
      if (got === 'offline') {
        // 게임이 꺼져 있다. 켜질 때까지 가끔 확인한다
        after = 0
        await wait(4000)
        continue
      }
      if (!got) continue
      after = got.seq
      let reply: GameReply
      try {
        reply = await this.answerInGame(got.words, got.kind)
      } catch (error) {
        reply = { pick: 0, pickText: '', note: '', replies: [], error: error instanceof Error ? error.message : String(error) }
      }
      await sendReply(got.seq, reply)
    }
  }

  private async answerInGame(words: string, kind: GameWords['kind']): Promise<GameReply> {
    const fail = (error: string): GameReply => ({ pick: 0, pickText: '', note: '', replies: [], error })
    const config = this.config()
    if (!config) return fail('Claude API 키가 없습니다. FM 보좌관 앱의 설정에서 키를 넣어 주세요.')
    const shout = kind === 'shout'
    const game = shout ? await readMatchFromGame() : await readFromGame()
    if (!game || game.options.length === 0) {
      return fail(shout ? '외침 목록을 읽지 못했습니다. 다시 말해 주세요.' : '지금 화면에서 고를 선택지를 찾지 못했습니다.')
    }

    const scene: TalkScene = {
      id: this.nextId++,
      readable: true,
      source: 'game',
      screen: game.screen,
      situation: game.situation,
      speaker: game.speaker,
      question: game.question,
      options: game.options,
      facts: game.teams ? [...game.facts, this.ownTeamFact(game.teams)] : game.facts
    }
    if (!this.gameTalk || !sameScene(this.gameTalk.scene, scene)) this.gameTalk = { scene, history: [] }
    const talk = this.gameTalk
    talk.scene = scene

    const result = await respond(config, scene, talk.history, words, this.getSquadNames())
    if (!result.ok || !result.turn) return fail(result.message ?? '답을 받지 못했습니다.')
    this.count(result.usage)
    const turn = result.turn
    talk.history.push({ from: 'me', speaker: '감독', text: words })
    for (const line of turn.replies) talk.history.push({ from: 'them', speaker: line.speaker, text: line.text })

    const option = turn.pickIndex === null ? undefined : scene.options[turn.pickIndex]
    if (!option || option.ref === undefined) {
      return { pick: 0, pickText: '', note: turn.reason || '맞는 선택지를 찾지 못했습니다.', replies: turn.replies }
    }
    const what = shout ? '외침' : '선택지'
    const lead = turn.confidence < K.LOW_CONFIDENCE ? `딱 맞는 ${what}이 없어 가장 가까운 것` : `적용할 ${what}`
    const tone = option.tone ? ` (${option.tone})` : ''
    return { pick: option.ref, pickText: option.text, note: `${lead}${tone}: ${option.text}`, replies: turn.replies }
  }

  /**
   * 점수판의 두 팀 가운데 어느 쪽이 우리 팀인지 AI에게 알려 줄 문장.
   * 게임 화면에는 그 표시가 없어서, 여러 경기에 계속 나오는 약칭을 우리 팀으로 본다.
   */
  private ownTeamFact(teams: [string, string]): string {
    const pair = teams.join('|')
    const seen = this.settings.get().matchPairs
    if (!seen.includes(pair)) this.settings.set({ matchPairs: [...seen, pair].slice(-12) })
    const own = guessOwnTeam(this.settings.get().matchPairs)
    if (own && teams.includes(own)) return `우리 팀은 ${own}입니다.`
    return '점수판의 두 팀 가운데 어느 쪽이 우리 팀인지는 알 수 없습니다. 이기고 있다거나 지고 있다고 단정하지 마세요.'
  }

  dispose(): void {
    this.disposed = true
  }
}
