import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { BackupEntry, BackupList } from '@shared/types'
import { isPlainFileName } from './pathGuard'

/**
 * 세이브 자동 백업.
 *
 * 게임이 저장을 마칠 때마다 세이브를 통째로 복사해 둔다. 사본 이름은
 *   <세이브 이름>__<저장 시각 yyyyMMdd-HHmmss>.fm          자동 사본
 *   <세이브 이름>__<저장 시각>__pre.fm                     복원하기 직전에 남긴 사본
 * 이고, 사본 파일의 수정 시각을 원본의 저장 시각과 같게 맞춰 둔다(같은 저장을 두 번 복사하지 않으려고).
 *
 * 원본 세이브를 고치는 일은 복원뿐이고, 복원 전에는 지금 파일을 먼저 사본으로 남긴다.
 */

const NAME = /^(.+)__(\d{8}-\d{6})(__pre)?\.fm$/i

function stamp(time: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  return (
    `${time.getFullYear()}${two(time.getMonth() + 1)}${two(time.getDate())}` +
    `-${two(time.getHours())}${two(time.getMinutes())}${two(time.getSeconds())}`
  )
}

function parseStamp(text: string): Date {
  const n = (from: number, length: number): number => Number(text.slice(from, from + length))
  return new Date(n(0, 4), n(4, 2) - 1, n(6, 2), n(9, 2), n(11, 2), n(13, 2))
}

/** 사본 파일 이름에서 정보를 읽는다. 우리 사본이 아니면 null */
export function parseBackupName(fileName: string): Pick<BackupEntry, 'id' | 'saveName' | 'savedAt' | 'beforeRestore'> | null {
  const m = NAME.exec(fileName)
  if (!m) return null
  return { id: fileName, saveName: `${m[1]}.fm`, savedAt: parseStamp(m[2]).toISOString(), beforeRestore: Boolean(m[3]) }
}

/** 화면이 보낸 사본 이름이 쓸 수 있는 것인가: 폴더 이름이나 경로가 섞이지 않은, 우리 사본 모양의 이름(N-03) */
export function isBackupId(id: unknown): id is string {
  return isPlainFileName(id) && parseBackupName(id) !== null
}

export class BackupManager {
  /** 같은 파일을 동시에 두 번 복사하지 않게 차례로 처리한다 */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private dir: string,
    private getSaveDir: () => string,
    private getKeep: () => number
  ) {}

  private run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job)
    this.queue = next.catch(() => undefined)
    return next
  }

  async list(): Promise<BackupList> {
    if (!existsSync(this.dir)) return { dir: this.dir, entries: [], totalBytes: 0 }
    const entries: BackupEntry[] = []
    for (const name of await readdir(this.dir)) {
      const parsed = parseBackupName(name)
      if (!parsed) continue
      const info = await stat(join(this.dir, name))
      entries.push({ ...parsed, bytes: info.size })
    }
    entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || Number(b.beforeRestore) - Number(a.beforeRestore))
    return { dir: this.dir, entries, totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) }
  }

  /**
   * 세이브 하나를 사본으로 남긴다. 같은 저장(이름·저장 시각·크기가 같은 것)이 이미 있으면 건너뛴다.
   * 새로 남겼으면 그 사본을, 건너뛰었으면 null을 준다.
   */
  backup(savePath: string, beforeRestore = false, prune = true): Promise<BackupEntry | null> {
    return this.run(async () => {
      const source = await stat(savePath)
      const base = basename(savePath).replace(/\.fm$/i, '')
      const name = `${base}__${stamp(source.mtime)}${beforeRestore ? '__pre' : ''}.fm`
      const target = join(this.dir, name)
      mkdirSync(this.dir, { recursive: true })

      // 같은 저장의 사본이 종류와 상관없이 이미 있으면 다시 남기지 않는다
      for (const twin of [`${base}__${stamp(source.mtime)}.fm`, `${base}__${stamp(source.mtime)}__pre.fm`]) {
        const path = join(this.dir, twin)
        if (existsSync(path) && (await stat(path)).size === source.size) return null
      }

      // 다 복사된 뒤에 제 이름을 준다(복사 도중 앱이 꺼져도 반쪽짜리가 사본으로 보이지 않게)
      const partial = `${target}.part`
      await copyFile(savePath, partial)
      await utimes(partial, source.atime, source.mtime)
      await rename(partial, target)
      if (prune) await this.prune(`${base}.fm`)
      return { ...parseBackupName(name)!, bytes: source.size }
    })
  }

  /** 세이브마다 최근 것만 남기고 오래된 사본을 지운다. */
  private async prune(saveName: string): Promise<void> {
    const keep = Math.max(1, Math.floor(this.getKeep()))
    const mine = (await this.list()).entries.filter((entry) => entry.saveName === saveName)
    for (const old of mine.slice(keep)) await rm(join(this.dir, old.id), { force: true })
  }

  /**
   * 사본을 세이브 폴더로 되돌린다. 지금 있는 세이브는 먼저 사본으로 남긴다.
   * 게임이 켜져 있으면 게임에서 그 세이브를 다시 불러와야 반영된다.
   */
  async restore(id: string): Promise<{ ok: boolean; message?: string; savePath?: string }> {
    const parsed = isBackupId(id) ? parseBackupName(id) : null
    const from = parsed ? join(this.dir, id) : ''
    if (!parsed || !existsSync(from)) return { ok: false, message: '사본을 찾지 못했습니다.' }
    const saveDir = this.getSaveDir()
    if (!existsSync(saveDir)) return { ok: false, message: `세이브 폴더가 없습니다: ${saveDir}` }
    const target = join(saveDir, parsed.saveName)

    // 지금 있는 세이브를 먼저 남긴다. 이때는 오래된 사본을 정리하지 않는다(되돌리려는 사본이 지워질 수 있다)
    if (existsSync(target)) await this.backup(target, true, false)
    const result = await this.run(async () => {
      const info = await stat(from)
      const partial = `${target}.restoring`
      try {
        await copyFile(from, partial)
        await utimes(partial, info.atime, info.mtime)
        await rename(partial, target)
      } catch (error) {
        await rm(partial, { force: true })
        const reason = error instanceof Error ? error.message : String(error)
        return { ok: false, message: `복원하지 못했습니다. 게임이 그 세이브를 쓰는 중일 수 있습니다. (${reason})` }
      }
      return { ok: true, savePath: target }
    })
    if (result.ok) await this.run(() => this.prune(parsed.saveName))
    return result
  }

  async remove(id: string): Promise<void> {
    if (!isBackupId(id)) return
    await this.run(() => rm(join(this.dir, id), { force: true }))
  }
}
