import { closeSync, constants, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, parse } from 'node:path'
import { FM26_CATALOG } from '@shared/catalogFm26'
import { activeCatalog } from '@shared/catalogs'
import { migrateSettings, migrationVersion, needsMigration, withBackupNote } from '@shared/migration'
import { LEGACY_CATALOG } from '@shared/roleCatalog'
import type { Settings } from '@shared/types'

/**
 * 설정 기본값. 설정에 칸을 더할 때는 여기에 한 줄을 더한다(읽을 때 파일의 값이 이 위에 얹힌다).
 */
export function defaultSettings(documentsDir: string, saveDirOverride?: string): Settings {
  return {
    saveDir: saveDirOverride ?? join(documentsDir, 'Sports Interactive', 'Football Manager 26', 'games'),
    saveTeams: {},
    activeSave: '',
    density: 'compact',
    theme: 'blue',
    formation: '4-2-3-1',
    slotRoles: {},
    roleWeights: {},
    talkModel: 'claude-sonnet-5-5',
    talkEffort: 'medium',
    talkStats: { requests: 0, inputTokens: 0, outputTokens: 0 },
    matchPairs: [],
    keepRunning: true,
    backupEnabled: true,
    backupKeep: 3
  }
}

/** 이름 바꾸기가 잠깐 막힐 때 나오는 오류: Windows에서 백신이나 검색 색인이 방금 쓴 파일을 잠깐 잡고 있으면 이 셋으로 실패한다 */
const RENAME_BUSY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES'])
/** 이름 바꾸기를 해 보는 횟수와, 해 보는 사이에 기다리는 시간(밀리초). 막히지 않으면 기다리지 않고, 계속 막히면 0.1초쯤 뒤에 던진다 */
const RENAME_TRIES = 5
const RENAME_WAIT_MS = 30

/** 파일을 쓸 때 바깥에 맡기는 두 일(시험이 바꿔 끼워 막힘을 흉내 낸다) */
export interface AtomicIo {
  rename(from: string, to: string): void
  /** 멈춰서 기다린다(밀리초) */
  sleep(ms: number): void
}

const SYSTEM_IO: AtomicIo = {
  rename: renameSync,
  // 본체는 잠깐 멈춰도 된다: 설정 쓰기는 드물고, 기다리는 것은 이름 바꾸기가 막혔을 때뿐이다
  sleep: (ms) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** 이름을 바꾼다. 잠깐 막히는 오류(RENAME_BUSY_CODES)만 몇 번 다시 해 보고, 그 밖의 오류는 바로, 계속 막히면 마지막 오류를 그대로 던진다 */
function renameWithRetry(from: string, to: string, io: AtomicIo): void {
  for (let attempt = 1; ; attempt++) {
    try {
      io.rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= RENAME_TRIES || code === undefined || !RENAME_BUSY_CODES.has(code)) throw error
      io.sleep(RENAME_WAIT_MS)
    }
  }
}

/**
 * 파일을 원자적으로 쓴다: 같은 폴더의 임시 파일에 다 쓰고 디스크에 내린 뒤 이름을 바꿔 덮는다.
 * 중간에 꺼지거나 쓰기가 실패해도 옛 파일은 그대로이고 반쯤 쓴 파일이 남지 않는다. 실패하면 던진다(임시 파일은 치운다).
 * 이름 바꾸기가 잠깐 막히는 오류(EPERM, EBUSY, EACCES)는 몇 번 다시 해 본다.
 */
export function writeFileAtomic(file: string, text: string, io: Partial<AtomicIo> = {}): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  try {
    const fd = openSync(temp, 'w')
    try {
      writeFileSync(fd, text, 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameWithRetry(temp, file, { ...SYSTEM_IO, ...io })
  } catch (error) {
    try {
      rmSync(temp, { force: true })
    } catch {
      // 임시 파일을 못 치워도 원래 오류를 알린다
    }
    throw error
  }
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** 설정 파일을 읽은 결과: 없음, 읽음, 깨짐(읽지 못했거나 JSON 객체가 아님) */
type ReadResult = { kind: 'missing' } | { kind: 'ok'; saved: Partial<Settings> } | { kind: 'broken' }

export class SettingsStore {
  private current: Settings
  /** 이전 때문에 settings.json을 바꾸기 전에 사본(settings.v1.json)을 남겨야 하는데 아직 못 남겼는가 */
  private backupDue = false

  /** now는 시각을 주는 함수다(깨진 파일 이름과 이전 기록에 쓴다. 시험이 바꿔 끼운다) */
  constructor(
    private file: string,
    documentsDir: string,
    saveDirOverride?: string,
    private now: () => Date = () => new Date()
  ) {
    const read = this.read()
    let current: Settings = { ...defaultSettings(documentsDir, saveDirOverride), ...(read.kind === 'ok' ? read.saved : {}) }
    if (saveDirOverride) current.saveDir = saveDirOverride
    let dirty = false

    // 깨진 파일은 기본값으로 시작하되 말없이 버리지 않는다: 따로 남기고 알린다(settingsProblem)
    if (read.kind === 'broken') {
      const kept = this.keepBroken()
      current = { ...current, settingsProblem: kept.problem }
      // 깨진 파일을 따로 남기지 못했으면 그 자리에 새 파일을 쓰지 않는다(깨진 파일이 유일한 사본일 수 있다)
      dirty = kept.saved
    }

    if (read.kind !== 'ok') {
      // 새로 시작했으면 이전할 옛 설정이 없다. FM26 체계로 시작하는 설정이라는 표시만 한다
      if (activeCatalog(current).id === 'fm26') current = { ...current, settingsVersion: migrationVersion() }
    } else if (needsMigration(current, activeCatalog(current).id)) {
      // 설정을 읽을 때 한 번 이전하고 한 번 쓴다. 쓰기 전에(writeOut) 옛 파일을 settings.v1.json으로 남기고 이전 기록에 사본 알림을 더한다(사본이 이미 있으면 그대로 둔다)
      current = migrateSettings(current, { fm26: FM26_CATALOG, legacy: LEGACY_CATALOG, now: this.now() }).settings
      this.backupDue = true
      dirty = true
    }

    this.current = current
    if (dirty) {
      try {
        this.current = this.writeOut(current)
      } catch (error) {
        // 쓰지 못해도 앱은 켠다. 이번에는 메모리의 설정으로 돌고, 다음에 쓸 때(또는 다음에 켤 때) 다시 쓴다. 옛 파일은 그대로다
        console.error('[settings] 설정을 쓰지 못했습니다', error)
      }
    }
  }

  get(): Settings {
    return this.current
  }

  /** 설정을 합쳐 쓰고, 쓴 설정을 돌려준다. 쓰기가 실패하면 던지고, 옛 파일과 메모리의 설정은 그대로다 */
  set(patch: Partial<Settings>): Settings {
    const written = this.writeOut({ ...this.current, ...patch })
    this.current = written
    return written
  }

  /** 설정 파일 옆 파일의 경로: `settings.json` → `settings.<꼬리>.json` */
  private sibling(tail: string): string {
    const { dir, name, ext } = parse(this.file)
    return join(dir, `${name}.${tail}${ext}`)
  }

  private read(): ReadResult {
    if (!existsSync(this.file)) return { kind: 'missing' }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''))
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? { kind: 'ok', saved: parsed as Partial<Settings> } : { kind: 'broken' }
    } catch {
      return { kind: 'broken' }
    }
  }

  /** 읽지 못한 설정 파일을 settings.broken-<시각>.json으로 옮겨 남기고, 그 사실을 사용자에게 알릴 기록을 돌려준다 */
  private keepBroken(): { problem: NonNullable<Settings['settingsProblem']>; saved: boolean } {
    const now = this.now()
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
    let target = this.sibling(`broken-${stamp}`)
    for (let n = 2; existsSync(target); n++) target = this.sibling(`broken-${stamp}-${n}`)
    try {
      renameSync(this.file, target)
    } catch (error) {
      console.error('[settings] 깨진 설정 파일을 남기지 못했습니다', error)
      return { problem: { at: now.toISOString(), file: '', message: '설정 파일을 읽지 못해 기본값으로 시작했습니다. 읽지 못한 파일을 따로 남기지는 못했습니다.' }, saved: false }
    }
    const file = basename(target)
    return { problem: { at: now.toISOString(), file, message: `설정 파일을 읽지 못해 기본값으로 시작했습니다. 읽지 못한 파일은 따로 남겨 두었습니다: ${file}` }, saved: true }
  }

  /** 지금 설정 파일을 settings.v1.json으로 복사해 둔다(이미 있으면 그대로 둔다). 사본의 파일 이름을 돌려주고, 남기지 못했으면 null */
  private makeBackup(): string | null {
    const target = this.sibling('v1')
    try {
      copyFileSync(this.file, target, constants.COPYFILE_EXCL)
    } catch (error) {
      // 이미 사본이 있으면(앞서 이전하다 쓰기에서 멈췄을 때) 그 사본이 옛 파일이다. 파일이 아니거나 다른 이유로 못 남겼으면 실패다
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !isFile(target)) {
        console.error('[settings] 설정 사본을 남기지 못했습니다', error)
        return null
      }
    }
    return basename(target)
  }

  /**
   * 설정 파일에 쓰고, 실제로 쓴 설정을 돌려준다. 이전 때문에 사본(settings.v1.json)을 아직 못 남겼으면 쓰기 전에 남긴다(옛 파일을 지키려는 것이다).
   * 남기면 쓰는 설정의 이전 기록에 사본 알림을 더하고, 못 남기면 쓰지 않고 던진다(그때는 아무것도 바뀌지 않는다).
   * 사본이 이미 있어도 같은 결과라서, 쓰기가 실패한 뒤에 다시 해도 알림이 빠지지 않는다. 했다는 표시는 쓰기가 끝난 뒤에만 지운다.
   */
  private writeOut(wanted: Settings): Settings {
    let next = wanted
    if (this.backupDue && existsSync(this.file)) {
      const backup = this.makeBackup()
      if (backup === null) throw new Error('settings backup failed')
      next = withBackupNote(next, backup)
    }
    writeFileAtomic(this.file, JSON.stringify(next, null, 2))
    this.backupDue = false
    return next
  }
}
