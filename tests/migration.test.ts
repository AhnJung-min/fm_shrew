/**
 * 설정 이전(2단계 U6 앞부분, N-05): 옛 14역할 설정을 FM26 역할 체계의 설정으로 옮기는 순수 함수(src/shared/migration.ts)가
 * 옛 칸을 지우지 않고, 1:1로 이어지는 역할의 고친 가중치를 옮기고, 바뀐 것을 알리고, 두 번 돌려도 같으며, 깨진 입력에도 멈추지 않는지 본다.
 * 파일을 읽고 쓰는 쪽(사본, 원자적 쓰기, 깨진 파일 보존)은 tests/settings.test.ts가 본다.
 * 시험 자료의 이름과 경로는 모두 지어낸 것이다.
 */
import { describe, expect, it } from 'vitest'
import { createFm26Catalog, FM26_CATALOG, type Fm26Data } from '../src/shared/catalogFm26'
import { activeCatalog } from '../src/shared/catalogs'
import raw from '../src/shared/data/fm26-roles.json'
import { FORMATIONS } from '../src/shared/formations'
import { migrateSettings, migrationVersion, needsMigration, withBackupNote, type MigrationContext } from '../src/shared/migration'
import { effectiveRoleWeights, LEGACY_CATALOG, withCustomRoles, type CustomRole, type RoleCatalog } from '../src/shared/roleCatalog'
import { DEFAULT_ROLE, ROLES, rolesFor } from '../src/shared/roles'
import { analyseTactic } from '../src/shared/tactic'
import type { MigrationNote } from '../src/shared/tacticApi'
import { blockingProblems, cellPosition, legacyTactic, resolveMainTactic, slotKindOf, validateTactic, validateTacticSet, type TacticSet } from '../src/shared/tacticModel'
import type { Settings } from '../src/shared/types'
import { SQUAD_COLUMNS, SYNTHETIC_TODAY, syntheticSquad } from './helpers/syntheticWorld'

const data = raw as unknown as Fm26Data
const NOW = new Date('2026-12-01T09:30:00.000Z')
const CONTEXT: MigrationContext = { fm26: FM26_CATALOG, legacy: LEGACY_CATALOG, now: NOW }

/** 깊게 얼린다: 이전이 입력을 바꾸면 TypeError로 걸린다 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** 2단계 앞 판 앱이 쓰던 설정 모양 그대로(2단계 칸이 하나도 없다). 모든 값은 지어낸 것이다 */
function oldSettings(over: Partial<Settings> = {}): Settings {
  return {
    saveDir: 'D:/가상 폴더/세이브',
    activeSave: 'D:/가상 폴더/세이브/가온 시티 2025.fm',
    saveTeams: { '가온 시티 2025.fm': 9001 },
    density: 'comfortable',
    theme: 'black',
    formation: '4-2-3-1',
    slotRoles: {},
    roleWeights: {},
    talkModel: 'claude-sonnet-5-5',
    talkEffort: 'high',
    talkStats: { requests: 7, inputTokens: 1200, outputTokens: 340 },
    matchPairs: ['가온|누리'],
    keepRunning: false,
    backupEnabled: true,
    backupKeep: 5,
    ...over
  }
}

/** 포메이션마다 가운데 수비 자리(순번 7)에 볼 플레잉 센터백을 고른 설정. 5개 포메이션 모두 순번 7이 가운데 수비다 */
const bpdAt = (...formations: string[]): Record<string, string> => Object.fromEntries(formations.map((id) => [`${id}:7`, 'bpd']))

/** 이전한 결과(기록이 반드시 있다) */
function migrate(settings: Settings, context: MigrationContext = CONTEXT): { settings: Settings; notes: MigrationNote[] } {
  const result = migrateSettings(settings, context)
  expect(result.changed).toBe(true)
  return { settings: result.settings, notes: result.record!.notes }
}

const tacticsOf = (settings: Settings): Array<{ id: string; name: string; source: string; main: boolean }> =>
  (settings.tacticsDefault?.tactics ?? []).map((tactic) => ({ id: tactic.id, name: tactic.name, source: tactic.source, main: tactic.id === settings.tacticsDefault?.mainId }))

describe('언제 이전하는가', () => {
  it('판은 2이고, 쓰는 카탈로그가 FM26이며 판이 2보다 낮을 때만 이전해야 한다(옛 카탈로그를 쓰는 동안과 이미 이전한 설정은 아니다)', () => {
    expect(migrationVersion()).toBe(2)
    expect(needsMigration(oldSettings(), 'fm26')).toBe(true)
    expect(needsMigration(oldSettings({ settingsVersion: 1 }), 'fm26')).toBe(true)
    expect(needsMigration(oldSettings({ settingsVersion: 2 }), 'fm26')).toBe(false)
    expect(needsMigration(oldSettings({ settingsVersion: 3 }), 'fm26')).toBe(false)
    expect(needsMigration(oldSettings(), 'legacy14')).toBe(false)
    // 판이 숫자가 아니면 옛 설정으로 본다
    expect(needsMigration({ settingsVersion: 'x' as never }, 'fm26')).toBe(true)
    expect(needsMigration({ settingsVersion: Number.NaN }, 'fm26')).toBe(true)
  })

  it('판이 이미 2 이상이면 아무것도 바꾸지 않고 입력을 그대로 돌려준다', () => {
    const done = oldSettings({ settingsVersion: 2 })
    const result = migrateSettings(done, CONTEXT)
    expect(result).toEqual({ settings: done, record: null, changed: false })
    expect(result.settings).toBe(done)
  })
})

describe('옛 설정의 열쇠는 하나도 사라지지 않는다(N-05)', () => {
  const OLD = oldSettings({
    formation: '4-3-3',
    slotRoles: { '4-3-3:0': 'tm', '4-3-3:3': 'ap', '4-3-3:4': 'dlp', '4-3-3:7': 'bpd', '4-4-2:3': 'ap', '4-4-2:6': 'wb', '3-5-2:5': 'dlp' },
    roleWeights: { cb: { marking: 5, tackling: 0, composure: 3 }, st: { finishing: 1 }, gk: { reflexes: 0 }, b2b: { stamina: 5 }, dlp: { passing: 3 }, tm: { heading: 2 } }
  })

  it('이전 전 설정의 모든 열쇠가 그대로 있고(값도 같다), 더해진 열쇠는 전술 묶음·판·이전 기록뿐이다', () => {
    const before = structuredClone(OLD)
    const { settings } = migrate(deepFreeze(structuredClone(OLD)))
    for (const key of Object.keys(before) as Array<keyof Settings>) {
      expect(key in settings, `${key}가 사라졌다`).toBe(true)
      if (key !== 'roleWeights') expect(settings[key], key).toEqual(before[key])
    }
    // 옛 역할 id의 고친 가중치도 그대로이고, 새 id 항목만 더해진다
    for (const [roleId, weights] of Object.entries(before.roleWeights)) expect(settings.roleWeights[roleId], roleId).toEqual(weights)
    expect(Object.keys(settings.roleWeights).filter((roleId) => !(roleId in before.roleWeights)).sort()).toEqual(
      ['ip.BoxToBoxMidfielder', 'ip.CentralDefender', 'ip.CentreForward', 'ip.DeepLyingPlaymaker', 'ip.Goalkeeper', 'ip.TargetMan'].sort()
    )
    expect(Object.keys(settings).filter((key) => !(key in before)).sort()).toEqual(['migration', 'settingsVersion', 'tacticsDefault'])
    expect(settings.settingsVersion).toBe(2)
    expect(settings.catalog).toBeUndefined()
  })

  it('이전 기록: 판 2, 이전한 시각, 확인 전, 알림 목록(사본은 쓰는 쪽이 더한다)', () => {
    const result = migrateSettings(OLD, CONTEXT)
    expect(result.record).toEqual({ version: 2, at: NOW.toISOString(), notes: expect.any(Array), acknowledged: false })
    expect(result.settings.migration).toBe(result.record)
    // 시각은 글자로도 받는다
    expect(migrateSettings(OLD, { ...CONTEXT, now: '2027-01-02T03:04:05.000Z' }).record?.at).toBe('2027-01-02T03:04:05.000Z')
  })

  it('사본 알림을 더하면 알림 끝에 붙고 사본 파일 이름이 적힌다(이전 기록이 없으면 그대로)', () => {
    const { settings } = migrate(OLD)
    const withBackup = withBackupNote(settings, 'settings.v1.json')
    expect(withBackup.migration?.backupFile).toBe('settings.v1.json')
    expect(withBackup.migration?.notes.at(-1)).toEqual({ kind: 'backup', text: expect.stringContaining('settings.v1.json') })
    expect(withBackup.migration?.notes).toHaveLength(settings.migration!.notes.length + 1)
    expect(settings.migration?.backupFile).toBeUndefined()
    expect(withBackupNote(OLD, 'settings.v1.json')).toBe(OLD)
  })
})

describe('전술: 옛 포메이션이 주 전술이고, 고친 포메이션이 더해진다', () => {
  const OLD = oldSettings({
    formation: '4-3-3',
    slotRoles: { '4-3-3:0': 'tm', '4-3-3:3': 'ap', '4-3-3:4': 'dlp', '4-3-3:7': 'bpd', '4-4-2:3': 'ap', '4-4-2:6': 'wb', '3-5-2:5': 'dlp' }
  })

  it('주 전술은 옛 포메이션이고, 자리 역할을 고친 다른 포메이션이 FORMATIONS 순서로 따라온다(고치지 않은 포메이션은 옮기지 않는다)', () => {
    const { settings } = migrate(OLD)
    expect(tacticsOf(settings)).toEqual([
      { id: 'migrated:4-3-3', name: '4-3-3', source: 'user', main: true },
      { id: 'migrated:4-4-2', name: '4-4-2', source: 'user', main: false },
      { id: 'migrated:3-5-2', name: '3-5-2', source: 'user', main: false }
    ])
    expect(settings.tacticsDefault?.catalog).toBe('fm26')
    // 세이브마다의 묶음은 만들지 않는다(옛 설정은 세이브마다 다르지 않았다)
    expect(settings.tactics).toBeUndefined()
    // 쓰는 쪽이 같은 함수로 주 전술을 고른다
    const main = resolveMainTactic({ ...settings, catalog: 'fm26' }, '가온 시티 2025.fm', FM26_CATALOG)
    expect(main.id).toBe('migrated:4-3-3')
    expect(main.preset).toBe('4-3-3')
    expect(main.sharePct).toBeNull()
    expect(main.catalog).toBe('fm26')
    expect(validateTacticSet(settings.tacticsDefault!, FM26_CATALOG)).toEqual([])
  })

  it('고치지 않은 설정은 옛 포메이션 하나뿐이고 출처는 프리셋이다. 기본 역할을 다시 고른 것과 맞지 않는 값은 고친 것이 아니다', () => {
    expect(tacticsOf(migrate(oldSettings({ formation: '3-5-2' })).settings)).toEqual([{ id: 'migrated:3-5-2', name: '3-5-2', source: 'preset', main: true }])
    const sameAsDefault = oldSettings({ slotRoles: { '4-3-3:7': 'cb', '4-4-2:3': 'b2b', '3-5-2:0': 'cb', '3-4-3:99': 'st', '4-4-2:2': 'ghost' } })
    expect(tacticsOf(migrate(sameAsDefault).settings)).toEqual([{ id: 'migrated:4-2-3-1', name: '4-2-3-1', source: 'preset', main: true }])
  })

  it('자리마다 옛 역할의 대응 역할을 쓰고, 공 미소유 시 역할은 칸의 기본 역할이다', () => {
    const { settings } = migrate(OLD)
    const [main, second, third] = settings.tacticsDefault!.tactics
    // 4-3-3: 0 최전방(타깃맨), 1·2 측면 공격(기본), 3·4 중앙 미드(플레이메이커, 딥라잉), 5 수비형 미드, 6~9 수비(순번 7만 볼 플레잉), 10 골키퍼
    expect(main.slots.map((slot) => slot.ip.roleId)).toEqual([
      'ip.TargetMan',
      'ip.InsideForward',
      'ip.InsideForward',
      'ip.AdvancedPlaymaker',
      'ip.CentralMidfielder',
      'ip.DefensiveMidfielder',
      'ip.FullBack',
      'ip.BallPlayingDefender',
      'ip.CentralDefender',
      'ip.FullBack',
      'ip.Goalkeeper'
    ])
    expect(main.slots.map((slot) => slot.oop.roleId)).toEqual([
      'oop.OPCentreForward',
      'oop.OPWinger',
      'oop.OPWinger',
      'oop.OPCentralMidfielder',
      'oop.OPCentralMidfielder',
      'oop.OPDefensiveMidfielder',
      'oop.OPFullBack',
      'oop.OPCentreBack',
      'oop.OPCentreBack',
      'oop.OPFullBack',
      'oop.OPGoalkeeper'
    ])
    // 두 국면의 칸은 같고 비중은 적지 않는다(null, 대장의 기본값)
    for (const tactic of settings.tacticsDefault!.tactics) {
      expect(tactic.sharePct).toBeNull()
      for (const slot of tactic.slots) expect(slot.oop.cell).toEqual(slot.ip.cell)
    }
    // 4-4-2 순번 3은 중앙 미드의 플레이메이커, 순번 6은 왼쪽 수비의 윙백. 3-5-2 순번 5는 수비형 미드의 딥라잉(수비형 미드 줄이라 그대로 갈 수 있다)
    expect(second.slots[3].ip.roleId).toBe('ip.AdvancedPlaymaker')
    expect(second.slots[6].ip.roleId).toBe('ip.WingBack')
    expect(third.slots[5].ip.roleId).toBe('ip.DeepLyingPlaymaker')
  })

  it('자리 순서는 프리셋(옛 FORMATIONS 순서) 그대로다', () => {
    const { settings } = migrate(OLD)
    for (const tactic of settings.tacticsDefault!.tactics) {
      const formation = FORMATIONS.find((each) => each.id === tactic.preset)!
      expect(tactic.slots.map((slot) => cellPosition(slot.ip.cell))).toEqual(formation.rows.flat())
    }
  })

  it('고친 포메이션이 주 전술 말고 넷이면 전술은 셋이고, 넘친 포메이션은 알림에 적힌다', () => {
    const overflow = oldSettings({ formation: '4-2-3-1', slotRoles: bpdAt('4-3-3', '4-4-2', '3-5-2', '3-4-3') })
    const { settings, notes } = migrate(overflow)
    expect(tacticsOf(settings).map((tactic) => tactic.id)).toEqual(['migrated:4-2-3-1', 'migrated:4-3-3', 'migrated:4-4-2'])
    const dropped = notes.filter((note) => note.kind === 'tacticsDropped')
    expect(dropped).toHaveLength(1)
    expect(dropped[0].text).toContain('3-5-2, 3-4-3')
    expect(dropped[0].text).toContain('3개')
    // 옛 설정에는 그대로 남는다
    expect(settings.slotRoles).toEqual(overflow.slotRoles)
  })

  it('주 전술도 고쳤고 다른 포메이션이 셋이면 주 전술과 앞의 둘이 전술이 되고 나머지가 알림에 적힌다', () => {
    const { settings, notes } = migrate(oldSettings({ formation: '3-4-3', slotRoles: bpdAt('3-4-3', '4-2-3-1', '4-3-3', '4-4-2') }))
    expect(tacticsOf(settings).map((tactic) => tactic.id)).toEqual(['migrated:3-4-3', 'migrated:4-2-3-1', 'migrated:4-3-3'])
    expect(settings.tacticsDefault?.mainId).toBe('migrated:3-4-3')
    expect(notes.find((note) => note.kind === 'tacticsDropped')?.text).toContain('4-4-2')
  })

  it('고친 포메이션이 둘이면 알림에 넘친 것이 없다', () => {
    const { notes } = migrate(oldSettings({ slotRoles: bpdAt('4-3-3', '4-4-2') }))
    expect(notes.some((note) => note.kind === 'tacticsDropped')).toBe(false)
  })

  it('이미 tacticsDefault가 있으면 덮어쓰지 않고 알린다(판 표시만 잃은 설정에서 사용자의 전술을 지키려는 것이다)', () => {
    const own = migrate(oldSettings()).settings.tacticsDefault!
    const kept = { ...own, mainId: own.tactics[0].id, tactics: own.tactics.map((tactic) => ({ ...tactic, name: '내 전술' })) }
    const { settings, notes } = migrate(oldSettings({ tacticsDefault: kept, formation: '4-3-3', slotRoles: bpdAt('4-3-3') }))
    expect(settings.tacticsDefault).toBe(kept)
    expect(notes.find((note) => note.text.includes('이미 저장해 둔 전술'))?.kind).toBe('slot')
  })

  describe('저장해 둔 묶음을 FM26에서 쓸 수 없으면 옛 포메이션과 자리 역할로 새로 만들고 알린다', () => {
    /** 주 전술 4-3-3에 최전방(순번 0)은 타깃맨, 가운데 수비(순번 7)는 볼 플레잉 센터백을 고른 옛 설정 */
    const EDITED = { formation: '4-3-3', slotRoles: { '4-3-3:0': 'tm', '4-3-3:7': 'bpd' } }
    const REPLACED_NOTE = '저장해 둔 전술 묶음을 FM26에서 쓸 수 없어 옛 포메이션과 자리 역할로 새로 만들었습니다'
    const KEPT_NOTE = '이미 저장해 둔 전술이 있어 옛 포메이션과 자리 역할은 옮기지 않았습니다'

    /** 옛 14역할을 쓰는 동안 저장 검사를 통과해 저장된 묶음(옛 전술 하나) */
    const legacySet = (): TacticSet => {
      const tactic = legacyTactic('4-3-3', EDITED.slotRoles)
      return { catalog: 'legacy14', tactics: [tactic], mainId: tactic.id }
    }
    /** 저장 검사를 통과하는 FM26 묶음(전술 둘) */
    const fm26Set = (): TacticSet => structuredClone(migrate(oldSettings({ formation: '4-3-3', slotRoles: bpdAt('4-3-3', '4-4-2') })).settings.tacticsDefault!)
    const damaged = (change: (set: TacticSet) => void): TacticSet => {
      const set = fm26Set()
      change(set)
      return set
    }

    const UNUSABLE: Array<[string, unknown]> = [
      ['옛 14역할 때 저장한 묶음(역할 목록이 legacy14)', legacySet()],
      ['글자', 'abc'],
      ['빈 객체', {}],
      ['배열', []],
      ['숫자', 5],
      ['거짓 값(0)', 0],
      ['모양이 틀린 FM26 묶음', { catalog: 'fm26', tactics: 'x', mainId: 1 }],
      ['FM26 묶음인데 전술이 비었다', { catalog: 'fm26', tactics: [], mainId: 'x' }],
      ['카탈로그에 없는 역할이 든 FM26 묶음', damaged((set) => void (set.tactics[0].slots[0].ip.roleId = 'ip.없는역할'))],
      ['주 전술이 목록에 없는 FM26 묶음', damaged((set) => void (set.mainId = '없는 전술'))],
      ['전술이 4개인 FM26 묶음', damaged((set) => void set.tactics.push({ ...structuredClone(set.tactics[0]), id: 'x1' }, { ...structuredClone(set.tactics[0]), id: 'x2' }))],
      ['이름이 빈 전술이 든 FM26 묶음', damaged((set) => void (set.tactics[1].name = ' '))]
    ]

    it.each(UNUSABLE)('%s: 쓰지 않고 옛 설정에서 새로 만들며 알린다', (_name, value) => {
      const { settings, notes } = migrate(deepFreeze(oldSettings({ ...EDITED, tacticsDefault: value as TacticSet })))
      // 주 전술을 고르는 함수가 프리셋으로 물러서지 않고 옮긴 전술(고친 자리 역할이 든 것)을 쓴다
      const main = resolveMainTactic({ ...settings, catalog: 'fm26' }, null, FM26_CATALOG)
      expect(main.id).toBe('migrated:4-3-3')
      expect(main.slots[0].ip.roleId).toBe('ip.TargetMan')
      expect(main.slots[7].ip.roleId).toBe('ip.BallPlayingDefender')
      expect(validateTacticSet(settings.tacticsDefault!, FM26_CATALOG)).toEqual([])
      expect(settings.tacticsDefault).not.toBe(value)
      // 바뀐 것은 알림에 적힌다: 새로 만들었다는 말이 옮겼다는 말보다 앞에 있고, 지켰다는 말은 없다
      const texts = notes.map((note) => note.text)
      expect(texts[0]).toBe(REPLACED_NOTE)
      expect(texts[1]).toContain('옛 설정의 포메이션(4-3-3)')
      expect(texts).not.toContain(KEPT_NOTE)
      expect(notes.filter((note) => note.text === REPLACED_NOTE)).toHaveLength(1)
    })

    it('쓸 수 있는 FM26 묶음은 같은 설정에서도 지킨다(고친 자리 역할이 든 새 전술은 만들지 않는다)', () => {
      const own = fm26Set()
      const { settings, notes } = migrate(oldSettings({ ...EDITED, tacticsDefault: own }))
      expect(settings.tacticsDefault).toBe(own)
      expect(notes.map((note) => note.text)).toContain(KEPT_NOTE)
      expect(notes.map((note) => note.text)).not.toContain(REPLACED_NOTE)
      expect(notes.some((note) => note.text.startsWith('옛 설정의 포메이션'))).toBe(false)
    })

    it('값이 없던(undefined, null) 묶음은 바뀐 것이 아니라서 새로 만들었다는 말을 적지 않는다', () => {
      for (const none of [undefined, null]) {
        const { settings, notes } = migrate(oldSettings({ ...EDITED, tacticsDefault: none as unknown as undefined }))
        expect(settings.tacticsDefault?.mainId, String(none)).toBe('migrated:4-3-3')
        expect(notes.map((note) => note.text), String(none)).not.toContain(REPLACED_NOTE)
        expect(notes[0].text).toContain('옛 설정의 포메이션(4-3-3)')
      }
    })

    it('저장해 둔 묶음이 사용자 역할을 쓰면 설정의 사용자 역할을 얹어 검사한다: 정의가 있으면 지키고, 정의가 없으면 쓸 수 없는 묶음이다', () => {
      const custom: CustomRole = { id: 'user.target', phase: 'ip', name: '내 타깃', positions: ['ST'], weights: { heading: 5 } }
      const own = fm26Set()
      own.tactics[0].slots[0].ip.roleId = 'user.target'
      expect(validateTacticSet(own, withCustomRoles(FM26_CATALOG, [custom]))).toEqual([])
      const kept = migrate(oldSettings({ ...EDITED, tacticsDefault: own, customRoles: [custom] }))
      expect(kept.settings.tacticsDefault).toBe(own)
      expect(kept.notes.map((note) => note.text)).toContain(KEPT_NOTE)
      const lost = migrate(oldSettings({ ...EDITED, tacticsDefault: own }))
      expect(lost.settings.tacticsDefault).not.toBe(own)
      expect(lost.notes[0].text).toBe(REPLACED_NOTE)
      // 사용자 역할 칸이 배열이 아니어도 멈추지 않는다
      expect(migrate(oldSettings({ ...EDITED, tacticsDefault: own, customRoles: 'x' as never })).notes[0].text).toBe(REPLACED_NOTE)
    })

    it('옮긴 전술을 만들 수 없는 경우(자료가 어긋났다)에는 새로 만들었다고 적지 않고, 있던 값은 그대로 둔다', () => {
      const noStriker: RoleCatalog = createFm26Catalog({ ...data, slotKinds: Object.fromEntries(Object.entries(data.slotKinds).filter(([kind]) => !kind.startsWith('ST.'))) })
      const { settings, notes } = migrate(oldSettings({ ...EDITED, tacticsDefault: 'abc' as never }), { ...CONTEXT, fm26: noStriker })
      expect(settings.tacticsDefault).toBe('abc')
      expect(notes.some((note) => note.kind === 'problem')).toBe(true)
      expect(notes.map((note) => note.text)).not.toContain(REPLACED_NOTE)
    })

    it('다시 돌려도 같다: 새로 만든 묶음은 이미 쓸 수 있어서 다음에는 지켜진다', () => {
      const first = migrate(oldSettings({ ...EDITED, tacticsDefault: legacySet() })).settings
      const { settingsVersion: _version, migration: _migration, ...stripped } = first
      const again = migrate(stripped as Settings, { ...CONTEXT, now: new Date('2030-01-01T00:00:00Z') })
      expect(again.settings.tacticsDefault).toEqual(first.tacticsDefault)
      expect(again.notes.map((note) => note.text)).toContain(KEPT_NOTE)
      expect(again.notes.map((note) => note.text)).not.toContain(REPLACED_NOTE)
    })
  })
})

describe('프리셋 5개 × 옛 역할 고르기 전부', () => {
  /** 옛 박스 투 박스·딥라잉이 중앙 미드 자리에서 바뀌는 것이 이전에 알릴 유일한 자리 바뀜이다(자료 시험이 확인한 사실) */
  const REPLACED = new Set(['b2b', 'dlp'])
  const LINE = /^(.+) 자리 (\d+)곳: /

  it('모든 자리가 고를 수 있는 역할을 갖고, 바뀐 자리는 중앙 미드의 박스 투 박스·딥라잉뿐이며 한 줄로 묶여 적힌다', () => {
    let migrations = 0
    for (const formation of FORMATIONS) {
      const positions = formation.rows.flat()
      positions.forEach((position, index) => {
        for (const role of rolesFor(position)) {
          const where = `${formation.id}:${index} ${role.id}`
          const { settings, notes } = migrate(oldSettings({ formation: formation.id, slotRoles: { [`${formation.id}:${index}`]: role.id } }))
          migrations++
          const tactic = resolveMainTactic({ ...settings, catalog: 'fm26' }, null, FM26_CATALOG)
          expect(tactic.id, where).toBe(`migrated:${formation.id}`)
          expect(blockingProblems(validateTactic(tactic, FM26_CATALOG)), where).toEqual([])
          tactic.slots.forEach((slot, at) => {
            for (const phase of ['ip', 'oop'] as const) {
              const kind = slotKindOf(tactic, at, phase)
              expect(FM26_CATALOG.choicesAt(cellPosition(slot[phase].cell)!, phase, kind).map((choice) => choice.roleId), `${where} ${at} ${phase}`).toContain(slot[phase].roleId)
            }
          })
          // 옛 분석이 쓰던 역할(고른 것, 나머지는 옛 기본)로 바뀐 자리 수를 따로 센다
          const oldRoles = positions.map((each, at) => (at === index ? role.id : DEFAULT_ROLE[each]))
          const replacedAt = positions.flatMap((each, at) => (each === 'MC' && REPLACED.has(oldRoles[at]) ? [at] : []))
          for (const at of positions.keys()) {
            const expected = replacedAt.includes(at) ? 'ip.CentralMidfielder' : FM26_CATALOG.legacyMap()[oldRoles[at]].to
            expect(tactic.slots[at].ip.roleId, `${where} 자리 ${at}`).toBe(expected)
          }
          const lines = notes.filter((note) => note.kind === 'slot' && LINE.test(note.text))
          if (replacedAt.length === 0) expect(lines, where).toEqual([])
          else {
            expect(lines, where).toEqual([
              { kind: 'slot', text: `중앙 미드 자리 ${replacedAt.length}곳: 박스 투 박스와 딥라잉 플레이메이커는 FM26에서 수비형 미드 줄의 역할이라 중앙 미드필더로 바꿨습니다` }
            ])
          }
        }
      })
    }
    expect(migrations).toBeGreaterThan(100)
  })

  it('옛 기본 역할(박스 투 박스)이 놓이던 4-3-3의 중앙 미드 두 자리는 고치지 않았어도 중앙 미드필더로 바뀌고 알림이 한 줄 나온다', () => {
    const { settings, notes } = migrate(oldSettings({ formation: '4-3-3' }))
    expect(settings.tacticsDefault?.tactics[0].slots.slice(3, 5).map((slot) => slot.ip.roleId)).toEqual(['ip.CentralMidfielder', 'ip.CentralMidfielder'])
    expect(notes.filter((note) => note.text.startsWith('중앙 미드 자리'))).toEqual([
      { kind: 'slot', text: '중앙 미드 자리 2곳: 박스 투 박스와 딥라잉 플레이메이커는 FM26에서 수비형 미드 줄의 역할이라 중앙 미드필더로 바꿨습니다' }
    ])
    // 중앙 미드가 없는 4-2-3-1에는 그 줄이 없다
    expect(migrate(oldSettings()).notes.some((note) => note.text.includes('중앙 미드 자리'))).toBe(false)
  })

  it('여러 전술에서 바뀐 자리는 전술을 가리지 않고 한 줄에 센다', () => {
    const { notes } = migrate(oldSettings({ formation: '4-3-3', slotRoles: { '4-4-2:3': 'dlp', '3-5-2:2': 'dlp' } }))
    // 4-3-3 두 자리(옛 기본) + 4-4-2 두 자리(순번 3은 딥라잉, 4는 옛 기본) + 3-5-2 두 자리(순번 2는 딥라잉, 3은 옛 기본)
    expect(notes.filter((note) => note.text.startsWith('중앙 미드 자리'))).toEqual([
      { kind: 'slot', text: '중앙 미드 자리 6곳: 박스 투 박스와 딥라잉 플레이메이커는 FM26에서 수비형 미드 줄의 역할이라 중앙 미드필더로 바꿨습니다' }
    ])
  })
})

describe('고친 가중치', () => {
  const EDITED = {
    gk: { reflexes: 0, handling: 5 },
    cb: { marking: 5, tackling: 0, composure: 3 },
    bpd: { passing: 5 },
    fb: { crossing: 1 },
    wb: { stamina: 3 },
    dm: { tackling: 2 },
    dlp: { passing: 3 },
    b2b: { stamina: 5 },
    ap: { vision: 4 },
    am: { finishing: 3 },
    winger: { pace: 5 },
    if: { dribbling: 3 },
    st: { finishing: 1 },
    tm: { heading: 2 }
  }

  it('1:1로 이어지는 옛 역할 14개(박스 투 박스와 딥라잉 포함)의 고친 값이 공 소유 시 역할 id로 옮겨지고, 그 능력치의 실효 가중치가 같다', () => {
    const before = oldSettings({ roleWeights: EDITED })
    const { settings, notes } = migrate(before)
    const map = FM26_CATALOG.legacyMap()
    expect(Object.keys(EDITED).sort()).toEqual(ROLES.map((role) => role.id).sort())
    for (const [oldId, weights] of Object.entries(EDITED)) {
      const newId = map[oldId].to
      expect(map[oldId].oneToOne, oldId).toBe(true)
      expect(newId.startsWith('ip.'), oldId).toBe(true)
      for (const attribute of Object.keys(weights)) {
        const before14 = effectiveRoleWeights(LEGACY_CATALOG, oldId, before.roleWeights)[attribute]
        expect(effectiveRoleWeights(FM26_CATALOG, newId, settings.roleWeights)[attribute], `${oldId} → ${newId} ${attribute}`).toBe(before14)
      }
    }
    // 공 미소유 시 역할에는 옮기지 않는다
    expect(Object.keys(settings.roleWeights).filter((id) => id.startsWith('oop.'))).toEqual([])
    // 알림은 한 줄로, 옮긴 역할마다 능력치 수가 적힌다
    const carried = notes.filter((note) => note.kind === 'weightsCarried')
    expect(carried).toHaveLength(1)
    expect(carried[0].text).toContain('공 소유 시 역할로 옮겼습니다')
    expect(carried[0].text).toContain('센터백은 센터백(능력치 3개)')
    expect(carried[0].text).toContain('박스 투 박스는 박스 투 박스 미드필더(능력치 1개)')
    expect(carried[0].text).toContain('딥라잉 플레이메이커는 딥라잉 플레이메이커(능력치 1개)')
    expect(carried[0].text).toContain('스트라이커는 센터 포워드(능력치 1개)')
    expect(carried[0].text).toContain('타깃맨은 타겟 포워드(능력치 1개)')
    expect(notes.some((note) => note.kind === 'weightsReset')).toBe(false)
  })

  it('옛 id의 값은 지우지 않고, 새 id에 이미 있는 능력치 값은 건드리지 않는다(없는 능력치만 옮긴다)', () => {
    const { settings, notes } = migrate(oldSettings({ roleWeights: { cb: { marking: 5, tackling: 1 }, 'ip.CentralDefender': { marking: 2, jumping: 4 } } }))
    expect(settings.roleWeights.cb).toEqual({ marking: 5, tackling: 1 })
    expect(settings.roleWeights['ip.CentralDefender']).toEqual({ marking: 2, jumping: 4, tackling: 1 })
    expect(notes.find((note) => note.kind === 'weightsCarried')?.text).toContain('센터백은 센터백(능력치 1개)')
    // 옮길 능력치가 하나도 남지 않으면 그 역할은 옮긴 것으로 적지 않고 새 id는 그대로다
    const same = migrate(oldSettings({ roleWeights: { cb: { marking: 5 }, 'ip.CentralDefender': { marking: 3 } } }))
    expect(same.settings.roleWeights['ip.CentralDefender']).toEqual({ marking: 3 })
    expect(same.notes.some((note) => note.kind === 'weightsCarried')).toBe(false)
  })

  it('고친 가중치가 없으면 roleWeights는 그대로이고 옮김·초기화 알림이 없다', () => {
    const before = oldSettings({ roleWeights: { cb: {} } })
    const { settings, notes } = migrate(before)
    expect(settings.roleWeights).toBe(before.roleWeights)
    expect(notes.some((note) => note.kind === 'weightsCarried' || note.kind === 'weightsReset')).toBe(false)
  })

  it('1:1이 아닌 역할의 고친 값은 옮기지 않고(옛 id에 남는다) 초기화한 역할로 알림에 적힌다', () => {
    const notOneToOne = createFm26Catalog({ ...data, legacyMap: { ...data.legacyMap, cb: { to: 'ip.CentralDefender', oneToOne: false } } })
    const { settings, notes } = migrate(oldSettings({ roleWeights: { cb: { marking: 5 }, st: { finishing: 1 } } }), { ...CONTEXT, fm26: notOneToOne })
    expect(settings.roleWeights['ip.CentralDefender']).toBeUndefined()
    expect(settings.roleWeights.cb).toEqual({ marking: 5 })
    expect(settings.roleWeights['ip.CentreForward']).toEqual({ finishing: 1 })
    expect(notes.find((note) => note.kind === 'weightsReset')?.text).toContain('센터백')
    expect(notes.find((note) => note.kind === 'weightsReset')?.text).not.toContain('스트라이커')
    expect(notes.find((note) => note.kind === 'weightsCarried')?.text).not.toContain('센터백')
  })

  it('대응 표에 없는 옛 역할도 초기화로 적고, 그 역할이 놓이던 자리는 칸의 기본 역할로 바뀌어 한 줄로 알린다', () => {
    const { tm, ...rest } = data.legacyMap
    expect(tm.to).toBe('ip.TargetMan')
    const withoutTm = createFm26Catalog({ ...data, legacyMap: rest })
    const { settings, notes } = migrate(oldSettings({ slotRoles: { '4-2-3-1:0': 'tm' }, roleWeights: { tm: { heading: 2 } } }), { ...CONTEXT, fm26: withoutTm })
    expect(settings.tacticsDefault?.tactics[0].slots[0].ip.roleId).toBe('ip.CentreForward')
    expect(notes.find((note) => note.text.startsWith('최전방 자리'))).toEqual({ kind: 'slot', text: '최전방 자리 1곳: 타깃맨은 FM26에서 이 칸의 역할 목록에 없어 센터 포워드로 바꿨습니다' })
    expect(notes.find((note) => note.kind === 'weightsReset')?.text).toContain('타깃맨')
    expect(settings.roleWeights['ip.TargetMan']).toBeUndefined()
  })

  it('소수 가중치도 값 그대로 옮기고(실효 가중치가 같다), 모르는 능력치와 숫자가 아닌 값은 옮기지 않는다', () => {
    const { settings } = migrate(oldSettings({ roleWeights: { cb: { marking: 4.5, ghost: 3, tackling: 'x' as never, passing: null as never, jumping: -1 }, b2b: { stamina: 2.25 } } }))
    expect(settings.roleWeights['ip.CentralDefender']).toEqual({ marking: 4.5, jumping: -1 })
    expect(settings.roleWeights['ip.BoxToBoxMidfielder']).toEqual({ stamina: 2.25 })
    expect(settings.roleWeights.cb).toEqual({ marking: 4.5, ghost: 3, tackling: 'x', passing: null, jumping: -1 })
  })
})

describe('깨진 입력에도 멈추지 않고 쓸 수 있는 설정을 낸다', () => {
  const GARBAGE: Array<[string, unknown]> = [
    ['빈 설정', {}],
    ['포메이션만', { formation: '3-5-2' }],
    ['모르는 포메이션', { formation: '9-9-9', slotRoles: { '9-9-9:0': 'cb' } }],
    ['모르는 역할과 틀린 자리 열쇠', { slotRoles: { '4-2-3-1:99': 'cb', '4-2-3-1:-1': 'cb', '4-2-3-1:x': 'cb', '4-2-3-1:3': 'ghost', '4-2-3-1:0': 'cb', 'nope:0': 'gk', '4-3-3:99': 'st', '4-3-3:': 'st' } }],
    ['맞지 않는 포지션의 역할(골키퍼 자리에 중앙 수비)', { formation: '4-3-3', slotRoles: { '4-3-3:10': 'cb', '4-3-3:0': 'gk' } }],
    ['소수 가중치와 모르는 능력치와 이상한 역할 항목', { roleWeights: { cb: { marking: 4.5, ghost: 3, tackling: 'x' }, nobody: { marking: 1 }, st: 'oops', gk: [1, 2], tm: null, b2b: { stamina: 2.25 } } }],
    ['모양이 틀린 칸', { formation: 7, slotRoles: 'abc', roleWeights: [1, 2, 3] }],
    ['null 칸', { formation: null, slotRoles: null, roleWeights: null, tacticsDefault: null, settingsVersion: null }],
    ['숫자 칸', { formation: 5, slotRoles: 5, roleWeights: 5 }],
    ['열쇠 이름이 객체 속성과 겹침', { slotRoles: { __proto__: 'x', constructor: 'cb', toString: 'gk' }, roleWeights: { constructor: { marking: 1 }, hasOwnProperty: { marking: 1 } } }]
  ]

  it.each(GARBAGE)('%s', (_name, input) => {
    const result = migrateSettings(deepFreeze(structuredClone(input)) as Settings, CONTEXT)
    expect(result.changed).toBe(true)
    expect(result.settings.settingsVersion).toBe(2)
    expect(result.record?.acknowledged).toBe(false)
    const set = result.settings.tacticsDefault
    expect(set).toBeDefined()
    // 쓸 수 있는 전술 묶음이다: 저장 검사를 통과하고 주 전술이 고른다
    expect(validateTacticSet(set!, FM26_CATALOG)).toEqual([])
    const main = resolveMainTactic({ ...result.settings, catalog: 'fm26' }, null, FM26_CATALOG)
    expect(main.id).toBe(set!.mainId)
    expect(blockingProblems(validateTactic(main, FM26_CATALOG))).toEqual([])
    // 알림 글은 모두 글자이고 비어 있지 않다
    for (const note of result.record!.notes) expect(note.text.length).toBeGreaterThan(0)
  })

  it('빈 설정은 4-2-3-1 프리셋을 주 전술로 두고 비중·공 미소유 시 알림만 낸다', () => {
    const { settings, notes } = migrate({} as Settings)
    expect(tacticsOf(settings)).toEqual([{ id: 'migrated:4-2-3-1', name: '4-2-3-1', source: 'preset', main: true }])
    expect(notes.map((note) => note.kind)).toEqual(['slot', 'slot', 'share'])
  })

  it('모르는 포메이션은 맨 앞 포메이션으로 본다(옛 분석과 같다)', () => {
    expect(tacticsOf(migrate(oldSettings({ formation: '9-9-9' })).settings).map((tactic) => tactic.id)).toEqual(['migrated:4-2-3-1'])
  })

  it('틀린 입력의 고친 가중치 가운데 읽을 수 있는 것만 옮긴다', () => {
    const { settings } = migrate({ roleWeights: { cb: { marking: 4.5, ghost: 3, tackling: 'x' }, nobody: { marking: 1 }, st: 'oops', gk: [1, 2], tm: null, b2b: { stamina: 2.25 } } } as unknown as Settings)
    expect(settings.roleWeights['ip.CentralDefender']).toEqual({ marking: 4.5 })
    expect(settings.roleWeights['ip.BoxToBoxMidfielder']).toEqual({ stamina: 2.25 })
    expect(Object.keys(settings.roleWeights).filter((id) => id.startsWith('ip.')).sort()).toEqual(['ip.BoxToBoxMidfielder', 'ip.CentralDefender'])
  })
})

describe('두 번 돌려도 같다', () => {
  it('같은 입력에 같은 시각이면 결과가 같고, 이전한 설정을 다시 넣으면 아무것도 바꾸지 않는다', () => {
    const OLD = oldSettings({ formation: '3-5-2', slotRoles: { ...bpdAt('3-5-2', '4-4-2'), '3-5-2:2': 'dlp' }, roleWeights: { cb: { marking: 5 }, b2b: { stamina: 4 } } })
    const first = migrateSettings(OLD, CONTEXT)
    expect(migrateSettings(OLD, CONTEXT)).toEqual(first)
    const second = migrateSettings(first.settings, { ...CONTEXT, now: new Date('2030-01-01T00:00:00Z') })
    expect(second.changed).toBe(false)
    expect(second.record).toBeNull()
    expect(second.settings).toBe(first.settings)
    expect(second.settings).toEqual(first.settings)
  })

  it('판 표시만 지워진 설정을 다시 이전해도 전술과 가중치가 그대로다(새 id의 값은 덮어쓰지 않고 이미 있는 전술 묶음은 지킨다)', () => {
    const first = migrate(oldSettings({ formation: '4-4-2', slotRoles: bpdAt('4-4-2'), roleWeights: { cb: { marking: 5 } } })).settings
    const { settingsVersion: _version, migration: _migration, ...stripped } = first
    const again = migrate(stripped as Settings, { ...CONTEXT, now: new Date('2030-01-01T00:00:00Z') }).settings
    expect(again.tacticsDefault).toEqual(first.tacticsDefault)
    expect(again.roleWeights).toEqual(first.roleWeights)
  })
})

describe('이전은 입력을 바꾸지 않는다', () => {
  it('깊게 얼린 설정을 넣어도 던지지 않고, 새 객체를 돌려준다', () => {
    const frozen = deepFreeze(oldSettings({ formation: '4-3-3', slotRoles: bpdAt('4-3-3', '4-4-2'), roleWeights: { cb: { marking: 5 } } }))
    const result = migrateSettings(frozen, CONTEXT)
    expect(result.settings).not.toBe(frozen)
    expect(result.settings.slotRoles).toBe(frozen.slotRoles)
    expect(Object.isFrozen(result.settings)).toBe(false)
  })
})

describe('settings.catalog를 legacy14로 두면 이전 전과 정밀하게 같은 옛 분석이 돈다(되돌림 스위치)', () => {
  const OLD = oldSettings({
    formation: '4-3-3',
    slotRoles: { '4-3-3:0': 'tm', '4-3-3:3': 'ap', '4-3-3:4': 'dlp', '4-3-3:7': 'bpd', '4-4-2:3': 'ap' },
    roleWeights: { cb: { marking: 5, tackling: 0, composure: 3 }, st: { finishing: 1 }, gk: { reflexes: 0 }, b2b: { stamina: 5 }, tm: { heading: 2 } }
  })

  it('옛 칸(포메이션, 자리 역할, 고친 가중치)이 같아서 같은 선수단의 분석이 반올림 없이 같다', () => {
    const rows = syntheticSquad()
    const run = (settings: Settings): ReturnType<typeof analyseTactic> => {
      const catalog = activeCatalog(settings)
      expect(catalog.id).toBe('legacy14')
      return analyseTactic({ rows, columns: SQUAD_COLUMNS, today: SYNTHETIC_TODAY, tactic: resolveMainTactic(settings, '가온 시티 2025.fm', catalog), catalog, roleWeights: settings.roleWeights })
    }
    const before = analyseTactic({ rows, columns: SQUAD_COLUMNS, today: SYNTHETIC_TODAY, formation: OLD.formation, slotRoles: OLD.slotRoles, roleWeights: OLD.roleWeights })
    expect(before).not.toBeNull()
    const after = { ...migrate(OLD).settings, catalog: 'legacy14' as const }
    expect(run({ ...OLD, catalog: 'legacy14' })).toEqual(before)
    expect(run(after)).toEqual(before)
    // 옛 꼴로 불러도 같다
    expect(analyseTactic({ rows, columns: SQUAD_COLUMNS, today: SYNTHETIC_TODAY, formation: after.formation, slotRoles: after.slotRoles, roleWeights: after.roleWeights })).toEqual(before)
  })
})

describe('알림 글', () => {
  const OLD = oldSettings({
    formation: '4-3-3',
    slotRoles: { ...bpdAt('4-3-3', '4-4-2', '3-5-2', '3-4-3'), '4-3-3:4': 'dlp' },
    roleWeights: { cb: { marking: 5 }, b2b: { stamina: 5 } }
  })

  it('게임 낱말(공 소유 시, 공 미소유 시)을 쓰고 옛 낱말(점유 시)은 쓰지 않는다', () => {
    const { notes } = migrate(OLD)
    const text = notes.map((note) => note.text).join('\n')
    expect(text).toContain('공 소유 시')
    expect(text).toContain('공 미소유 시')
    expect(text).not.toContain('점유 시')
    expect(text).not.toMatch(/[·•→]/)
  })

  it('종류와 차례: 전술(주 전술, 더한 전술, 넘친 전술), 자리 바뀜, 공 미소유 시 역할, 비중, 옮긴 가중치', () => {
    const { notes } = migrate(OLD)
    expect(notes.map((note) => note.kind)).toEqual(['slot', 'slot', 'tacticsDropped', 'slot', 'slot', 'share', 'weightsCarried'])
    expect(notes[0].text).toBe('옛 설정의 포메이션(4-3-3)과 자리 역할을 FM26 역할로 옮겨 주 전술로 두었습니다')
    expect(notes[1].text).toBe('자리 역할을 고친 적이 있는 포메이션(4-4-2, 3-5-2)도 전술로 옮겼습니다')
    expect(notes[2].text).toBe('전술은 세이브마다 3개까지 둘 수 있어 옮기지 못한 포메이션: 3-4-3(옛 설정에는 그대로 남아 있습니다)')
    expect(notes[3].text).toBe('중앙 미드 자리 6곳: 박스 투 박스와 딥라잉 플레이메이커는 FM26에서 수비형 미드 줄의 역할이라 중앙 미드필더로 바꿨습니다')
    expect(notes[4].text).toBe('공 미소유 시 역할은 모든 자리에서 그 칸의 기본 역할로 두었습니다')
  })

  it('비중은 정하지 않고 대장의 기본값을 따른다는 말이 한 번 적힌다(기본 60, 추정)', () => {
    const { notes } = migrate(OLD)
    const share = notes.filter((note) => note.kind === 'share')
    expect(share).toEqual([{ kind: 'share', text: '공 소유 시 비중은 정하지 않고 기본값(공 소유 시 60 : 공 미소유 시 40, 추정)을 따릅니다' }])
  })

  it('받침에 맞는 조사를 쓴다(은/는, 와/과, 로/으로)', () => {
    const custom: RoleCatalog = createFm26Catalog({ ...data, legacyMap: Object.fromEntries(Object.entries(data.legacyMap).filter(([id]) => id !== 'fb' && id !== 'dm')) })
    const { notes } = migrate(oldSettings({ slotRoles: {} }), { ...CONTEXT, fm26: custom })
    const lines = notes.filter((note) => note.kind === 'slot' && / 자리 \d+곳: /.test(note.text)).map((note) => note.text)
    // 왼쪽·오른쪽 수비의 풀백과 수비형 미드 둘은 대응이 없어 기본 역할로 바뀐다
    expect(lines).toContain('왼쪽 수비 자리 1곳: 풀백은 FM26에서 이 칸의 역할 목록에 없어 풀백으로 바꿨습니다')
    expect(lines).toContain('오른쪽 수비 자리 1곳: 풀백은 FM26에서 이 칸의 역할 목록에 없어 풀백으로 바꿨습니다')
    expect(lines).toContain('수비형 미드 자리 2곳: 수비형 미드필더는 FM26에서 이 칸의 역할 목록에 없어 수비형 미드필더로 바꿨습니다')
  })

  it('바뀐 뒤의 역할 이름이 ㄹ 받침으로 끝나면 "로", 다른 받침이면 "으로", 받침이 없으면 "로"를 쓴다', () => {
    const rename = (name: string): RoleCatalog =>
      createFm26Catalog({
        ...data,
        roles: data.roles.map((role) => (role.id === 'ip.FullBack' ? { ...role, name } : role)),
        legacyMap: Object.fromEntries(Object.entries(data.legacyMap).filter(([id]) => id !== 'fb'))
      })
    const lineOf = (name: string): string | undefined =>
      migrate(oldSettings(), { ...CONTEXT, fm26: rename(name) }).notes.find((note) => note.text.startsWith('왼쪽 수비 자리'))?.text.replace(/^.*없어 /, '')
    expect(lineOf('사이드월')).toBe('사이드월로 바꿨습니다')
    expect(lineOf('사이드백')).toBe('사이드백으로 바꿨습니다')
    expect(lineOf('사이드맨')).toBe('사이드맨으로 바꿨습니다')
    expect(lineOf('사이드')).toBe('사이드로 바꿨습니다')
    expect(lineOf('FB')).toBe('FB(으)로 바꿨습니다')
  })
})
