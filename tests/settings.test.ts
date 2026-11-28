/**
 * 설정 저장소와 전술 저장(2단계 U6 앞부분, A-03·N-05): 설정 파일을 읽고 쓰는 쪽(src/main/settings.ts)과 전술 묶음 저장·이전 알림 확인(src/main/tacticStore.ts).
 * 이전 규칙 자체(무엇을 어떻게 옮기나)는 tests/migration.test.ts가 보고, 여기서는 파일에 닿는 약속을 본다:
 * 읽을 때 한 번 이전하고 한 번 쓴다, 쓰기 전에 옛 파일을 settings.v1.json으로 한 번만 남긴다, 모든 쓰기는 원자적이다(실패해도 옛 파일이 그대로다),
 * 깨진 파일은 settings.broken-<시각>.json으로 남고 알린다, 전술 묶음은 검사를 통과한 것만 쓰고 새 저장소로 읽어도 같다.
 * 시험 자료의 이름과 경로는 모두 지어낸 것이다. 시험마다 새 임시 폴더를 쓰고 끝나면 지운다.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, SettingsStore, writeFileAtomic, type AtomicIo } from '../src/main/settings'
import { ackMigration, saveTactics } from '../src/main/tacticStore'
import { FM26_CATALOG } from '../src/shared/catalogFm26'
import { DEFAULT_CATALOG } from '../src/shared/catalogs'
import { legacyTactic, presetTactic, resolveMainTactic, validateTactic, type Tactic, type TacticSet } from '../src/shared/tacticModel'
import type { Settings } from '../src/shared/types'

const DOCS = 'D:/가상 폴더/문서'
const SAVE_KEY = '가온 시티 2025.fm'
const FIXED = new Date('2026-12-01T09:30:15.250Z')
const LATER = new Date('2030-01-01T00:00:00.000Z')
const BROKEN_NAME = 'settings.broken-20261201T093015Z.json'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fmb-settings-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const file = (name = 'settings.json'): string => join(dir, name)
const open = (now: Date = FIXED): SettingsStore => new SettingsStore(file(), DOCS, undefined, () => now)
const write = (value: unknown): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  writeFileSync(file(), text, 'utf8')
  return text
}
const text = (name = 'settings.json'): string => readFileSync(file(name), 'utf8')
const json = (name = 'settings.json'): Record<string, any> => JSON.parse(text(name))
const names = (): string[] => readdirSync(dir).sort()
/** 콘솔에 남기는 오류를 조용히 받는다(쓰기 실패 흉내에서 나온다) */
const quiet = (): ReturnType<typeof vi.spyOn> => vi.spyOn(console, 'error').mockImplementation(() => undefined)

/** 2단계 앞 판 앱이 쓴 설정 파일(FM26 카탈로그를 쓰도록 catalog 칸이 있다) */
const oldFile = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  saveDir: 'D:/가상 폴더/세이브',
  activeSave: `D:/가상 폴더/세이브/${SAVE_KEY}`,
  saveTeams: { [SAVE_KEY]: 9001 },
  density: 'comfortable',
  theme: 'black',
  formation: '4-3-3',
  slotRoles: { '4-3-3:0': 'tm', '4-3-3:7': 'bpd', '4-4-2:3': 'ap' },
  roleWeights: { cb: { marking: 5 }, b2b: { stamina: 5 } },
  keepRunning: false,
  backupEnabled: true,
  backupKeep: 5,
  catalog: 'fm26',
  ...over
})

describe('설정 파일 읽기와 쓰기(get·set의 꼴은 그대로다)', () => {
  it('파일이 없으면 기본값으로 시작하고 파일을 만들지 않는다. set은 합쳐 쓰고 새 저장소로 읽어도 같다', () => {
    const store = open()
    expect(store.get()).toEqual(defaultSettings(DOCS))
    expect(names()).toEqual([])
    const next = store.set({ theme: 'black', backupKeep: 9 })
    expect(next).toBe(store.get())
    expect(next).toEqual({ ...defaultSettings(DOCS), theme: 'black', backupKeep: 9 })
    expect(json()).toEqual({ ...defaultSettings(DOCS), theme: 'black', backupKeep: 9 })
    expect(open().get()).toEqual(next)
  })

  it('파일의 값이 기본값 위에 얹히고, 모르는 열쇠(앞뒤 판 앱의 것)도 지우지 않는다', () => {
    write({ theme: 'black', backupKeep: 7, 앞날의열쇠: { a: 1 }, catalog: 'legacy14' })
    const store = open()
    expect(store.get()).toEqual({ ...defaultSettings(DOCS), theme: 'black', backupKeep: 7, 앞날의열쇠: { a: 1 }, catalog: 'legacy14' })
    store.set({ density: 'comfortable' })
    expect(json().앞날의열쇠).toEqual({ a: 1 })
  })

  it('saveDir을 따로 주면 그것이 먼저다(시험 실행용)', () => {
    write({ saveDir: 'D:/다른 곳', catalog: 'legacy14' })
    expect(new SettingsStore(file(), DOCS, 'E:/시험 세이브').get().saveDir).toBe('E:/시험 세이브')
  })

  it('쓰고 나면 임시 파일이 남지 않는다', () => {
    const store = open()
    store.set({ theme: 'black' })
    store.set({ theme: 'blue' })
    expect(names()).toEqual(['settings.json'])
  })

  it('파일 머리의 BOM은 떼고 읽는다(깨진 파일로 보지 않는다)', () => {
    write(`\uFEFF${JSON.stringify({ theme: 'black', catalog: 'legacy14' })}`)
    const store = open()
    expect(store.get().theme).toBe('black')
    expect(store.get().settingsProblem).toBeUndefined()
    expect(names()).toEqual(['settings.json'])
  })

  it('쓰기를 흉내 내어 실패시켜도 옛 파일과 메모리의 설정이 그대로다', () => {
    const original = write({ theme: 'black', catalog: 'legacy14' })
    const store = open()
    // 임시 파일 자리에 폴더가 있으면 임시 파일을 만들 수 없다
    mkdirSync(file('settings.json.tmp'))
    expect(() => store.set({ theme: 'blue' })).toThrow()
    expect(text()).toBe(original)
    expect(store.get().theme).toBe('black')
    // 막힘이 풀리면 쓴다
    rmSync(file('settings.json.tmp'), { recursive: true })
    expect(store.set({ theme: 'blue' }).theme).toBe('blue')
    expect(json().theme).toBe('blue')
    expect(names()).toEqual(['settings.json'])
  })
})

describe('옛 카탈로그를 쓰는 동안은 이전하지 않는다(전환 전, 되돌림 스위치)', () => {
  it('catalog가 legacy14이면 파일을 한 글자도 바꾸지 않고 사본도 만들지 않는다', () => {
    const original = write(oldFile({ catalog: 'legacy14' }))
    const store = open()
    expect(text()).toBe(original)
    expect(names()).toEqual(['settings.json'])
    expect(store.get().settingsVersion).toBeUndefined()
    expect(store.get().migration).toBeUndefined()
    expect(store.get().tacticsDefault).toBeUndefined()
    // 쓸 일이 생겨도(다른 설정을 바꿔도) 이전하지 않는다
    store.set({ theme: 'blue' })
    expect(json().settingsVersion).toBeUndefined()
    expect(names()).toEqual(['settings.json'])
  })
})

describe('catalog 칸이 없는 설정은 기본 카탈로그를 따른다', () => {
  it('기본 카탈로그가 옛 것인 동안은 이전하지 않고, FM26이 되면 이전한다(전환 묶음의 마지막 한 줄이 이 시험을 고치지 않게 둘 다 본다)', () => {
    const { catalog: _catalog, ...withoutCatalog } = oldFile()
    const original = write(withoutCatalog)
    const store = open()
    if (DEFAULT_CATALOG === 'legacy14') {
      expect(text()).toBe(original)
      expect(names()).toEqual(['settings.json'])
      expect(store.get().settingsVersion).toBeUndefined()
    } else {
      expect(store.get().settingsVersion).toBe(2)
      expect(text('settings.v1.json')).toBe(original)
    }
  })
})

describe('FM26을 쓰면 읽을 때 한 번 이전하고 한 번 쓴다(N-05)', () => {
  it('이전한 설정을 메모리에 두고 파일에 쓰며, 쓰기 전의 옛 파일을 settings.v1.json으로 남긴다', () => {
    const original = write(oldFile())
    const store = open()
    const settings = store.get()
    expect(settings.settingsVersion).toBe(2)
    expect(settings.tacticsDefault?.mainId).toBe('migrated:4-3-3')
    expect(settings.migration).toMatchObject({ version: 2, at: FIXED.toISOString(), acknowledged: false, backupFile: 'settings.v1.json' })
    expect(settings.migration?.notes.at(-1)).toMatchObject({ kind: 'backup', text: expect.stringContaining('settings.v1.json') })
    // 옛 칸은 그대로
    expect(settings.formation).toBe('4-3-3')
    expect(settings.slotRoles).toEqual({ '4-3-3:0': 'tm', '4-3-3:7': 'bpd', '4-4-2:3': 'ap' })
    expect(settings.roleWeights).toMatchObject({ cb: { marking: 5 }, b2b: { stamina: 5 }, 'ip.CentralDefender': { marking: 5 }, 'ip.BoxToBoxMidfielder': { stamina: 5 } })
    // 파일에도 같은 설정이 있고, 사본은 이전 전 파일 그대로다
    expect(json()).toEqual(JSON.parse(JSON.stringify(settings)))
    expect(text('settings.v1.json')).toBe(original)
    expect(names()).toEqual(['settings.json', 'settings.v1.json'])
  })

  it('다시 켜도(새 저장소) 이전하지 않는다: 같은 설정을 읽고 파일과 사본은 그대로다', () => {
    write(oldFile())
    const first = open()
    const written = text()
    const copy = text('settings.v1.json')
    const again = open(LATER)
    expect(again.get()).toEqual(first.get())
    expect(again.get().migration?.at).toBe(FIXED.toISOString())
    expect(text()).toBe(written)
    expect(text('settings.v1.json')).toBe(copy)
    expect(names()).toEqual(['settings.json', 'settings.v1.json'])
  })

  it('사본은 한 번만 생긴다: 나중에 쓰기를 거듭해도 사본은 이전 전 파일 그대로이고, 이미 있는 사본은 덮어쓰지 않는다', () => {
    const original = write(oldFile())
    const store = open()
    store.set({ theme: 'blue' })
    store.set({ density: 'compact' })
    expect(text('settings.v1.json')).toBe(original)
    // 앞서 이전하다 멈춰 사본만 남은 경우: 그 사본이 옛 파일이므로 덮어쓰지 않는다
    rmSync(file(), { force: true })
    rmSync(file('settings.v1.json'), { force: true })
    write(oldFile())
    writeFileSync(file('settings.v1.json'), '앞서 남긴 사본', 'utf8')
    const second = open()
    expect(text('settings.v1.json')).toBe('앞서 남긴 사본')
    expect(second.get().migration?.backupFile).toBe('settings.v1.json')
    expect(second.get().settingsVersion).toBe(2)
  })

  it('사본을 남기지 못하면(사본 자리에 폴더가 있다) 옛 파일을 쓰지 않는다. 이번 실행은 메모리의 이전한 설정으로 돌고, 사본이 가능해지면 쓴다', () => {
    const original = write(oldFile())
    mkdirSync(file('settings.v1.json'))
    quiet()
    const store = open()
    expect(text()).toBe(original)
    expect(store.get().settingsVersion).toBe(2)
    expect(store.get().migration?.backupFile).toBeUndefined()
    expect(() => store.set({ theme: 'blue' })).toThrow()
    expect(text()).toBe(original)
    // 막힘이 풀리면 사본을 남기고 나서 쓴다
    rmSync(file('settings.v1.json'), { recursive: true })
    store.set({ theme: 'blue' })
    expect(text('settings.v1.json')).toBe(original)
    expect(json().settingsVersion).toBe(2)
    expect(json().theme).toBe('blue')
  })

  it('시작할 때 못 남긴 사본을 나중에 남기면 이전 기록에도 사본 알림 한 줄과 사본 파일 이름이 적힌다(메모리와 파일 모두)', () => {
    write(oldFile())
    mkdirSync(file('settings.v1.json'))
    quiet()
    const store = open()
    expect(store.get().migration?.notes.some((note) => note.kind === 'backup')).toBe(false)
    expect(store.get().migration?.backupFile).toBeUndefined()
    rmSync(file('settings.v1.json'), { recursive: true })
    const next = store.set({ theme: 'blue' })
    expect(next).toBe(store.get())
    for (const settings of [next, json() as Settings]) {
      expect(settings.migration?.backupFile).toBe('settings.v1.json')
      expect(settings.migration?.notes.filter((note) => note.kind === 'backup')).toEqual([{ kind: 'backup', text: expect.stringContaining('settings.v1.json') }])
      expect(settings.migration?.notes.at(-1)?.kind).toBe('backup')
    }
    // 더 써도 다시 켜도 알림은 한 줄이고 그대로다
    store.set({ theme: 'black' })
    expect(json().migration.notes.filter((note: { kind: string }) => note.kind === 'backup')).toHaveLength(1)
    expect(open(LATER).get().migration).toEqual(store.get().migration)
  })

  it('알림 확인이 사본을 남기기 전에 만든 이전 기록(사본 알림이 없다)으로 덮어도 사본 알림이 빠지지 않는다', () => {
    write(oldFile())
    mkdirSync(file('settings.v1.json'))
    quiet()
    const store = open()
    // 사본이 막힌 동안에는 확인도 쓰지 못한다
    expect(ackMigration({ settings: store }).ok).toBe(false)
    expect(store.get().migration?.acknowledged).toBe(false)
    rmSync(file('settings.v1.json'), { recursive: true })
    const result = ackMigration({ settings: store })
    expect(result.ok).toBe(true)
    expect(result.settings?.migration).toMatchObject({ acknowledged: true, backupFile: 'settings.v1.json' })
    expect(json().migration).toMatchObject({ acknowledged: true, backupFile: 'settings.v1.json' })
    expect(json().migration.notes.at(-1).kind).toBe('backup')
    expect(open(LATER).get().migration).toEqual(store.get().migration)
  })

  it('이전한 설정을 쓰다 실패해도 옛 파일이 그대로이고 앱은 켜진다. 다시 켜면 같은 결과로 이전한다', () => {
    const original = write(oldFile())
    mkdirSync(file('settings.json.tmp'))
    const log = quiet()
    const store = open()
    expect(log).toHaveBeenCalled()
    expect(text()).toBe(original)
    expect(store.get().settingsVersion).toBe(2)
    // 사본은 쓰기 전에 남겼다
    expect(text('settings.v1.json')).toBe(original)
    expect(open().get()).toEqual(store.get())
    expect(text()).toBe(original)
    rmSync(file('settings.json.tmp'), { recursive: true })
    store.set({ theme: 'blue' })
    expect(json().settingsVersion).toBe(2)
  })

  it('옛 14역할을 쓰는 동안 저장한 전술 묶음은 FM26에서 쓸 수 없어서, 옛 포메이션과 자리 역할로 새로 만들고 알린다', () => {
    // 옛 카탈로그를 쓰는 동안에는 저장 검사가 옛 카탈로그 묶음을 받아들인다
    write(oldFile({ catalog: 'legacy14' }))
    const before = open()
    const legacy = legacyTactic('4-3-3', before.get().slotRoles)
    expect(saveTactics({ settings: before }, null, { catalog: 'legacy14', tactics: [legacy], mainId: legacy.id }).ok).toBe(true)
    expect(before.get().tacticsDefault?.catalog).toBe('legacy14')
    // FM26을 쓰게 되면(catalog 칸을 바꿔 다시 켠다) 그 묶음을 쓰지 못하고 옛 설정에서 새로 만든다
    const original = write({ ...json(), catalog: 'fm26' })
    const store = open(LATER)
    const main = resolveMainTactic(store.get(), SAVE_KEY, FM26_CATALOG)
    expect(main.id).toBe('migrated:4-3-3')
    expect(main.slots[0].ip.roleId).toBe('ip.TargetMan')
    expect(main.slots[7].ip.roleId).toBe('ip.BallPlayingDefender')
    expect(store.get().tacticsDefault?.catalog).toBe('fm26')
    const notes = store.get().migration?.notes.map((note) => note.text) ?? []
    expect(notes).toContain('저장해 둔 전술 묶음을 FM26에서 쓸 수 없어 옛 포메이션과 자리 역할로 새로 만들었습니다')
    expect(notes).not.toContain('이미 저장해 둔 전술이 있어 옛 포메이션과 자리 역할은 옮기지 않았습니다')
    // 사본에는 옛 묶음이 그대로 있다
    expect(text('settings.v1.json')).toBe(original)
    expect(JSON.parse(text('settings.v1.json')).tacticsDefault.catalog).toBe('legacy14')
  })

  it('이전 알림 확인(ackMigration)이 파일에 남아 새 저장소로 읽어도 확인한 채이고, 다시 확인해도 파일을 쓰지 않는다', () => {
    write(oldFile())
    const store = open()
    expect(store.get().migration?.acknowledged).toBe(false)
    const result = ackMigration({ settings: store })
    expect(result.ok).toBe(true)
    expect(result.settings?.migration?.acknowledged).toBe(true)
    expect(open(LATER).get().migration?.acknowledged).toBe(true)
    expect(open(LATER).get().migration?.notes).toEqual(store.get().migration?.notes)
    const written = text()
    expect(ackMigration({ settings: store })).toEqual({ ok: true, settings: store.get() })
    expect(text()).toBe(written)
  })

  it('이전 기록이 객체가 아니어도(손으로 고친 파일) 확인은 던지지 않고 아무것도 바꾸지 않는다', () => {
    write({ catalog: 'fm26', settingsVersion: 2, migration: '손으로 쓴 글' })
    const store = open()
    const before = text()
    expect(ackMigration({ settings: store })).toEqual({ ok: true, settings: store.get() })
    expect(text()).toBe(before)
    expect(store.get().migration).toBe('손으로 쓴 글')
  })

  it('쓰지 못하면 확인을 기록하지 못했다고 실패로 알린다(경로는 담지 않는다)', () => {
    write(oldFile())
    const store = open()
    mkdirSync(file('settings.json.tmp'))
    quiet()
    const result = ackMigration({ settings: store })
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain(dir)
    expect(store.get().migration?.acknowledged).toBe(false)
  })
})

describe('기본 카탈로그가 FM26로 바뀐 뒤의 시작(전환 묶음의 마지막 한 줄 뒤와 같다)', () => {
  type Store = typeof SettingsStore
  /** 기본 카탈로그만 FM26인 것처럼 속인 설정 저장소 클래스. settings.catalog가 있으면 그것이 먼저인 규칙은 그대로다 */
  async function storeClassWithFm26Default(): Promise<Store> {
    vi.resetModules()
    vi.doMock('../src/shared/catalogs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/shared/catalogs')>()
      return { ...actual, DEFAULT_CATALOG: 'fm26', activeCatalog: (settings: Parameters<typeof actual.activeCatalog>[0]) => actual.activeCatalog({ ...settings, catalog: settings.catalog ?? 'fm26' }) }
    })
    return (await import('../src/main/settings')).SettingsStore
  }
  afterEach(() => {
    vi.doUnmock('../src/shared/catalogs')
    vi.resetModules()
  })

  it('파일이 없는 새 설정은 이전할 것이 없다: 판을 2로 표시하고 이전 기록(알림)도 파일도 만들지 않는다', async () => {
    const Store = await storeClassWithFm26Default()
    const store = new Store(file(), DOCS, undefined, () => FIXED)
    expect(store.get()).toEqual({ ...defaultSettings(DOCS), settingsVersion: 2 })
    expect(names()).toEqual([])
    // 처음 쓸 때 판이 파일에 간다
    store.set({ theme: 'black' })
    expect(json().settingsVersion).toBe(2)
    expect(names()).toEqual(['settings.json'])
  })

  it('catalog 칸이 없는 옛 설정은 기본 카탈로그를 따라 FM26으로 이전한다(사본을 남기고 한 번만)', async () => {
    const Store = await storeClassWithFm26Default()
    const { catalog: _catalog, ...withoutCatalog } = oldFile()
    const original = write(withoutCatalog)
    const store = new Store(file(), DOCS, undefined, () => FIXED)
    expect(store.get().settingsVersion).toBe(2)
    expect(store.get().catalog).toBeUndefined()
    expect(store.get().migration?.acknowledged).toBe(false)
    expect(text('settings.v1.json')).toBe(original)
    const written = text()
    expect(new Store(file(), DOCS, undefined, () => LATER).get()).toEqual(store.get())
    expect(text()).toBe(written)
  })

  it('catalog를 legacy14로 둔 설정은 기본이 FM26이어도 이전하지 않는다(되돌림 스위치)', async () => {
    const Store = await storeClassWithFm26Default()
    const original = write(oldFile({ catalog: 'legacy14' }))
    const store = new Store(file(), DOCS, undefined, () => FIXED)
    expect(text()).toBe(original)
    expect(names()).toEqual(['settings.json'])
    expect(store.get().settingsVersion).toBeUndefined()
  })

  it('깨진 파일은 남기고 알리며, 이전할 옛 설정을 읽지 못했으니 이전 기록 없이 판 2로 시작한다', async () => {
    const Store = await storeClassWithFm26Default()
    write('{')
    const store = new Store(file(), DOCS, undefined, () => FIXED)
    expect(store.get()).toEqual({ ...defaultSettings(DOCS), settingsVersion: 2, settingsProblem: expect.objectContaining({ file: BROKEN_NAME }) })
    expect(text(BROKEN_NAME)).toBe('{')
    expect(json().settingsVersion).toBe(2)
    expect(names()).toEqual([BROKEN_NAME, 'settings.json'])
  })
})

describe('깨진 설정 파일은 말없이 버리지 않는다(N-05)', () => {
  it('JSON이 깨졌으면 settings.broken-<시각>.json으로 남기고, 기본값으로 시작하며, settingsProblem으로 알린다', () => {
    const broken = '{"theme": "black", "formation": '
    write(broken)
    const store = open()
    expect(names()).toEqual([BROKEN_NAME, 'settings.json'])
    expect(text(BROKEN_NAME)).toBe(broken)
    expect(store.get()).toEqual({ ...defaultSettings(DOCS), settingsProblem: { at: FIXED.toISOString(), file: BROKEN_NAME, message: expect.stringContaining('기본값으로 시작했습니다') } })
    expect(store.get().settingsProblem?.message).toContain(BROKEN_NAME)
    // 새 파일에도 적혀 있어 다시 켜도 알 수 있다
    expect(json().settingsProblem).toEqual(store.get().settingsProblem)
  })

  it.each([
    ['빈 파일', ''],
    ['공백뿐인 파일', '  \n'],
    ['쓰다 만 JSON', '{'],
    ['배열', '[1, 2]'],
    ['null', 'null'],
    ['글자', '"설정"'],
    ['숫자', '12']
  ])('%s도 깨진 파일로 남긴다', (_name, content) => {
    write(content)
    const store = open()
    expect(text(BROKEN_NAME)).toBe(content)
    expect(store.get().settingsProblem).toMatchObject({ file: BROKEN_NAME })
    expect(store.get()).toMatchObject(defaultSettings(DOCS))
  })

  it('다시 켜도 깨진 파일이 또 생기지 않고, 같은 초에 또 깨지면 번호를 붙여 앞의 것을 덮어쓰지 않는다', () => {
    write('{')
    const first = open()
    expect(open().get().settingsProblem).toEqual(first.get().settingsProblem)
    expect(names()).toEqual([BROKEN_NAME, 'settings.json'])
    write('{{')
    open()
    expect(names()).toEqual(['settings.broken-20261201T093015Z-2.json', BROKEN_NAME, 'settings.json'])
    expect(text(BROKEN_NAME)).toBe('{')
    expect(text('settings.broken-20261201T093015Z-2.json')).toBe('{{')
  })

  it('알림 확인(ackMigration)이 settingsProblem도 지우고 그 결과가 파일에 남는다. 확인한 뒤에는 다시 켜도 알림이 없다', () => {
    write('{')
    const store = open()
    expect(store.get().settingsProblem).toBeDefined()
    const result = ackMigration({ settings: store })
    expect(result.ok).toBe(true)
    expect(result.settings?.settingsProblem).toBeUndefined()
    expect('settingsProblem' in json()).toBe(false)
    expect(open().get().settingsProblem).toBeUndefined()
    // 깨진 파일은 그대로 남는다
    expect(text(BROKEN_NAME)).toBe('{')
  })
})

describe('깨진 설정 파일의 이름을 바꾸지 못했을 때(다른 프로그램이 파일을 잡고 있을 때)', () => {
  const BROKEN = '{"theme": "black", '
  const NOT_KEPT = '설정 파일을 읽지 못해 기본값으로 시작했습니다. 읽지 못한 파일을 따로 남기지는 못했습니다.'
  type Keeper = { keepBroken(this: SettingsStore): { problem: NonNullable<Settings['settingsProblem']>; saved: boolean } }
  /** 깨진 파일을 따로 남기는 일을 바꿔 끼운다: 처음 fails번은 이름 바꾸기가 막힌 것처럼 못 남기고, 그 뒤에는 진짜로 남긴다(시작할 때 한 번 부른다) */
  const blockKeeping = (fails: number): { calls(): number } => {
    const original = (SettingsStore.prototype as unknown as Keeper).keepBroken
    let calls = 0
    vi.spyOn(SettingsStore.prototype as unknown as Keeper, 'keepBroken').mockImplementation(function (this: SettingsStore) {
      return ++calls <= fails ? { problem: { at: FIXED.toISOString(), file: '', message: NOT_KEPT }, saved: false } : original.call(this)
    })
    return { calls: () => calls }
  }

  it('시작할 때는 그 자리에 새 파일을 쓰지 않고(깨진 파일이 유일한 사본일 수 있다), 첫 쓰기 전에 다시 남겨 보고 남기면 알림에 그 파일 이름을 적는다', () => {
    write(BROKEN)
    const keeping = blockKeeping(1)
    const store = open()
    expect(text()).toBe(BROKEN)
    expect(names()).toEqual(['settings.json'])
    expect(store.get().settingsProblem).toEqual({ at: FIXED.toISOString(), file: '', message: NOT_KEPT })
    expect(keeping.calls()).toBe(1)
    // 첫 쓰기 전에 다시 남긴다
    store.set({ theme: 'blue' })
    expect(keeping.calls()).toBe(2)
    expect(names()).toEqual([BROKEN_NAME, 'settings.json'])
    expect(text(BROKEN_NAME)).toBe(BROKEN)
    expect(json().theme).toBe('blue')
    expect(store.get().settingsProblem).toMatchObject({ file: BROKEN_NAME, message: expect.stringContaining(BROKEN_NAME) })
    expect(json().settingsProblem).toEqual(store.get().settingsProblem)
    // 그 뒤의 쓰기는 깨진 파일을 또 남기지 않는다
    store.set({ theme: 'black' })
    expect(keeping.calls()).toBe(2)
    expect(names()).toEqual([BROKEN_NAME, 'settings.json'])
    expect(open(LATER).get()).toEqual(store.get())
  })

  it('다시 해 봐도 못 남기면 쓰지 않고 던진다: 깨진 파일과 메모리의 설정이 그대로이고, 막힘이 풀리면 쓴다', () => {
    write(BROKEN)
    const keeping = blockKeeping(3)
    quiet()
    const store = open()
    const before = store.get()
    expect(() => store.set({ theme: 'blue' })).toThrow()
    expect(ackMigration({ settings: store }).ok).toBe(false)
    expect(keeping.calls()).toBe(3)
    expect(text()).toBe(BROKEN)
    expect(names()).toEqual(['settings.json'])
    expect(store.get()).toBe(before)
    // 막힘이 풀리면 깨진 파일을 남기고 쓴다
    expect(store.set({ theme: 'blue' }).theme).toBe('blue')
    expect(text(BROKEN_NAME)).toBe(BROKEN)
    expect(json().theme).toBe('blue')
    expect(names()).toEqual([BROKEN_NAME, 'settings.json'])
  })

  it('알림을 먼저 확인해서 지웠으면(그 확인이 다시 남기는 쓰기이기도 하다) 깨진 파일을 남긴 뒤에도 알림을 되살리지 않는다', () => {
    write(BROKEN)
    blockKeeping(1)
    const store = open()
    expect(ackMigration({ settings: store }).ok).toBe(true)
    expect(text(BROKEN_NAME)).toBe(BROKEN)
    expect('settingsProblem' in json()).toBe(false)
    expect(store.get().settingsProblem).toBeUndefined()
    expect(open(LATER).get().settingsProblem).toBeUndefined()
  })

  it('깨진 파일이 그 사이에 없어졌으면 남길 것이 없으니 그냥 쓴다', () => {
    write(BROKEN)
    const keeping = blockKeeping(1)
    const store = open()
    rmSync(file())
    store.set({ theme: 'blue' })
    expect(keeping.calls()).toBe(1)
    expect(names()).toEqual(['settings.json'])
    expect(json().theme).toBe('blue')
  })
})

describe('원자적 쓰기는 이름 바꾸기가 잠깐 막히면 몇 번 다시 해 본다', () => {
  const busy = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: 흉내 낸 오류`), { code })
  /** 처음 fails번은 오류로 막히고 그 뒤에는 진짜 이름 바꾸기를 하는, 바꿔 끼운 일. 이름 바꾸기 시도와 기다린 시간을 적는다 */
  const flaky = (fails: number, code = 'EPERM'): { io: AtomicIo; renames: string[]; sleeps: number[] } => {
    const renames: string[] = []
    const sleeps: number[] = []
    let left = fails
    const io: AtomicIo = {
      rename: (from, to) => {
        renames.push(`${basename(from)} to ${basename(to)}`)
        if (left-- > 0) throw busy(code)
        renameSync(from, to)
      },
      sleep: (ms) => void sleeps.push(ms)
    }
    return { io, renames, sleeps }
  }
  const OLD = '옛 내용'
  const NEW = '새 내용'

  it.each(['EPERM', 'EBUSY', 'EACCES'])('%s로 세 번 막혀도 다시 해서 쓴다: 새 내용이 들어가고 임시 파일이 남지 않으며, 막힌 만큼 기다린다', (code) => {
    writeFileSync(file(), OLD)
    const { io, renames, sleeps } = flaky(3, code)
    writeFileAtomic(file(), NEW, io)
    expect(text()).toBe(NEW)
    expect(names()).toEqual(['settings.json'])
    expect(renames).toEqual(Array(4).fill('settings.json.tmp to settings.json'))
    expect(sleeps).toHaveLength(3)
    for (const ms of sleeps) expect(ms).toBeGreaterThan(0)
    // 다 합쳐도 0.5초를 넘지 않는다(본체는 기다리는 동안 멈춰 있다)
    expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(500)
  })

  it('막히지 않으면 기다리지 않고 한 번에 쓴다', () => {
    const { io, renames, sleeps } = flaky(0)
    writeFileAtomic(file(), NEW, io)
    expect(text()).toBe(NEW)
    expect(renames).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it('계속 막히면(5번 해 보고) 오류를 그대로 던지고, 옛 파일이 그대로이며 임시 파일이 남지 않는다', () => {
    writeFileSync(file(), OLD)
    const { io, renames, sleeps } = flaky(99, 'EBUSY')
    expect(() => writeFileAtomic(file(), NEW, io)).toThrow(/EBUSY/)
    expect(renames).toHaveLength(5)
    expect(sleeps).toHaveLength(4)
    expect(text()).toBe(OLD)
    expect(names()).toEqual(['settings.json'])
  })

  it.each(['ENOENT', 'EISDIR', 'ENOSPC', 'EXDEV'])('그 밖의 오류(%s)는 다시 해 보지 않고 바로 던진다', (code) => {
    writeFileSync(file(), OLD)
    const { io, renames, sleeps } = flaky(99, code)
    expect(() => writeFileAtomic(file(), NEW, io)).toThrow(code)
    expect(renames).toHaveLength(1)
    expect(sleeps).toEqual([])
    expect(text()).toBe(OLD)
    expect(names()).toEqual(['settings.json'])
  })

  it('오류에 번호(code)가 없어도 멈추지 않고 그대로 던진다', () => {
    writeFileSync(file(), OLD)
    const io: AtomicIo = {
      rename: () => {
        throw new Error('번호 없는 오류')
      },
      sleep: () => undefined
    }
    expect(() => writeFileAtomic(file(), NEW, io)).toThrow('번호 없는 오류')
    expect(text()).toBe(OLD)
    expect(names()).toEqual(['settings.json'])
  })

  it('기다리는 일을 바꿔 끼우지 않으면 진짜로 멈춰 기다린다(막힌 만큼 시간이 걸린다)', () => {
    writeFileSync(file(), OLD)
    const { io } = flaky(2)
    const started = performance.now()
    writeFileAtomic(file(), NEW, { rename: io.rename })
    const elapsed = performance.now() - started
    expect(text()).toBe(NEW)
    // 두 번 막혀 두 번 기다렸다(한 번에 30밀리초쯤). 아래쪽 경계만 본다
    expect(elapsed).toBeGreaterThanOrEqual(40)
  })

  it('설정 저장소의 쓰기도 이 쓰기를 거친다: 임시 파일을 만들 수 없는 것은 이름 바꾸기가 막힌 것이 아니라서 기다리지 않고 바로 던진다', () => {
    const original = write({ theme: 'black', catalog: 'legacy14' })
    const store = open()
    mkdirSync(file('settings.json.tmp'))
    const started = performance.now()
    expect(() => store.set({ theme: 'blue' })).toThrow()
    expect(performance.now() - started).toBeLessThan(1000)
    expect(text()).toBe(original)
  })
})

describe('전술 묶음 저장(A-03)', () => {
  const FORMATIONS = ['4-2-3-1', '4-3-3', '4-4-2', '3-5-2']
  const tactic = (at: number): Tactic => ({ ...presetTactic(FORMATIONS[at], FM26_CATALOG, `t${at + 1}`), name: `전술 ${at + 1}` })
  const setOf = (count: number, mainAt = 0): TacticSet => ({ catalog: 'fm26', tactics: Array.from({ length: count }, (_, at) => tactic(at)), mainId: `t${mainAt + 1}` })
  /** 이전이 끝난 FM26 설정으로 시작한다 */
  const start = (): SettingsStore => {
    write({ catalog: 'fm26', settingsVersion: 2, theme: 'black' })
    return open()
  }

  it('전술 3개와 주 전술을 쓰고 새 저장소로 읽으면 같다', () => {
    const store = start()
    const set = setOf(3, 1)
    const result = saveTactics({ settings: store }, SAVE_KEY, set)
    expect(result).toMatchObject({ ok: true, problems: [] })
    expect(result.settings).toBe(store.get())
    const reopened = open(LATER)
    expect(reopened.get().tactics).toEqual({ [SAVE_KEY]: set })
    expect(reopened.get().theme).toBe('black')
    // 그 세이브의 주 전술은 고른 것이고, 다른 세이브는 쓸 수 있는 묶음이 없어 옛 포메이션의 프리셋이다
    expect(resolveMainTactic(reopened.get(), SAVE_KEY, FM26_CATALOG).id).toBe('t2')
    expect(resolveMainTactic(reopened.get(), '다른 세이브.fm', FM26_CATALOG).id).toBe('preset:4-2-3-1')
  })

  it('saveKey가 없으면(null) 모든 세이브의 기본 묶음에, 경로가 오면 파일 이름으로 쓴다. 다른 세이브의 묶음은 지키고 같은 세이브는 바꾼다', () => {
    const store = start()
    expect(saveTactics({ settings: store }, null, setOf(1)).ok).toBe(true)
    expect(store.get().tacticsDefault).toEqual(setOf(1))
    expect(store.get().tactics).toBeUndefined()
    expect(saveTactics({ settings: store }, `D:\\가상 폴더\\세이브\\${SAVE_KEY}`, setOf(2)).ok).toBe(true)
    expect(saveTactics({ settings: store }, '다른 세이브.fm', setOf(1)).ok).toBe(true)
    expect(Object.keys(store.get().tactics ?? {}).sort()).toEqual([SAVE_KEY, '다른 세이브.fm'].sort())
    expect(saveTactics({ settings: store }, SAVE_KEY, setOf(3)).ok).toBe(true)
    expect(store.get().tactics?.[SAVE_KEY].tactics).toHaveLength(3)
    expect(store.get().tactics?.['다른 세이브.fm'].tactics).toHaveLength(1)
    // 경로가 아닌 열쇠로는 쓸 수 없다
    expect(saveTactics({ settings: store }, 'D:/가상 폴더/', setOf(1)).ok).toBe(false)
  })

  it('4번째 전술은 이유와 함께 거절하고 설정은 바뀌지 않는다', () => {
    const store = start()
    const before = text()
    const result = saveTactics({ settings: store }, SAVE_KEY, setOf(4))
    expect(result.ok).toBe(false)
    expect(result.problems.map((problem) => problem.code)).toEqual(['tacticCount'])
    expect(result.message).toContain('전술은 1개 이상 3개 이하여야 합니다')
    expect(text()).toBe(before)
    expect(store.get().tactics).toBeUndefined()
    // 빈 묶음도 거절한다
    expect(saveTactics({ settings: store }, SAVE_KEY, { ...setOf(1), tactics: [] }).problems.map((problem) => problem.code)).toContain('tacticCount')
  })

  const BAD: Array<[string, string, (set: TacticSet) => void]> = [
    ['자리가 10개', 'slotCount', (set) => void set.tactics[0].slots.pop()],
    ['골키퍼 칸에 필드 역할', 'goalkeeperRole', (set) => void (set.tactics[0].slots[10].ip.roleId = 'ip.CentralDefender')],
    ['두 자리가 한 칸에 겹침', 'overlap', (set) => void (set.tactics[0].slots[1].ip.cell = { ...set.tactics[0].slots[0].ip.cell })],
    ['점유 비중이 범위 밖', 'share', (set) => void (set.tactics[0].sharePct = 101)],
    ['점유 비중이 정수가 아님', 'share', (set) => void (set.tactics[0].sharePct = 60.5)],
    ['카탈로그에 없는 역할', 'roleMissing', (set) => void (set.tactics[0].slots[0].ip.roleId = 'ip.없는역할')],
    ['이름이 너무 김', 'name', (set) => void (set.tactics[0].name = '가'.repeat(41))],
    ['이름이 비었음', 'name', (set) => void (set.tactics[0].name = '  ')],
    ['쓰는 카탈로그와 다름', 'catalog', (set) => void (set.tactics[0].catalog = 'legacy14')],
    ['묶음의 카탈로그가 다름', 'catalog', (set) => void (set.catalog = 'legacy14')],
    ['공 미소유 시 칸에 공 소유 시 역할', 'rolePhase', (set) => void (set.tactics[0].slots[0].oop.roleId = 'ip.CentreForward')],
    ['그 포지션에서 고를 수 없는 역할', 'roleChoice', (set) => void (set.tactics[0].slots[0].ip.roleId = 'ip.FullBack')],
    ['주 전술이 묶음에 없음', 'mainId', (set) => void (set.mainId = '없는 전술')],
    ['같은 번호의 전술 둘', 'duplicateId', (set) => void (set.tactics[1].id = set.tactics[0].id)],
    ['칸이 올바르지 않음', 'cell', (set) => void ((set.tactics[0].slots[0].ip.cell as { lane: string }).lane = 'Z')]
  ]

  it.each(BAD)('검사에 걸린 전술은 저장하지 않는다: %s', (_name, code, damage) => {
    const store = start()
    const before = text()
    const set = setOf(2)
    damage(set)
    const result = saveTactics({ settings: store }, SAVE_KEY, set)
    expect(result.ok).toBe(false)
    expect(result.problems.map((problem) => problem.code)).toContain(code)
    expect(result.message).toContain('전술을 저장하지 못했습니다')
    expect(text()).toBe(before)
    expect(store.get().tactics).toBeUndefined()
  })

  it('고칠 곳이 여럿이면 첫 이유와 개수를 알린다', () => {
    const store = start()
    const set = setOf(1)
    set.tactics[0].sharePct = 101
    set.tactics[0].slots.pop()
    const result = saveTactics({ settings: store }, SAVE_KEY, set)
    expect(result.problems.length).toBeGreaterThan(1)
    expect(result.message).toContain(`고칠 곳이 모두 ${result.problems.length}곳입니다`)
  })

  it('엉뚱한 값(null, 빈 객체, 글자, 칸 모양이 틀린 전술)은 던지지 않고 거절한다', () => {
    const store = start()
    for (const set of [null, undefined, {}, 'x', 7, { catalog: 'fm26', tactics: 'x', mainId: 1 }, { catalog: 'fm26', tactics: [null], mainId: 'a' }, { catalog: 'fm26', tactics: [{ slots: 5 }], mainId: 'a' }]) {
      const result = saveTactics({ settings: store }, SAVE_KEY, set as unknown as TacticSet)
      expect(result.ok, JSON.stringify(set)).toBe(false)
      expect(Array.isArray(result.problems)).toBe(true)
    }
    expect(store.get().tactics).toBeUndefined()
  })

  it('게임에서 확인하지 못한 칸의 알림(note)만 있는 전술은 막지 않고 저장한다', () => {
    const store = start()
    const set: TacticSet = { catalog: 'fm26', tactics: [{ ...presetTactic('3-5-2', FM26_CATALOG, 'u1'), name: '확인 전' }], mainId: 'u1' }
    // 세 명 가운데 한가운데 수비 자리에 바깥 수비의 역할: 그 칸 목록은 게임에서 확인 전이라 알림만 남는다
    set.tactics[0].slots[8].ip.roleId = 'ip.WideCentreBack'
    const problems = validateTactic(set.tactics[0], FM26_CATALOG)
    expect(problems.map((problem) => [problem.code, problem.level])).toEqual([['roleUnconfirmed', 'note']])
    expect(saveTactics({ settings: store }, SAVE_KEY, set)).toMatchObject({ ok: true, problems: [] })
    expect(store.get().tactics?.[SAVE_KEY].tactics[0].slots[8].ip.roleId).toBe('ip.WideCentreBack')
  })

  it('화면이 보낸 엉뚱한 칸은 설정 파일에 남기지 않고, 다른 설정은 그대로 둔다', () => {
    const store = start()
    const set = setOf(1) as unknown as { tactics: Array<Record<string, any>>; 덤: string }
    set.덤 = '지워진다'
    set.tactics[0].덤 = '지워진다'
    set.tactics[0].slots[0].덤 = '지워진다'
    set.tactics[0].slots[0].ip.덤 = '지워진다'
    set.tactics[0].slots[0].ip.cell.덤 = '지워진다'
    expect(saveTactics({ settings: store }, SAVE_KEY, set as unknown as TacticSet).ok).toBe(true)
    expect(JSON.stringify(json())).not.toContain('지워진다')
    expect(json().theme).toBe('black')
    expect(json().tactics[SAVE_KEY]).toEqual(setOf(1))
  })

  it('쓰기에 실패하면 경로 없이 실패를 알리고 설정은 그대로다', () => {
    const store = start()
    const before = text()
    mkdirSync(file('settings.json.tmp'))
    quiet()
    const result = saveTactics({ settings: store }, SAVE_KEY, setOf(1))
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([])
    expect(result.message).toContain('저장하지 못했습니다')
    expect(result.message).not.toContain(dir)
    expect(text()).toBe(before)
    expect(store.get().tactics).toBeUndefined()
  })

  it('손으로 고친 설정 파일의 tactics가 객체가 아니어도 그것을 풀어 쓰지 않고 새 묶음만 쓴다', () => {
    write({ catalog: 'fm26', settingsVersion: 2, tactics: 'abc' })
    const store = open()
    expect(saveTactics({ settings: store }, SAVE_KEY, setOf(1)).ok).toBe(true)
    expect(store.get().tactics).toEqual({ [SAVE_KEY]: setOf(1) })
  })

  it('FM26이 아닌 카탈로그를 쓰는 동안은 FM26 묶음을 거절한다', () => {
    write({ catalog: 'legacy14' })
    const store = open()
    const result = saveTactics({ settings: store }, SAVE_KEY, setOf(1))
    expect(result.ok).toBe(false)
    expect(result.problems.map((problem) => problem.code)).toContain('catalog')
  })

  it('저장은 같은 설정의 다른 칸(옛 칸, 가중치, 이전 기록)을 건드리지 않는다', () => {
    write(oldFile())
    const store = open()
    const before = JSON.parse(JSON.stringify(store.get())) as Settings
    expect(saveTactics({ settings: store }, SAVE_KEY, setOf(3)).ok).toBe(true)
    const after = JSON.parse(JSON.stringify(store.get())) as Record<string, unknown>
    delete after.tactics
    expect(after).toEqual(before)
  })
})
