import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { BackupManager, isBackupId, parseBackupName } from '../src/main/backup'

let saveDir: string
let backupDir: string
let keep: number
let manager: BackupManager

/** 세이브를 흉내 낸 파일을 쓰고 저장 시각을 정해 준다 */
function save(name: string, content: string, at: Date): string {
  const path = join(saveDir, name)
  writeFileSync(path, content)
  utimesSync(path, at, at)
  return path
}

const day = (d: number, hour = 12): Date => new Date(2026, 10, d, hour, 0, 0)

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'fmb-backup-'))
  saveDir = join(root, 'games')
  backupDir = join(root, 'backups')
  mkdirSync(saveDir)
  keep = 3
  manager = new BackupManager(
    backupDir,
    () => saveDir,
    () => keep
  )
})

describe('parseBackupName', () => {
  it('사본 이름에서 세이브 이름·저장 시각·종류를 읽는다', () => {
    const parsed = parseBackupName('내 팀 - 가온 시티__20261126-021530__pre.fm')!
    expect(parsed.saveName).toBe('내 팀 - 가온 시티.fm')
    expect(new Date(parsed.savedAt).getHours()).toBe(2)
    expect(parsed.beforeRestore).toBe(true)
    expect(parseBackupName('내 팀__20261126-021530.fm')!.beforeRestore).toBe(false)
  })

  it('우리 사본이 아닌 파일은 무시한다', () => {
    expect(parseBackupName('내 팀.fm')).toBeNull()
    expect(parseBackupName('내 팀__20261126-021530.fm.part')).toBeNull()
  })
})

describe('BackupManager', () => {
  it('세이브를 저장 시각이 붙은 이름으로 복사하고, 같은 저장은 다시 남기지 않는다', async () => {
    const path = save('a.fm', 'first', day(1))
    const made = await manager.backup(path)
    expect(made?.saveName).toBe('a.fm')
    expect(readFileSync(join(backupDir, made!.id), 'utf8')).toBe('first')
    expect(await manager.backup(path)).toBeNull()
    expect((await manager.list()).entries).toHaveLength(1)
  })

  it('세이브마다 최근 것만 남기고, 다른 세이브의 사본은 건드리지 않는다', async () => {
    await manager.backup(save('b.fm', 'other', day(1)))
    for (let d = 1; d <= 5; d++) await manager.backup(save('a.fm', `v${d}`, day(d)))
    const list = await manager.list()
    const mine = list.entries.filter((entry) => entry.saveName === 'a.fm')
    expect(mine.map((entry) => readFileSync(join(backupDir, entry.id), 'utf8'))).toEqual(['v5', 'v4', 'v3'])
    expect(list.entries.filter((entry) => entry.saveName === 'b.fm')).toHaveLength(1)
    expect(list.totalBytes).toBe(2 + 2 + 2 + 5)
  })

  it('복원하면 지금 세이브를 먼저 남기고, 세이브를 그 시각의 내용으로 바꾼다', async () => {
    const old = await manager.backup(save('a.fm', 'old', day(1)))
    const path = save('a.fm', 'new', day(2))

    const result = await manager.restore(old!.id)
    expect(result.ok).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('old')
    expect(statSync(path).mtime.getDate()).toBe(1)

    const entries = (await manager.list()).entries
    const before = entries.find((entry) => entry.beforeRestore)!
    expect(readFileSync(join(backupDir, before.id), 'utf8')).toBe('new')
    // 되돌린 세이브는 이미 있는 사본과 같은 저장이라 또 남기지 않는다
    expect(await manager.backup(path)).toBeNull()
  })

  it('보관 개수가 꽉 찬 상태에서 가장 오래된 사본으로 되돌려도 그 사본을 잃지 않는다', async () => {
    const made = []
    for (let d = 1; d <= 3; d++) made.push(await manager.backup(save('a.fm', `v${d}`, day(d))))
    const path = save('a.fm', 'v4', day(4))

    const result = await manager.restore(made[0]!.id)
    expect(result.ok).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('v1')
    // 직전 상태(v4)는 가장 최근 사본이라 정리 뒤에도 남아 있다
    const kept = (await manager.list()).entries.map((entry) => readFileSync(join(backupDir, entry.id), 'utf8'))
    expect(kept).toContain('v4')
    expect(kept).toHaveLength(3)
  })

  it('없는 사본이나 없는 세이브 폴더는 실패로 알린다', async () => {
    expect((await manager.restore('a__20261101-120000.fm')).ok).toBe(false)
    const made = await manager.backup(save('a.fm', 'x', day(1)))
    saveDir = join(saveDir, 'missing')
    expect((await manager.restore(made!.id)).ok).toBe(false)
  })

  it('복사 도중의 임시 파일은 목록에 나오지 않고, 지우기는 우리 사본만 지운다', async () => {
    const made = await manager.backup(save('a.fm', 'x', day(1)))
    writeFileSync(join(backupDir, 'a__20261102-120000.fm.part'), 'half')
    writeFileSync(join(backupDir, 'notes.txt'), 'keep me')
    expect((await manager.list()).entries).toHaveLength(1)

    await manager.remove('notes.txt')
    await manager.remove(made!.id)
    expect(existsSync(join(backupDir, 'notes.txt'))).toBe(true)
    expect(readdirSync(backupDir).filter((name) => name.endsWith('.fm'))).toEqual([])
  })

  describe('N-03: 화면이 보낸 사본 이름 검사', () => {
    const HOSTILE = [
      '../victim__20260101-000000.fm',
      '..\\victim__20260101-000000.fm',
      'sub/victim__20260101-000000.fm',
      'sub\\victim__20260101-000000.fm',
      '/victim__20260101-000000.fm',
      'C:\\victim__20260101-000000.fm',
      'C:victim__20260101-000000.fm',
      '\\\\server\\share\\victim__20260101-000000.fm',
      'victim__20260101-000000.fm:stream',
      'victim\0__20260101-000000.fm',
      '..',
      '',
      'victim.fm'
    ]

    it('폴더 이름이나 경로가 섞인 이름, 우리 사본 모양이 아닌 이름은 사본 이름이 아니다', () => {
      for (const id of HOSTILE) expect(isBackupId(id), JSON.stringify(id)).toBe(false)
      for (const id of [null, undefined, 3, {}, ['a__20261101-120000.fm']]) expect(isBackupId(id)).toBe(false)
      expect(isBackupId('a__20261101-120000.fm')).toBe(true)
      expect(isBackupId('내 세이브 - 가상 FC__20261101-120000__pre.fm')).toBe(true)
    })

    it('폴더 밖의 파일은 복원으로 읽지도, 세이브 폴더 밖에 쓰지도, 지우기로 지우지도 못한다', async () => {
      const root = join(backupDir, '..')
      const victim = join(root, 'victim__20260101-000000.fm')
      writeFileSync(victim, 'outside')
      for (const id of HOSTILE) {
        expect((await manager.restore(id)).ok, JSON.stringify(id)).toBe(false)
        await manager.remove(id)
      }
      expect(readFileSync(victim, 'utf8')).toBe('outside')
      expect(existsSync(join(root, 'victim.fm'))).toBe(false)
      expect(readdirSync(saveDir)).toEqual([])
    })

    it('정상 이름은 그대로 복원되고 지워진다', async () => {
      const made = await manager.backup(save('a.fm', 'x', day(1)))
      expect((await manager.restore(made!.id)).ok).toBe(true)
      await manager.remove(made!.id)
      expect((await manager.list()).entries.filter((entry) => !entry.beforeRestore)).toHaveLength(0)
    })
  })
})
