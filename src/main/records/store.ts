import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { SaveRecords } from '@shared/records'
import { decodeGrowth, encodeGrowth, growthDate, type GrowthSnapshot } from './growth'

/**
 * 기록 보관(N-07): 세이브마다 폴더 하나(<기록 폴더>/<세이브 이름의 짧은 해시>/).
 *   meta.json       세이브 이름(label), 내 팀 번호, 만든 날, 평점 가져오기 상태
 *   YYYY-MM-DD.fmg  성장 스냅샷(growth.ts). 날짜는 스냅샷의 게임 날짜이고, 게임 속 한 달에 하나만 둔다
 *   ratings.jsonl   경기 평점 기록(ratings.ts)
 */

/** 세이브 하나가 차지할 수 있는 크기. 넘으면 오래된 스냅샷부터 분기당 하나로 솎고, 그래도 넘으면 가장 오래된 것부터 지운다 */
export const RECORDS_CAP_BYTES = 50 * 1024 * 1024
export const SNAPSHOT_FILE = /^(\d{4})-(\d{2})-(\d{2})\.fmg$/
export const RATINGS_FILE = 'ratings.jsonl'
const META_FILE = 'meta.json'
const FOLDER_ID = /^[0-9a-f]{8}$/

export interface RecordMeta {
  v: 1
  /** 세이브 파일 이름(확장자 없이) */
  label: string
  teamId: number | null
  /** 이 폴더를 만든 날(실제 날짜, YYYY-MM-DD) */
  created: string
  /** 플러그인의 평점 파일에서 여기까지 읽었다(바이트) */
  ratingsOffset: number
  /** ratings.jsonl의 경기 수 */
  ratedMatches: number
}

export interface SnapshotFile {
  /** 파일 이름 */
  file: string
  /** 게임 날짜 YYYY-MM-DD */
  date: string
  bytes: number
}

/** 세이브 경로 → 기록 이름(확장자를 뗀 파일 이름) */
export const saveLabel = (path: string): string => basename(path, extname(path))

/** 기록 이름 → 폴더 이름. 대소문자와 유니코드 정규형은 같게 본다 */
export const folderIdOf = (label: string): string => createHash('sha1').update(label.normalize('NFC').toLowerCase()).digest('hex').slice(0, 8)

const monthOf = (date: string): string => date.slice(0, 7)
/** 'YYYY-MM-DD' → 'YYYY-Qn' */
const quarterOf = (date: string): string => `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`

/**
 * 크기 상한을 넘을 때 지울 스냅샷을 정한다. snapshots는 날짜 순이 아니어도 된다. otherBytes는 스냅샷이 아닌 파일(평점 기록 등)의 크기.
 * 1) 가장 오래된 분기부터, 분기마다 가장 이른 것 하나만 남기고 지운다. 상한 안에 들면 거기서 멈춘다.
 * 2) 그래도 넘으면 가장 오래된 것부터 지운다.
 * 가장 최근 스냅샷은 어느 경우에도 지우지 않는다.
 */
export function planThinning(snapshots: SnapshotFile[], otherBytes: number, cap: number): string[] {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))
  let total = otherBytes + sorted.reduce((sum, s) => sum + s.bytes, 0)
  const doomed: string[] = []
  if (total <= cap || sorted.length <= 1) return doomed
  const newest = sorted[sorted.length - 1]
  const drop = (s: SnapshotFile): void => {
    doomed.push(s.file)
    total -= s.bytes
  }
  const quarters = new Map<string, SnapshotFile[]>()
  for (const s of sorted) quarters.set(quarterOf(s.date), [...(quarters.get(quarterOf(s.date)) ?? []), s])
  for (const group of quarters.values()) {
    for (const s of group.slice(1)) {
      if (total <= cap) return doomed
      if (s !== newest) drop(s)
    }
  }
  for (const s of sorted) {
    if (total <= cap) break
    if (s !== newest && !doomed.includes(s.file)) drop(s)
  }
  return doomed
}

export class RecordStore {
  /** 쓰는 중인 (폴더, 월). 같은 달의 쓰기가 겹치지 않게 한다 */
  private readonly writing = new Set<string>()

  constructor(
    private readonly root: string,
    private readonly cap = RECORDS_CAP_BYTES
  ) {}

  dir(label: string): string {
    return join(this.root, folderIdOf(label))
  }

  /** 폴더와 meta.json을 만들어 두고(없으면), 내 팀 번호를 알면 적는다. meta를 돌려준다 */
  ensure(label: string, teamId: number | null | undefined): RecordMeta {
    const dir = this.dir(label)
    mkdirSync(dir, { recursive: true })
    const meta = this.meta(label) ?? { v: 1, label, teamId: null, created: new Date().toISOString().slice(0, 10), ratingsOffset: 0, ratedMatches: 0 }
    if (teamId !== undefined && teamId !== null && meta.teamId !== teamId) meta.teamId = teamId
    this.saveMeta(label, meta)
    return meta
  }

  /** meta.json. 없거나 깨졌으면 null */
  meta(label: string): RecordMeta | null {
    try {
      const saved = JSON.parse(readFileSync(join(this.dir(label), META_FILE), 'utf8')) as Partial<RecordMeta>
      return {
        v: 1,
        label: typeof saved.label === 'string' ? saved.label : label,
        teamId: typeof saved.teamId === 'number' ? saved.teamId : null,
        created: typeof saved.created === 'string' ? saved.created : '',
        ratingsOffset: Number.isFinite(saved.ratingsOffset) ? Number(saved.ratingsOffset) : 0,
        ratedMatches: Number.isFinite(saved.ratedMatches) ? Number(saved.ratedMatches) : 0
      }
    } catch {
      return null
    }
  }

  saveMeta(label: string, meta: RecordMeta): void {
    writeFileSync(join(this.dir(label), META_FILE), JSON.stringify(meta, null, 2), 'utf8')
  }

  /** 스냅샷 파일들, 오래된 것부터 */
  snapshots(label: string): SnapshotFile[] {
    return this.snapshotsIn(this.dir(label))
  }

  private snapshotsIn(dir: string): SnapshotFile[] {
    if (!existsSync(dir)) return []
    const found: SnapshotFile[] = []
    for (const file of readdirSync(dir)) {
      const match = SNAPSHOT_FILE.exec(file)
      if (match) found.push({ file, date: `${match[1]}-${match[2]}-${match[3]}`, bytes: statSync(join(dir, file)).size })
    }
    return found.sort((a, b) => a.date.localeCompare(b.date))
  }

  /** 이 게임 날짜가 속한 달의 스냅샷이 이미 있는지(쓰는 중인 것 포함) */
  hasMonth(label: string, date: string): boolean {
    if (this.writing.has(`${folderIdOf(label)}/${monthOf(date)}`)) return true
    const month = monthOf(date)
    return this.snapshots(label).some((s) => monthOf(s.date) === month)
  }

  /**
   * 스냅샷을 남긴다. 그 달의 스냅샷이 이미 있으면 쓰지 않고 'exists'. 쓴 뒤 크기 상한을 맞춘다.
   * 압축과 쓰기는 비동기라 부르는 쪽을 막지 않는다.
   */
  async writeSnapshot(label: string, teamId: number | null | undefined, snap: GrowthSnapshot): Promise<'written' | 'exists'> {
    const date = growthDate(snap)
    if (this.hasMonth(label, date)) return 'exists'
    const key = `${folderIdOf(label)}/${monthOf(date)}`
    this.writing.add(key)
    try {
      this.ensure(label, teamId)
      const target = join(this.dir(label), `${date}.fmg`)
      const part = `${target}.part`
      await writeFile(part, encodeGrowth(snap))
      await rename(part, target)
      this.enforceCap(label)
      return 'written'
    } finally {
      this.writing.delete(key)
    }
  }

  /** 스냅샷 하나를 읽는다(4단계가 쓴다). date는 snapshots()의 date */
  async readSnapshot(label: string, date: string): Promise<GrowthSnapshot> {
    return decodeGrowth(await readFile(join(this.dir(label), `${date}.fmg`)))
  }

  /** 폴더가 상한을 넘으면 오래된 스냅샷을 솎는다. 지운 파일 수를 돌려준다 */
  enforceCap(label: string): number {
    const dir = this.dir(label)
    const snaps = this.snapshotsIn(dir)
    const total = this.folderBytes(dir)
    const snapBytes = snaps.reduce((sum, s) => sum + s.bytes, 0)
    const doomed = planThinning(snaps, total - snapBytes, this.cap)
    for (const file of doomed) unlinkSync(join(dir, file))
    return doomed.length
  }

  private folderBytes(dir: string): number {
    let sum = 0
    for (const file of readdirSync(dir)) {
      try {
        sum += statSync(join(dir, file)).size
      } catch {
        // 그새 지워진 파일은 건너뛴다
      }
    }
    return sum
  }

  /** 세이브마다의 기록 요약(설정 화면). 이름순 */
  summaries(): SaveRecords[] {
    if (!existsSync(this.root)) return []
    const out: SaveRecords[] = []
    for (const id of readdirSync(this.root)) {
      const dir = join(this.root, id)
      if (!FOLDER_ID.test(id) || !statSync(dir).isDirectory()) continue
      let saved: Partial<RecordMeta> = {}
      try {
        saved = JSON.parse(readFileSync(join(dir, META_FILE), 'utf8')) as Partial<RecordMeta>
      } catch {
        // meta가 없는 폴더는 이름을 모르는 채로 보여 준다
      }
      const snaps = this.snapshotsIn(dir)
      out.push({
        id,
        label: typeof saved.label === 'string' ? saved.label : id,
        teamId: typeof saved.teamId === 'number' ? saved.teamId : null,
        created: typeof saved.created === 'string' ? saved.created : '',
        bytes: this.folderBytes(dir),
        snapshots: snaps.length,
        lastSnapshot: snaps.length > 0 ? snaps[snaps.length - 1].date : null,
        ratedMatches: Number.isFinite(saved.ratedMatches) ? Number(saved.ratedMatches) : 0
      })
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }

  /** 지울 폴더의 경로. 기록 폴더 안의 8자리 해시 폴더가 아니거나 없으면 null */
  folderOf(id: string): string | null {
    if (!FOLDER_ID.test(id)) return null
    const dir = join(this.root, id)
    return existsSync(dir) ? dir : null
  }
}
