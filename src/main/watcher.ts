import { existsSync } from 'node:fs'
import { watch, type FSWatcher } from 'chokidar'
import { basename } from 'node:path'

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
