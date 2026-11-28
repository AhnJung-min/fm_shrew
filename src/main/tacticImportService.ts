import { activeCatalog } from '@shared/catalogs'
import type { RosterPlayer } from '@shared/club'
import { gameReadGate } from '@shared/compat'
import type { GameStatus } from '@shared/game'
import type { RoleCatalog } from '@shared/roleCatalog'
import { tacticImportFailed, type TacticImportResult } from '@shared/tacticApi'
import { parseTacticAnswer, roleListReport, tacticFromGame } from '@shared/tacticImport'
import { firstTeam } from './clubService'
import type { Phase2Deps } from './tacticIpc'
import { gameTactic } from './talk/bridge'
import { NO_TEAM_MESSAGE } from './worldService'

/**
 * 게임에서 전술 가져오기(A-01). 게임이 켜져 있고, 플러그인이 0.14.0 이상이고, 게임 판이 지원 표(shared/compat.ts)에 있을 때,
 * 세이브의 내 팀 선수 번호와 팀 번호로 게임의 지금 전술을 읽어 쓰는 카탈로그의 전술 초안으로 바꾼다. 초안은 저장하지 않는다:
 * 사용자가 편집기에서 확인하고 저장할 때만 설정에 쓴다(tacticsSave). 게임에는 아무것도 쓰지 않는다.
 */

/** 선수 번호를 못 찾으면 다음 선수로 해 보는 최대 횟수 */
const MAX_TRIES = 3
/** 이 시간 안에 실패했으면 선수를 찾지 못한 것으로 보고 다음 선수로 해 본다. 더 걸린 실패(시간 초과, 게임이 바쁨)는 다른 선수로 해도 같다 */
const QUICK_FAIL_MS = 10_000
/** 자리 11개 × 두 국면 */
const ROLE_LISTS_EXPECTED = 22

const BUSY_MESSAGE = '게임이 바쁩니다. 날짜를 넘기는 중이거나 경기 중이면 끝난 뒤에 다시 눌러 주세요. 계속 안 되면 게임에서 이 세이브를 불러왔는지 확인해 주세요. 지금은 전술을 직접 만들어 주세요.'

/** 자리별 역할 목록을 견준 결과 한 줄(안내 글 뒤에 붙는다). 읽은 수와 견준 수와 다른 수를 모두 적어, 견주지 못한 것이 "다른 곳 없음"으로 읽히지 않게 한다 */
function roleListNote(received: number, compared: number, different: number): string {
  if (compared === 0) return ` 자리별 역할 목록은 하나도 견주지 못했습니다(읽은 목록 ${received}곳, 전체 ${ROLE_LISTS_EXPECTED}곳).`
  return ` 자리별 역할 목록은 ${received}곳(전체 ${ROLE_LISTS_EXPECTED}곳)을 읽어 ${compared}곳을 견주었고, 그 가운데 ${different}곳이 앱의 목록과 달랐습니다.`
}

export interface GameTacticInput {
  /** 게임 연결 상태(게임 판과 플러그인 버전을 본다) */
  game: Pick<GameStatus, 'connected' | 'pluginVersion' | 'gameVersion'>
  /** 세이브에서 찾은 내 팀 번호 */
  teamId: number
  /** 내 팀 선수 고유 번호. 앞에서부터 MAX_TRIES명까지 해 본다 */
  uids: number[]
  /** 전술을 풀어 넣을 카탈로그 */
  catalog: RoleCatalog
  /** 자리마다 고를 수 있는 역할 목록도 읽어 앱의 목록과 견준다(느리다) */
  readRoleLists: boolean
  /** 새 전술의 번호 */
  id: string
}

/** 게임에 묻고 풀어 전술 초안을 만든다. 게임이 켜져 있는지, 플러그인과 게임 판이 맞는지도 여기서 본다(나머지 조건은 importTactic이 본다) */
export async function readGameTactic(input: GameTacticInput): Promise<TacticImportResult> {
  const started = Date.now()
  const gate = gameReadGate(input.game, 'tactic')
  if (!gate.open || !gate.row) return tacticImportFailed(gate.reason)
  if (input.catalog.id !== gate.row.catalog.id) {
    return tacticImportFailed('지금은 옛 14역할 목록을 쓰고 있어 게임 전술을 가져올 수 없습니다. 게임의 역할은 FM26 역할 목록으로만 읽을 수 있습니다.')
  }

  let raw: unknown | null = null
  for (const uid of input.uids.slice(0, MAX_TRIES)) {
    const asked = Date.now()
    raw = await gameTactic(input.teamId, uid, input.readRoleLists)
    if (raw === null) {
      if (Date.now() - asked > QUICK_FAIL_MS) break
      continue
    }
    // 이 선수로는 자리가 하나도 오지 않았으면 다음 선수로 해 본다(읽을 수 없는 답은 다른 선수로 해도 같다)
    const read = parseTacticAnswer(raw)
    if (!read || read.ip.rows.length + read.oop.rows.length > 0) break
  }
  if (raw === null) return tacticImportFailed(BUSY_MESSAGE)
  const answer = parseTacticAnswer(raw)
  if (!answer) return tacticImportFailed('게임이 준 전술 정보를 읽지 못했습니다. 게임 안 플러그인과 앱의 버전이 맞는지 확인해 주세요. 지금은 전술을 직접 만들어 주세요.')

  const converted = tacticFromGame(answer, input.catalog, gate.row, input.id)
  const report = input.readRoleLists && converted.tactic ? roleListReport(answer, input.catalog, gate.row, converted.tactic) : null
  const gameName = answer.ip.name || answer.oop.name
  const formationName = answer.ip.formation || answer.oop.formation
  // 받은 목록 가운데 자리를 찾지 못해 견주지 못한 것은 "다른 곳 없음"으로 읽히지 않게 따로 알린다(U4 자료의 "확인 전" 칸을 이 결과로 고친다)
  const received = answer.roleLists.length
  const notCompared = report ? received - report.compared : 0
  const problems = [
    ...converted.problems,
    ...(report?.lines ?? []),
    ...(notCompared > 0 ? [`자리별 역할 목록 ${notCompared}곳은 자리를 찾지 못해 견주지 못했습니다.`] : [])
  ]
  const listNote = report ? roleListNote(received, report.compared, report.different) : ''
  const message = converted.tactic
    ? converted.ok
      ? `게임의 지금 전술${gameName ? ` “${gameName}”` : ''}을 읽었습니다. 편집기에서 확인한 뒤 저장해 주세요.${listNote}`
      : `게임의 지금 전술${gameName ? ` “${gameName}”` : ''}을 읽었지만 확인할 것이 있습니다. 아래를 살펴본 뒤 편집기에서 고쳐 저장해 주세요.${listNote}`
    : '게임의 전술을 앱의 전술로 바꾸지 못했습니다. 아래 까닭을 확인하고 전술을 직접 만들어 주세요.'
  return {
    ok: converted.ok,
    message,
    ...(converted.tactic ? { draft: converted.tactic } : {}),
    problems,
    unknownBits: converted.unknownBits,
    ...(gameName ? { gameName } : {}),
    ...(formationName ? { formationName } : {}),
    elapsedMs: Date.now() - started
  }
}

/**
 * 전술을 물을 선수 번호들(앞에서부터 해 본다). 게임은 선수를 거쳐 "그 선수의 지금 팀"의 전술을 주므로, 그 선수가 지금도 내 팀이어야 한다.
 * 세이브의 소속은 마지막으로 저장했을 때의 것이라, 저장한 뒤에 팔았거나 2군으로 내린 선수가 앞에 있으면 다른 팀의 전술이 올 수 있다.
 * 그래서 게임이 알려 준 지금 내 팀 선수 이름(/state)에 있는 선수만 쓴다. 게임이 이름을 알려 주지 않았거나 겹치는 선수가 하나도 없으면 세이브의 순서 그대로다.
 */
function playersToAsk(mine: RosterPlayer[], currentNames: readonly string[]): number[] {
  const now = new Set(currentNames)
  const present = mine.filter((player) => now.has(player.name))
  return (present.length > 0 ? present : mine).map((player) => player.uid)
}

export async function importTactic(deps: Phase2Deps, options?: { readRoleLists?: boolean }): Promise<TacticImportResult> {
  const link = deps.link.status()
  const world = deps.world.world
  if (!world || !deps.world.path) return tacticImportFailed('먼저 시작 화면에서 세이브를 골라 적용해 주세요.')
  if (world.teamId === undefined) return tacticImportFailed(NO_TEAM_MESSAGE)
  // 게임이 꺼져 있거나 플러그인·게임 판이 맞지 않으면 그 까닭을 먼저 알린다(그 기능만 꺼진다)
  const gate = gameReadGate(link.game, 'tactic')
  if (!gate.open) return tacticImportFailed(gate.reason)
  if (!link.game.loaded) return tacticImportFailed('게임에서 세이브를 불러온 뒤에 전술을 가져올 수 있습니다.')
  const club = link.data.club
  if (club && link.game.team && !club.includes(link.game.team) && !link.game.team.includes(club)) {
    return tacticImportFailed(`게임은 지금 ${link.game.team}(으)로 들어가 있어 적용한 세이브의 팀(${club})과 다릅니다. 같은 세이브를 불러와 주세요.`)
  }
  return readGameTactic({
    game: link.game,
    teamId: world.teamId,
    uids: playersToAsk(firstTeam(world), deps.link.rosterNames()),
    catalog: activeCatalog(deps.settings.get()),
    readRoleLists: options?.readRoleLists === true,
    id: `game:${Date.now().toString(36)}`
  })
}
