import { existsSync } from 'node:fs'
import { watch, type FSWatcher } from 'chokidar'
import { basename } from 'node:path'
import { isExportFile } from './importer'

/** FM26 Player Export가 선수 목록이 아닌 것(일정, 경기 기록, 스태프)을 내보낼 때 붙이는 파일 이름 머리 */
const NON_PLAYER_PREFIX = /^(calendario_|match_stats_|partida_|staff_export_)/i

/**
 * 지켜보지 않을 경로.
 * 플러그인은 같은 목록을 CSV와 HTML 두 벌로 저장하므로 HTML 폴더는 건너뛰어 두 번 가져오지 않게 한다.
 */
export function shouldIgnore(path: string, isFile: boolean): boolean {
  if (/[\\/]Exports HTML([\\/]|$)/i.test(path)) return true
  if (!isFile) return false
  return !isExportFile(path) || NON_PLAYER_PREFIX.test(basename(path))
}

/** 게임이 저장할 때 직전 세이브를 옮겨 두는 파일. 한 박자 늦은 데이터라 읽지 않는다. */
const SAVE_BACKUP_NAME = /^last save overwrite backup\.fm$/i

export function isSaveFile(path: string): boolean {
  const name = basename(path)
  return /\.fm$/i.test(name) && !SAVE_BACKUP_NAME.test(name)
}

/** 세이브 폴더를 지켜보다가 게임이 저장을 마치면 알려 준다. */
export class SaveWatcher {
  private watcher: FSWatcher | null = null

  constructor(private onSave: (path: string) => void) {}

  async start(dir: string): Promise<void> {
    await this.stop()
    if (!existsSync(dir)) return
    this.watcher = watch(dir, {
      depth: 0,
      ignoreInitial: true,
      // 세이브는 100MB가 넘어 쓰는 데 시간이 걸린다. 크기가 멈춘 뒤에 읽는다.
      awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 250 },
      ignored: (path, stats) => Boolean(stats?.isFile()) && !isSaveFile(path)
    })
    this.watcher.on('add', (path) => this.onSave(path))
    this.watcher.on('change', (path) => this.onSave(path))
    this.watcher.on('error', (error) => console.error('[save watcher]', error))
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }
}

/**
 * 내보내기 폴더를 지켜보다가 CSV/HTML 파일이 생기면 알려 준다.
 * 앱이 꺼져 있던 동안 생긴 파일도 시작할 때 한 번 훑는다(중복은 저장소에서 걸러진다).
 */
export class ExportWatcher {
  private watcher: FSWatcher | null = null

  constructor(private onFile: (path: string) => void) {}

  async start(dirs: string[]): Promise<void> {
    await this.stop()
    const existing = dirs.filter((dir) => existsSync(dir))
    if (existing.length === 0) return

    this.watcher = watch(existing, {
      // 하위 폴더 세 단계까지(예: Football Manager 26\FM26PlayerExport by vinteset\Exports CSV)
      depth: 3,
      ignoreInitial: false,
      // 플러그인이 줄 단위로 이어 쓰므로, 크기가 멈출 때까지 넉넉히 기다린 뒤 읽는다
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 150 },
      ignored: (path, stats) => shouldIgnore(path, Boolean(stats?.isFile()))
    })
    this.watcher.on('add', (path) => this.onFile(path))
    this.watcher.on('change', (path) => this.onFile(path))
    this.watcher.on('error', (error) => console.error('[watcher]', error))
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }
}
