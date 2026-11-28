/**
 * 2단계 새 창구의 계약(U1): 창구 이름이 화면(preload, 미리보기 목업)과 본체(tacticIpc.ts)에 모두 있고,
 * 본체만 쓰는 설정 열쇠는 화면이 보낸 patch에서 버려지며, 아직 채우지 않은 서비스와 목업은 "준비되지 않았습니다"를 돌려주고 던지지 않는다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { registerTacticIpc, type Phase2Deps } from '../src/main/tacticIpc'
import { mockRoleToolsApi } from '../src/renderer/src/lib/mock/roleTools'
import { mockTacticsApi } from '../src/renderer/src/lib/mock/tactics'
import { mockTacticToolsApi } from '../src/renderer/src/lib/mock/tacticTools'
import { dropMainOwned, MAIN_OWNED_KEYS, NOT_READY, normsFailed, TACTIC_CHANNELS } from '../src/shared/tacticApi'
import type { Settings } from '../src/shared/types'

const SRC = join(__dirname, '..', 'src')
const read = (path: string): string => readFileSync(join(SRC, path), 'utf8')
const preload = read('preload/index.ts')
const mainIndex = read('main/index.ts')
const rendererApi = read('renderer/src/api.ts')

const METHODS = Object.keys(TACTIC_CHANNELS) as Array<keyof typeof TACTIC_CHANNELS>

describe('새 창구 이름이 preload, tacticIpc.ts, 목업에 모두 있다', () => {
  it('창구는 10개이고, 채널 이름이 겹치지 않으며 옛 창구와 부딪히지 않는다', () => {
    expect(METHODS).toHaveLength(10)
    const channels = Object.values(TACTIC_CHANNELS)
    expect(new Set(channels).size).toBe(channels.length)
    for (const channel of channels) {
      expect(channel).toMatch(/^[a-z]+:[A-Za-z]+$/)
      expect(mainIndex, `${channel}는 index.ts의 옛 창구와 겹친다`).not.toContain(`ipcMain.handle('${channel}'`)
    }
    // 계획에 정한 이름 그대로
    expect(TACTIC_CHANNELS).toEqual({
      tacticsSave: 'tactics:save',
      worldNorms: 'world:norms',
      tacticImport: 'tactics:import',
      tacticRecommend: 'tactics:recommend',
      customRolesSave: 'roles:saveCustom',
      roleBundleExport: 'roles:export',
      roleBundlePreview: 'roles:preview',
      roleBundleApply: 'roles:apply',
      roleStarCheck: 'roles:stars',
      migrationAck: 'settings:ackMigration'
    })
  })

  it('preload가 메서드마다 같은 채널로 invoke한다', () => {
    for (const method of METHODS) {
      expect(preload, method).toMatch(new RegExp(`\\b${method}: \\([^)]*\\) => ipcRenderer\\.invoke\\('${TACTIC_CHANNELS[method]}'`))
    }
    // applySave는 두 번째 값(선택)도 본체로 넘긴다
    expect(preload).toContain("applySave: (path, options) => ipcRenderer.invoke('link:apply', path, options)")
  })

  it('registerTacticIpc가 이 채널들을 정확히 하나씩 등록한다', () => {
    const handlers = new Map<string, unknown>()
    registerTacticIpc({ handle: (channel: string, handler: unknown) => handlers.set(channel, handler) } as never, fakeDeps())
    expect([...handlers.keys()].sort()).toEqual(Object.values(TACTIC_CHANNELS).sort())
    expect(mainIndex).toContain('registerTacticIpc(ipcMain')
  })

  it('미리보기 목업 세 틀이 메서드 10개를 빠짐없이, 겹치지 않게 낸다', () => {
    const state = { getSettings: () => ({}) as Settings, setSettings: () => undefined }
    const keys = [...Object.keys(mockTacticsApi(state)), ...Object.keys(mockTacticToolsApi(state)), ...Object.keys(mockRoleToolsApi(state))]
    expect(keys.sort()).toEqual([...METHODS].sort())
    // 미리보기의 api가 세 틀을 펼쳐 넣는다
    for (const shell of ['mockTacticsApi', 'mockTacticToolsApi', 'mockRoleToolsApi']) expect(rendererApi).toContain(`...${shell}(state)`)
  })
})

describe('본체 소유 설정 열쇠', () => {
  it('화면이 보낸 patch에서 본체 소유 열쇠를 버리고, 나머지는 그대로 둔다', () => {
    expect([...MAIN_OWNED_KEYS].sort()).toEqual(['customRoles', 'migration', 'settingsProblem', 'settingsVersion', 'tactics', 'tacticsDefault'])
    const patch = {
      density: 'comfortable',
      formation: '4-3-3',
      slotRoles: { '4-3-3:7': 'bpd' },
      roleWeights: { cb: { marking: 5 } },
      catalog: 'legacy14',
      tactics: { 'a.fm': { catalog: 'fm26', tactics: [], mainId: 'x' } },
      tacticsDefault: { catalog: 'fm26', tactics: [], mainId: 'x' },
      customRoles: [],
      migration: { version: 2, at: '', notes: [], acknowledged: true },
      settingsVersion: 2,
      settingsProblem: { at: '', file: '', message: '' }
    } as unknown as Partial<Settings>
    const frozen = Object.freeze({ ...patch })
    expect(dropMainOwned(frozen)).toEqual({ density: 'comfortable', formation: '4-3-3', slotRoles: { '4-3-3:7': 'bpd' }, roleWeights: { cb: { marking: 5 } }, catalog: 'legacy14' })
    // 입력은 바뀌지 않는다
    expect(Object.keys(frozen)).toHaveLength(11)
    expect(dropMainOwned({ density: 'compact' })).toEqual({ density: 'compact' })
    expect(dropMainOwned({})).toEqual({})
    expect(dropMainOwned(null as never)).toEqual({})
    expect(dropMainOwned('x' as never)).toEqual({})
  })

  it('본체의 settings:set 창구가 patch를 dropMainOwned에 거쳐 쓴다', () => {
    const handler = /ipcMain\.handle\('settings:set'[\s\S]*?\n {2}\}\)/.exec(mainIndex)?.[0] ?? ''
    expect(handler).toContain('settings.set(dropMainOwned(patch))')
    // 본체 안에서 직접 쓰는 길(전술 저장, 이전)은 SettingsStore.set을 바로 부른다. 화면이 보낸 patch만 걸러진다
    expect(handler).not.toContain('settings.set(patch)')
  })
})

/** 서비스가 건드리지 않는 모양만 갖춘 가짜 의존물 */
function fakeDeps(overrides: Partial<Phase2Deps> = {}): Phase2Deps {
  return {
    settings: {} as never,
    world: {} as never,
    link: {} as never,
    norms: () => normsFailed(NOT_READY),
    pickSavePath: async () => null,
    pickOpenPath: async () => null,
    dataDir: '',
    ...overrides
  }
}

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>

function registered(deps: Phase2Deps = fakeDeps()): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  registerTacticIpc({ handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } as never, deps)
  return handlers
}

describe('아직 채우지 않은 창구는 "준비되지 않았습니다"를 돌려주고 던지지 않는다', () => {
  const NOT_READY_RESULT = { ok: false, message: NOT_READY }
  const SHAPES: Record<keyof typeof TACTIC_CHANNELS, Record<string, unknown>> = {
    tacticsSave: { problems: [] },
    worldNorms: { norms: {} },
    tacticImport: { problems: [], unknownBits: [] },
    tacticRecommend: { ranked: [], suggestions: [], elapsedMs: 0 },
    customRolesSave: {},
    roleBundleExport: {},
    roleBundlePreview: { changes: [], warnings: [] },
    roleBundleApply: {},
    roleStarCheck: { rows: [], players: 0, readAt: null },
    migrationAck: {}
  }
  const ARGUMENTS: unknown[][] = [[], [null], [undefined, undefined], ['a.fm', { 엉뚱한: '값' }], [7, 'x', {}], [[1, 2], '?']]

  it('본체의 채널마다: 어떤 값을 받아도 준비되지 않았다는 결과가 나온다', async () => {
    const handlers = registered()
    expect(NOT_READY).toBe('아직 준비되지 않았습니다.')
    for (const method of METHODS) {
      const handler = handlers.get(TACTIC_CHANNELS[method])!
      for (const args of ARGUMENTS) {
        await expect(handler({}, ...args), `${method}(${JSON.stringify(args)})`).resolves.toEqual({ ...NOT_READY_RESULT, ...SHAPES[method] })
      }
    }
  })

  it('미리보기 목업마다: 같은 결과가 나온다', async () => {
    const state = { getSettings: () => ({}) as Settings, setSettings: () => undefined }
    const shells = { ...mockTacticsApi(state), ...mockTacticToolsApi(state), ...mockRoleToolsApi(state) } as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
    for (const method of METHODS) {
      for (const args of ARGUMENTS) await expect(shells[method](...args), `${method}(${JSON.stringify(args)})`).resolves.toEqual({ ...NOT_READY_RESULT, ...SHAPES[method] })
    }
  })

  it('기준 분포 창구는 본체가 이어 주는 함수(deps.norms)를 부르고, 배열이 아닌 값은 빈 목록으로 넘긴다', async () => {
    const seen: unknown[] = []
    const handlers = registered(fakeDeps({ norms: (profiles) => (seen.push(profiles), { ok: true, norms: {} }) }))
    const profile = { ip: { position: 'DC', roleId: 'cb' }, oop: { position: 'DC', roleId: 'cb' }, sharePct: 60 }
    await expect(handlers.get('world:norms')!({}, [profile])).resolves.toEqual({ ok: true, norms: {} })
    await handlers.get('world:norms')!({}, '배열이 아님')
    expect(seen).toEqual([[profile], []])
  })

  it('서비스가 던져도 화면에는 실패 결과를 주고 오류 내용은 담지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const handlers = registered(fakeDeps({ norms: () => { throw new Error('C:\\비밀\\경로 때문에 깨졌다') } }))
      const result = (await handlers.get('world:norms')!({}, [])) as { ok: boolean; message: string; norms: unknown }
      expect(result).toMatchObject({ ok: false, norms: {} })
      expect(result.message).not.toContain('비밀')
      expect(result.message.length).toBeGreaterThan(0)
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('파일 대화상자 의존물은 본체가 준다(화면은 경로를 주지 않는다): 의존물에 두 함수가 있다', () => {
    const deps = fakeDeps()
    expect(typeof deps.pickSavePath).toBe('function')
    expect(typeof deps.pickOpenPath).toBe('function')
    // 화면으로 가는 창구 어디에도 경로를 받는 메서드가 없다
    expect(preload).not.toMatch(/(roleBundleExport|roleBundlePreview|roleBundleApply): \([^)]*(path|file)/i)
  })
})
