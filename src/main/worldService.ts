import { existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { expectedWage, type WageCoefs } from '@shared/dashboard'
import type { ClubChoices, EditorApplyReport, EditorPlayerResult, LinkExtras, SaveCheck } from '@shared/connect'
import { SAVE_CHECK_OK } from '@shared/connect'
import { NO_DATA, type DataStatus, type SaveFileInfo } from '@shared/game'
import { POSITION_KEYS, PLAYABLE_RATING, positionOrder, positionsLabel } from '@shared/positions'
import { footValues, formatPounds, hiddenAttributes, isGoalkeeper, visibleAttributes } from '@shared/playerView'
import { normOf, type RoleNorms } from '@shared/norms'
import { prepareRole, ROLE_BY_ID, savedRoleScore } from '@shared/roles'
import {
  clubStature,
  recommend,
  squadMoney,
  tierRanker,
  TRAIT_WEIGHTS,
  type RecommendContext,
  type RecommendInput,
  type RecommendTierId,
  type TraitId,
  type Traits
} from '@shared/recommend'
import { analyseTactic, slotBench } from '@shared/tactic'
import {
  categoriesOf,
  checkEdit,
  effectiveScore,
  gapVsAnchor,
  rotationWindowOf,
  SAVE_ATTRIBUTE_ORDER,
  shownValue,
  type CandidateBench,
  type CandidateCategory,
  type CandidateQuery,
  type CandidateResult,
  type CandidateRow,
  type EditorEdit,
  type EditorListItem,
  type EditorPlayer,
  type MarketResult,
  type PlayerMarket,
  type PlayerProfile,
  parseGameDate,
  SQUAD_STATUS_LABEL
} from '@shared/world'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from './save/reader'
import { ageAt, findTeamByNames, NO_TEAM, readWorld, SEX_FEMALE, signedClubTeam, teamHasPlayers, type SaveWorld } from './save/world'
import { clubChoices } from './clubChoices'
import { playerResult, reportOf, skippedResult } from './editorReport'
import { computeRoleNorms } from './roleNorms'
import { checkSaveWorld } from './saveCheck'
import { NameBook } from './names'
import { calendar } from './save/contracts'
import { squadTable, type SquadTable } from './squad'
import { gamePeople, livePlayer, liveSetOutcome, PEOPLE_PER_REQUEST, type GameName } from './talk/bridge'

/** 게임에서 받은 시장 정보를 다시 묻지 않고 쓰는 시간 */
const MARKET_KEEP_MS = 10 * 60_000
/** 영입 후보로 한 번에 보여 주는 줄 수 */
const MAX_ROWS = 300
/** 에디터에서 이름으로 찾을 때 보여 주는 줄 수 */
const MAX_FOUND = 80
/** 임대를 읽는 규칙이 맞다고 믿으려면 세이브 전체에서 이만큼은 임대 선수가 나와야 한다(게임 데이터베이스에는 수천 명이 임대 중이다) */
export const MIN_LOANS_IN_SAVE = 100
/** 게임이 한 덩어리로 넘겨주는 선수 한 명의 크기: 번호 4 + 현재·잠재 능력 4 + 숙련도 15 + 능력치 54 */
const PACKED_SIZE = 8 + POSITION_COUNT + ATTRIBUTE_COUNT

const ATTRIBUTE_INDEX = new Map<string, number>(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))
const POSITION_INDEX = new Map<string, number>(POSITION_KEYS.map((key, i) => [key, i]))
const NO_SAVE = '먼저 시작 화면에서 세이브를 골라 적용해 주세요.'
/** 내 팀을 모를 때 화면마다 보여 주는 안내 */
export const NO_TEAM_MESSAGE = '이 세이브에서 내 팀을 아직 찾지 못했습니다. 시작 화면에서 내 구단을 고르거나, 게임을 켜고 이 세이브를 불러오세요.'
/** 세이브 형식 점검에 걸렸을 때 점수 화면에 주는 안내(걸린 내용은 화면이 따로 보여 준다) */
export const FORMAT_CHANGED_MESSAGE = '세이브 형식이 바뀐 것 같습니다. 틀린 점수를 보여 주지 않으려고 이 화면을 막았습니다.'

interface Loaded {
  path: string
  mtimeMs: number
  size: number
  world: SaveWorld
  /** 선수 고유 번호 → 순번 */
  byUid: Map<number, number>
  /** 게임에서 지금 값을 받아 덮어쓴 시각과 선수 수. 받은 적이 없으면 null */
  live: { at: number; matched: number } | null
  note: string
  /** 세이브 형식 자가 점검 결과(A-16). 시험에서 직접 끼워 넣은 자료에는 없을 수 있고, 없으면 이상 없음으로 본다 */
  check?: SaveCheck
}

export interface WorldDeps {
  /** 이 세이브에서 이미 찾아 둔 내 팀 번호 */
  knownTeam(fileName: string): number | undefined
  /** 켜져 있는 게임이 알려 준 내 팀 선수 이름(내 팀을 처음 찾을 때 대조한다). 게임이 꺼져 있으면 빈 목록 */
  rosterNames(): string[]
  /** 찾아낸 내 팀 번호를 기억해 둔다 */
  rememberTeam(fileName: string, teamId: number): void
  roleWeights(): Record<string, Record<string, number>>
  /**
   * 대시보드의 리그 주급 모델(ln 주급 = a + b·CA + 나이 더미). 소속 없는 선수의 주급을 어림하는 데 쓴다(4회차).
   * 이미 계산해 둔 것을 돌려주기만 한다(계산은 한 번). 아직 없으면 null이고 그때는 자유 계약 선수의 주급 부담을 보통(0.5)으로 본다
   */
  wageModel?(): WageCoefs | null
  /** 게임에 물어 알게 된 이름(나라, 팀)을 적어 두는 폴더 */
  namesDir: string
  /** 세이브 파일을 새로 읽은 직후(게임의 지금 값으로 덮어쓰기 전). 기록 보관이 그날의 값을 남기는 데 쓴다 */
  onRead?(path: string, world: SaveWorld): void
}

/**
 * 사용자가 적용한 세이브 하나를 통째로 읽어 두고(모든 구단의 선수), 스쿼드·영입 후보·에디터에 자료를 준다.
 *
 * 선수의 이름·나이·구단은 세이브에서 읽는다. 능력치 값은 세이브의 값으로 시작하고,
 * 게임이 켜져 있으면 게임 안 플러그인이 넘겨준 "지금 값"으로 덮어쓴다(useLive).
 * 값을 고치는 것은 세이브가 아니라 켜져 있는 게임에 한다.
 */
export class WorldService {
  private loaded: Loaded | null = null
  /** 지금은 게임의 값을 읽거나 고칠 수 없는 이유(게임이 꺼져 있음, 플러그인이 옛 버전). 할 수 있으면 null */
  private liveOff: string | null = null

  /** 지금은 선수의 시장 정보를 게임에 물을 수 없는 이유. 물을 수 있으면 null */
  private marketOff: string | null = null
  private readonly marketCache = new Map<number, { at: number; info: PlayerMarket }>()

  /** 세이브에 번호만 있는 이름들(나라, 구단을 알아내지 못한 팀). 게임에 물어 채운다 */
  private readonly names: NameBook
  /** 이번에 물어봤지만 게임이 답하지 않은 번호(다시 묻지 않는다) */
  private readonly unanswered = { team: new Set<number>(), nation: new Set<number>() }
  private namesStage = 0
  /** 게임이 알려 준 구단으로 내 구단을 바꿨다는 한 줄 안내와 그 세이브 경로(다른 세이브를 적용하면 보이지 않는다) */
  private teamNote: { path: string; text: string } | null = null

  /**
   * 세이브 안의 값(능력치·이름 정보)이 바뀔 때마다 늘린다. 이 값이 같으면 아래 캐시(여자 선수 표시, 역할 기준 분포)가 아직 맞다.
   * 기준 분포는 선수 10만 명을 돌아 구하므로 (세이브 객체, 이 번호, 역할 가중치)가 같으면 다시 구하지 않는다.
   */
  private revision = 0
  private femaleCache: { world: SaveWorld; revision: number; mask: Uint8Array } | null = null
  /** 팀 번호 → 구단 순번(임대 선수의 원 소속 구단을 찾는 데 쓴다). 임대 기록을 믿을 수 있는지도 함께 */
  private loanCache: { world: SaveWorld; teamClub: Map<number, number>; trusted: boolean } | null = null
  private normCache: { world: SaveWorld; revision: number; weights: string; norms: RoleNorms } | null = null
  private statureCache: { world: SaveWorld; revision: number; byTeam: Map<number, number> } | null = null

  constructor(private readonly deps: WorldDeps) {
    this.names = new NameBook(deps.namesDir)
  }

  /** 시장 정보(몸값·주급·계약)를 게임에 물을 수 있는지를 알려 둔다. 못 하면 그 이유. */
  setMarketOff(reason: string | null): void {
    this.marketOff = reason
  }

  /** 게임의 값을 읽고 고칠 수 있는지를 알려 둔다. 못 하면 그 이유(화면에 그대로 보여 준다). */
  setLiveOff(reason: string | null): void {
    this.liveOff = reason
  }

  /** 게임에서 지금 값을 받은 시각(ms). 받은 적이 없으면 null. 이 값이 같으면 능력·현재 능력도 같다 */
  liveStamp(): number | null {
    return this.loaded?.live?.at ?? null
  }

  /** 적용해 둔 세이브의 경로 */
  get path(): string | null {
    return this.loaded?.path ?? null
  }

  /** 지금 적용해 둔 세이브의 자료. 다시 읽지 않는다(다시 읽기는 GameLink가 맡는다) */
  get world(): SaveWorld | null {
    return this.loaded?.world ?? null
  }

  /**
   * path 세이브를 읽어 적용한다. 이미 읽어 둔 그 파일이면 다시 읽지 않는다.
   * 세이브 하나를 읽는 데 몇 초 걸린다.
   */
  apply(path: string): SaveWorld {
    const info = statSync(path)
    const current = this.loaded
    if (current && current.path === path && current.mtimeMs === info.mtimeMs && current.size === info.size) {
      if (current.world.teamId === undefined) this.findTeam(current)
      return current.world
    }
    const fileName = basename(path)
    this.names.open(fileName)
    this.unanswered.team.clear()
    this.namesStage = 0
    const world = readWorld(path, (fresh) => this.pickTeam(fresh, fileName))
    if (world.teamId !== undefined) this.deps.rememberTeam(fileName, world.teamId)
    const byUid = new Map<number, number>()
    for (let k = 0; k < world.count; k++) {
      const uid = world.uids[k]
      // 번호가 겹치는 기록은 어느 선수인지 가릴 수 없어 뺀다
      if (uid !== 0) byUid.set(uid, byUid.has(uid) ? -1 : k)
    }
    const check = checkSaveWorld(world, { minLoans: MIN_LOANS_IN_SAVE })
    this.loaded = { path, mtimeMs: info.mtimeMs, size: info.size, world, byUid, live: null, note: '', check }
    // 형식이 바뀐 것 같은 세이브는 기록(성장 스냅샷·평점)에 남기지 않는다. 틀린 값이 실측 자료에 섞이지 않게
    if (check.ok) this.deps.onRead?.(path, world)
    return world
  }

  /** 세이브 형식 점검과 구단 안내. LinkStatus에 얹어 화면으로 보낸다 */
  extras(): LinkExtras {
    const loaded = this.loaded
    const note = this.teamNote && loaded && this.teamNote.path === loaded.path ? this.teamNote.text : ''
    return { check: loaded?.check ?? SAVE_CHECK_OK, teamNote: note }
  }

  /** 세이브 형식 점검에 걸렸으면 점수 화면에 줄 안내. 아니면 null */
  blocked(): string | null {
    return this.loaded?.check && !this.loaded.check.ok ? FORMAT_CHANGED_MESSAGE : null
  }

  /** 세이브를 다시 읽는다(내 팀이 바뀌었을 때). 게임에서 받은 지금 값은 사라지므로 부른 쪽이 다시 받는다 */
  private reread(path: string): void {
    this.loaded = null
    this.apply(path)
  }

  /** 내 구단 고르기에 보여 줄 구단 목록(A-14). 이 세이브의 대표 팀(1군)마다 하나 */
  clubs(): ClubChoices {
    const world = this.loaded?.world
    if (!world) return { ok: false, message: NO_SAVE, clubs: [] }
    return { ok: true, clubs: clubChoices(world, (id) => this.names.nation(id)) }
  }

  /** 사용자가 고른 구단을 이 세이브의 내 팀으로 기억하고 세이브를 다시 읽는다(A-14) */
  chooseTeam(teamId: number): { ok: boolean; message: string } {
    const loaded = this.loaded
    if (!loaded) return { ok: false, message: NO_SAVE }
    const choice = clubChoices(loaded.world, () => '').find((club) => club.teamId === teamId)
    if (!choice) return { ok: false, message: '이 세이브에서 그 구단의 1군 선수를 찾지 못했습니다.' }
    this.deps.rememberTeam(basename(loaded.path), teamId)
    this.teamNote = null
    this.reread(loaded.path)
    return { ok: true, message: `내 구단을 ${choice.name}(으)로 정했습니다.` }
  }

  /**
   * 켜져 있는 게임이 알려 주는 내 팀이 이 세이브 안의 다른 팀이면 게임을 따른다(A-14. 게임이 이긴다).
   * 게임의 내 팀 선수 이름이 이 세이브의 한 팀과 절반 넘게 겹칠 때만 같은 세이브로 본다(다른 세이브를 불러와 있으면 겹치지 않는다).
   * 바꿨으면 true
   */
  followGame(): boolean {
    const loaded = this.loaded
    if (!loaded || loaded.world.teamId === undefined) return false
    const fromGame = findTeamByNames(loaded.world, this.deps.rosterNames())
    if (fromGame === null || fromGame === loaded.world.teamId) return false
    const before = this.myClubName(loaded.world)
    this.deps.rememberTeam(basename(loaded.path), fromGame)
    const path = loaded.path
    this.reread(path)
    const now = this.loaded?.world ? this.myClubName(this.loaded.world) : ''
    this.teamNote = { path, text: `게임이 알려 준 구단(${now || '이름 모름'})으로 바꿨습니다.${before ? ` 전에 고른 구단은 ${before}입니다.` : ''}` }
    return true
  }

  private pickTeam(world: SaveWorld, fileName: string): number | undefined {
    const known = this.deps.knownTeam(fileName)
    if (known !== undefined && teamHasPlayers(world, known)) return known
    // 처음이거나 팀을 옮긴 경우: 게임이 알려 준 내 팀 선수 이름과 가장 많이 겹치는 팀을 찾는다
    return findTeamByNames(world, this.deps.rosterNames()) ?? undefined
  }

  /** 내 팀을 아직 못 찾은 세이브에서, 게임이 켜진 뒤 다시 찾아본다. 찾으면 true (게임의 오늘 날짜를 알려면 세이브를 다시 읽어야 한다) */
  private findTeam(loaded: Loaded): boolean {
    const teamId = this.pickTeam(loaded.world, basename(loaded.path))
    if (teamId === undefined) return false
    this.deps.rememberTeam(basename(loaded.path), teamId)
    // 나이 계산에 쓰는 "게임의 오늘"은 내 팀 기록에서 읽으므로, 다음에 읽을 때 채워지도록 읽어 둔 것을 버린다
    this.loaded = null
    this.apply(loaded.path)
    return true
  }

  /** 게임이 켜졌을 때: 내 팀을 못 찾았던 세이브면 다시 찾아본다. */
  retryTeam(): void {
    const loaded = this.loaded
    if (loaded && loaded.world.teamId === undefined) this.findTeam(loaded)
  }

  /** 적용한 세이브 파일이 그새 바뀌었으면(게임이 다시 저장함) 다시 읽는다. 다시 읽었으면 true */
  reloadIfChanged(): boolean {
    const loaded = this.loaded
    if (!loaded || !existsSync(loaded.path)) return false
    const info = statSync(loaded.path)
    if (info.mtimeMs === loaded.mtimeMs && info.size === loaded.size) return false
    this.apply(loaded.path)
    return true
  }

  /**
   * 게임이 넘겨준 모든 선수의 지금 값을 덮어쓴다.
   * 덩어리는 선수마다 [고유 번호 u32][현재 능력 u16][잠재 능력 u16][숙련도 15][능력치 54]다. 덮어쓴 선수 수를 돌려준다.
   */
  useLive(packed: Buffer): number {
    const loaded = this.loaded
    if (!loaded) return 0
    const { world, byUid } = loaded
    let matched = 0
    for (let at = 0; at + PACKED_SIZE <= packed.length; at += PACKED_SIZE) {
      const k = byUid.get(packed.readUInt32LE(at))
      if (k === undefined || k < 0) continue
      world.ca[k] = packed.readUInt16LE(at + 4)
      world.pa[k] = packed.readUInt16LE(at + 6)
      world.positions.set(packed.subarray(at + 8, at + 8 + POSITION_COUNT), k * POSITION_COUNT)
      world.attributes.set(packed.subarray(at + 8 + POSITION_COUNT, at + PACKED_SIZE), k * ATTRIBUTE_COUNT)
      matched++
    }
    if (matched > 0) this.revision++
    if (matched > 0) {
      loaded.live = { at: Date.now(), matched }
      loaded.note = ''
    }
    return matched
  }

  /** 게임의 값을 쓰지 못한 이유를 적어 둔다(화면에 보여 준다). */
  setNote(note: string): void {
    if (this.loaded) this.loaded.note = note
  }

  status(): DataStatus {
    const loaded = this.loaded
    if (!loaded) return NO_DATA
    const { world } = loaded
    const save: SaveFileInfo = {
      path: loaded.path,
      name: basename(loaded.path),
      savedAt: new Date(loaded.mtimeMs).toISOString(),
      bytes: loaded.size
    }
    return {
      save,
      players: world.count,
      hasTeam: world.teamId !== undefined,
      club: this.myClubName(world),
      clubUid: this.myClubUid(world),
      source: loaded.live ? 'game' : 'save',
      liveAt: loaded.live ? new Date(loaded.live.at).toISOString() : null,
      liveMatched: loaded.live?.matched ?? 0,
      note: loaded.note,
      namesStage: this.namesStage
    }
  }

  private myClubUid(world: SaveWorld): number | null {
    if (world.teamId === undefined) return null
    for (let k = 0; k < world.count; k++) {
      if (world.teamIds[k] === world.teamId && world.club[k] >= 0) return world.clubs[world.club[k]].uid
    }
    return null
  }

  private myClubName(world: SaveWorld): string {
    if (world.teamId === undefined) return ''
    for (let k = 0; k < world.count; k++) {
      if (world.teamIds[k] === world.teamId && world.club[k] >= 0) return world.clubs[world.club[k]].name
    }
    return ''
  }

  /** 내 팀 선수 이름(게임 안 직접 답변에서 AI가 이름 표기를 맞추는 데 쓴다) */
  myNames(): string[] {
    const world = this.loaded?.world
    if (!world || world.teamId === undefined) return []
    const names: string[] = []
    for (let k = 0; k < world.count; k++) if (world.teamIds[k] === world.teamId && world.names[k]) names.push(world.names[k])
    return names
  }

  /** 내 팀 선수 표 */
  squad(): SquadTable & { ok: boolean; message?: string; roleNorms?: RoleNorms } {
    const world = this.loaded?.world
    if (!world) return { ok: false, message: NO_SAVE, columns: [], rows: [] }
    const blocked = this.blocked()
    if (blocked) return { ok: false, message: blocked, columns: [], rows: [] }
    if (world.teamId === undefined) {
      return {
        ok: false,
        message: NO_TEAM_MESSAGE,
        columns: [],
        rows: []
      }
    }
    return { ok: true, ...this.squadOf(world), roleNorms: this.roleNorms() ?? undefined }
  }

  /** 내 팀 선수 표. 임대로 온 선수의 줄에는 임대가 끝나는 날(추정)과 원 소속 구단을 싣는다(5회차) */
  private squadOf(world: SaveWorld): SquadTable {
    let myClub = -1
    for (let k = 0; k < world.count; k++) {
      if (world.teamIds[k] === world.teamId && world.club[k] >= 0) {
        myClub = world.club[k]
        break
      }
    }
    return squadTable(world, (k) => this.loanedInFrom(world, k, myClub))
  }

  /**
   * k번 선수가 다른 구단에서 임대로 온 선수이면 원 소속 구단 이름(모르면 빈 글자), 아니면 null.
   * 대시보드의 임대 영입과 같은 기준: 임대 기록을 믿을 수 있고(세이브 전체에서 임대가 충분히 읽힘) 원 소속이 내 구단이 아니다.
   */
  private loanedInFrom(world: SaveWorld, k: number, myClub: number): string | null {
    const lender = world.loanFrom[k]
    if (lender === NO_TEAM) return null
    const index = this.loanIndex(world)
    if (!index.trusted) return null
    const club = index.teamClub.get(lender)
    if (club !== undefined) return club === myClub ? null : world.clubs[club].name
    const learned = this.names.team(lender)
    return learned ? learned.club || learned.name : ''
  }

  /** 팀 번호 → 구단 체급 S(t)(남자 선수의 현재 능력 상위 11명의 중간값, 5명 미만이면 없음). 세이브·값이 같으면 다시 구하지 않는다(5회차) */
  private statures(world: SaveWorld): Map<number, number> {
    const kept = this.statureCache
    if (kept && kept.world === world && kept.revision === this.revision) return kept.byTeam
    const female = this.femaleMask(world)
    const abilities = new Map<number, number[]>()
    for (let k = 0; k < world.count; k++) {
      const team = world.teamIds[k]
      if (team === NO_TEAM || female[k] || !world.names[k] || world.uids[k] === 0) continue
      const list = abilities.get(team)
      if (list) list.push(world.ca[k])
      else abilities.set(team, [world.ca[k]])
    }
    const byTeam = new Map<number, number>()
    for (const [team, list] of abilities) {
      const value = clubStature(list)
      if (value !== null) byTeam.set(team, value)
    }
    this.statureCache = { world, revision: this.revision, byTeam }
    return byTeam
  }

  /**
   * 역할별 기준 분포(shared/norms.ts). 세이브 전체에서 한 번 구해 두고, 세이브·값·역할 가중치가 같으면 다시 구하지 않는다.
   * 전술 분석(스쿼드·대시보드·영입 후보)이 모두 같은 값을 쓰도록 squad()가 함께 준다. 세이브를 적용하지 않았으면 null.
   */
  roleNorms(): RoleNorms | null {
    const world = this.loaded?.world
    if (!world) return null
    const weights = JSON.stringify(this.deps.roleWeights())
    const kept = this.normCache
    if (kept && kept.world === world && kept.revision === this.revision && kept.weights === weights) return kept.norms
    const norms = computeRoleNorms(world, this.deps.roleWeights(), this.femaleMask(world))
    this.normCache = { world, revision: this.revision, weights, norms }
    return norms
  }

  /** 선수마다 여자이면 1. 세이브가 적은 성별을 우선으로 하고, 게임이 알려 준 여자 팀의 선수도 더한다 */
  private femaleMask(world: SaveWorld): Uint8Array {
    const kept = this.femaleCache
    if (kept && kept.world === world && kept.revision === this.revision) return kept.mask
    const mask = new Uint8Array(world.count)
    for (let k = 0; k < world.count; k++) mask[k] = this.isFemale(world, k) ? 1 : 0
    this.femaleCache = { world, revision: this.revision, mask }
    return mask
  }

  private clubName(world: SaveWorld, k: number): string {
    if (world.teamIds[k] === NO_TEAM) return '자유 계약'
    const club = world.club[k]
    if (club >= 0) return world.clubs[club].name
    // 세이브에서 구단을 알아내지 못한 팀은 게임이 알려 준 이름을 쓴다
    const team = this.names.team(world.teamIds[k])
    return team ? team.club || team.name : ''
  }

  /** 팀 번호의 구단 이름과 엠블럼 번호. 구단을 세이브에서 알아내지 못했으면 게임이 알려 준 이름을 쓰고, 그것도 모르면 빈 글자 */
  private teamOf(world: SaveWorld, team: number): { name: string; uid: number | null } {
    const club = this.loanIndex(world).teamClub.get(team)
    if (club !== undefined) return { name: world.clubs[club].name, uid: world.clubs[club].uid || null }
    const learned = this.names.team(team)
    return { name: learned ? learned.club || learned.name : '', uid: null }
  }

  private loanIndex(world: SaveWorld): { teamClub: Map<number, number>; trusted: boolean } {
    const kept = this.loanCache
    if (kept && kept.world === world) return kept
    const teamClub = new Map<number, number>()
    let loans = 0
    for (let k = 0; k < world.count; k++) {
      const team = world.teamIds[k]
      if (team !== NO_TEAM && world.club[k] >= 0 && !teamClub.has(team)) teamClub.set(team, world.club[k])
      if (world.loanFrom[k] !== NO_TEAM) loans++
    }
    // 대시보드와 같은 기준: 세이브 전체에서 임대가 이만큼은 읽혀야 임대 기록을 믿는다
    const entry = { world, teamClub, trusted: loans >= MIN_LOANS_IN_SAVE }
    this.loanCache = entry
    return entry
  }

  /**
   * 선수의 소속 구단. 임대 중이면 원 소속 구단(이적료를 받는 쪽)을 돌려주고 지금 뛰는 구단은 loanedTo에 적는다.
   * 원 소속을 알아내지 못하면 지금 뛰는 구단을 그대로 소속으로 본다.
   */
  private clubOf(world: SaveWorld, k: number): { name: string; uid: number | null; loanedTo: string | null } {
    const host = { name: this.clubName(world, k), uid: world.club[k] >= 0 ? world.clubs[world.club[k]].uid : null, loanedTo: null }
    const lender = world.loanFrom[k]
    if (lender === NO_TEAM) return host
    const index = this.loanIndex(world)
    if (!index.trusted) return host
    const club = index.teamClub.get(lender)
    if (club !== undefined) return { name: world.clubs[club].name, uid: world.clubs[club].uid, loanedTo: host.name }
    const learned = this.names.team(lender)
    const name = learned ? learned.club || learned.name : ''
    return name ? { name, uid: null, loanedTo: host.name } : host
  }

  /**
   * 여자 선수인지. 세이브에 적힌 성별(world.sex)을 기준으로 하고, 게임이 알려 준 여자 팀의 선수도 여자로 본다.
   * (구단 번호가 20억 이상이면 여자 구단이라는 어림은 새로 만든 남자 구단에도 걸려 쓰지 않는다.)
   */
  private isFemale(world: SaveWorld, k: number): boolean {
    if (world.sex[k] === SEX_FEMALE) return true
    const team = this.names.team(world.teamIds[k])
    return team ? team.female : false
  }

  /**
   * 게임에 물어볼 이름들: 아직 이름을 모르는 나라, 그리고 팀(구단을 알아내지 못한 팀이 먼저).
   * 팀은 여자 팀인지도 게임이 알려 주므로 구단을 아는 팀도 묻는다.
   */
  missingNames(): { nations: number[]; urgentTeams: number[]; otherTeams: number[] } {
    const world = this.loaded?.world
    const nations = new Set<number>()
    const urgent = new Set<number>()
    const others = new Set<number>()
    if (world) {
      for (let k = 0; k < world.count; k++) {
        const nation = world.nationId[k]
        if (nation > 0 && !this.names.hasNation(nation) && !this.unanswered.nation.has(nation)) nations.add(nation)
        const team = world.teamIds[k]
        if (team === NO_TEAM || this.names.hasTeam(team) || this.unanswered.team.has(team)) continue
        if (world.club[k] < 0) urgent.add(team)
        else others.add(team)
      }
    }
    return { nations: [...nations], urgentTeams: [...urgent], otherTeams: [...others].filter((team) => !urgent.has(team)) }
  }

  /** 게임이 알려 준 이름을 적어 둔다. asked 가운데 답이 없는 번호는 이번에는 다시 묻지 않는다. */
  learnNames(kind: 'team' | 'nation', asked: number[], answers: GameName[]): void {
    const answered = new Set<number>()
    for (const answer of answers) {
      if (!answer.name) continue
      answered.add(answer.id)
      if (kind === 'nation') this.names.setNation(answer.id, answer.name)
      else this.names.setTeam(answer.id, { name: answer.name, club: answer.club ?? '', female: answer.gender === 'True' })
    }
    for (const id of asked) if (!answered.has(id)) this.unanswered[kind].add(id)
    if (answers.length > 0) this.revision++
  }

  /** 이름을 어디까지 알아냈는지 적고(화면이 자료를 다시 읽는다) 파일에 남긴다. */
  namesReached(stage: number): void {
    this.namesStage = Math.max(this.namesStage, stage)
    this.names.flush()
  }

  private listItem(world: SaveWorld, k: number): EditorListItem {
    return {
      uid: world.uids[k],
      name: world.names[k],
      age: ageAt(world, k),
      position: positionsLabel([...world.positions.subarray(k * POSITION_COUNT, (k + 1) * POSITION_COUNT)]),
      club: this.clubName(world, k),
      clubUid: world.club[k] >= 0 ? world.clubs[world.club[k]].uid : null,
      ca: world.ca[k],
      pa: world.pa[k]
    }
  }

  /**
   * 고른 역할로 모든 선수의 점수를 매겨 유형별 영입 후보를 고른다.
   * 순서: 걸러내기(내 구단·여자·조건) → 유형 자격(shared/world.ts categoriesOf) → 자격 후보에만 추천 점수 → 같은 유형 안의 백분위 등급.
   */
  candidates(query: CandidateQuery): CandidateResult {
    const empty: Record<CandidateCategory, number> = { all: 0, starter: 0, rotation: 0, prospect: 0, free: 0 }
    const noBench: CandidateBench = { starter: null, backup: null }
    const fail = (message: string, saveName?: string): CandidateResult => ({ ok: false, message, saveName, bench: noBench, counts: empty, rows: [], matched: 0 })
    const loaded = this.loaded
    if (!loaded) return fail(NO_SAVE)
    const { world } = loaded
    const saveName = basename(loaded.path)
    const blocked = this.blocked()
    if (blocked) return fail(blocked, saveName)
    if (world.teamId === undefined) {
      return fail(NO_TEAM_MESSAGE, saveName)
    }
    const roleWeights = this.deps.roleWeights()
    const norms = this.roleNorms() ?? {}
    const female = this.femaleMask(world)
    // 전술의 한 자리를 기준으로 찾으면 그 자리의 역할·주전·두 번째 선수·보강 필요도를 쓴다(스쿼드 전술판과 같은 계산)
    const table = this.squadOf(world)
    const analysis = query.slot
      ? analyseTactic({ rows: table.rows, columns: table.columns, today: table.today, formation: query.slot.formation, slotRoles: query.slot.slotRoles, roleWeights, norms })
      : null
    const slotFound = analysis?.slots[query.slot?.index ?? -1] ?? null
    const roleId = slotFound ? slotFound.slot.roleId : query.roleId
    const role = ROLE_BY_ID[roleId]
    if (!role) return fail('알 수 없는 역할입니다.', saveName)
    const norm = normOf(norms, roleId)

    // 스쿼드 화면과 같은 값이 나오도록 게임 표시값(1~20)으로 계산한다(roles.ts의 savedRoleScore 하나)
    const prepared = prepareRole(roleId, roleWeights)
    const slots = (slotFound ? [slotFound.slot.position] : role.positions).map((key) => POSITION_INDEX.get(key)!).filter((index) => index !== undefined)
    const ratingOf = (k: number): number => {
      let best = 0
      for (const slot of slots) best = Math.max(best, world.positions[k * POSITION_COUNT + slot])
      return best
    }
    const eligible = (k: number): boolean => ratingOf(k) >= PLAYABLE_RATING
    const scoreOf = (k: number): number => savedRoleScore(world.attributes, k * ATTRIBUTE_COUNT, prepared)

    // 내 팀(1군)의 주급·몸값 수준과, 이 역할을 뛸 수 있는 선수들
    const mine: Array<{ k: number; score: number; eff: number }> = []
    const myWages: number[] = []
    const myValues: number[] = []
    let myClub = -1
    for (let k = 0; k < world.count; k++) {
      if (world.teamIds[k] !== world.teamId || !world.names[k]) continue
      if (world.club[k] >= 0) myClub = world.club[k]
      myWages.push(world.wage[k])
      myValues.push(world.value[k])
      if (eligible(k)) {
        const score = scoreOf(k)
        mine.push({ k, score, eff: effectiveScore(score, ratingOf(k), null, norm.sigma) })
      }
    }
    mine.sort((a, b) => b.eff - a.eff)
    const bench: CandidateBench =
      (analysis && slotFound ? slotBench(analysis, slotFound.slot.index) : null) ?? {
        starter: mine[0] ? { name: world.names[mine[0].k], score: mine[0].eff, shownScore: mine[0].score, ca: world.ca[mine[0].k], age: ageAt(world, mine[0].k) } : null,
        backup: mine[1] ? { name: world.names[mine[1].k], score: mine[1].eff, shownScore: mine[1].score, age: ageAt(world, mine[1].k) } : null,
        thin: mine.length < 3
      }
    const money = squadMoney(myWages, myValues)
    const wageCoefs = this.deps.wageModel?.() ?? null
    // 파는 구단의 체급(영입 현실성): 구단별로 한 번 구해 둔다. 임대 중인 후보는 원 소속 팀의 체급이다
    const statures = this.statures(world)
    const myStature = statures.get(world.teamId) ?? null
    const loans = this.loanIndex(world)
    // 같은 포지션·역할의 자리는 한 그룹이라 필요도도 그룹 값(자리들 가운데 최대)이다
    const group = slotFound ? slotFound.group : null
    const need = group ? group.need : null
    const context: RecommendContext = {
      starter: bench.starter,
      backup: bench.backup ? { score: bench.backup.score, shownScore: bench.backup.shownScore } : null,
      today: world.gameDate ? { year: world.gameDate.year, day: world.gameDate.day } : null,
      money,
      myStature,
      need,
      norm,
      groupSlots: group?.slots.length,
      expectedWage: wageCoefs ? (ca, age) => expectedWage(wageCoefs, ca, age) : null
    }
    const goalkeeper = role.positions.includes('GK')
    const traitAt = (id: TraitId): number => ATTRIBUTE_INDEX.get(id)!
    const traitIds = Object.keys(TRAIT_WEIGHTS) as TraitId[]
    const inputOf = (k: number, score: number, age: number | null): RecommendInput => {
      const traits = {} as Traits
      for (const id of traitIds) traits[id] = shownValue(world.attributes[k * ATTRIBUTE_COUNT + traitAt(id)])
      // 소속은 없지만 다른 구단과 계약을 마친 선수는 협상할 수 없다: 소속 있음으로 보고 영입 현실성이 낮다(자유 계약이 아니다)
      const signedTeam = signedClubTeam(world, k)
      const lender = world.loanFrom[k]
      const sellerTeam = lender !== NO_TEAM && loans.trusted ? lender : world.teamIds[k]
      return {
        category: query.category,
        goalkeeper,
        roleScore: score,
        roleRating: ratingOf(k),
        age,
        ca: world.ca[k],
        pa: world.pa[k],
        value: world.value[k] || null,
        wage: world.wage[k] || null,
        contractEnd: world.contractEnd[k] || null,
        squadStatus: world.squadStatus[k],
        hasClub: world.teamIds[k] !== NO_TEAM || signedTeam !== null,
        sellerStature: world.teamIds[k] === NO_TEAM ? null : (statures.get(sellerTeam) ?? null),
        signedWith: signedTeam === null ? null : this.teamOf(world, signedTeam).name,
        traits
      }
    }

    // 즉시 전력·로테이션의 경계와 유망주의 기준선은 같은 자리 안에서는 모든 후보에 같다: 한 번만 구한다
    const window = rotationWindowOf(bench, norm, goalkeeper)
    const search = query.search.trim().toLowerCase()
    // 계약 만료 조건: 오늘에서 그 개월 수 뒤의 날짜(연도 × 1000 + 연중 일수)까지 끝나는 선수만
    let expiresBy = 0
    if (query.expiringWithinMonths && world.gameDate) {
      const days = world.gameDate.day + Math.round(query.expiringWithinMonths * 30.44)
      expiresBy = (world.gameDate.year + Math.floor((days - 1) / 365)) * 1000 + ((days - 1) % 365) + 1
    }
    const counts = { ...empty }
    /** 고른 유형의 자격 후보 전체의 총점과 영입 현실성(등급을 매기는 기준. 이름 검색과 상관없다) */
    const qualifiedTotals: Array<{ total: number; low: boolean }> = []
    const picked: Array<{ k: number; score: number; age: number | null; categories: CandidateCategory[]; total: number; low: boolean; inTab: boolean }> = []
    for (let k = 0; k < world.count; k++) {
      const name = world.names[k]
      if (!name || world.uids[k] === 0) continue
      const team = world.teamIds[k]
      const club = world.club[k]
      // 내 구단 선수(2군·유스 포함)와 여자 선수는 후보가 아니다
      if (team === world.teamId || (club >= 0 && club === myClub)) continue
      if (female[k]) continue
      // 내가 임대 보낸 선수(원 소속이 내 구단)는 후보가 아니다. 소속이 "임대받은 팀"으로만 보여 후보로 나오던 것을 막는다(5회차)
      const lender = world.loanFrom[k]
      if (lender !== NO_TEAM && loans.trusted && myClub >= 0 && loans.teamClub.get(lender) === myClub) continue
      // 이미 내 구단과 계약을 마친 선수도 후보가 아니다
      const signedTeam = signedClubTeam(world, k)
      if (signedTeam !== null && (signedTeam === world.teamId || (myClub >= 0 && loans.teamClub.get(signedTeam) === myClub))) continue
      if (team !== NO_TEAM && club < 0 && !this.names.hasTeam(team) && !query.includeUnknownClub) continue
      if (expiresBy > 0 && (world.contractEnd[k] === 0 || world.contractEnd[k] > expiresBy)) continue
      if (query.onlyEligible && !eligible(k)) continue
      const age = ageAt(world, k)
      if (query.maxAge !== null && (age === null || age > query.maxAge)) continue

      const score = scoreOf(k)
      // 다른 구단과 계약을 마친 무소속 선수는 소속 있음으로 본다(자유 계약 유형에서 뺀다. 5회차)
      const categories = categoriesOf({ score, age, ca: world.ca[k], pa: world.pa[k], hasClub: team !== NO_TEAM || signedTeam !== null, rating: ratingOf(k) }, bench, norm, goalkeeper, window)
      const qualified = categories.length > 0
      const inTab = query.category === 'all' ? qualified : categories.includes(query.category)
      const nameHit = !search || name.toLowerCase().includes(search)
      if (nameHit) {
        if (qualified) counts.all++
        for (const category of categories) counts[category]++
      }
      // 이름을 찾는 중이면 유형 자격이 없어도 이름이 맞는 선수를 보여 준다
      const shown = nameHit && (inTab || search !== '')
      if (!inTab && !shown) continue
      // 줄 세우는 데는 설명 글이 필요 없어 점수만 구한다(풀이는 보여 줄 줄에만 붙인다)
      const scored = recommend(inputOf(k, score, age), context, false)
      const total = scored.total
      const low = scored.realism.low
      if (inTab) qualifiedTotals.push({ total, low })
      if (shown) picked.push({ k, score, age, categories, total, low, inTab })
    }
    // 추천 점수 순. 같으면 적합도, 현재 능력 순
    picked.sort((a, b) => b.total - a.total || b.score - a.score || world.ca[b.k] - world.ca[a.k])
    const tierOf = tierRanker(qualifiedTotals)

    const rows: CandidateRow[] = picked.slice(0, MAX_ROWS).map(({ k, score, age, categories, total, low, inTab }) => {
      // 다른 구단과 계약을 마친 무소속 선수의 소속 칸은 "구단명(입단 예정)"
      const signedTeam = signedClubTeam(world, k)
      const signedClub = signedTeam === null ? null : this.teamOf(world, signedTeam)
      const club = signedClub ? { name: `${signedClub.name || '다른 구단'}(입단 예정)`, uid: signedClub.uid, loanedTo: null } : this.clubOf(world, k)
      const recommendation = recommend(inputOf(k, score, age), context)
      return {
        uid: world.uids[k],
        name: world.names[k],
        age,
        position: positionsLabel([...world.positions.subarray(k * POSITION_COUNT, (k + 1) * POSITION_COUNT)]),
        club: club.name,
        clubUid: club.uid,
        loanedTo: club.loanedTo,
        ca: world.ca[k],
        pa: world.pa[k],
        value: world.value[k] || null,
        wage: world.wage[k] || null,
        contractEnd: world.contractEnd[k] ? calendar({ year: Math.floor(world.contractEnd[k] / 1000), day: world.contractEnd[k] % 1000 }) : null,
        squadStatus: SQUAD_STATUS_LABEL[world.squadStatus[k]] ?? '',
        nation: this.names.nation(world.nationId[k]),
        score,
        gap: bench.starter ? Math.round((score - (bench.starter.shownScore ?? bench.starter.score)) * 10) / 10 : null,
        gapEff: gapVsAnchor(recommendation.fit.effective, bench, norm, goalkeeper),
        categories,
        recommend: recommendation,
        // 등급 경계는 영입 현실성이 낮지 않은 후보로만 정하고, 낮은 선수는 그 위에 끼워 "고려"까지로 제한한다(총점·정렬은 그대로)
        tier: (inTab ? tierOf(total, low) : 'outside') as RecommendTierId,
        attributes: [...world.attributes.subarray(k * ATTRIBUTE_COUNT, (k + 1) * ATTRIBUTE_COUNT)].map(shownValue)
      }
    })
    return { ok: true, saveName, bench, counts, rows, matched: picked.length, ranked: qualifiedTotals.length, norm, need, group: group ? { label: group.label, slots: group.slots.length } : null, baseline: money }
  }

  /**
   * 선수들의 몸값·주급·계약 만료·국적. 켜져 있는 게임에 물어 받고, 받은 것은 잠시 기억해 둔다.
   * 게임에서 찾지 못한 선수는 결과에서 빠진다.
   */
  async market(uids: number[]): Promise<MarketResult> {
    if (this.marketOff) return { ok: false, message: this.marketOff, players: [] }
    const now = Date.now()
    const players: PlayerMarket[] = []
    const missing: number[] = []
    for (const uid of new Set(uids.filter((each) => Number.isInteger(each) && each > 0))) {
      const kept = this.marketCache.get(uid)
      if (kept && now - kept.at < MARKET_KEEP_MS) players.push(kept.info)
      else missing.push(uid)
    }
    for (let from = 0; from < missing.length; from += PEOPLE_PER_REQUEST) {
      const answers = await gamePeople(missing.slice(from, from + PEOPLE_PER_REQUEST))
      if (answers === null) {
        return { ok: players.length > 0, message: '게임에서 몸값·주급을 받지 못했습니다. 게임이 날짜를 넘기는 중이면 잠시 뒤에 다시 됩니다.', players }
      }
      for (const answer of answers) {
        const info: PlayerMarket = {
          uid: answer.uid,
          value: answer.value && answer.value !== '-' ? answer.value : undefined,
          valueSort: answer.valueSort !== undefined && answer.valueSort > 0 ? answer.valueSort : undefined,
          wage: answer.wage && answer.wage !== '-' ? answer.wage : undefined,
          wageSort: answer.wageSort !== undefined && answer.wageSort > 0 ? answer.wageSort : undefined,
          contractEnd: (answer.contractEnd && parseGameDate(answer.contractEnd)) || undefined,
          nation: answer.nation || undefined,
          club: answer.club || undefined,
          female: answer.gender === undefined ? undefined : answer.gender === 'True'
        }
        this.marketCache.set(info.uid, { at: Date.now(), info })
        players.push(info)
      }
    }
    return { ok: true, players }
  }

  /** 에디터의 선수 목록. 찾는 글자가 없으면 내 팀 선수들 */
  editorList(search: string): { ok: boolean; message?: string; saveName?: string; items: EditorListItem[] } {
    const loaded = this.loaded
    if (!loaded) return { ok: false, message: NO_SAVE, items: [] }
    const { world } = loaded
    const wanted = search.trim().toLowerCase()
    const found: number[] = []
    for (let k = 0; k < world.count && found.length < (wanted ? MAX_FOUND : 200); k++) {
      const name = world.names[k]
      if (!name || world.uids[k] === 0) continue
      if (wanted ? name.toLowerCase().includes(wanted) : world.teamId !== undefined && world.teamIds[k] === world.teamId) found.push(k)
    }
    const order = (k: number): number => positionOrder([...world.positions.subarray(k * POSITION_COUNT, (k + 1) * POSITION_COUNT)])
    if (wanted) found.sort((a, b) => world.ca[b] - world.ca[a])
    else found.sort((a, b) => order(a) - order(b) || world.names[a].localeCompare(world.names[b], 'ko'))
    return { ok: true, saveName: basename(loaded.path), items: found.map((k) => this.listItem(world, k)) }
  }

  private indexOf(uid: number): number {
    const k = this.loaded?.byUid.get(uid)
    return k === undefined ? -1 : k
  }

  private store(k: number, values: { ca?: number; pa?: number; positions?: number[]; attributes?: number[] }): void {
    const world = this.loaded?.world
    if (!world) return
    if (values.ca !== undefined) world.ca[k] = values.ca
    if (values.pa !== undefined) world.pa[k] = values.pa
    if (values.positions) world.positions.set(values.positions, k * POSITION_COUNT)
    if (values.attributes) world.attributes.set(values.attributes, k * ATTRIBUTE_COUNT)
    this.revision++
  }

  /**
   * 에디터에 보여 줄 선수의 값. 이름·나이·구단은 세이브에서, 고칠 값은 켜져 있는 게임에서 읽는다.
   * 게임에서 읽지 못하면 읽어 둔 값을 주고 그 이유를 적는다(그때는 고칠 수 없다).
   */
  async editorPlayer(uid: number): Promise<EditorPlayer | null> {
    const world = this.loaded?.world
    const k = this.indexOf(uid)
    if (!world || k < 0) return null
    const live = this.liveOff ? null : await livePlayer(uid)
    const usable = live !== null && live.found === 1 && live.positions && live.attributes && live.ca !== undefined && live.pa !== undefined
    if (usable) this.store(k, live)
    const player: EditorPlayer = {
      ...this.listItem(world, k),
      positions: [...world.positions.subarray(k * POSITION_COUNT, (k + 1) * POSITION_COUNT)],
      attributes: [...world.attributes.subarray(k * ATTRIBUTE_COUNT, (k + 1) * ATTRIBUTE_COUNT)],
      source: usable ? 'game' : 'save'
    }
    if (usable) return player
    // (화면이 이 뒤에 "이 상태에서는 고친 값을 게임에 넣을 수 없습니다"를 붙인다)
    if (this.liveOff) return { ...player, sourceNote: this.liveOff }
    if (live === null) return { ...player, sourceNote: '게임 안 플러그인이 대답하지 않아 세이브의 값을 보여 줍니다.' }
    return {
      ...player,
      sourceNote:
        live.found === 0
          ? '켜져 있는 게임에서 이 선수를 찾지 못해 세이브의 값을 보여 줍니다. 게임에서 이 세이브를 불러왔는지 확인해 주세요.'
          : '켜져 있는 게임에서 이 선수의 기록이 여러 개 나와 어느 것이 맞는지 알 수 없습니다. 세이브의 값을 보여 줍니다.'
    }
  }

  /**
   * 선수 정보 화면에 필요한 값 전부. 이름·나이·구단·계약은 세이브에서, 능력치는 에디터와 같은 규칙으로
   * (게임이 켜져 있으면 게임의 지금 값, 아니면 세이브의 값) 읽는다. 몸값·주급은 게임이 보여 주는 금액을 먼저 쓴다.
   */
  async playerProfile(uid: number): Promise<PlayerProfile | null> {
    const base = await this.editorPlayer(uid)
    const world = this.loaded?.world
    const k = this.indexOf(uid)
    if (!base || !world || k < 0) return null
    const shown = base.attributes.map(shownValue)
    const market = (await this.market([uid])).players.find((player) => player.uid === uid)

    const club = this.clubOf(world, k)
    const gameMoney = Boolean(market?.value || market?.wage)
    const savedEnd = world.contractEnd[k] ? calendar({ year: Math.floor(world.contractEnd[k] / 1000), day: world.contractEnd[k] % 1000 }) : null
    const born = world.birthYear[k] ? calendar({ year: world.birthYear[k], day: world.birthDay[k] || 1 }) : null
    const goalkeeper = isGoalkeeper(base.positions)
    return {
      uid,
      name: base.name,
      age: base.age,
      birth: born,
      position: base.position,
      positions: base.positions,
      goalkeeper,
      ca: base.ca,
      pa: base.pa,
      club: club.loanedTo ? club.name : base.club || market?.club || '',
      clubUid: club.loanedTo ? club.uid : world.club[k] >= 0 ? world.clubs[world.club[k]].uid : null,
      loanedTo: club.loanedTo ?? undefined,
      nation: this.names.nation(world.nationId[k]) || market?.nation || '',
      value: gameMoney ? (market?.value ?? '') : formatPounds(world.value[k]),
      wage: gameMoney ? (market?.wage ?? '').replace(/^주급\s*/, '') : formatPounds(world.wage[k]),
      moneyFrom: gameMoney ? 'game' : 'save',
      contractEnd: market?.contractEnd ?? savedEnd,
      squadStatus: SQUAD_STATUS_LABEL[world.squadStatus[k]] ?? '',
      foot: footValues(shown),
      attributes: visibleAttributes(shown, goalkeeper),
      hidden: hiddenAttributes(shown),
      source: base.source,
      sourceNote: base.sourceNote
    }
  }

  /**
   * 고친 값을 켜져 있는 게임에 바로 넣는다. 선수마다 따로 넣고, 넣은 뒤 게임이 돌려준 값으로 항목마다 확인한다.
   * 한 선수에서 막히면 거기서 멈추고, 선수·항목별로 들어간 것과 들어가지 않은 것을 돌려준다(A-15).
   * (한 선수의 쓰기가 중간에 실패했을 때 게임 안에서 앞 값을 되돌리는 일은 플러그인이 맡는다.)
   */
  async applyEdits(edits: EditorEdit[]): Promise<EditorApplyReport> {
    const world = this.loaded?.world
    const nameOf = (uid: number): string => {
      const k = this.indexOf(uid)
      return k >= 0 && world ? world.names[k] : String(uid)
    }
    const nothing = (message: string): EditorApplyReport => ({
      ok: false,
      message,
      players: edits.map((edit) => skippedResult(edit, nameOf(edit.uid)))
    })
    if (edits.length === 0) return { ok: false, message: '고친 값이 없습니다.', players: [] }
    if (this.liveOff) return nothing(this.liveOff.replace(/세이브에 저장된 값을 보여 줍니다/, '값을 넣을 수 없습니다'))
    for (const edit of edits) {
      const problem = checkEdit(edit)
      if (problem) return nothing(problem)
    }
    const results: EditorPlayerResult[] = []
    for (const edit of edits) {
      const name = nameOf(edit.uid)
      const result = playerResult(edit, name, await liveSetOutcome(edit))
      results.push(result)
      // 스쿼드와 영입 후보에도 바로 보이게 읽어 둔 값도 바꾼다(들어간 선수만)
      if (result.status === 'written') {
        const k = this.indexOf(edit.uid)
        if (k >= 0) this.store(k, edit)
      }
      if (result.status !== 'written') break
    }
    for (const edit of edits.slice(results.length)) results.push(skippedResult(edit, nameOf(edit.uid)))
    return reportOf(results)
  }
}
