import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 게임이 알려 준 팀 하나 */
export interface TeamName {
  /** 팀 이름("리버풀 U21") */
  name: string
  /** 그 팀이 속한 구단 이름("리버풀") */
  club: string
  /** 여자 팀인지 */
  female: boolean
}

interface NationsFile {
  nations: Record<string, string>
}

interface TeamsFile {
  teams: Record<string, TeamName>
}

/**
 * 세이브에는 번호만 있고 이름이 없는 것들(나라, 그리고 구단을 알아내지 못한 팀)의 이름표.
 * 켜져 있는 게임에 물어 알게 된 것을 이 PC의 앱 폴더에 적어 두고 다음에도 쓴다.
 *
 * 나라 이름은 어느 세이브에서나 같아 한 파일에 두고, 팀은 세이브마다 따로 둔다
 * (팀 번호는 세이브 안의 순번이라 세이브가 다르면 다른 팀일 수 있다).
 */
export class NameBook {
  private nations = new Map<number, string>()
  private teams = new Map<number, TeamName>()
  private saveName = ''
  private dirtyNations = false
  private dirtyTeams = false

  constructor(private readonly dir: string) {
    this.nations = new Map(Object.entries(this.read<NationsFile>(this.nationsFile())?.nations ?? {}).map(([id, name]) => [Number(id), name]))
  }

  private nationsFile(): string {
    return join(this.dir, 'nations.json')
  }

  private teamsFile(): string {
    return join(this.dir, `teams-${encodeURIComponent(this.saveName)}.json`)
  }

  private read<T>(file: string): T | null {
    try {
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null
    } catch {
      return null
    }
  }

  /** 세이브를 적용할 때: 그 세이브의 팀 이름표를 연다. */
  open(saveName: string): void {
    if (saveName === this.saveName) return
    this.flush()
    this.saveName = saveName
    this.teams = new Map(Object.entries(this.read<TeamsFile>(this.teamsFile())?.teams ?? {}).map(([id, team]) => [Number(id), team]))
  }

  nation(id: number): string {
    return this.nations.get(id) ?? ''
  }

  team(id: number): TeamName | undefined {
    return this.teams.get(id)
  }

  hasNation(id: number): boolean {
    return this.nations.has(id)
  }

  hasTeam(id: number): boolean {
    return this.teams.has(id)
  }

  get teamCount(): number {
    return this.teams.size
  }

  get nationCount(): number {
    return this.nations.size
  }

  setNation(id: number, name: string): void {
    if (!name || this.nations.get(id) === name) return
    this.nations.set(id, name)
    this.dirtyNations = true
  }

  setTeam(id: number, team: TeamName): void {
    this.teams.set(id, team)
    this.dirtyTeams = true
  }

  /** 알게 된 것을 파일에 적는다. */
  flush(): void {
    try {
      if (!this.dirtyNations && !this.dirtyTeams) return
      mkdirSync(this.dir, { recursive: true })
      if (this.dirtyNations) {
        writeFileSync(this.nationsFile(), JSON.stringify({ nations: Object.fromEntries(this.nations) } satisfies NationsFile))
        this.dirtyNations = false
      }
      if (this.dirtyTeams && this.saveName) {
        writeFileSync(this.teamsFile(), JSON.stringify({ teams: Object.fromEntries(this.teams) } satisfies TeamsFile))
        this.dirtyTeams = false
      }
    } catch (error) {
      console.error('[names] save', error)
    }
  }
}
