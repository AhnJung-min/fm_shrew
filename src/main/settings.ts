import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '@shared/types'

export class SettingsStore {
  private current: Settings

  constructor(
    private file: string,
    documentsDir: string,
    saveDirOverride?: string
  ) {
    const defaults: Settings = {
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
