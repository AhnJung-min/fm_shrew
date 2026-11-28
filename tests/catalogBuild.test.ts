/**
 * FM26 역할 카탈로그 자료(src/shared/data/fm26-roles.json)의 생성기(2단계 U4). 계산은 tests/helpers/catalogBuild.ts에 있고,
 * 이 파일은 그것을 시험하고, 원본이 있으면 원본으로 자료 파일을 만든다.
 *
 * 원본이 없어도 도는 시험: 원본에서 필요한 칸만 읽는지, 포지션 비트와 칸 종류, 앱 추가 규칙, 글 만들기, 초안 표의 모양,
 * 그리고 "자료 파일을 원본 꼴로 되돌린 것에서 생성기가 같은 자료를 만든다"(생성기와 자료 파일이 어긋나지 않았다는 것).
 *
 * 환경 변수(원본이 있을 때만 도는 시험)
 *   FMB_CATALOG_SOURCE  켜진 게임에서 읽은 파일이 있는 폴더(메인 체크아웃의 review-notes/ingame). role-key-attributes.json, role-slots*.json이 필요하고
 *                       role-stars.json이 있으면 1군 별점 표와의 어긋남도, role-by-position.json이 있으면 포지션별 역할 표와의 어긋남도 본다.
 *   FMB_CATALOG_WRITE   1이면 원본에서 만든 글을 자료 파일에 쓴다(`npm run catalog:build`). 아니면 자료 파일과 같은지만 본다.
 *                       쓰는 실행에서는 "자료 파일과 생성기가 어긋나지 않았다"를 보는 시험 넷(아래 CHECK_FILE)을 건너뛴다. 규칙이나 표를 바꾼 뒤의 첫 실행은
 *                       옛 자료 파일을 새 생성기와 견주게 되어 빨갛게 나오기 때문이다. 쓴 뒤에 `npm test -- tests/catalogBuild.test.ts`로 다시 확인한다.
 * 다시 돌려도 자료 파일이 바뀌지 않아야 한다(열쇠 차례와 줄 모양이 고정이다).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Fm26Data } from '../src/shared/catalogFm26'
import raw from '../src/shared/data/fm26-roles.json'
import { ROLES } from '../src/shared/roles'
import {
  ALL_KINDS,
  appAttributesOf,
  ATTRIBUTE_NAMES,
  buildFm26Data,
  checkPositionTables,
  checkStarTables,
  COMMITTED_APP_RULE,
  decodePosition,
  DRAFT_KINDS,
  formatFm26Data,
  kindOfCell,
  LEGACY_TARGETS,
  NAMELESS_ROLE_NAMES,
  NOTE_GAME,
  observedKinds,
  parseKeyAttributes,
  parsePositionTable,
  parseSlots,
  parseStars,
  POSITION_ORDER,
  type BuildSource,
  type ParsedPositionTable,
  type ParsedSlots,
  type ParsedStars
} from './helpers/catalogBuild'

const SOURCE = process.env.FMB_CATALOG_SOURCE
const WRITE = process.env.FMB_CATALOG_WRITE === '1'
const DATA_FILE = join(__dirname, '..', 'src', 'shared', 'data', 'fm26-roles.json')
const committed = raw as unknown as Fm26Data
/** 자료 파일을 생성기의 표와 견주는 시험. 자료 파일을 새로 쓰는 실행(WRITE)에서는 건너뛴다 */
const CHECK_FILE = it.skipIf(WRITE)

describe('원본 읽기: 필요한 칸만 읽는다', () => {
  it('역할 목록 파일의 설명 글(help)과 모르는 칸은 읽히지 않는다', () => {
    const parsed = parseKeyAttributes({
      readAt: '2026-01-01T00:00:00.000Z',
      plugin: '9.9.9',
      roles: [{ phase: 'ip', id: '1', enumName: 'Goalkeeper', name: '골키퍼', short: 'GK', keyAttributes: ['반사 신경'], help: '지어낸 긴 설명 글입니다.' }]
    })
    expect(Object.keys(parsed.roles[0]).sort()).toEqual(['enumName', 'id', 'keyAttributes', 'name', 'phase', 'short'])
    expect(Object.keys(parsed).sort()).toEqual(['readAt', 'roles'])
    expect(JSON.stringify(parsed)).not.toContain('긴 설명')
  })

  it('전술 자리 파일의 선수 이름은 읽히지 않는다', () => {
    const parsed = parseSlots({
      plugin: '9.9.9',
      slots: [{ index: 0, player: '지어낸 선수', ip: { position: 1, role: '4096', available: [{ id: '1', name: '골키퍼', selected: false, starMin: 3 }] }, oop: { position: 1, available: [] } }]
    })
    expect(JSON.stringify(parsed)).not.toContain('지어낸 선수')
    expect(parsed.slots[0].ip.available).toEqual([{ id: '1' }])
  })

  it('1군 별점 파일은 포지션 숙련과 역할 번호만 읽고 선수 이름은 읽지 않는다', () => {
    const parsed = parseStars({ players: [{ uid: 9000001, name: '지어낸 선수', positions: { GK: 20 }, ip: [{ id: '1', name: '골키퍼', min: 18 }], oop: [] }] })
    expect(JSON.stringify(parsed)).not.toContain('지어낸 선수')
    expect(parsed.players[0]).toEqual({ positions: { GK: 20 }, ip: [{ id: '1' }], oop: [] })
  })

  it('포지션별 역할 표는 역할 번호와 이름만 읽고 모르는 칸은 읽지 않는다', () => {
    const parsed = parsePositionTable({ readAt: 'x', plugin: '9.9.9', source: '지어낸 출처', positions: { GK: { ip: [{ id: '1', short: 'GK', name: '골키퍼', player: '지어낸 선수' }], oop: [] } } })
    expect(parsed).toEqual({ positions: { GK: { ip: [{ id: '1', short: 'GK', name: '골키퍼' }], oop: [] } } })
    expect(JSON.stringify(parsed)).not.toContain('지어낸')
  })

  it('모양이 다르면 어느 파일인지 적어서 던진다', () => {
    expect(() => parseKeyAttributes({ roles: 'x' })).toThrow('role-key-attributes.json')
    expect(() => parseKeyAttributes({ readAt: 'x', roles: [{ phase: 'both', id: '1', enumName: 'A', keyAttributes: [] }] })).toThrow()
    expect(() => parseKeyAttributes({ readAt: 'x', roles: [{ phase: 'ip', id: '글자', enumName: 'A', keyAttributes: [] }] })).toThrow()
    expect(() => parseSlots({ slots: [{ index: 0 }] })).toThrow('role-slots.json')
    expect(() => parseStars({ players: [{ positions: { GK: '20' }, ip: [], oop: [] }] })).toThrow('role-stars.json')
    expect(() => parsePositionTable({ positions: { GK: { ip: [{ id: '글자' }], oop: [] } } })).toThrow('role-by-position.json')
  })
})

describe('포지션 비트와 칸 종류', () => {
  it('게임 포지션 비트를 포지션과 좌우로 푼다(계획 부록 D)', () => {
    expect(decodePosition(1)).toEqual({ position: 'GK', side: null })
    expect(decodePosition(4)).toEqual({ position: 'DR', side: null })
    expect(decodePosition(8)).toEqual({ position: 'DL', side: null })
    expect(decodePosition(16 + 2097152)).toEqual({ position: 'DC', side: 'right' })
    expect(decodePosition(16 + 1048576)).toEqual({ position: 'DC', side: 'left' })
    expect(decodePosition(128)).toEqual({ position: 'DM', side: null })
    expect(decodePosition(1024 + 1048576)).toEqual({ position: 'MC', side: 'left' })
    expect(decodePosition(2048)).toEqual({ position: 'AMR', side: null })
    expect(decodePosition(4096)).toEqual({ position: 'AML', side: null })
    expect(decodePosition(8192)).toEqual({ position: 'AMC', side: null })
    expect(decodePosition(16384)).toEqual({ position: 'ST', side: null })
    expect(decodePosition(32)).toEqual({ position: 'WBR', side: null })
    expect(decodePosition(64)).toEqual({ position: 'WBL', side: null })
    expect(decodePosition(256)).toEqual({ position: 'MR', side: null })
    expect(decodePosition(512)).toEqual({ position: 'ML', side: null })
    // 최전방 둘 자리에서 오는 비트는 최전방의 오른쪽·왼쪽 칸이다(부록 D, 확인 전)
    expect(decodePosition(32768)).toEqual({ position: 'ST', side: 'right' })
    expect(decodePosition(65536)).toEqual({ position: 'ST', side: 'left' })
  })

  it('받지 않는 비트, 포지션이 둘인 비트, 양쪽 비트는 던진다(생성기를 고쳐야 한다는 뜻)', () => {
    for (const bits of [0, 2, 1 + 4, 16 + 1048576 + 2097152, 16384 + 32768, 32768 + 65536, 1 << 25]) expect(() => decodePosition(bits), String(bits)).toThrow()
  })

  it('칸 종류는 tacticModel의 slotKindOf와 같은 규칙이다: 넓은 포지션은 그대로, 가운데 포지션은 칸 수와 자리로', () => {
    expect(kindOfCell('GK', null, 1)).toBe('GK')
    expect(kindOfCell('AML', null, 1)).toBe('AML')
    expect(kindOfCell('DC', 'left', 1)).toBe('DC.single')
    expect(kindOfCell('DC', 'left', 2)).toBe('DC.pair')
    expect(kindOfCell('DC', 'right', 3)).toBe('DC.trio.side')
    expect(kindOfCell('DC', null, 3)).toBe('DC.trio.centre')
    expect(kindOfCell('MC', null, 4)).toBe('MC.trio.centre')
    expect(ALL_KINDS).toHaveLength(29)
    expect(new Set(ALL_KINDS).size).toBe(29)
  })
})

describe('observedKinds: 게임에서 본 자리에서 칸 종류별 목록을 만든다', () => {
  /** 지어낸 역할 번호 → 역할(국면과 번호로 찾는다) */
  const roleOf = (phase: 'ip' | 'oop', gameId: string): { id: string; phase: 'ip' | 'oop'; gameId: string } | undefined => (gameId === '0' ? undefined : { id: `${phase}.R${gameId}`, phase, gameId })
  const cell = (position: number, ids: string[], oopIds: string[] = ids): ParsedSlots['slots'][number] => ({
    index: 0,
    ip: { position, available: ids.map((id) => ({ id })) },
    oop: { position, available: oopIds.map((id) => ({ id })) }
  })

  it('가운데 칸 둘이면 pair, 하나면 single, 목록은 게임 번호 오름차순이다(64비트 값은 숫자로 바꾸지 않고 비교한다)', () => {
    const file: ParsedSlots = { slots: [cell(1, ['9007199254740992', '1', '4096']), cell(16 + 1048576, ['2', '16384']), cell(16 + 2097152, ['16384', '2']), cell(128, ['16'])] }
    const seen = observedKinds([file], roleOf)
    expect([...seen.keys()]).toEqual(['GK', 'DC.pair', 'DM.single'])
    expect(seen.get('GK')?.ip).toEqual(['ip.R1', 'ip.R4096', 'ip.R9007199254740992'])
    expect(seen.get('DC.pair')?.ip).toEqual(['ip.R2', 'ip.R16384'])
    expect(seen.get('DM.single')?.oop).toEqual(['oop.R16'])
  })

  it('가운데 칸 셋이면 바깥 둘은 trio.side, 가운데는 trio.centre이고, 국면마다 따로 센다', () => {
    const three: ParsedSlots = { slots: [cell(16 + 1048576, ['2']), cell(16, ['2']), cell(16 + 2097152, ['2'])] }
    expect([...observedKinds([three], roleOf).keys()].sort()).toEqual(['DC.trio.centre', 'DC.trio.side'])
    // 점유 시에는 가운데 칸 둘, 비점유 시에는 셋인 자리
    const mixed: ParsedSlots = {
      slots: [
        { index: 0, ip: { position: 16 + 1048576, available: [{ id: '2' }] }, oop: { position: 16 + 1048576, available: [{ id: '8' }] } },
        { index: 1, ip: { position: 16 + 2097152, available: [{ id: '2' }] }, oop: { position: 16, available: [{ id: '8' }] } },
        { index: 2, ip: { position: 1, available: [{ id: '1' }] }, oop: { position: 16 + 2097152, available: [{ id: '8' }] } }
      ]
    }
    const seen = observedKinds([mixed], roleOf)
    expect(seen.get('DC.pair')?.ip).toEqual(['ip.R2'])
    expect(seen.get('DC.trio.side')?.oop).toEqual(['oop.R8'])
    expect(seen.get('DC.trio.centre')?.oop).toEqual(['oop.R8'])
  })

  it('같은 칸 종류를 두 번 보았는데 목록이 다르면, 모르는 역할 번호가 있으면 던진다', () => {
    const differ: ParsedSlots = { slots: [cell(4, ['4', '8']), cell(4, ['4'])] }
    expect(() => observedKinds([differ], roleOf)).toThrow('목록이 다릅니다')
    expect(() => observedKinds([{ slots: [cell(4, ['4'])] }, { slots: [cell(4, ['8'])] }], roleOf)).toThrow('목록이 다릅니다')
    expect(() => observedKinds([{ slots: [cell(4, ['0'])] }], roleOf)).toThrow('역할 번호')
  })

  it('같은 목록을 여러 파일에서 보면 하나로 합친다', () => {
    const seen = observedKinds([{ slots: [cell(4, ['4', '8'])] }, { slots: [cell(4, ['8', '4']), cell(8, ['4'])] }], roleOf)
    expect(seen.get('DR')?.ip).toEqual(['ip.R4', 'ip.R8'])
    expect(seen.get('DL')?.ip).toEqual(['ip.R4'])
  })
})

describe('앱 추가 능력치 규칙', () => {
  const role = (patch: Partial<{ id: string; enumName: string; goalkeeper: boolean; key: string[] }> = {}) => ({ id: 'ip.Winger', enumName: 'Winger', goalkeeper: false, key: ['crossing', 'dribbling'], ...patch })

  it('none: 아무것도 더하지 않는다', () => {
    expect(appAttributesOf('none', role())).toEqual([])
  })

  it('default: 골키퍼가 아닌 역할에 가속도·민첩성을, 핵심이 아닐 때만, 세이브 순서로 더한다', () => {
    expect(appAttributesOf('default', role())).toEqual(['acceleration', 'agility'])
    expect(appAttributesOf('default', role({ key: ['agility', 'crossing'] }))).toEqual(['acceleration'])
    expect(appAttributesOf('default', role({ key: ['acceleration', 'agility'] }))).toEqual([])
    expect(appAttributesOf('default', role({ id: 'ip.Goalkeeper', enumName: 'Goalkeeper', goalkeeper: true, key: ['reflexes'] }))).toEqual([])
    // 비점유 시 역할도 같다
    expect(appAttributesOf('default', role({ id: 'oop.OPWinger', enumName: 'OPWinger' }))).toEqual(['acceleration', 'agility'])
  })

  it('legacy: 옛 역할이 도움(가중치 2)으로 가진 능력치를 1:1로 대응하는 점유 시 역할에만 더한다(핵심은 빼고)', () => {
    const old = ROLES.find((each) => each.id === 'winger')!
    const helpful = Object.entries(old.weights).filter(([, weight]) => weight < 4).map(([attribute]) => attribute)
    const added = appAttributesOf('legacy', role({ key: ['crossing', 'dribbling', 'pace'] }))
    expect(added.length).toBeGreaterThan(0)
    for (const attribute of added) expect(helpful).toContain(attribute)
    expect(added).not.toContain('pace')
    // 대응하는 옛 역할이 없는 역할과 비점유 시 역할에는 더하지 않는다
    expect(appAttributesOf('legacy', role({ id: 'ip.Poacher', enumName: 'Poacher' }))).toEqual([])
    expect(appAttributesOf('legacy', role({ id: 'oop.OPWinger', enumName: 'Winger' }))).toEqual([])
  })

  it('옛 14역할이 모두 대응 표에 있고 서로 다른 역할로 간다', () => {
    expect(Object.keys(LEGACY_TARGETS).sort()).toEqual(ROLES.map((each) => each.id).sort())
    expect(new Set(Object.values(LEGACY_TARGETS)).size).toBe(ROLES.length)
  })
})

describe('초안 표와 이름 표', () => {
  it('초안은 게임에서 보지 못한 20개 칸 종류이고, 게임에서 본 아홉은 초안에 없다', () => {
    const seen = ['GK', 'DL', 'DR', 'DC.pair', 'DM.single', 'MC.pair', 'AML', 'AMR', 'ST.single']
    expect(Object.keys(DRAFT_KINDS).sort()).toEqual(ALL_KINDS.filter((kind) => !seen.includes(kind)).sort())
    for (const [kind, draft] of Object.entries(DRAFT_KINDS)) {
      expect(['inferred', 'unknown'], kind).toContain(draft.evidence)
      expect(draft.ip.length, kind).toBeGreaterThan(0)
      expect(draft.oop.length, kind).toBeGreaterThan(0)
      expect(Array.from(draft.note).length, `${kind}: 출처 메모`).toBeLessThanOrEqual(40)
      // 같은 역할이 한 목록에 둘 있지 않다
      expect(new Set(draft.ip).size, kind).toBe(draft.ip.length)
      expect(new Set(draft.oop).size, kind).toBe(draft.oop.length)
      // 점유 시 목록에는 비점유 시 이름이 없다
      for (const name of draft.ip) expect(name.startsWith('OP'), `${kind} ${name}`).toBe(false)
      for (const name of draft.oop) expect(name.startsWith('OP'), `${kind} ${name}`).toBe(true)
    }
  })

  it('능력치 이름 표는 37개이고, 앱 능력치 id가 겹치지 않는다', () => {
    expect(Object.keys(ATTRIBUTE_NAMES)).toHaveLength(37)
    expect(new Set(Object.values(ATTRIBUTE_NAMES)).size).toBe(37)
  })

  it('이름 없는 옛 역할의 이름은 10개이고 모두 있다', () => {
    expect(Object.keys(NAMELESS_ROLE_NAMES)).toHaveLength(10)
    for (const name of Object.values(NAMELESS_ROLE_NAMES)) expect(name.length).toBeGreaterThan(0)
  })
})

/**
 * 자료 파일을 원본 꼴(역할 목록 파일과 전술 자리 파일)로 되돌린다. 게임에서 본 전술의 11칸(같은 칸 종류는 같은 목록)을 만든다.
 * 이렇게 되돌린 원본에서 생성기가 같은 자료를 만들면, 자료 파일은 생성기의 출력이고 둘이 어긋나지 않았다는 뜻이다.
 */
function sourceFromData(data: Fm26Data): BuildSource {
  const nameOf = Object.fromEntries(Object.entries(data.attributeNames).map(([name, id]) => [id, name]))
  const idsAt = (kind: string, phase: 'ip' | 'oop'): { id: string }[] =>
    data.slotKinds[kind].filter((entry) => entry.evidence === 'game' && data.roles.find((role) => role.id === entry.roleId)!.phase === phase).map((entry) => ({ id: data.roles.find((role) => role.id === entry.roleId)!.gameId }))
  const CELLS: Array<{ kind: string; bits: number }> = [
    { kind: 'GK', bits: 1 },
    { kind: 'DR', bits: 4 },
    { kind: 'DC.pair', bits: 16 + 2097152 },
    { kind: 'DC.pair', bits: 16 + 1048576 },
    { kind: 'DL', bits: 8 },
    { kind: 'MC.pair', bits: 1024 + 2097152 },
    { kind: 'DM.single', bits: 128 },
    { kind: 'AMR', bits: 2048 },
    { kind: 'MC.pair', bits: 1024 + 1048576 },
    { kind: 'AML', bits: 4096 },
    { kind: 'ST.single', bits: 16384 }
  ]
  return {
    keyAttributes: {
      readAt: `${data.readAt}T00:00:00.000Z`,
      roles: data.roles.map((role) => ({ phase: role.phase, id: role.gameId, enumName: role.enumName, name: role.selectable ? role.name : null, short: role.short || null, keyAttributes: role.key.map((id) => nameOf[id]) }))
    },
    slots: [{ slots: CELLS.map(({ kind, bits }, index) => ({ index, ip: { position: bits, available: idsAt(kind, 'ip') }, oop: { position: bits, available: idsAt(kind, 'oop') } })) }]
  }
}

describe('생성기와 자료 파일', () => {
  CHECK_FILE('자료 파일을 원본 꼴로 되돌린 것에서 생성기가 같은 자료를 만든다(생성기와 자료 파일이 어긋나지 않았다)', () => {
    const source = sourceFromData(committed)
    expect(source.slots[0].slots).toHaveLength(11)
    expect(buildFm26Data(source, { appRule: COMMITTED_APP_RULE })).toEqual(committed)
  })

  CHECK_FILE('자료 파일의 글은 생성기가 쓰는 글과 같다(열쇠 차례와 줄 모양이 고정이라 다시 돌려도 바뀌지 않는다)', () => {
    const text = readFileSync(DATA_FILE, 'utf8')
    expect(formatFm26Data(committed)).toBe(text)
    expect(text.endsWith('}\n')).toBe(true)
    expect(text.includes('\r')).toBe(false)
    // 되돌려 읽으면 같은 자료다
    expect(JSON.parse(text)).toEqual(committed)
    // 역할 하나가 한 줄이다
    expect(text.split('\n').filter((line) => line.includes('"enumName"'))).toHaveLength(committed.roles.length)
  })

  it('글 만들기는 빈 목록과 표도 다룬다', () => {
    const empty: Fm26Data = { game: '0', readAt: '', appRule: 'none', attributeNames: {}, roles: [], slotKinds: {}, slotNotes: {}, defaultRoles: {}, legacyMap: {} }
    expect(JSON.parse(formatFm26Data(empty))).toEqual(empty)
  })

  it('원본에서 이름이 없는 새 역할이 오면 이름을 정하라고 던지고, 모르는 능력치 이름과 세이브 순서가 깨진 목록도 던진다', () => {
    const base = sourceFromData(committed)
    const change = (edit: (roles: BuildSource['keyAttributes']['roles']) => void): BuildSource => {
      const roles = base.keyAttributes.roles.map((role) => ({ ...role, keyAttributes: [...role.keyAttributes] }))
      edit(roles)
      return { ...base, keyAttributes: { ...base.keyAttributes, roles } }
    }
    expect(() => buildFm26Data(change((roles) => roles.push({ phase: 'ip', id: '123', enumName: 'NewRole', name: null, short: null, keyAttributes: [] })))).toThrow('NAMELESS_ROLE_NAMES')
    expect(() => buildFm26Data(change((roles) => roles[0].keyAttributes.push('없는 능력치')))).toThrow('모르는 능력치 이름')
    expect(() => buildFm26Data(change((roles) => roles[3].keyAttributes.reverse()))).toThrow('세이브 순서')
    expect(() => buildFm26Data(change((roles) => roles.push({ ...roles[0] })))).toThrow('겹칩니다')
    // 새 역할이 이름을 가지고 오면 어느 칸 종류에도 없어서 던진다(칸 종류에 놓아야 한다)
    expect(() => buildFm26Data(change((roles) => roles.push({ phase: 'ip', id: '123', enumName: 'NewRole', name: '새 역할', short: null, keyAttributes: ['패스'] })))).toThrow('어느 칸 종류의 목록에도 없습니다')
  })

  it('게임에서 읽은 목록이 비어 있으면 던진다(고를 수 있는 역할이 없는 칸은 없다)', () => {
    const base = sourceFromData(committed)
    // 인덱스 6은 DM.single 칸이다
    const emptied: BuildSource = { ...base, slots: [{ slots: base.slots[0].slots.map((slot) => ({ ...slot, oop: { ...slot.oop, available: slot.index === 6 ? [] : slot.oop.available } })) }] }
    expect(() => buildFm26Data(emptied)).toThrow('DM.single oop')
  })

  it('옛 방식 역할이 게임의 역할 목록에 나오면 그 역할은 고를 수 있는 역할이 되고 그 칸 종류의 포지션이 붙는다(사용자 확인 7번이 어긋났을 때)', () => {
    const base = sourceFromData(committed)
    const regista = committed.roles.find((role) => role.id === 'ip.Regista')!
    expect(regista.selectable).toBe(false)
    // 인덱스 5와 8은 MC.pair 칸이다(같은 칸 종류는 목록이 같아야 한다)
    const withRegista: BuildSource = {
      ...base,
      slots: [{ slots: base.slots[0].slots.map((slot) => ({ ...slot, ip: { ...slot.ip, available: slot.index === 5 || slot.index === 8 ? [...slot.ip.available, { id: regista.gameId }] : slot.ip.available } })) }]
    }
    const built = buildFm26Data(withRegista)
    expect(built.roles.find((role) => role.id === 'ip.Regista')!.selectable).toBe(true)
    expect(built.slotKinds['MC.pair'].map((entry) => entry.roleId)).toContain('ip.Regista')
    expect(built.slotKinds['MC.pair'].find((entry) => entry.roleId === 'ip.Regista')!.evidence).toBe('game')
    // 고를 수 있게 된 역할은 앱 추가 규칙도 따른다
    expect(built.roles.find((role) => role.id === 'ip.Regista')!.app).toEqual(appAttributesOf(COMMITTED_APP_RULE, { id: 'ip.Regista', enumName: 'Regista', goalkeeper: false, key: regista.key }))
    // 다른 역할은 그대로다
    expect(built.roles.filter((role) => !role.selectable)).toHaveLength(9)
  })

  CHECK_FILE('게임에서 읽은 칸 종류는 목록이 게임 번호 순이고 근거가 game, 초안 칸 종류는 초안의 근거와 출처 메모가 붙는다', () => {
    for (const kind of ALL_KINDS) {
      const draft = DRAFT_KINDS[kind]
      for (const entry of committed.slotKinds[kind]) expect(entry.evidence, `${kind} ${entry.roleId}`).toBe(draft ? draft.evidence : 'game')
      expect(committed.slotNotes[kind], kind).toBe(draft ? draft.note : NOTE_GAME)
    }
  })

  CHECK_FILE('옛 14역할 대응 표는 생성기의 표 그대로다', () => {
    for (const [oldId, target] of Object.entries(LEGACY_TARGETS)) expect(committed.legacyMap[oldId]).toEqual({ to: `ip.${target}`, oneToOne: true })
  })
})

describe('1군 별점 표와 견주기(checkStarTables)', () => {
  // 지어낸 자료: 포지션 둘, 점유 시 역할 셋
  const data = {
    roles: [
      { id: 'ip.A', phase: 'ip', gameId: '1', selectable: true },
      { id: 'ip.B', phase: 'ip', gameId: '2', selectable: true },
      { id: 'ip.Old', phase: 'ip', gameId: '4', selectable: false },
      { id: 'oop.C', phase: 'oop', gameId: '1', selectable: true }
    ],
    slotKinds: {
      DM: [{ roleId: 'ip.A', evidence: 'game' }],
      'MC.pair': [{ roleId: 'ip.B', evidence: 'game' }, { roleId: 'oop.C', evidence: 'game' }]
    }
  } as unknown as Fm26Data
  const stars = (rows: Array<{ positions: Record<string, number>; ip: string[]; oop: string[] }>): ParsedStars => ({ players: rows.map((row) => ({ positions: row.positions, ip: row.ip.map((id) => ({ id })), oop: row.oop.map((id) => ({ id })) })) })

  it('표에 있는 역할은 선수가 뛸 수 있는 포지션에, 표에 없는 역할은 뛸 수 없는 포지션에 있어야 한다', () => {
    expect(checkStarTables(data, stars([{ positions: { DM: 15, 'M (C)': 3 }, ip: ['1'], oop: [] }]))).toEqual([])
    expect(checkStarTables(data, stars([{ positions: { DM: 15, 'M (C)': 14 }, ip: ['1', '2'], oop: ['1'] }]))).toEqual([])
  })

  it('어긋나면 선수 이름 없이 순번으로 알린다', () => {
    const lacking = checkStarTables(data, stars([{ positions: { DM: 15 }, ip: [], oop: [] }]))
    expect(lacking).toEqual(['선수 0: ip.A가 표에 없는데 자료의 포지션(DM)을 뛸 수 있습니다.'])
    const extra = checkStarTables(data, stars([{ positions: { DM: 15 }, ip: ['1', '2'], oop: [] }]))
    expect(extra).toEqual(['선수 0: ip.B가 표에 있는데 자료의 포지션(MC)을 뛸 수 없습니다.'])
    expect(checkStarTables(data, stars([{ positions: { DM: 15 }, ip: ['1', '4'], oop: [] }])).join()).toContain('고를 수 없는 역할 ip.Old')
    expect(checkStarTables(data, stars([{ positions: { DM: 15 }, ip: ['1', '99'], oop: [] }])).join()).toContain('역할 번호 99가 자료에 없습니다')
  })

  it('숙련이 기준 미만인 포지션은 뛸 수 없는 것으로 본다(기준을 바꿀 수 있다)', () => {
    const player = stars([{ positions: { DM: 15, 'M (C)': 10 }, ip: ['1'], oop: [] }])
    expect(checkStarTables(data, player)).toEqual([])
    expect(checkStarTables(data, player, 9).join()).toContain('ip.B가 표에 없는데')
  })
})

describe('포지션별 역할 표와 견주기(checkPositionTables)', () => {
  // 지어낸 자료: 점유 시 역할 둘(하나는 고를 수 없음), 비점유 시 역할 하나. 번호 1은 점유 시와 비점유 시에 따로 있다
  const data = {
    roles: [
      { id: 'ip.A', phase: 'ip', gameId: '1', name: '가', short: 'A', selectable: true },
      { id: 'ip.B', phase: 'ip', gameId: '2', name: '나', short: 'B', selectable: true },
      { id: 'ip.Old', phase: 'ip', gameId: '4', name: '옛', short: '', selectable: false },
      { id: 'oop.C', phase: 'oop', gameId: '1', name: '다', short: 'C', selectable: true }
    ],
    slotKinds: {
      DM: [{ roleId: 'ip.A', evidence: 'game' }],
      'MC.pair': [{ roleId: 'ip.B', evidence: 'game' }, { roleId: 'oop.C', evidence: 'game' }]
    }
  } as unknown as Fm26Data
  type Row = { id: string; short?: string; name?: string }
  const A: Row = { id: '1', short: 'A', name: '가' }
  const B: Row = { id: '2', short: 'B', name: '나' }
  const C: Row = { id: '1', short: 'C', name: '다' }
  /** 포지션 14개가 모두 있는 표. 자료와 같은 DM·MC 말고는 빈 목록이다 */
  const table = (edit: Record<string, { ip: Row[]; oop: Row[] }> = {}): ParsedPositionTable => ({
    positions: { ...Object.fromEntries(POSITION_ORDER.map((position) => [position, { ip: [], oop: [] }])), DM: { ip: [A], oop: [] }, MC: { ip: [B], oop: [C] }, ...edit }
  })

  it('역할의 포지션이 게임 표와 같으면 문제가 없다(번호는 국면마다 따로 센다)', () => {
    expect(checkPositionTables(data, table())).toEqual([])
  })

  it('자료에만 있는 역할, 게임 표에만 있는 역할, 고를 수 없는 역할, 다른 이름, 빠진 포지션을 알린다', () => {
    expect(checkPositionTables(data, table({ DM: { ip: [], oop: [] } }))).toEqual(['DM ip: ip.A가 자료에만 있습니다(게임 표에 없음).'])
    expect(checkPositionTables(data, table({ MC: { ip: [B], oop: [] } }))).toEqual(['MC oop: oop.C가 자료에만 있습니다(게임 표에 없음).'])
    expect(checkPositionTables(data, table({ DM: { ip: [A, { id: '99' }], oop: [] } }))).toEqual(['DM ip: 게임 표의 역할 번호 99가 자료에 없습니다.'])
    expect(checkPositionTables(data, table({ DM: { ip: [A, B], oop: [] } }))).toEqual(['DM ip: ip.B가 게임 표에는 있는데 자료는 이 포지션에서 고를 수 없게 되어 있습니다.'])
    expect(checkPositionTables(data, table({ DM: { ip: [A, { id: '4' }], oop: [] } }))).toEqual(['DM ip: ip.Old가 게임 표에는 있는데 자료는 이 포지션에서 고를 수 없게 되어 있습니다.'])
    expect(checkPositionTables(data, table({ MC: { ip: [{ ...B, name: '다른 이름' }], oop: [C] } }))).toEqual(['MC ip: ip.B의 이름이나 짧은 이름이 게임 표와 다릅니다.'])
    expect(checkPositionTables(data, table({ MC: { ip: [B], oop: [{ ...C, short: 'X' }] } }))).toEqual(['MC oop: oop.C의 이름이나 짧은 이름이 게임 표와 다릅니다.'])
    // 이름을 주지 않은 줄은 이름을 견주지 않는다
    expect(checkPositionTables(data, table({ DM: { ip: [{ id: '1' }], oop: [] } }))).toEqual([])
    const missing = table()
    delete (missing.positions as Record<string, unknown>).ST
    expect(checkPositionTables(data, missing)).toEqual(['ST: 게임 표에 이 포지션이 없습니다.'])
  })
})

describe.skipIf(!SOURCE && !WRITE)('원본으로 만들기(FMB_CATALOG_SOURCE)', () => {
  const dir = SOURCE ?? ''
  const read = (name: string): unknown => JSON.parse(readFileSync(join(dir, name), 'utf8'))
  const slotNames = (): string[] => (dir && existsSync(dir) ? readdirSync(dir).filter((name) => /^role-slots.*\.json$/.test(name)).sort() : [])

  function readSource(): { source: BuildSource; stars: ParsedStars | null; privateText: string[] } {
    const keyRaw = read('role-key-attributes.json') as { roles: Array<{ help?: unknown }> }
    const slotRaws = slotNames().map((name) => read(name) as { slots: Array<{ player?: unknown }> })
    const starsRaw = existsSync(join(dir, 'role-stars.json')) ? (read('role-stars.json') as { players: Array<{ name?: unknown }> }) : null
    // 자료에 있으면 안 되는 글(선수 이름, 역할 설명 글). 읽어서 쓰지 않고 자료에 없다는 것만 확인하는 데 쓴다
    const privateText: string[] = []
    for (const file of slotRaws) for (const slot of file.slots) if (typeof slot.player === 'string') privateText.push(slot.player)
    for (const player of starsRaw?.players ?? []) if (typeof player.name === 'string') privateText.push(player.name)
    for (const role of keyRaw.roles) if (typeof role.help === 'string') privateText.push(role.help.slice(0, 16))
    return {
      source: { keyAttributes: parseKeyAttributes(keyRaw), slots: slotRaws.map((file) => parseSlots(file)) },
      stars: starsRaw ? parseStars(starsRaw) : null,
      privateText: privateText.filter((text) => Array.from(text).length >= 3)
    }
  }

  it('원본이 있다(FMB_CATALOG_WRITE=1에는 FMB_CATALOG_SOURCE가 꼭 있어야 한다)', () => {
    expect(SOURCE, 'FMB_CATALOG_SOURCE에 review-notes/ingame의 경로를 적는다').toBeTruthy()
    expect(existsSync(join(dir, 'role-key-attributes.json'))).toBe(true)
    expect(slotNames().length, 'role-slots*.json').toBeGreaterThan(0)
  })

  it.skipIf(!SOURCE)('원본에서 만든 자료가 자료 파일과 같다(FMB_CATALOG_WRITE=1이면 새로 쓴다)', () => {
    const text = formatFm26Data(buildFm26Data(readSource().source))
    if (WRITE) {
      writeFileSync(DATA_FILE, text)
      expect(readFileSync(DATA_FILE, 'utf8')).toBe(text)
      return
    }
    expect(text, '자료 파일이 원본에서 만든 것과 다릅니다. `npm run catalog:build`로 다시 만들고 바뀐 곳을 확인한다').toBe(readFileSync(DATA_FILE, 'utf8'))
  })

  it.skipIf(!SOURCE)('1군 별점 표와 어긋나는 포지션이 없다', () => {
    const { source, stars } = readSource()
    if (!stars) return
    expect(checkStarTables(buildFm26Data(source), stars)).toEqual([])
  })

  it.skipIf(!SOURCE)('게임에서 읽은 포지션별 역할 표(role-by-position.json)와 어긋나는 포지션이 없다', () => {
    if (!existsSync(join(dir, 'role-by-position.json'))) return
    expect(checkPositionTables(buildFm26Data(readSource().source), parsePositionTable(read('role-by-position.json')))).toEqual([])
  })

  it.skipIf(!SOURCE)('자료 파일에 선수 이름과 역할 설명 글이 없다', () => {
    const { privateText } = readSource()
    expect(privateText.length).toBeGreaterThan(0)
    const text = readFileSync(DATA_FILE, 'utf8')
    for (const each of privateText) expect(text.includes(each), '자료에 있으면 안 되는 글').toBe(false)
  })
})
