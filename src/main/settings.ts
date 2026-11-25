import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '@shared/types'

/** 내보내기 파일이 생길 만한 기본 폴더들. 플러그인 설명에 저장 위치가 두 가지로 나와 있어 둘 다 본다. */
export function defaultWatchDirs(documentsDir: string): string[] {
  const base = join(documentsDir, 'Sports Interactive')
  return [join(base, 'Football Manager 26'), join(base, 'Football Manager 2026')]
}

export class SettingsStore {
  private current: Settings

  constructor(
    private file: string,
    documentsDir: string,
    watchDirOverride?: string,
    saveDirOverride?: string
  ) {
    const defaults: Settings = {
      watchDirs: watchDirOverride ? [watchDirOverride] : defaultWatchDirs(documentsDir),
      saveDir: saveDirOverride ?? join(documentsDir, 'Sports Interactive', 'Football Manager 26', 'games'),
      saveTeams: {},
      density: 'compact',
      formation: '4-2-3-1',
      slotRoles: {},
      roleWeights: {},
      talkHotkey: 'CommandOrControl+Shift+Space',
      talkModel: 'claude-opus-5-5',
      talkPhrases: [
        '잘하고 있다, 이대로 계속 가자',
        '실망스럽다, 더 집중해야 한다',
        '부담 갖지 말고 즐겨라',
        '이번 경기는 반드시 이겨야 한다'
      ],
      talkAllowScreen: false,
      talkStats: { requests: 0, inputTokens: 0, outputTokens: 0 },
      columnOverrides: {}
    }
    let saved: Partial<Settings> = {}
    if (existsSync(file)) {
      try {
        saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>
      } catch {
        // 설정 파일이 깨졌으면 기본값으로 시작한다
        saved = {}
      }
    }
    this.current = { ...defaults, ...saved }
    if (watchDirOverride) this.current.watchDirs = [watchDirOverride]
    if (saveDirOverride) this.current.saveDir = saveDirOverride
  }

  get(): Settings {
    return this.current
  }

  set(patch: Partial<Settings>): Settings {
    this.current = { ...this.current, ...patch }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.current, null, 2), 'utf8')
    return this.current
  }
}
