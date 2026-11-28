/**
 * 역할 카탈로그가 지켜야 하는 계약(2단계). 카탈로그마다 한 번 부른다: 옛 14역할(tests/roleCatalog.test.ts)과, 채워진 FM26 카탈로그(tests/catalogFm26.test.ts).
 * describe와 it을 직접 등록하므로 시험 파일의 맨 위에서 부른다.
 *
 * 계약(자료의 내용이 아니라 모양과 서로의 일관성만 본다)
 * - 역할: 번호가 겹치지 않고, 번호로 찾으면 그 역할이 나온다(상속된 이름 'constructor' 같은 것은 찾지 않는다). 이름과 포지션은 고를 수 있는 역할(selectable)만 갖춰야 한다:
 *   게임이 이름을 주지 않은 옛 방식의 역할은 어느 칸 목록에도 없어서 이름도 포지션도 비어 있을 수 있고, 그런 역할은 번호, 국면, 가중치와 출처 태그만 본다.
 * - 게임 역할 비트(gameId)는 10진 글자이고, (국면, gameId)로 찾으면 그 역할이 나온다.
 * - 가중치: 0 이상 ROLE_WEIGHT_MAX 이하이고, 능력치 id는 세이브의 54개 가운데 하나이고, 양수가 하나 이상 있으며, 양수 칸마다 출처 태그(게임 표시 또는 앱 추가)가 있다.
 * - 칸에서 고를 수 있는 역할: 모든 포지션·국면·칸 종류에 하나 이상 있고, 모두 그 국면에서 고를 수 있으며 그 포지션이 역할의 positions에 들어 있고,
 *   기본 역할은 그 목록 안에 있다. 골키퍼 역할은 골키퍼 칸에만 있고, 골키퍼 칸에는 골키퍼 역할만 있다.
 * - 참조 프로파일: 열쇠가 겹치지 않고, 역할이 카탈로그에 있고, 역할로 다시 찾으면 같은 것이 나온다.
 * - 기준 분포의 풀과 열쇠: 풀에 그 자리 포지션이 들어 있고, 같은 프로파일은 같은 열쇠, 점유 시 역할이 다르면 다른 열쇠다.
 * - 옛 14역할 대응 표: 옛 14역할을 모두 덮고, 대상이 카탈로그에 있고, 1:1로 이어지는 것은 같은 새 역할로 두 번 가지 않는다.
 */
import { describe, expect, it } from 'vitest'
import { ROLE_WEIGHT_MAX } from '../../src/shared/limits'
import type { RoleCatalog } from '../../src/shared/roleCatalog'
import { DEFAULT_ROLE, ROLES, type PositionKey } from '../../src/shared/roles'
import type { Phase, SlotProfile } from '../../src/shared/slotProfile'
import { SAVE_ATTRIBUTE_ORDER } from '../../src/shared/world'

const POSITIONS = Object.keys(DEFAULT_ROLE) as PositionKey[]
const PHASES: Phase[] = ['ip', 'oop']
const CENTRE: ReadonlySet<PositionKey> = new Set<PositionKey>(['DC', 'DM', 'MC', 'AMC', 'ST'])

/** 포지션의 칸 종류들: 넓은 포지션은 그대로, 가운데 포지션은 같은 줄의 가운데 칸 수에 따라 넷 */
export function kindsOf(position: PositionKey): string[] {
  return CENTRE.has(position) ? [`${position}.single`, `${position}.pair`, `${position}.trio.side`, `${position}.trio.centre`] : [position]
}

export function catalogContract(catalog: RoleCatalog): void {
  describe(`역할 카탈로그 계약: ${catalog.id}`, () => {
    it('기본 모양: 번호와 판이 있고, 역할마다 국면이 있으며 번호가 겹치지 않고, 고를 수 있는 역할은 이름·포지션이 있다', () => {
      expect(['legacy14', 'fm26']).toContain(catalog.id)
      expect(catalog.dataVersion.length).toBeGreaterThan(0)
      expect(catalog.roles.length).toBeGreaterThan(0)
      const ids = new Set<string>()
      for (const role of catalog.roles) {
        expect(role.id.length, '역할 번호').toBeGreaterThan(0)
        expect(ids.has(role.id), `번호 겹침 ${role.id}`).toBe(false)
        ids.add(role.id)
        expect(['ip', 'oop', 'both'], role.id).toContain(role.phase)
        // 이름과 포지션은 고를 수 있는 역할만 요구한다(고를 수 없는 역할은 어느 칸 목록에도 없어 둘 다 비어 있을 수 있다)
        if (role.selectable) {
          expect(role.label.length, role.id).toBeGreaterThan(0)
          expect(role.positions.length, role.id).toBeGreaterThan(0)
        }
        for (const position of role.positions) expect(POSITIONS, `${role.id} ${position}`).toContain(position)
        // 골키퍼 역할은 골키퍼 칸에만, 그 밖의 역할은 골키퍼 칸에 없다(포지션이 비어 있는 고를 수 없는 역할은 어긋날 것이 없다)
        if (role.goalkeeper) {
          if (role.selectable || role.positions.length > 0) expect([...role.positions], role.id).toEqual(['GK'])
        } else {
          expect(role.positions, role.id).not.toContain('GK')
        }
      }
    })

    it('번호로 찾으면 그 역할이 나오고, 없는 번호나 상속된 이름은 찾지 않는다', () => {
      for (const role of catalog.roles) expect(catalog.role(role.id)).toBe(role)
      for (const id of ['__없는 역할__', 'constructor', '__proto__', 'toString', '']) expect(catalog.role(id), id).toBeUndefined()
      for (const id of ['constructor', '__proto__', 'toString']) {
        expect(Object.keys(catalog.baseWeights(id)), id).toEqual([])
        expect(Object.keys(catalog.baseTags(id)), id).toEqual([])
      }
    })

    it('게임 역할 비트는 10진 글자이고, (국면, 비트)로 찾으면 그 역할이 나온다', () => {
      for (const role of catalog.roles) {
        if (role.gameId === undefined) continue
        expect(role.gameId, role.id).toMatch(/^\d+$/)
        for (const phase of PHASES) {
          if (role.phase === phase) expect(catalog.roleByGameId(phase, role.gameId), `${role.id} ${phase}`).toBe(role)
        }
      }
      expect(catalog.roleByGameId('ip', '비트가 아닌 글자')).toBeUndefined()
      expect(catalog.roleByGameId('oop', '99999999999999999999')).toBeUndefined()
    })

    it('가중치: 범위 안이고 능력치 id가 올바르며, 양수 칸마다 출처 태그가 있다', () => {
      const known: ReadonlySet<string> = new Set(SAVE_ATTRIBUTE_ORDER)
      for (const role of catalog.roles) {
        const weights = catalog.baseWeights(role.id)
        const tags = catalog.baseTags(role.id)
        let positive = 0
        for (const [attribute, weight] of Object.entries(weights)) {
          expect(known.has(attribute), `${role.id} ${attribute}: 모르는 능력치`).toBe(true)
          expect(Number.isFinite(weight) && weight >= 0 && weight <= ROLE_WEIGHT_MAX, `${role.id} ${attribute}=${weight}`).toBe(true)
          if (weight > 0) {
            positive++
            expect(['game', 'app'], `${role.id} ${attribute}: 출처 태그`).toContain(tags[attribute])
          }
        }
        expect(positive, `${role.id}: 양수 가중치`).toBeGreaterThan(0)
      }
    })

    it('칸에서 고를 수 있는 역할: 모든 포지션·국면·칸 종류에 있고, 서로 어긋나지 않는다', () => {
      for (const position of POSITIONS) {
        for (const phase of PHASES) {
          for (const kind of kindsOf(position)) {
            const where = `${position} ${phase} ${kind}`
            const choices = catalog.choicesAt(position, phase, kind)
            expect(choices.length, `${where}: 고를 수 있는 역할`).toBeGreaterThan(0)
            const seen = new Set<string>()
            for (const choice of choices) {
              expect(seen.has(choice.roleId), `${where}: 같은 역할 둘 ${choice.roleId}`).toBe(false)
              seen.add(choice.roleId)
              expect(['game', 'inferred', 'unknown', 'app', 'user'], `${where} ${choice.roleId}: 근거`).toContain(choice.evidence)
              const role = catalog.role(choice.roleId)
              expect(role, `${where}: 목록에 없는 역할 ${choice.roleId}`).toBeDefined()
              expect(role!.selectable, `${where} ${choice.roleId}: 고를 수 없는 역할`).toBe(true)
              expect(['both', phase], `${where} ${choice.roleId}: 국면`).toContain(role!.phase)
              expect(role!.positions, `${where} ${choice.roleId}: 포지션`).toContain(position)
              expect(role!.goalkeeper, `${where} ${choice.roleId}: 골키퍼 칸과 역할`).toBe(position === 'GK')
            }
            expect(seen.has(catalog.defaultRole(position, phase, kind)), `${where}: 기본 역할 ${catalog.defaultRole(position, phase, kind)}`).toBe(true)
          }
        }
      }
    })

    it('참조 프로파일: 열쇠가 겹치지 않고, 역할이 있고, 역할로 다시 찾으면 같은 것이 나온다', () => {
      const all = catalog.references()
      expect(all.length).toBeGreaterThan(0)
      const keys = new Set<string>()
      for (const ref of all) {
        expect(keys.has(ref.key), `열쇠 겹침 ${ref.key}`).toBe(false)
        keys.add(ref.key)
        expect(catalog.role(ref.roleId), ref.key).toBeDefined()
        expect(ref.positions.length, ref.key).toBeGreaterThan(0)
        expect(catalog.referenceOf(ref.roleId), ref.key).toEqual(ref)
      }
      for (const phase of PHASES) {
        for (const ref of catalog.references(phase)) expect(['both', phase], `${ref.key} ${phase}`).toContain(ref.phase)
      }
      expect(catalog.referenceOf('__없는 역할__')).toBeUndefined()
    })

    it('기준 분포의 풀과 열쇠: 풀에 그 자리 포지션이 있고, 같은 프로파일은 같은 열쇠, 점유 시 역할이 다르면 다른 열쇠다', () => {
      for (const position of POSITIONS) {
        const kind = kindsOf(position)[0]
        const choices = catalog.choicesAt(position, 'ip', kind)
        const profileOf = (roleId: string, share = 60): SlotProfile => ({
          ip: { position, roleId },
          oop: { position, roleId: catalog.defaultRole(position, 'oop', kind) },
          sharePct: share
        })
        const first = profileOf(choices[0].roleId)
        expect(catalog.poolOf(first), position).toContain(position)
        expect(catalog.normKey(first), position).toBe(catalog.normKey(profileOf(choices[0].roleId)))
        expect(catalog.normKey(first).length, position).toBeGreaterThan(0)
        if (choices.length > 1) expect(catalog.normKey(first), `${position}: 역할이 다르면 열쇠도 다르다`).not.toBe(catalog.normKey(profileOf(choices[1].roleId)))
      }
    })

    it('옛 14역할 대응 표: 모두 덮고, 대상이 카탈로그에 있고, 1:1은 같은 새 역할로 두 번 가지 않는다', () => {
      const map = catalog.legacyMap()
      const targets = new Set<string>()
      for (const legacy of ROLES) {
        const entry = map[legacy.id]
        expect(entry, `${legacy.id}: 대응 없음`).toBeDefined()
        expect(typeof entry.oneToOne, legacy.id).toBe('boolean')
        expect(catalog.role(entry.to), `${legacy.id} → ${entry.to}`).toBeDefined()
        if (!entry.oneToOne) continue
        expect(targets.has(entry.to), `${legacy.id}: ${entry.to}로 두 번`).toBe(false)
        targets.add(entry.to)
      }
    })
  })
}
