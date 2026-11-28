/**
 * FM26 역할 카탈로그(2단계 U4): 자료(src/shared/data/fm26-roles.json)와 그것으로 만든 카탈로그가 계약과 계획의 받아들이는 조건을 지키는지.
 * 자료는 생성기(tests/catalogBuild.test.ts)가 켜진 게임에서 읽은 원본으로 만든 것이다. 원본이 없어도 이 시험은 돈다
 * (게임에서 본 칸의 목록은 아래에 박아 둔 기대 목록으로 본다). 환경 변수 FMB_CATALOG_SOURCE로 원본 폴더를 주면 원본과도 견준다.
 *
 * 앱 추가 능력치처럼 리드가 고를 규칙에 따라 달라지는 시험은 "앱 추가 능력치" 묶음 한 곳에 모아 두었다(규칙은 tests/helpers/catalogBuild.ts의 COMMITTED_APP_RULE).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFm26Catalog, FM26_CATALOG, type Fm26Data } from '../src/shared/catalogFm26'
import raw from '../src/shared/data/fm26-roles.json'
import { K, withLedger } from '../src/shared/ledger'
import { ROLE_WEIGHT_MAX } from '../src/shared/limits'
import { prepareProfile, profileSpec, profileWeights, referenceSpec, weightEntries, withCustomRoles, type CustomRole, type RoleCatalog } from '../src/shared/roleCatalog'
import { DEFAULT_ROLE, ROLES, savedRoleScore, type PositionKey } from '../src/shared/roles'
import type { Phase, SlotProfile } from '../src/shared/slotProfile'
import { PRESET_IDS, presetTactic, slotKindOf, validateTactic } from '../src/shared/tacticModel'
import { SAVE_ATTRIBUTE_ORDER } from '../src/shared/world'
import { catalogContract, kindsOf } from './helpers/catalogContract'
import {
  ALL_KINDS,
  appAttributesOf,
  COMMITTED_APP_RULE,
  DRAFT_KINDS,
  LEGACY_TARGETS,
  NAMELESS_ROLE_NAMES,
  observedKinds,
  parseKeyAttributes,
  parseSlots
} from './helpers/catalogBuild'

const data = raw as unknown as Fm26Data
const catalog = FM26_CATALOG
const POSITIONS = Object.keys(DEFAULT_ROLE) as PositionKey[]
const PHASES: Phase[] = ['ip', 'oop']

catalogContract(catalog)

/** 게임에서 역할 목록을 읽은 칸 종류와 그 목록(게임이 보여 준 이름. 국면마다 게임 번호 오름차순이고 점유 시가 먼저). 시험에 박은 기대 목록이다 */
const OBSERVED: Record<string, { ip: string[]; oop: string[] }> = {
  GK: { ip: ['골키퍼', '볼 플레잉 골키퍼', '안정형 골키퍼'], oop: ['골키퍼', '스위퍼 키퍼', '라인 홀딩 골키퍼'] },
  DL: { ip: ['풀백', '윙백', '인사이드 윙백', '인사이드 풀백', '플레이메이킹 윙백'], oop: ['풀백', '압박형 풀백', '홀딩 풀백'] },
  DR: { ip: ['풀백', '윙백', '인사이드 윙백', '인사이드 풀백', '플레이메이킹 윙백'], oop: ['풀백', '압박형 풀백', '홀딩 풀백'] },
  'DC.pair': { ip: ['센터백', '전진형 센터백', '볼 플레잉 센터백', '안정형 센터백'], oop: ['센터백', '스토핑 센터백', '커버링 센터백'] },
  'DM.single': { ip: ['수비형 미드필더', '딥라잉 플레이메이커', '하프백'], oop: ['수비형 미드필더', '드롭핑 수비형 미드필더', '스크리닝 수비형 미드필더'] },
  'MC.pair': {
    ip: ['중앙 미드필더', '공격형 미드필더', '전진형 플레이메이커', '와이드 중앙 미드필더', '채널 미드필더', '미드필드 플레이메이커'],
    oop: ['중앙 미드필더', '압박형 중앙 미드필더', '스크리닝 중앙 미드필더', '와이드 커버링 중앙 미드필더']
  },
  AML: { ip: ['윙어', '인사이드 포워드', '플레이메이킹 윙어', '와이드 포워드', '인사이드 윙어'], oop: ['윙어', '추적형 윙어', '인사이드 지향 윙어', '측면 지향 윙어'] },
  AMR: { ip: ['윙어', '인사이드 포워드', '플레이메이킹 윙어', '와이드 포워드', '인사이드 윙어'], oop: ['윙어', '추적형 윙어', '인사이드 지향 윙어', '측면 지향 윙어'] },
  'ST.single': { ip: ['딥라잉 포워드', '센터 포워드', '타겟 포워드', '포처', '채널 포워드', '폴스 나인'], oop: ['센터 포워드', '추적형 센터 포워드', '중앙 지향 센터 포워드'] }
}

/** FM24식 옛 역할 10개(게임이 이름을 주지 않았고 어느 목록에도 나오지 않은 역할) */
const OLD_STYLE = ['ip.NoNonsenseFullBack', 'ip.BalWinningMidfielder', 'ip.AnchorMan', 'ip.Enganche', 'ip.Regista', 'ip.Mezzala', 'ip.SegundoVolante', 'ip.DefensiveWinger', 'ip.WideTargetMan', 'ip.CompleteForward']

const names = (kind: string, phase: Phase): string[] => catalog.choicesAt(kindPositionOf(kind), phase, kind).map((choice) => catalog.role(choice.roleId)!.label)
const kindPositionOf = (kind: string): PositionKey => kind.split('.')[0] as PositionKey
const ids = (position: PositionKey, phase: Phase, kind: string): string[] => catalog.choicesAt(position, phase, kind).map((choice) => choice.roleId)

describe('자료 파일: 역할 89개', () => {
  it('점유 시 50개, 비점유 시 39개이고, 고를 수 있는 것은 40개와 39개다', () => {
    expect(data.game).toBe('26.3.2')
    expect(data.readAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(data.roles).toHaveLength(89)
    expect(data.roles.filter((role) => role.phase === 'ip')).toHaveLength(50)
    expect(data.roles.filter((role) => role.phase === 'oop')).toHaveLength(39)
    expect(data.roles.filter((role) => role.phase === 'ip' && role.selectable)).toHaveLength(40)
    expect(data.roles.filter((role) => role.phase === 'oop' && role.selectable)).toHaveLength(39)
    expect(catalog.roles).toHaveLength(89)
    expect(catalog.roles.filter((role) => role.selectable)).toHaveLength(79)
    expect(catalog.dataVersion).toBe('26.3.2')
  })

  it('고를 수 없는 것은 FM24식 옛 역할 10개뿐이고, 이름은 있고 어느 칸에도 없다', () => {
    expect(data.roles.filter((role) => !role.selectable).map((role) => role.id).sort()).toEqual([...OLD_STYLE].sort())
    expect(OLD_STYLE.map((id) => id.replace('ip.', '')).sort()).toEqual(Object.keys(NAMELESS_ROLE_NAMES).sort())
    for (const id of OLD_STYLE) {
      const role = catalog.role(id)!
      expect(role.selectable).toBe(false)
      expect(role.label.length, id).toBeGreaterThan(0)
      expect([...role.positions], id).toEqual([])
      for (const position of POSITIONS) for (const phase of PHASES) for (const kind of kindsOf(position)) expect(ids(position, phase, kind), `${position} ${kind}`).not.toContain(id)
    }
  })

  it('역할 번호는 국면 이름과 열거형 이름이고, (국면, 게임 번호)가 겹치지 않으며, 게임 번호는 10진 글자다', () => {
    const seen = new Set<string>()
    for (const role of data.roles) {
      expect(role.id).toBe(`${role.phase}.${role.enumName}`)
      expect(role.gameId).toMatch(/^[1-9]\d*$/)
      expect(seen.has(`${role.phase}:${role.gameId}`), `겹침 ${role.id}`).toBe(false)
      seen.add(`${role.phase}:${role.gameId}`)
      // 비점유 시 열거형 이름은 OP로 시작한다
      expect(role.enumName.startsWith('OP'), role.id).toBe(role.phase === 'oop')
    }
    // 64비트 값이라 숫자로 바꾸면 틀린다: 2^53을 넘는 번호가 있어도 글자로 찾는다
    const big = data.roles.filter((role) => BigInt(role.gameId) > BigInt(Number.MAX_SAFE_INTEGER))
    expect(big.length).toBeGreaterThan(0)
    for (const role of big) expect(catalog.roleByGameId(role.phase, role.gameId), role.id).toBe(catalog.role(role.id))
    // 같은 번호가 두 국면에 있어도 국면으로 가른다(1은 점유 시 골키퍼이고 비점유 시에도 골키퍼, 2는 점유 시 센터백과 비점유 시 스위퍼 키퍼)
    expect(catalog.roleByGameId('ip', '2')?.id).toBe('ip.CentralDefender')
    expect(catalog.roleByGameId('oop', '2')?.id).toBe('oop.OPSweeperKeeper')
    expect(catalog.roleByGameId('ip', '123456')).toBeUndefined()
  })

  it('능력치 목록: 모두 세이브의 능력치이고, 핵심은 세이브 순서로 엄격히 늘어나며, 앱 추가와 겹치지 않는다', () => {
    const at = new Map<string, number>(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))
    for (const role of data.roles) {
      expect(role.key.length, role.id).toBeGreaterThan(0)
      for (const list of [role.key, role.app]) {
        for (const id of list) expect(at.has(id), `${role.id} ${id}`).toBe(true)
        list.forEach((id, i) => {
          if (i > 0) expect(at.get(id)!, `${role.id}: ${list[i - 1]} 다음 ${id}`).toBeGreaterThan(at.get(list[i - 1])!)
        })
      }
      for (const id of role.app) expect(role.key, `${role.id}: 핵심과 앱 추가가 겹침`).not.toContain(id)
    }
  })

  it('능력치 이름 표는 37개이고, 핵심 능력치가 가리키는 능력치가 모두 이 표에 있다', () => {
    expect(Object.keys(data.attributeNames)).toHaveLength(37)
    const named = new Set(Object.values(data.attributeNames))
    expect(named.size).toBe(37)
    for (const role of data.roles) for (const id of role.key) expect(named.has(id), `${role.id} ${id}`).toBe(true)
  })

  it('역할마다 이름과 짧은 이름이 있고(옛 역할 10개는 짧은 이름이 없을 수 있다), 이름은 국면 안에서 겹치지 않는다', () => {
    for (const phase of PHASES) {
      const labels = data.roles.filter((role) => role.phase === phase).map((role) => role.name)
      expect(new Set(labels).size, `${phase}: 이름 겹침`).toBe(labels.length)
    }
    for (const role of data.roles) {
      expect(role.name.length, role.id).toBeGreaterThan(0)
      if (role.selectable) expect(role.short.length, role.id).toBeGreaterThan(0)
    }
  })
})

describe('자료 파일: 개인 정보와 게임 설명 글이 없다(공개 저장소)', () => {
  const text = readFileSync(join(__dirname, '..', 'src', 'shared', 'data', 'fm26-roles.json'), 'utf8')

  it('설명 글 열쇠가 없고, 40자를 넘는 글자가 없다', () => {
    const visit = (value: unknown, path: string): void => {
      if (typeof value === 'string') {
        expect(Array.from(value).length, `${path}: 글자가 너무 김`).toBeLessThanOrEqual(40)
      } else if (Array.isArray(value)) {
        value.forEach((each, i) => visit(each, `${path}[${i}]`))
      } else if (value && typeof value === 'object') {
        for (const [key, each] of Object.entries(value)) {
          expect(key, `${path}: 설명 글 열쇠`).not.toMatch(/help|desc|text|note[^s]|detail|summary/i)
          visit(each, `${path}.${key}`)
        }
      }
    }
    visit(data, '자료')
  })

  it('열쇠는 정해진 것뿐이다(선수나 구단 같은 칸이 끼어들지 않았다)', () => {
    expect(Object.keys(data)).toEqual(['game', 'readAt', 'appRule', 'attributeNames', 'roles', 'slotKinds', 'slotNotes', 'defaultRoles', 'legacyMap'])
    for (const role of data.roles) expect(Object.keys(role), role.id).toEqual(['id', 'phase', 'gameId', 'enumName', 'name', 'short', 'selectable', 'key', 'app'])
    for (const [kind, entries] of Object.entries(data.slotKinds)) for (const entry of entries) expect(Object.keys(entry), kind).toEqual(['roleId', 'evidence'])
  })

  it('경로, 이메일, 계정 이름처럼 보이는 글이 없다', () => {
    expect(text).not.toMatch(/[A-Za-z]:[\\/]|\\\\|@|\.fm\b|\.json"/)
    expect(text).not.toMatch(/https?:/i)
  })

  it('출처 메모는 사이트 이름뿐이고(주소 없이), 모두 40자 안이다', () => {
    for (const [kind, note] of Object.entries(data.slotNotes)) {
      expect(note.length, kind).toBeGreaterThan(0)
      expect(Array.from(note).length, kind).toBeLessThanOrEqual(40)
    }
    expect(new Set(Object.values(data.slotNotes))).toEqual(new Set(['게임 역할 목록에서 읽음', '1군 별점 표, fmscout.com, realsport101.com', '1군 별점 표에서 짐작', '역할 이름으로 짠 초안']))
  })
})

describe('칸에서 고를 수 있는 역할', () => {
  it('칸 종류 29개 모두 두 국면의 목록, 기본 역할, 출처 메모가 있다', () => {
    expect(Object.keys(data.slotKinds)).toEqual([...ALL_KINDS])
    expect(Object.keys(data.slotNotes)).toEqual([...ALL_KINDS])
    expect(Object.keys(data.defaultRoles)).toEqual([...ALL_KINDS])
    for (const kind of ALL_KINDS) {
      const position = kindPositionOf(kind)
      for (const phase of PHASES) {
        const choices = catalog.choicesAt(position, phase, kind)
        expect(choices.length, `${kind} ${phase}`).toBeGreaterThan(0)
        const first = choices.map((choice) => choice.roleId)
        expect(first, `${kind} ${phase}: 게임 번호 오름차순`).toEqual([...first].sort((a, b) => (BigInt(catalog.role(a)!.gameId!) < BigInt(catalog.role(b)!.gameId!) ? -1 : 1)))
        expect(first).toContain(catalog.defaultRole(position, phase, kind))
      }
    }
  })

  it('게임에서 본 칸 아홉(11칸)의 목록이 게임이 보여 준 것과 같다(이름과 차례까지), 근거는 모두 game이다', () => {
    for (const [kind, expected] of Object.entries(OBSERVED)) {
      expect(names(kind, 'ip'), `${kind} 점유 시`).toEqual(expected.ip)
      expect(names(kind, 'oop'), `${kind} 비점유 시`).toEqual(expected.oop)
      for (const phase of PHASES) for (const choice of catalog.choicesAt(kindPositionOf(kind), phase, kind)) expect(choice.evidence, `${kind} ${choice.roleId}`).toBe('game')
    }
    // 게임에서 본 전술 하나의 11칸은 칸 종류 아홉이다: DC.pair와 MC.pair가 두 번씩
    expect(Object.keys(OBSERVED)).toHaveLength(9)
  })

  it('원본이 있으면 원본의 role-slots.json과 같다(FMB_CATALOG_SOURCE)', () => {
    const dir = process.env.FMB_CATALOG_SOURCE
    if (!dir || !existsSync(dir)) return
    const keyAttributes = parseKeyAttributes(JSON.parse(readFileSync(join(dir, 'role-key-attributes.json'), 'utf8')))
    const files = readdirSync(dir).filter((name) => /^role-slots.*\.json$/.test(name))
    expect(files.length).toBeGreaterThan(0)
    const roleOf = (phase: Phase, gameId: string): { id: string; phase: Phase; gameId: string } | undefined => {
      const found = keyAttributes.roles.find((role) => role.phase === phase && role.id === gameId)
      return found ? { id: `${found.phase}.${found.enumName}`, phase, gameId } : undefined
    }
    const seen = observedKinds(files.map((name) => parseSlots(JSON.parse(readFileSync(join(dir, name), 'utf8')))), roleOf)
    // 원본이 늘어 칸 종류가 더 보이면 자료에서 그 칸 종류가 game이어야 한다. 지금은 아홉이다
    expect([...seen.keys()].sort()).toEqual(Object.keys(OBSERVED).sort())
    for (const [kind, lists] of seen) {
      for (const phase of PHASES) expect(ids(kindPositionOf(kind), phase, kind), `${kind} ${phase}`).toEqual(lists[phase])
    }
  })

  it('게임에서 보지 못한 칸 종류의 근거는 inferred 또는 unknown이고, 초안 표와 같다', () => {
    for (const kind of ALL_KINDS) {
      const draft = DRAFT_KINDS[kind]
      const evidence = new Set(catalog.choicesAt(kindPositionOf(kind), 'ip', kind).concat(catalog.choicesAt(kindPositionOf(kind), 'oop', kind)).map((choice) => choice.evidence))
      expect([...evidence], kind).toEqual([draft ? draft.evidence : 'game'])
    }
    // 화면이 "게임에서 확인 전"을 붙일 칸: 게임에서 본 것이 아닌 것 20개
    expect(ALL_KINDS.filter((kind) => DRAFT_KINDS[kind])).toHaveLength(20)
  })

  it('역할이 고를 수 있는 포지션은 그 역할이 든 칸 종류의 포지션이다(1군 별점 표에서 알아낸 구조)', () => {
    const positionsOf = (id: string): string[] => [...catalog.role(id)!.positions]
    expect(positionsOf('ip.Goalkeeper')).toEqual(['GK'])
    expect(positionsOf('oop.OPSweeperKeeper')).toEqual(['GK'])
    expect(positionsOf('ip.FullBack')).toEqual(['DL', 'DR'])
    expect(positionsOf('ip.AdvancedWingBack')).toEqual(['WBL', 'WBR'])
    expect(positionsOf('ip.WingBack')).toEqual(['DL', 'DR', 'WBL', 'WBR'])
    expect(positionsOf('oop.OPWingBack')).toEqual(['WBL', 'WBR'])
    expect(positionsOf('ip.WideCentreBack')).toEqual(['DC'])
    expect(positionsOf('oop.OPCoveringWideCentreBack')).toEqual(['DC'])
    // 박스 투 박스 계열은 중앙 미드가 아니라 수비형 미드의 역할이다
    expect(positionsOf('ip.BoxToBoxMidfielder')).toEqual(['DM'])
    expect(positionsOf('ip.BoxToBoxPlaymaker')).toEqual(['DM'])
    expect(positionsOf('oop.OPPressingDefensiveMidfielder')).toEqual(['DM'])
    expect(positionsOf('ip.CentralMidfielder')).toEqual(['MC'])
    expect(positionsOf('ip.AttackingMidfielder')).toEqual(['MC', 'AMC'])
    expect(positionsOf('ip.WideMidfielder')).toEqual(['ML', 'MR'])
    expect(positionsOf('ip.Winger')).toEqual(['ML', 'MR', 'AML', 'AMR'])
    expect(positionsOf('ip.InsideForward')).toEqual(['AML', 'AMR'])
    expect(positionsOf('ip.Trequartista')).toEqual(['AMC'])
    expect(positionsOf('ip.ShadowStriker')).toEqual(['AMC'])
    expect(positionsOf('ip.TargetMan')).toEqual(['ST'])
    expect(positionsOf('oop.OPSplittingOutletCentreForward')).toEqual(['ST'])
  })

  it('칸 종류마다 차이가 나는 곳: 와이드 센터백은 수비 셋 바깥 칸, 박스 투 박스는 수비형 미드 둘, 분리 지향 센터 포워드는 최전방 둘', () => {
    expect(ids('DC', 'ip', 'DC.pair')).not.toContain('ip.WideCentreBack')
    expect(ids('DC', 'ip', 'DC.trio.side')).toEqual(expect.arrayContaining(['ip.WideCentreBack', 'ip.OverlappingCentreBack']))
    expect(ids('DC', 'ip', 'DC.trio.centre')).not.toContain('ip.WideCentreBack')
    expect(ids('DC', 'oop', 'DC.trio.side')).toEqual(expect.arrayContaining(['oop.OPWideCentreBack', 'oop.OPStoppingWideCentreBack', 'oop.OPCoveringWideCentreBack']))
    expect(ids('DM', 'ip', 'DM.single')).not.toContain('ip.BoxToBoxMidfielder')
    expect(ids('DM', 'ip', 'DM.pair')).toEqual(expect.arrayContaining(['ip.BoxToBoxMidfielder', 'ip.BoxToBoxPlaymaker']))
    expect(ids('DM', 'oop', 'DM.pair')).toEqual(expect.arrayContaining(['oop.OPPressingDefensiveMidfielder', 'oop.OPWideCoverDefensiveMidfielder']))
    expect(ids('ST', 'oop', 'ST.single')).not.toContain('oop.OPSplittingOutletCentreForward')
    expect(ids('ST', 'oop', 'ST.pair')).toContain('oop.OPSplittingOutletCentreForward')
    // 중앙 미드에는 박스 투 박스가 없다(좌우가 붙은 둘 자리에서 본 것과 1군 표가 같다)
    for (const kind of kindsOf('MC')) expect(ids('MC', 'ip', kind), kind).not.toContain('ip.BoxToBoxMidfielder')
  })

  it('고를 수 있는 모든 역할이 어느 칸 종류에는 있다(점유 시 40개, 비점유 시 39개가 빠짐없이)', () => {
    for (const phase of PHASES) {
      const offered = new Set<string>()
      for (const position of POSITIONS) for (const kind of kindsOf(position)) for (const id of ids(position, phase, kind)) offered.add(id)
      expect(offered.size, phase).toBe(phase === 'ip' ? 40 : 39)
      for (const role of catalog.roles.filter((each) => each.phase === phase && each.selectable)) expect(offered.has(role.id), role.id).toBe(true)
    }
  })

  it('기본 역할: 포지션마다 옛 기본 역할의 대응 역할이고, 그 칸에서 고를 수 없으면 그 포지션의 일반 역할이다(계획 부록 C)', () => {
    const expected: Record<PositionKey, [string, string]> = {
      GK: ['ip.Goalkeeper', 'oop.OPGoalkeeper'],
      DL: ['ip.FullBack', 'oop.OPFullBack'],
      DC: ['ip.CentralDefender', 'oop.OPCentreBack'],
      DR: ['ip.FullBack', 'oop.OPFullBack'],
      WBL: ['ip.WingBack', 'oop.OPWingBack'],
      WBR: ['ip.WingBack', 'oop.OPWingBack'],
      DM: ['ip.DefensiveMidfielder', 'oop.OPDefensiveMidfielder'],
      ML: ['ip.Winger', 'oop.OPWideMidfielder'],
      MC: ['ip.CentralMidfielder', 'oop.OPCentralMidfielder'],
      MR: ['ip.Winger', 'oop.OPWideMidfielder'],
      AML: ['ip.InsideForward', 'oop.OPWinger'],
      AMC: ['ip.AttackingMidfielder', 'oop.OPAtackingMidfielder'],
      AMR: ['ip.InsideForward', 'oop.OPWinger'],
      ST: ['ip.CentreForward', 'oop.OPCentreForward']
    }
    for (const position of POSITIONS) {
      for (const kind of kindsOf(position)) {
        expect(catalog.defaultRole(position, 'ip', kind), `${kind} 점유 시`).toBe(expected[position][0])
        expect(catalog.defaultRole(position, 'oop', kind), `${kind} 비점유 시`).toBe(expected[position][1])
      }
    }
    // 옛 기본 역할(중앙 미드는 박스 투 박스)은 중앙 미드에서 고를 수 없어 중앙 미드필더로 바뀐다
    expect(ids('MC', 'ip', 'MC.pair')).not.toContain(data.legacyMap[DEFAULT_ROLE.MC].to)
  })

  it('프리셋 5개가 이 카탈로그의 검사를 통과하고, 기본 역할로 채워진다', () => {
    for (const id of PRESET_IDS) {
      const tactic = presetTactic(id, catalog)
      expect(tactic.catalog).toBe('fm26')
      expect(validateTactic(tactic, catalog), id).toEqual([])
      tactic.slots.forEach((slot, index) => {
        expect(slot.ip.roleId.startsWith('ip.'), `${id} ${index}`).toBe(true)
        expect(slot.oop.roleId.startsWith('oop.'), `${id} ${index}`).toBe(true)
        expect(catalog.choicesAt(kindPositionOf(slotKindOf(tactic, index, 'ip')), 'ip', slotKindOf(tactic, index, 'ip')).map((choice) => choice.roleId)).toContain(slot.ip.roleId)
      })
    }
  })
})

describe('고를 칸이 목록에 없을 때 물러서기', () => {
  /** 칸 종류 몇 개만 가진 자료 */
  const small = (keep: string[]): RoleCatalog => {
    const slotKinds = Object.fromEntries(Object.entries(data.slotKinds).filter(([kind]) => keep.includes(kind)))
    return createFm26Catalog({ ...data, slotKinds, defaultRoles: Object.fromEntries(Object.entries(data.defaultRoles).filter(([kind]) => keep.includes(kind))) })
  }

  it('정확한 칸 종류가 없으면 같은 포지션의 다른 칸 종류의 목록으로, 근거는 unknown으로 낮춘다', () => {
    const only = small(['MC.pair', 'GK'])
    const exact = only.choicesAt('MC', 'ip', 'MC.pair')
    expect(exact.every((choice) => choice.evidence === 'game')).toBe(true)
    const fallback = only.choicesAt('MC', 'ip', 'MC.single')
    expect(fallback.map((choice) => choice.roleId)).toEqual(exact.map((choice) => choice.roleId))
    expect(fallback.every((choice) => choice.evidence === 'unknown')).toBe(true)
    // 기본 역할도 목록 안에서 고른다
    expect(only.defaultRole('MC', 'ip', 'MC.single')).toBe('ip.CentralMidfielder')
    expect(only.defaultRole('MC', 'oop', 'MC.trio.side')).toBe('oop.OPCentralMidfielder')
  })

  it('그 포지션의 칸 종류가 하나도 없으면 그 포지션의 역할 전부(게임 번호 순)로, 근거는 unknown이다', () => {
    const none = small(['GK'])
    // 칸 종류의 목록이 없어도 역할의 포지션은 자료의 목록에서 나온다. 목록이 아예 없으면 역할의 포지션도 없다
    expect(none.choicesAt('MC', 'ip', 'MC.pair')).toEqual([])
    expect(none.defaultRole('MC', 'ip', 'MC.pair')).toBe('')
    const partial = createFm26Catalog({ ...data, slotKinds: { ...data.slotKinds, 'MC.pair': [] } })
    expect(partial.choicesAt('MC', 'ip', 'MC.pair').map((choice) => choice.roleId)).toEqual(catalog.choicesAt('MC', 'ip', 'MC.single').map((choice) => choice.roleId))
    expect(partial.choicesAt('MC', 'ip', 'MC.pair').every((choice) => choice.evidence !== 'game')).toBe(true)
  })

  it('포지션과 칸 종류가 맞지 않거나 모르는 칸 종류를 물어도 던지지 않고, 그 포지션의 목록을 준다', () => {
    expect(() => catalog.choicesAt('DL', 'ip', 'DC.pair')).not.toThrow()
    expect(ids('DL', 'ip', 'DC.pair')).toEqual(ids('DL', 'ip', 'DL'))
    expect(ids('DC', 'ip', '')).toEqual(ids('DC', 'ip', 'DC.single'))
    expect(catalog.choicesAt('DC', 'ip', 'constructor').every((choice) => choice.evidence === 'unknown')).toBe(true)
    expect(catalog.defaultRole('DC', 'ip', '')).toBe('ip.CentralDefender')
    expect(catalog.defaultRole('GK', 'oop', '__proto__')).toBe('oop.OPGoalkeeper')
  })

  it('돌려준 목록을 고쳐도 카탈로그는 바뀌지 않는다', () => {
    const first = catalog.choicesAt('MC', 'ip', 'MC.pair')
    first.length = 0
    expect(catalog.choicesAt('MC', 'ip', 'MC.pair').length).toBeGreaterThan(0)
  })
})

describe('옛 14역할 대응(리드 결정 3: 모두 1:1)', () => {
  it('옛 14역할을 모두 덮고, 서로 다른 점유 시 역할로 가고, 대상은 고를 수 있는 역할이다', () => {
    const map = catalog.legacyMap()
    expect(Object.keys(map).sort()).toEqual(ROLES.map((role) => role.id).sort())
    const targets = new Set<string>()
    for (const old of ROLES) {
      const entry = map[old.id]
      expect(entry, old.id).toEqual({ to: `ip.${LEGACY_TARGETS[old.id]}`, oneToOne: true })
      const target = catalog.role(entry.to)!
      expect(target.selectable, old.id).toBe(true)
      expect(target.phase, old.id).toBe('ip')
      targets.add(entry.to)
    }
    expect(targets.size).toBe(14)
  })

  it('옛 역할이 놓이던 포지션에서 대응 역할을 고를 수 없는 경우는 둘뿐이다(중앙 미드의 박스 투 박스와 딥라잉). 이전할 때 그 칸의 기본 역할로 바뀌고 알림에 적힌다', () => {
    const misses: string[] = []
    for (const old of ROLES) {
      const target = catalog.role(catalog.legacyMap()[old.id].to)!
      for (const position of old.positions) if (!target.positions.includes(position)) misses.push(`${old.id} → ${target.id}: ${position}`)
    }
    expect(misses).toEqual(['dlp → ip.DeepLyingPlaymaker: MC', 'b2b → ip.BoxToBoxMidfielder: MC'])
  })
})

describe('가중치와 근거 태그(F-04): 목록은 자료에, 값은 대장에', () => {
  it('핵심은 ROLE_KEY_WEIGHT, 앱 추가는 ROLE_APP_WEIGHT이고 범위 안이다. 값은 그때그때 대장에서 읽는다', () => {
    for (const role of data.roles) {
      const weights = catalog.baseWeights(role.id)
      expect(Object.keys(weights).sort(), role.id).toEqual([...role.key, ...role.app].sort())
      for (const id of role.key) expect(weights[id], `${role.id} ${id}`).toBe(K.ROLE_KEY_WEIGHT)
      for (const id of role.app) expect(weights[id], `${role.id} ${id}`).toBe(K.ROLE_APP_WEIGHT)
      for (const value of Object.values(weights)) expect(value <= ROLE_WEIGHT_MAX && value > 0).toBe(true)
      // 키 차례는 세이브 능력치 순서
      expect(Object.keys(weights), role.id).toEqual(SAVE_ATTRIBUTE_ORDER.filter((id) => id in weights))
    }
    const cb = withLedger({ ROLE_KEY_WEIGHT: 3, ROLE_APP_WEIGHT: 1 }, () => catalog.baseWeights('ip.CentralDefender'))
    expect(cb.heading).toBe(3)
    expect(cb.acceleration).toBe(1)
    // 대장을 되돌리면 값도 되돌아온다
    expect(catalog.baseWeights('ip.CentralDefender').heading).toBe(4)
    expect([K.ROLE_KEY_WEIGHT, K.ROLE_APP_WEIGHT]).toEqual([4, 2])
  })

  it('모든 가중치 칸에 게임 표시(game) 또는 앱 추가(app) 태그가 있고, 목록과 맞는다', () => {
    for (const role of data.roles) {
      const tags = catalog.baseTags(role.id)
      expect(Object.keys(tags).sort(), role.id).toEqual(Object.keys(catalog.baseWeights(role.id)).sort())
      for (const id of role.key) expect(tags[id], `${role.id} ${id}`).toBe('game')
      for (const id of role.app) expect(tags[id], `${role.id} ${id}`).toBe('app')
    }
  })

  it('역할 가중치 화면의 줄: 능력치 차례, 태그, 원래 값. 고친 칸은 user다', () => {
    const entries = weightEntries(catalog, 'ip.CentralDefender', {})
    expect(entries.map((entry) => entry.attr)).toEqual(SAVE_ATTRIBUTE_ORDER.filter((id) => id in catalog.baseWeights('ip.CentralDefender')))
    for (const entry of entries) {
      expect(entry.tag).toBe(data.roles.find((role) => role.id === 'ip.CentralDefender')!.key.includes(entry.attr) ? 'game' : 'app')
      expect(entry.weight).toBe(entry.base)
    }
    const edited = weightEntries(catalog, 'ip.CentralDefender', { 'ip.CentralDefender': { heading: 5, passing: 3 } })
    const by = Object.fromEntries(edited.map((entry) => [entry.attr, entry]))
    expect(by.heading).toEqual({ attr: 'heading', weight: 5, tag: 'user', base: 4 })
    expect(by.passing).toEqual({ attr: 'passing', weight: 3, tag: 'user', base: 0 })
    expect(by.marking.tag).toBe('game')
  })

  it('모르는 역할 번호는 빈 가중치이고 죽지 않는다(상속된 이름도)', () => {
    for (const id of ['', '없는 역할', 'cb', 'constructor', '__proto__']) {
      expect(catalog.baseWeights(id), id).toEqual({})
      expect(catalog.baseTags(id), id).toEqual({})
    }
  })

  describe('앱 추가 능력치(리드 결정 1: 규칙은 COMMITTED_APP_RULE)', () => {
    it('자료의 앱 추가 목록이 규칙대로이고, 자료가 어느 규칙으로 만들어졌는지 적혀 있다', () => {
      expect(data.appRule).toBe(COMMITTED_APP_RULE)
      for (const role of data.roles) {
        const where = catalog.role(role.id)!.positions
        const expected = appAttributesOf(COMMITTED_APP_RULE, { id: role.id, enumName: role.enumName, goalkeeper: where.length === 1 && where[0] === 'GK', key: role.key })
        expect([...role.app], role.id).toEqual(expected)
      }
    })

    it.runIf(COMMITTED_APP_RULE === 'default')('기본안: 골키퍼가 아닌 역할에 가속도·민첩성(핵심이 아닐 때만), 골키퍼 역할에는 없다. 두 국면 모두', () => {
      for (const role of data.roles) {
        const keeper = catalog.role(role.id)!.goalkeeper
        if (keeper) expect([...role.app], role.id).toEqual([])
        else expect([...role.app], role.id).toEqual(['acceleration', 'agility'].filter((id) => !role.key.includes(id)))
      }
      expect(data.roles.find((role) => role.id === 'ip.CentralDefender')!.app).toEqual(['acceleration', 'agility'])
      expect(data.roles.find((role) => role.id === 'oop.OPCentreForward')!.app).toEqual(['acceleration', 'agility'])
      // 가속도가 핵심인 역할은 민첩성만 더한다
      expect(data.roles.find((role) => role.id === 'ip.Poacher')!.app).toEqual(['agility'])
      // 핵심이 셋뿐인 비점유 시 센터 포워드는 앱 추가가 둘이라 가중치 비중이 4·4·4 : 2·2가 된다
      const weights = catalog.baseWeights('oop.OPCentreForward')
      expect(Object.values(weights).sort()).toEqual([2, 2, 4, 4, 4])
    })
  })
})

describe('두 국면의 가중치를 섞는다(F-02): 핵심 목록이 같은 짝은 비중이 몇이든 적합도가 같다', () => {
  const sameWeights = (a: string, b: string): boolean => {
    const x = catalog.baseWeights(a)
    const y = catalog.baseWeights(b)
    const keys = Object.keys(x)
    return keys.length === Object.keys(y).length && keys.every((key) => x[key] === y[key])
  }
  const ipRoles = catalog.roles.filter((role) => role.phase === 'ip' && role.selectable)
  const oopRoles = catalog.roles.filter((role) => role.phase === 'oop' && role.selectable)
  const pairs = ipRoles.flatMap((ip) => oopRoles.filter((oop) => sameWeights(ip.id, oop.id)).map((oop) => [ip, oop] as const))

  /** 지어낸 선수들의 저장된 능력치(1~100) */
  const players = ((): Uint8Array[] => {
    let state = 20260101
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 4294967296
    }
    return Array.from({ length: 120 }, () => Uint8Array.from({ length: SAVE_ATTRIBUTE_ORDER.length }, () => 1 + Math.floor(next() * 100)))
  })()

  it('같은 가중치의 점유 시·비점유 시 짝이 있다: 센터백과 골키퍼 짝을 포함', () => {
    expect(pairs.length).toBeGreaterThan(5)
    const has = (ip: string, oop: string): boolean => pairs.some(([a, b]) => a.id === ip && b.id === oop)
    expect(has('ip.CentralDefender', 'oop.OPCentreBack')).toBe(true)
    expect(has('ip.Goalkeeper', 'oop.OPGoalkeeper')).toBe(true)
    expect(has('ip.Goalkeeper', 'oop.OPLineKeeper')).toBe(true)
    expect(has('ip.NoNonsenseGoalkeeper', 'oop.OPGoalkeeper')).toBe(true)
    expect(has('ip.NoNonsenseCentreBack', 'oop.OPCentreBack')).toBe(true)
  })

  it('그런 짝은 비중 0~100 모든 정수에서 합성 가중치가 점유 시 표와 같고, 같은 선수의 적합도가 Object.is로 같다', () => {
    for (const [ip, oop] of pairs) {
      const position = ip.positions[0]
      const alone = prepareProfile(catalog, { ip: { position, roleId: ip.id }, oop: { position, roleId: ip.id }, sharePct: 100 }, {})
      for (let share = 0; share <= 100; share++) {
        const profile: SlotProfile = { ip: { position, roleId: ip.id }, oop: { position, roleId: oop.id }, sharePct: share }
        expect(profileWeights(catalog, profile, {}), `${ip.id} ${oop.id} ${share}`).toEqual(catalog.baseWeights(ip.id))
        const mixed = prepareProfile(catalog, profile, {})
        expect(mixed.total).toBe(alone.total)
        for (const player of players.slice(0, 6)) expect(Object.is(savedRoleScore(player, 0, mixed), savedRoleScore(player, 0, alone)), `${ip.id} ${oop.id} ${share}`).toBe(true)
      }
    }
  })

  it('가중치가 다른 짝은 중간 비중에서 섞이고, 비중 100과 0은 한쪽 역할 그대로다', () => {
    const position: PositionKey = 'DC'
    const profile = (share: number): SlotProfile => ({ ip: { position, roleId: 'ip.CentralDefender' }, oop: { position, roleId: 'oop.OPCoveringCentreBack' }, sharePct: share })
    expect(sameWeights('ip.CentralDefender', 'oop.OPCoveringCentreBack')).toBe(false)
    expect(profileWeights(catalog, profile(100), {})).toEqual(catalog.baseWeights('ip.CentralDefender'))
    expect(profileWeights(catalog, profile(0), {})).toEqual(catalog.baseWeights('oop.OPCoveringCentreBack'))
    expect(profileWeights(catalog, profile(60), {})).not.toEqual(catalog.baseWeights('ip.CentralDefender'))
    const mixedScores = players.map((player) => savedRoleScore(player, 0, prepareProfile(catalog, profile(60), {})))
    const ipScores = players.map((player) => savedRoleScore(player, 0, prepareProfile(catalog, profile(100), {})))
    expect(mixedScores).not.toEqual(ipScores)
  })
})

describe('참조 프로파일과 기준 분포의 풀', () => {
  it('고를 수 있는 역할마다 하나(점유 시 40, 비점유 시 39), 열쇠는 ref:<역할 번호>이고, 국면을 주면 그 국면만 준다', () => {
    expect(catalog.references()).toHaveLength(79)
    expect(catalog.references('ip')).toHaveLength(40)
    expect(catalog.references('oop')).toHaveLength(39)
    for (const ref of catalog.references()) {
      expect(ref.key).toBe(`ref:${ref.roleId}`)
      expect(ref.phase).toBe(catalog.role(ref.roleId)!.phase)
      expect([...ref.positions]).toEqual([...catalog.role(ref.roleId)!.positions])
      expect(ref.goalkeeper).toBe(ref.positions.length === 1 && ref.positions[0] === 'GK')
      expect(catalog.referenceOf(ref.roleId)).toBe(ref)
    }
    // 골키퍼 역할은 점유 시 셋, 비점유 시 셋
    expect(catalog.references('ip').filter((ref) => ref.goalkeeper)).toHaveLength(3)
    expect(catalog.references('oop').filter((ref) => ref.goalkeeper)).toHaveLength(3)
    // 고를 수 없는 옛 역할은 참조 프로파일이 없다
    for (const id of OLD_STYLE) expect(catalog.referenceOf(id)).toBeUndefined()
    expect(catalog.references('ip').map((ref) => ref.key)).toEqual(catalog.references().filter((ref) => ref.phase === 'ip').map((ref) => ref.key))
  })

  it('참조 풀의 합집합이 포지션 14개를 모두 덮는다(국면마다)', () => {
    for (const phase of PHASES) {
      const covered = new Set<string>()
      for (const ref of catalog.references(phase)) for (const position of ref.positions) covered.add(position)
      expect([...covered].sort(), phase).toEqual([...POSITIONS].sort())
    }
  })

  it('참조 프로파일의 기준 분포 요청: 열쇠, 풀 = 그 역할을 고를 수 있는 포지션 전부, 가중치 = 그 역할의 실효 가중치', () => {
    const ref = catalog.referenceOf('ip.FullBack')!
    expect(referenceSpec(catalog, ref, {})).toEqual({ key: 'ref:ip.FullBack', pool: ['DL', 'DR'], weights: catalog.baseWeights('ip.FullBack') })
    expect(referenceSpec(catalog, ref, { 'ip.FullBack': { tackling: 0 } }).weights.tackling).toBe(0)
  })

  it('프로파일의 풀은 점유 시 포지션과 그 좌우 짝, 가운데 포지션은 하나다', () => {
    const profile = (position: PositionKey, ipRole: string, oopRole: string, share = 60): SlotProfile => ({ ip: { position, roleId: ipRole }, oop: { position, roleId: oopRole }, sharePct: share })
    const pools: Record<PositionKey, PositionKey[]> = {
      GK: ['GK'], DL: ['DL', 'DR'], DR: ['DL', 'DR'], DC: ['DC'], WBL: ['WBL', 'WBR'], WBR: ['WBL', 'WBR'], DM: ['DM'],
      ML: ['ML', 'MR'], MR: ['ML', 'MR'], MC: ['MC'], AML: ['AML', 'AMR'], AMR: ['AML', 'AMR'], AMC: ['AMC'], ST: ['ST']
    }
    for (const position of POSITIONS) expect([...catalog.poolOf(profile(position, 'ip.X', 'oop.Y'))], position).toEqual(pools[position])
    // 비점유 시 포지션이 달라도 풀은 점유 시 포지션을 따른다
    expect([...catalog.poolOf({ ip: { position: 'AMR', roleId: 'ip.Winger' }, oop: { position: 'MR', roleId: 'oop.OPWideMidfielder' }, sharePct: 60 })]).toEqual(['AML', 'AMR'])
  })

  it('기준 분포 열쇠는 풀, 두 역할, 비중으로 정해진다(왼쪽과 오른쪽 자리는 같은 열쇠)', () => {
    const left: SlotProfile = { ip: { position: 'DL', roleId: 'ip.FullBack' }, oop: { position: 'DL', roleId: 'oop.OPFullBack' }, sharePct: 60 }
    const right: SlotProfile = { ip: { position: 'DR', roleId: 'ip.FullBack' }, oop: { position: 'DR', roleId: 'oop.OPFullBack' }, sharePct: 60 }
    expect(catalog.normKey(left)).toBe('DL+DR|ip.FullBack|oop.OPFullBack|60')
    expect(catalog.normKey(right)).toBe(catalog.normKey(left))
    expect(catalog.normKey({ ...left, sharePct: 40 })).not.toBe(catalog.normKey(left))
    expect(catalog.normKey({ ...left, oop: { position: 'DL', roleId: 'oop.OPPressingFullBack' } })).not.toBe(catalog.normKey(left))
    expect(catalog.normKey({ ...left, ip: { position: 'DL', roleId: 'ip.WingBack' } })).not.toBe(catalog.normKey(left))
    expect(catalog.normKey({ ip: { position: 'DC', roleId: 'ip.CentralDefender' }, oop: { position: 'DC', roleId: 'oop.OPCentreBack' }, sharePct: 100 })).toBe('DC|ip.CentralDefender|oop.OPCentreBack|100')
    // 기준 분포 요청: 풀과 합성 가중치
    const spec = profileSpec(catalog, left, {})
    expect(spec.key).toBe(catalog.normKey(left))
    expect(spec.pool).toEqual(['DL', 'DR'])
  })
})

describe('사용자 역할을 얹는다', () => {
  it('FM26 카탈로그 위에도 사용자 역할이 그 국면·포지션의 목록 끝에 user로 더해지고, 다른 목록은 그대로다', () => {
    const custom: CustomRole = { id: 'user.a', phase: 'oop', name: '사용자 역할', positions: ['DM', 'MC'], weights: { tackling: 4, passing: 2 } }
    const withUser = withCustomRoles(catalog, [custom])
    expect(withUser.choicesAt('DM', 'oop', 'DM.single').at(-1)).toEqual({ roleId: 'user.a', evidence: 'user' })
    expect(withUser.choicesAt('DM', 'ip', 'DM.single')).toEqual(catalog.choicesAt('DM', 'ip', 'DM.single'))
    expect(withUser.choicesAt('MC', 'oop', 'MC.pair').slice(0, -1)).toEqual(catalog.choicesAt('MC', 'oop', 'MC.pair'))
    expect(withUser.references('oop').some((ref) => ref.roleId === 'user.a')).toBe(true)
    expect(withUser.roles.slice(0, catalog.roles.length)).toEqual(catalog.roles)
    expect(withUser.legacyMap()).toBe(catalog.legacyMap())
  })
})

describe('카탈로그를 만드는 함수는 어긋난 자료에도 죽지 않는다', () => {
  it('목록이 모르는 역할을 부르거나, 고를 수 없는 역할을 담거나, 같은 역할이 둘이어도 그 항목만 건너뛴다', () => {
    const broken = createFm26Catalog({
      ...data,
      slotKinds: {
        ...data.slotKinds,
        GK: [...data.slotKinds.GK, { roleId: 'ip.없는역할', evidence: 'game' }, { roleId: 'ip.Regista', evidence: 'game' }, { roleId: 'ip.Goalkeeper', evidence: 'game' }],
        '아무칸.single': [{ roleId: 'ip.Goalkeeper', evidence: 'game' }]
      }
    })
    expect(broken.choicesAt('GK', 'ip', 'GK').map((choice) => choice.roleId)).toEqual(catalog.choicesAt('GK', 'ip', 'GK').map((choice) => choice.roleId))
    expect(broken.role('ip.Goalkeeper')!.positions).toEqual(['GK'])
  })

  it('빈 자료로도 만들어지고 무엇을 물어도 제 모양의 답을 준다', () => {
    const empty = createFm26Catalog({ game: '0', readAt: '', appRule: 'none', attributeNames: {}, roles: [], slotKinds: {}, slotNotes: {}, defaultRoles: {}, legacyMap: {} })
    expect(empty.roles).toEqual([])
    expect(empty.choicesAt('DC', 'ip', 'DC.pair')).toEqual([])
    expect(empty.defaultRole('DC', 'ip', 'DC.pair')).toBe('')
    expect(empty.references()).toEqual([])
    expect(empty.references('ip')).toEqual([])
    expect(empty.role('ip.X')).toBeUndefined()
    expect(empty.baseWeights('ip.X')).toEqual({})
  })
})
