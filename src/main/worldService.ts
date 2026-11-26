import { existsSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { POSITION_KEYS, PLAYABLE_RATING, positionOrder, positionsLabel } from '@shared/positions'
import { effectiveWeights, ROLE_BY_ID } from '@shared/roles'
import {
  categoriesOf,
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
  type EditorSaveResult
} from '@shared/world'
import { checkEdit, writeEditedSave } from './save/editor'
import { ATTRIBUTE_COUNT, POSITION_COUNT } from './save/reader'
import { ageAt, findTeamByNames, NO_TEAM, readWorld, teamHasPlayers, type SaveWorld } from './save/world'

/** 영입 후보로 한 번에 보여 주는 줄 수 */
const MAX_ROWS = 300
/** 에디터에서 이름으로 찾을 때 보여 주는 줄 수 */
const MAX_FOUND = 80
/** 수정본 세이브의 이름 꼬리 */
const EDITED_SUFFIX = ' (수정)'

const ATTRIBUTE_INDEX = new Map<string, number>(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))
const POSITION_INDEX = new Map<string, number>(POSITION_KEYS.map((key, i) => [key, i]))

interface Loaded {
  path: string
  mtimeMs: number
  size: number
  world: SaveWorld
}

export interface WorldDeps {
  /** 세이브 폴더에서 가장 최근에 저장된 세이브 */
  newestSave(): string | null
  /** 이 세이브에서 이미 찾아 둔 내 팀 번호 */
  knownTeam(fileName: string): number | undefined
  /** 내 팀을 처음 찾을 때 대조할 명단(게임에서 내보낸 스쿼드의 선수 이름) */
  rosterNames(): string[]
  /** 찾아낸 내 팀 번호를 기억해 둔다 */
  rememberTeam(fileName: string, teamId: number): void
  roleWeights(): Record<string, Record<string, number>>
  /** 고치기 전에 원본 세이브의 사본을 남긴다 */
  backup(path: string): Promise<void>
}

/**
 * 가장 최근 세이브 하나를 통째로 읽어 두고(모든 구단의 선수), 영입 후보를 고르고 능력치 수정본을 쓴다.
 * 세이브를 읽는 데 몇 초 걸리므로 파일이 바뀌지 않았으면 읽어 둔 것을 다시 쓴다.
 */
export class WorldService {
  private loaded: Loaded | null = null

  constructor(private readonly deps: WorldDeps) {}

  /** path 세이브를 읽어 둔다. 이미 읽은 그 파일이면 그대로 돌려준다. */
  read(path: string): SaveWorld {
    const info = statSync(path)
    const current = this.loaded
    if (current && current.path === path && current.mtimeMs === info.mtimeMs && current.size === info.size) {
      return current.world
    }
    const fileName = basename(path)
    const world = readWorld(path, (fresh) => {
      const known = this.deps.knownTeam(fileName)
      if (known !== undefined && teamHasPlayers(fresh, known)) return known
      // 처음이거나 팀을 옮긴 경우: 내보낸 명단과 가장 많이 겹치는 팀을 찾는다
      return findTeamByNames(fresh, this.deps.rosterNames()) ?? undefined
    })
    if (world.teamId !== undefined) this.deps.rememberTeam(fileName, world.teamId)
    this.loaded = { path, mtimeMs: info.mtimeMs, size: info.size, world }
    return world
  }

  private latest(): Loaded {
    const path = this.deps.newestSave()
    if (!path) throw new Error('세이브 폴더에 세이브가 없습니다. 게임에서 한 번 저장해 주세요.')
    this.read(path)
    return this.loaded!
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
    let loaded: Loaded
    try {
      loaded = this.latest()
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error), bench: noBench, counts: empty, rows: [], matched: 0 }
    }
    const { world } = loaded
    const saveName = basename(loaded.path)
    if (world.teamId === undefined) {
      return {
        ok: false,
        saveName,
        message:
          '세이브에서 내 팀을 찾지 못했습니다. 게임의 스쿼드 화면에서 선수를 모두 선택하고 F9로 한 번 내보내면, 그 명단으로 팀을 찾습니다.',
        bench: noBench,
        counts: empty,
        rows: [],
        matched: 0
      }
    }
    const role = ROLE_BY_ID[query.roleId]
    if (!role) return { ok: false, saveName, message: '알 수 없는 역할입니다.', bench: noBench, counts: empty, rows: [], matched: 0 }

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
      score,
      gap: bench.starter ? Math.round((score - bench.starter.score) * 10) / 10 : null,
      categories,
      attributes: [...world.attributes.subarray(k * ATTRIBUTE_COUNT, (k + 1) * ATTRIBUTE_COUNT)].map(shownValue)
    }))
    return { ok: true, saveName, bench, counts, rows, matched: picked.length }
  }

  /** 에디터의 선수 목록. 찾는 글자가 없으면 내 팀 선수들 */
  editorList(search: string): { ok: boolean; message?: string; saveName?: string; items: EditorListItem[] } {
    let loaded: Loaded
    try {
      loaded = this.latest()
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error), items: [] }
    }
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

  editorPlayer(uid: number): EditorPlayer | null {
    const world = this.loaded?.world
    if (!world || uid === 0) return null
    const k = world.uids.indexOf(uid)
    if (k < 0 || world.uids.indexOf(uid, k + 1) >= 0) return null
    return {
      ...this.listItem(world, k),
      positions: [...world.positions.subarray(k * POSITION_COUNT, (k + 1) * POSITION_COUNT)],
      attributes: [...world.attributes.subarray(k * ATTRIBUTE_COUNT, (k + 1) * ATTRIBUTE_COUNT)]
    }
  }

  /**
   * 수정을 적용한 새 세이브를 세이브 폴더에 쓴다. 원본은 그대로 두고 "이름 (수정).fm"으로 따로 만든다.
   * 이미 수정본을 고치는 중이면 그 파일을 덮어쓴다(먼저 사본을 남긴다).
   */
  async saveEdits(edits: EditorEdit[]): Promise<EditorSaveResult> {
    const loaded = this.loaded
    if (!loaded) return { ok: false, message: '먼저 세이브를 읽어야 합니다.' }
    if (edits.length === 0) return { ok: false, message: '고친 값이 없습니다.' }
    for (const edit of edits) {
      const problem = checkEdit(edit)
      if (problem) return { ok: false, message: problem }
    }
    try {
      const info = statSync(loaded.path)
      if (info.mtimeMs !== loaded.mtimeMs || info.size !== loaded.size) {
        this.loaded = null
        return { ok: false, message: '그 사이에 게임이 세이브를 다시 저장했습니다. 바뀐 세이브를 다시 읽었으니 값을 확인하고 다시 저장해 주세요.' }
      }
      const sourceName = basename(loaded.path)
      const base = sourceName.replace(/\.fm$/i, '')
      const targetName = base.endsWith(EDITED_SUFFIX) ? sourceName : `${base}${EDITED_SUFFIX}.fm`
      const target = join(dirname(loaded.path), targetName)

      await this.deps.backup(loaded.path)
      if (target !== loaded.path && existsSync(target)) await this.deps.backup(target)
      if (loaded.world.teamId !== undefined) this.deps.rememberTeam(targetName, loaded.world.teamId)
      const result = writeEditedSave(loaded.path, target, edits)
      this.loaded = null
      return {
        ok: true,
        fileName: targetName,
        message: `선수 ${result.players}명의 값을 고친 세이브 “${targetName}”을 만들었습니다. 게임에서 이 세이브를 불러오세요.`
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}
