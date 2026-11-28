/**
 * 역할 가중치 묶음 서비스(2단계 U8, src/main/roleShareService.ts): 저장·열기 대화상자는 본체가 열고 화면은 파일 경로를 주지 않는다.
 * 임시 폴더의 진짜 파일로 내보내기, 읽기 전 크기 검사, 미리 보기, 합치기·바꾸기 적용을 시험한다. 설정은 가짜 저장소(메모리)다.
 * 사용자 역할 저장은 뒤로 미룬 기능이라 "준비되지 않았습니다"를 그대로 돌려준다.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyRoleBundle, exportRoleBundle, previewRoleBundle, saveCustomRoles } from '../src/main/roleShareService'
import { registerTacticIpc, type Phase2Deps } from '../src/main/tacticIpc'
import { FM26_CATALOG } from '../src/shared/catalogFm26'
import { FIELDS } from '../src/shared/fields'
import { ROLE_BUNDLE_MAX_BYTES } from '../src/shared/limits'
import { effectiveRoleWeights, profileWeights, type RoleOverrides } from '../src/shared/roleCatalog'
import { bundleToText, exportBundle, parseBundle } from '../src/shared/roleShare'
import type { SlotProfile } from '../src/shared/slotProfile'
import { NOT_READY, normsFailed, TACTIC_CHANNELS } from '../src/shared/tacticApi'
import type { Settings } from '../src/shared/types'
import { seededDraw } from './helpers/searchSquad'

const catalog = FM26_CATALOG
const ATTRIBUTES = FIELDS.filter((field) => field.isAttr).map((field) => field.id)

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fmb-roleshare-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))
afterEach(() => vi.restoreAllMocks())

interface Fake {
  deps: Phase2Deps
  current(): Settings
  /** 저장 대화상자가 고르는 경로(null이면 취소) */
  savePath: { value: string | null; asked: string[] }
  /** 열기 대화상자가 고르는 경로(null이면 취소) */
  openPath: { value: string | null }
}

function fake(initial: Partial<Settings> = {}): Fake {
  let settings = { roleWeights: {}, catalog: 'fm26', ...initial } as Settings
  const savePath = { value: null as string | null, asked: [] as string[] }
  const openPath = { value: null as string | null }
  const deps: Phase2Deps = {
    settings: { get: () => settings, set: (patch: Partial<Settings>) => (settings = { ...settings, ...patch }) } as never,
    world: {} as never,
    link: {} as never,
    norms: () => normsFailed('준비 중'),
    pickSavePath: async (name) => (savePath.asked.push(name), savePath.value),
    pickOpenPath: async () => openPath.value,
    dataDir: dir
  }
  return { deps, current: () => settings, savePath, openPath }
}

let counter = 0
const file = (name = 'x'): string => join(dir, `${name}-${counter++}.json`)
/** 역할 가중치만 있는 설정(내보내기는 이 칸만 읽는다) */
const asSettings = (roleWeights: RoleOverrides): Settings => ({ roleWeights }) as unknown as Settings

/** 씨앗으로 고른 사용자 수정 가중치 */
function edits(seed: number, count: number): RoleOverrides {
  const draw = seededDraw(seed)
  const out: RoleOverrides = {}
  for (let at = 0; at < count; at++) {
    const role = catalog.roles[Math.floor(draw() * catalog.roles.length)]
    out[role.id] = { ...out[role.id], [ATTRIBUTES[Math.floor(draw() * ATTRIBUTES.length)]]: Math.floor(draw() * 6) }
  }
  return out
}

/** 모든 역할과 프로파일 몇 개의 실효 가중치(0 이하는 뺀 것: 적합도에는 영향이 없다) */
function tables(overrides: RoleOverrides): unknown {
  const positive = (weights: Readonly<Record<string, number>>): Record<string, number> => Object.fromEntries(Object.entries(weights).filter(([, weight]) => weight > 0).sort(([a], [b]) => a.localeCompare(b)))
  const profiles: SlotProfile[] = [
    { ip: { position: 'DC', roleId: 'ip.CentralDefender' }, oop: { position: 'DC', roleId: 'oop.OPStoppingCentreBack' }, sharePct: 60 },
    { ip: { position: 'MC', roleId: 'ip.BoxToBoxMidfielder' }, oop: { position: 'MC', roleId: 'oop.OPPressingCentralMidfielder' }, sharePct: 40 }
  ]
  return [catalog.roles.map((role) => positive(effectiveRoleWeights(catalog, role.id, overrides))), profiles.map((profile) => positive(profileWeights(catalog, profile, overrides)))]
}

describe('내보내기', () => {
  it('본체의 저장 대화상자로 고른 경로에 묶음 파일을 쓴다. 파일은 이 앱이 다시 읽을 수 있다', async () => {
    const f = fake({ roleWeights: edits(1, 20) })
    const path = file('export')
    f.savePath.value = path
    const result = await exportRoleBundle(f.deps)
    expect(result.ok).toBe(true)
    expect(result.message).toContain(`${catalog.roles.length}개`)
    expect(f.savePath.asked).toEqual(['fmb-role-weights.json'])
    const read = parseBundle(readFileSync(path, 'utf8'))
    expect(read).toEqual({ ok: true, bundle: exportBundle(f.current(), catalog) })
    // 설정은 건드리지 않는다
    expect(f.current().roleWeights).toEqual(edits(1, 20))
  })

  it('저장 대화상자를 취소하면 파일을 만들지 않고 실패로 알린다', async () => {
    const f = fake()
    f.savePath.value = null
    const result = await exportRoleBundle(f.deps)
    expect(result).toEqual({ ok: false, message: '내보내기를 취소했습니다.' })
  })

  it('쓸 수 없는 곳이면 실패로 알리고, 글에 경로나 오류 내용을 싣지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const f = fake()
    const target = join(dir, '없는 폴더', '더 없는 폴더', 'x.json')
    f.savePath.value = target
    const result = await exportRoleBundle(f.deps)
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain('없는 폴더')
    expect(result.message).not.toContain(dir)
    expect(existsSync(target)).toBe(false)
    expect(spy).toHaveBeenCalled()
  })

  it('설정에 0~5 정수가 아닌 값이 손으로 들어가 있으면 파일을 만들기 전에 막고 까닭을 알린다(대화상자도 열지 않는다)', async () => {
    const f = fake({ roleWeights: { 'ip.Goalkeeper': { handling: 2.5 } } })
    f.savePath.value = file('bad')
    const result = await exportRoleBundle(f.deps)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('정수')
    expect(f.savePath.asked).toEqual([])
    expect(existsSync(f.savePath.value)).toBe(false)
    const big = fake({ roleWeights: { 'ip.Goalkeeper': { handling: 9 } } })
    expect((await exportRoleBundle(big.deps)).message).toContain('0에서 5 사이')
  })
})

describe('가져오기 미리 보기와 적용', () => {
  /** 보내는 쪽 설정의 묶음 파일을 만든다 */
  function bundleFile(roleWeights: RoleOverrides, name = 'bundle'): string {
    const path = file(name)
    writeFileSync(path, bundleToText(exportBundle({ roleWeights } as Settings, catalog)), 'utf8')
    return path
  }

  it('내보내기 → 기본값으로 되돌리기 → 가져오기(합치기, 바꾸기) 뒤 모든 역할과 프로파일의 가중치가 같다', async () => {
    for (const mode of ['merge', 'replace'] as const) {
      const sender = fake({ roleWeights: edits(4, 50) })
      const path = file('trip')
      sender.savePath.value = path
      expect((await exportRoleBundle(sender.deps)).ok).toBe(true)
      const receiver = fake({ roleWeights: {} })
      receiver.openPath.value = path
      const preview = await previewRoleBundle(receiver.deps)
      expect(preview.ok).toBe(true)
      expect(preview.token).toBeTruthy()
      expect(preview.changes.length).toBeGreaterThan(0)
      const applied = await applyRoleBundle(receiver.deps, preview.token!, mode)
      expect(applied.ok).toBe(true)
      expect(applied.settings).toBe(receiver.current())
      expect(tables(receiver.current().roleWeights)).toEqual(tables(sender.current().roleWeights))
    }
  })

  it('미리 보기는 설정을 바꾸지 않고, 바뀔 역할 목록과 경고와 표(token)를 준다', async () => {
    const path = bundleFile({ 'ip.CentralDefender': { marking: 5 } })
    const f = fake({ roleWeights: { 'ip.Goalkeeper': { handling: 1 } } })
    f.openPath.value = path
    const before = JSON.stringify(f.current())
    const preview = await previewRoleBundle(f.deps)
    expect(JSON.stringify(f.current())).toBe(before)
    expect(preview.ok).toBe(true)
    expect(preview.message).toContain('역할 2개의 가중치가 바뀝니다')
    expect(preview.changes.map((line) => line.split(':')[0])).toEqual(['골키퍼(공 소유 시)', '센터백(공 소유 시)'])
    expect(preview.warnings).toEqual([])
    expect(typeof preview.token).toBe('string')
  })

  it('바뀌는 것이 없으면 그렇게 알린다', async () => {
    const f = fake({ roleWeights: edits(2, 10) })
    const path = file('same')
    writeFileSync(path, bundleToText(exportBundle(f.current(), catalog)), 'utf8')
    f.openPath.value = path
    const preview = await previewRoleBundle(f.deps)
    expect(preview).toMatchObject({ ok: true, message: '이 파일로 바뀌는 가중치가 없습니다.', changes: [] })
    expect((await applyRoleBundle(f.deps, preview.token!, 'merge')).message).toBe('바뀐 가중치가 없습니다.')
  })

  it('열기 대화상자를 취소하면 실패로 알리고 앞의 미리 보기를 그대로 둔다', async () => {
    const f = fake()
    f.openPath.value = bundleFile({ 'ip.CentralDefender': { marking: 5 } })
    const first = await previewRoleBundle(f.deps)
    f.openPath.value = null
    const canceled = await previewRoleBundle(f.deps)
    expect(canceled).toEqual({ ok: false, message: '가져올 파일을 고르지 않았습니다.', changes: [], warnings: [] })
    expect((await applyRoleBundle(f.deps, first.token!, 'merge')).ok).toBe(true)
  })

  it('합치기는 묶음에 없는 역할의 고친 값을 두고, 바꾸기는 원래 값으로 되돌린다', async () => {
    // 묶음은 모든 역할의 실효 값을 담으므로, 일부 역할만 든 파일을 직접 만든다
    const partial = file('partial')
    const bundle = exportBundle(asSettings({ 'ip.CentralDefender': { marking: 5 } }), catalog)
    writeFileSync(partial, JSON.stringify({ ...bundle, weights: { 'ip.CentralDefender': bundle.weights['ip.CentralDefender'] } }), 'utf8')
    for (const [mode, kept] of [['merge', true], ['replace', false]] as const) {
      const f = fake({ roleWeights: { 'ip.Goalkeeper': { handling: 1 }, cb: { marking: 3 } } })
      f.openPath.value = partial
      const preview = await previewRoleBundle(f.deps)
      expect(preview.warnings.join(' ')).toContain('이 묶음에 없는 역할 1개')
      const applied = await applyRoleBundle(f.deps, preview.token!, mode)
      expect(applied.ok).toBe(true)
      const weights = f.current().roleWeights
      expect(Boolean(weights['ip.Goalkeeper'])).toBe(kept)
      expect(weights['ip.CentralDefender']).toEqual({ marking: 5 })
      // 지금 카탈로그에 없는 옛 역할의 고친 값은 어느 쪽도 건드리지 않는다
      expect(weights.cb).toEqual({ marking: 3 })
    }
  })

  it('적용은 미리 본 뒤에 바뀐 지금 설정에 맞춰 한다', async () => {
    const partial = file('partial2')
    const bundle = exportBundle(asSettings({ 'ip.CentralDefender': { marking: 5 } }), catalog)
    writeFileSync(partial, JSON.stringify({ ...bundle, weights: { 'ip.CentralDefender': bundle.weights['ip.CentralDefender'] } }), 'utf8')
    const f = fake()
    f.openPath.value = partial
    const preview = await previewRoleBundle(f.deps)
    // 미리 본 뒤에 사용자가 다른 역할을 고쳤다
    f.deps.settings.set({ roleWeights: { 'oop.OPGoalkeeper': { reflexes: 5 } } })
    expect((await applyRoleBundle(f.deps, preview.token!, 'merge')).ok).toBe(true)
    expect(f.current().roleWeights).toEqual({ 'oop.OPGoalkeeper': { reflexes: 5 }, 'ip.CentralDefender': { marking: 5 } })
  })

  it('표(token)가 맞아야 적용한다: 틀린 표, 빈 표, 이미 쓴 표, 새 파일을 고른 뒤의 옛 표는 거절한다', async () => {
    const f = fake()
    f.openPath.value = bundleFile({ 'ip.CentralDefender': { marking: 5 } })
    const first = await previewRoleBundle(f.deps)
    const before = JSON.stringify(f.current())
    for (const token of ['', 'x', 'token-아님']) {
      expect(await applyRoleBundle(f.deps, token, 'merge')).toEqual({ ok: false, message: '가져올 파일을 다시 골라 주세요.' })
    }
    expect(JSON.stringify(f.current())).toBe(before)
    // 새 파일을 고르면 앞의 표는 못 쓴다
    f.openPath.value = bundleFile({ 'ip.CentralDefender': { marking: 4 } }, 'second')
    const second = await previewRoleBundle(f.deps)
    expect(second.token).not.toBe(first.token)
    expect((await applyRoleBundle(f.deps, first.token!, 'merge')).ok).toBe(false)
    expect((await applyRoleBundle(f.deps, second.token!, 'merge')).ok).toBe(true)
    // 한 번 쓴 표는 다시 못 쓴다
    expect((await applyRoleBundle(f.deps, second.token!, 'merge')).ok).toBe(false)
  })

  it('표는 서비스마다 따로다(다른 서비스의 표로는 적용할 수 없다)', async () => {
    const a = fake()
    const b = fake()
    a.openPath.value = bundleFile({ 'ip.CentralDefender': { marking: 5 } })
    const preview = await previewRoleBundle(a.deps)
    expect((await applyRoleBundle(b.deps, preview.token!, 'merge')).ok).toBe(false)
    expect((await applyRoleBundle(a.deps, preview.token!, 'merge')).ok).toBe(true)
  })

  it('다른 카탈로그나 게임 판의 묶음은 경고와 함께 미리 보여 준다', async () => {
    const f = fake()
    const path = file('other')
    const bundle = exportBundle({ roleWeights: {} } as Settings, catalog)
    writeFileSync(path, JSON.stringify({ ...bundle, catalogVersion: '26.4.0' }), 'utf8')
    f.openPath.value = path
    const preview = await previewRoleBundle(f.deps)
    expect(preview.ok).toBe(true)
    expect(preview.warnings[0]).toContain('26.4.0')
  })
})

describe('가져올 수 없는 파일은 읽기 전이나 읽은 뒤에 이유와 함께 거절하고, 글에 경로를 싣지 않는다', () => {
  const failure = async (path: string | null, check?: (message: string) => void): Promise<void> => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const f = fake({ roleWeights: { 'ip.Goalkeeper': { handling: 1 } } })
    f.openPath.value = path
    const before = JSON.stringify(f.current())
    const preview = await previewRoleBundle(f.deps)
    expect(preview.ok).toBe(false)
    expect(preview.token).toBeUndefined()
    expect(preview.changes).toEqual([])
    expect(preview.message).not.toContain(dir)
    expect(JSON.stringify(f.current())).toBe(before)
    check?.(preview.message)
  }

  it('한도를 넘는 큰 파일: 읽기 전에 크기로 거절한다', async () => {
    const path = file('big')
    writeFileSync(path, ' '.repeat(ROLE_BUNDLE_MAX_BYTES + 1))
    await failure(path, (message) => expect(message).toContain('너무 큽니다'))
  })

  it('한도와 같은 크기의 파일은 읽는다', async () => {
    const f = fake()
    const text = bundleToText(exportBundle({ roleWeights: {} } as Settings, catalog))
    const path = file('exact')
    writeFileSync(path, text + ' '.repeat(ROLE_BUNDLE_MAX_BYTES - Buffer.byteLength(text)))
    f.openPath.value = path
    expect((await previewRoleBundle(f.deps)).ok).toBe(true)
  })

  it('JSON이 아닌 파일, 모양이 틀린 파일, 모르는 능력치, 소수, 5 초과, __proto__ 열쇠', async () => {
    const cases: Array<[string, string]> = [
      ['글입니다', 'JSON'],
      ['[]', '모양'],
      ['{"format":"x"}', '이 앱이 만든'],
      [JSON.stringify({ ...exportBundle({ roleWeights: {} } as Settings, catalog), weights: { 'ip.Goalkeeper': { 없는능력치: 3 } } }), '알 수 없는 능력치'],
      [JSON.stringify({ ...exportBundle({ roleWeights: {} } as Settings, catalog), weights: { 'ip.Goalkeeper': { handling: 3.5 } } }), '정수'],
      [JSON.stringify({ ...exportBundle({ roleWeights: {} } as Settings, catalog), weights: { 'ip.Goalkeeper': { handling: 6 } } }), '0에서 5 사이'],
      ['{"format":"fmb-role-weights","version":1,"catalog":"fm26","catalogVersion":"26.3.2","weights":{"__proto__":{"handling":4}},"customRoles":[]}', '__proto__']
    ]
    for (const [text, reason] of cases) {
      const path = file('bad')
      writeFileSync(path, text, 'utf8')
      await failure(path, (message) => {
        expect(message).toContain('가져올 수 없는 파일입니다')
        expect(message, text.slice(0, 30)).toContain(reason)
      })
    }
  })

  it('폴더이거나 없는 파일이거나 읽을 수 없는 경로', async () => {
    const folder = join(dir, 'a-folder')
    mkdirSync(folder, { recursive: true })
    await failure(folder, (message) => expect(message).toContain('파일이 아닙니다'))
    await failure(join(dir, 'no-such-file.json'), (message) => expect(message).toContain('읽지 못했습니다'))
  })
})

describe('창구를 거쳐도 파일 경로는 본체가 정한다', () => {
  type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
  const register = (f: Fake): Map<string, Handler> => {
    const handlers = new Map<string, Handler>()
    registerTacticIpc({ handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } as never, f.deps)
    return handlers
  }

  it('화면이 어떤 값을 같이 보내도 저장·열기 경로는 대화상자가 정한 것이다', async () => {
    const mine = edits(6, 30)
    const f = fake({ roleWeights: mine })
    const handlers = register(f)
    const chosen = file('chosen')
    f.savePath.value = chosen
    // 화면이 경로를 끼워 보내도(그런 메서드는 없지만 본체는 받은 인자를 쓰지 않는다) 대화상자의 경로에 쓴다
    const exported = (await handlers.get(TACTIC_CHANNELS.roleBundleExport)!({}, join(dir, 'evil.json'))) as { ok: boolean }
    expect(exported.ok).toBe(true)
    expect(existsSync(chosen)).toBe(true)
    expect(existsSync(join(dir, 'evil.json'))).toBe(false)
    f.openPath.value = chosen
    for (const [sent, word] of [[{ 엉뚱: '값' }, '합쳤습니다'], ['replace', '바꾸었습니다']] as const) {
      f.deps.settings.set({ roleWeights: {} })
      const preview = (await handlers.get(TACTIC_CHANNELS.roleBundlePreview)!({}, join(dir, 'evil.json'))) as { ok: boolean; token: string }
      expect(preview.ok).toBe(true)
      // 방식이 합치기·바꾸기가 아니면 합치기로 본다
      const applied = (await handlers.get(TACTIC_CHANNELS.roleBundleApply)!({}, preview.token, sent)) as { ok: boolean; message: string }
      expect(applied.ok).toBe(true)
      expect(applied.message).toContain(word)
      expect(tables(f.current().roleWeights)).toEqual(tables(mine))
    }
  })

  it('사용자 역할 저장은 아직 만들지 않아 "준비되지 않았습니다"를 돌려준다(설정을 쓰지 않는다)', async () => {
    const f = fake()
    expect(await saveCustomRoles(f.deps, [])).toEqual({ ok: false, message: NOT_READY })
    expect(f.current().customRoles).toBeUndefined()
  })
})
