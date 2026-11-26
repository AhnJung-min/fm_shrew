import { existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { NO_DATA, type DataStatus, type SaveFileInfo } from '@shared/game'
import { POSITION_KEYS, PLAYABLE_RATING, positionOrder, positionsLabel } from '@shared/positions'
import { effectiveWeights, ROLE_BY_ID } from '@shared/roles'
import {
  categoriesOf,
  checkEdit,
  SAVE_ATTRIBUTE_ORDER,
  shownValue,
  type CandidateBench,
  type CandidateCategory,
  type CandidateQuery,
  type CandidateResult,
  type CandidateRow,
  type EditorApplyResult,
  type EditorEdit,
  type EditorListItem,
  type EditorPlayer,
  type MarketResult,
  type PlayerMarket,
  parseGameDate
} from '@shared/world'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from './save/reader'
import { ageAt, findTeamByNames, NO_TEAM, readWorld, teamHasPlayers, type SaveWorld } from './save/world'
import { squadTable, type SquadTable } from './squad'
import { gamePeople, livePlayer, liveSet, PEOPLE_PER_REQUEST } from './talk/bridge'

/** 게임에서 받은 시장 정보를 다시 묻지 않고 쓰는 시간 */
const MARKET_KEEP_MS = 10 * 60_000
/** 영입 후보로 한 번에 보여 주는 줄 수 */
const MAX_ROWS = 300
/** 에디터에서 이름으로 찾을 때 보여 주는 줄 수 */
const MAX_FOUND = 80
/** 게임이 한 덩어리로 넘겨주는 선수 한 명의 크기: 번호 4 + 현재·잠재 능력 4 + 숙련도 15 + 능력치 54 */
const PACKED_SIZE = 8 + POSITION_COUNT + ATTRIBUTE_COUNT

const ATTRIBUTE_INDEX = new Map<string, number>(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))
const POSITION_INDEX = new Map<string, number>(POSITION_KEYS.map((key, i) => [key, i]))
const NO_SAVE = '먼저 홈 화면에서 세이브를 골라 적용해 주세요.'

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
}

export interface WorldDeps {
  /** 이 세이브에서 이미 찾아 둔 내 팀 번호 */
  knownTeam(fileName: string): number | undefined
  /** 켜져 있는 게임이 알려 준 내 팀 선수 이름(내 팀을 처음 찾을 때 대조한다). 게임이 꺼져 있으면 빈 목록 */
  rosterNames(): string[]
  /** 찾아낸 내 팀 번호를 기억해 둔다 */
  rememberTeam(fileName: string, teamId: number): void
  roleWeights(): Record<string, Record<string, number>>
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

  constructor(private readonly deps: WorldDeps) {}

  /** 시장 정보(몸값·주급·계약)를 게임에 물을 수 있는지를 알려 둔다. 못 하면 그 이유. */
  setMarketOff(reason: string | null): void {
    this.marketOff = reason
  }

  /** 게임의 값을 읽고 고칠 수 있는지를 알려 둔다. 못 하면 그 이유(화면에 그대로 보여 준다). */
  setLiveOff(reason: string | null): void {
    this.liveOff = reason
  }

  /** 적용해 둔 세이브의 경로 */
  get path(): string | null {
    return this.loaded?.path ?? null
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
    const world = readWorld(path, (fresh) => this.pickTeam(fresh, fileName))
    if (world.teamId !== undefined) this.deps.rememberTeam(fileName, world.teamId)
    const byUid = new Map<number, number>()
    for (let k = 0; k < world.count; k++) {
      const uid = world.uids[k]
      // 번호가 겹치는 기록은 어느 선수인지 가릴 수 없어 뺀다
      if (uid !== 0) byUid.set(uid, byUid.has(uid) ? -1 : k)
    }
    this.loaded = { path, mtimeMs: info.mtimeMs, size: info.size, world, byUid, live: null, note: '' }
    return world
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
      source: loaded.live ? 'game' : 'save',
      liveAt: loaded.live ? new Date(loaded.live.at).toISOString() : null,
      liveMatched: loaded.live?.matched ?? 0,
      note: loaded.note
    }
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
  squad(): SquadTable & { ok: boolean; message?: string } {
    const world = this.loaded?.world
    if (!world) return { ok: false, message: NO_SAVE, columns: [], rows: [] }
    if (world.teamId === undefined) {
      return {
        ok: false,
        message: '이 세이브에서 내 팀을 아직 찾지 못했습니다. 게임을 켜고 이 세이브를 불러오면 내 팀을 찾습니다.',
        columns: [],
        rows: []
      }
    }
    return { ok: true, ...squadTable(world) }
  }

  private clubName(world: SaveWorld, k: number): string {
    if (world.teamIds[k] === NO_TEAM) return '자유 계약'
    const club = world.club[k]
    return club >= 0 ? world.clubs[club].name : ''
  }

  private listItem(world: SaveWorld, k: number): EditorListItem {
    return {
      uid: world.uids[k],
      name: world.names[k],
      age: ageAt(world, k),
      position: positionsLabel([...world.positions.subarray(k * POSITION_COUNT, (k + 1) * POSITION_COUNT)]),
      club: this.clubName(world, k),
      ca: world.ca[k],
      pa: world.pa[k]
    }
  }

  /** 고른 역할로 모든 선수의 점수를 매겨 유형별 영입 후보를 고른다. */
  candidates(query: CandidateQuery): CandidateResult {
    const empty: Record<CandidateCategory, number> = { all: 0, starter: 0, rotation: 0, prospect: 0, free: 0 }
    const noBench: CandidateBench = { starter: null, backup: null }
    const fail = (message: string, saveName?: string): CandidateResult => ({ ok: false, message, saveName, bench: noBench, counts: empty, rows: [], matched: 0 })
    const loaded = this.loaded
    if (!loaded) return fail(NO_SAVE)
    const { world } = loaded
    const saveName = basename(loaded.path)
    if (world.teamId === undefined) {
      return fail('이 세이브에서 내 팀을 아직 찾지 못했습니다. 게임을 켜고 이 세이브를 불러오면 내 팀을 찾습니다.', saveName)
    }
    const role = ROLE_BY_ID[query.roleId]
    if (!role) return fail('알 수 없는 역할입니다.', saveName)

    const weights: Array<[number, number]> = []
    let weightSum = 0
    for (const [id, weight] of Object.entries(effectiveWeights(query.roleId, this.deps.roleWeights()))) {
      const index = ATTRIBUTE_INDEX.get(id)
      if (index === undefined || weight <= 0) continue
      weights.push([index, weight])
      weightSum += weight
    }
    const slots = role.positions.map((key) => POSITION_INDEX.get(key)!).filter((index) => index !== undefined)
    const eligible = (k: number): boolean => slots.some((slot) => world.positions[k * POSITION_COUNT + slot] >= PLAYABLE_RATING)
    // 스쿼드 화면과 같은 값이 나오도록 게임 표시값(1~20)으로 계산한다
    const scoreOf = (k: number): number => {
      if (weightSum === 0) return 0
      let sum = 0
      for (const [index, weight] of weights) sum += shownValue(world.attributes[k * ATTRIBUTE_COUNT + index]) * weight
      return Math.round((sum / weightSum / 20) * 1000) / 10
    }

    // 내 팀에서 이 역할을 뛸 수 있는 선수들
    const mine: Array<{ k: number; score: number }> = []
    let myClub = -1
    for (let k = 0; k < world.count; k++) {
      if (world.teamIds[k] !== world.teamId || !world.names[k]) continue
      if (world.club[k] >= 0) myClub = world.club[k]
      if (eligible(k)) mine.push({ k, score: scoreOf(k) })
    }
    mine.sort((a, b) => b.score - a.score)
    const bench: CandidateBench = {
      starter: mine[0] ? { name: world.names[mine[0].k], score: mine[0].score, ca: world.ca[mine[0].k] } : null,
      backup: mine[1] ? { name: world.names[mine[1].k], score: mine[1].score } : null
    }

    const search = query.search.trim().toLowerCase()
    const counts = { ...empty }
    const picked: Array<{ k: number; score: number; age: number | null; categories: CandidateCategory[] }> = []
    for (let k = 0; k < world.count; k++) {
      const name = world.names[k]
      if (!name || world.uids[k] === 0) continue
      const team = world.teamIds[k]
      const club = world.club[k]
      // 내 구단 선수(2군·유스 포함)는 후보가 아니다
      if (team === world.teamId || (club >= 0 && club === myClub)) continue
      if (club >= 0 && world.clubs[club].women) continue
      if (team !== NO_TEAM && club < 0 && !query.includeUnknownClub) continue
      if (query.onlyEligible && !eligible(k)) continue
      const age = ageAt(world, k)
      if (query.maxAge !== null && (age === null || age > query.maxAge)) continue
      if (search && !name.toLowerCase().includes(search)) continue

      const score = scoreOf(k)
      const categories = categoriesOf({ score, age, ca: world.ca[k], pa: world.pa[k], hasClub: team !== NO_TEAM }, bench)
      counts.all++
      for (const category of categories) counts[category]++
      if (query.category !== 'all' && !categories.includes(query.category)) continue
      picked.push({ k, score, age, categories })
    }
    // 유망주는 잠재 능력 순, 나머지는 역할 점수 순
    if (query.category === 'prospect') picked.sort((a, b) => world.pa[b.k] - world.pa[a.k] || b.score - a.score)
    else picked.sort((a, b) => b.score - a.score || world.ca[b.k] - world.ca[a.k])

    const rows: CandidateRow[] = picked.slice(0, MAX_ROWS).map(({ k, score, age, categories }) => ({
      uid: world.uids[k],
      name: world.names[k],
      age,
      position: positionsLabel([...world.positions.subarray(k * POSITION_COUNT, (k + 1) * POSITION_COUNT)]),
      club: this.clubName(world, k),
      ca: world.ca[k],
      pa: world.pa[k],
      value: world.value[k] || null,
      score,
      gap: bench.starter ? Math.round((score - bench.starter.score) * 10) / 10 : null,
      categories,
      attributes: [...world.attributes.subarray(k * ATTRIBUTE_COUNT, (k + 1) * ATTRIBUTE_COUNT)].map(shownValue)
    }))
    return { ok: true, saveName, bench, counts, rows, matched: picked.length }
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

  /** 고친 값을 켜져 있는 게임에 바로 넣는다. 선수마다 따로 넣고, 넣은 뒤 게임이 돌려준 값으로 확인한다. */
  async applyEdits(edits: EditorEdit[]): Promise<EditorApplyResult> {
    if (edits.length === 0) return { ok: false, message: '고친 값이 없습니다.' }
    if (this.liveOff) return { ok: false, message: this.liveOff.replace(/세이브에 저장된 값을 보여 줍니다/, '값을 넣을 수 없습니다') }
    for (const edit of edits) {
      const problem = checkEdit(edit)
      if (problem) return { ok: false, message: problem }
    }
    const world = this.loaded?.world
    const nameOf = (uid: number): string => {
      const k = this.indexOf(uid)
      return k >= 0 && world ? world.names[k] : String(uid)
    }
    const done: string[] = []
    for (const edit of edits) {
      const after = await liveSet(edit)
      const stopped = done.length > 0 ? ` (${done.join(', ')}까지는 반영했습니다.)` : ''
      if (after === null) return { ok: false, message: `게임에 연결하지 못했습니다. 게임이 켜져 있는지 확인해 주세요.${stopped}` }
      if (after.found !== 1) return { ok: false, message: `켜져 있는 게임에서 ${nameOf(edit.uid)}의 기록을 찾지 못했습니다.${stopped}` }
      const same = (a: number[] | undefined, b: number[] | undefined): boolean => !a || (b !== undefined && a.every((v, i) => v === b[i]))
      const landed =
        same(edit.positions, after.positions) &&
        same(edit.attributes, after.attributes) &&
        (edit.ca === undefined || edit.ca === after.ca) &&
        (edit.pa === undefined || edit.pa === after.pa)
      if (!landed) return { ok: false, message: `${nameOf(edit.uid)}의 값을 넣었지만 다시 읽은 값이 다릅니다.${stopped}` }
      // 스쿼드와 영입 후보에도 바로 보이게 읽어 둔 값도 바꾼다
      const k = this.indexOf(edit.uid)
      if (k >= 0) this.store(k, after)
      done.push(nameOf(edit.uid))
    }
    return {
      ok: true,
      message: `${done.join(', ')}의 값을 게임에 반영했습니다. 게임에서 그 선수 화면을 다시 열면 보입니다. 게임에서 저장해야 세이브에도 남습니다.`
    }
  }
}
