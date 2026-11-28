/**
 * 지원 버전 표와 게임 판 확인(N-02): 게임 판 글자를 읽고, 표에 있는지 판정하고, 게임에서 읽는 기능을 열고 닫는 문을 본다.
 */
import { describe, expect, it } from 'vitest'
import { SIGNATURE } from '../src/main/save/container'
import { checkGameVersion, gameReadGate, normalizeVersion, roleGameId, SUPPORTED_VERSIONS } from '../src/shared/compat'
import { NEEDED_PLUGIN, TACTIC_PLUGIN } from '../src/shared/game'
import { FULL_PLUGIN } from '../src/shared/pluginGates'
import { DEFAULT_ROLE } from '../src/shared/roles'

const row = SUPPORTED_VERSIONS[0]

describe('normalizeVersion', () => {
  it('빌드 번호나 넷째 숫자를 떼고 주.부.수만 남긴다', () => {
    expect(normalizeVersion('26.3.2+2329565')).toBe('26.3.2')
    expect(normalizeVersion('26.3.2')).toBe('26.3.2')
    expect(normalizeVersion('  26.3.2  ')).toBe('26.3.2')
    expect(normalizeVersion('v26.3.2')).toBe('26.3.2')
    expect(normalizeVersion('26.3.2.2329565')).toBe('26.3.2')
    expect(normalizeVersion('26.4')).toBe('26.4')
    // 두 자리 수는 한 자리 수와 다르다
    expect(normalizeVersion('26.3.20')).toBe('26.3.20')
  })

  it('읽을 수 없거나 확인할 수 없는 꼬리가 붙은 글자는 null이다', () => {
    for (const text of ['', ' ', 'abc', '26', '26.', '.3.2', '26.x.2', '26.3.2beta', '26.3.2-beta', '26.3.2 beta', '26.3.2+', '+26.3.2', '26,3,2']) {
      expect(normalizeVersion(text), JSON.stringify(text)).toBeNull()
    }
    expect(normalizeVersion(null)).toBeNull()
    expect(normalizeVersion(undefined)).toBeNull()
    expect(normalizeVersion(26.3 as unknown as string)).toBeNull()
  })
})

describe('checkGameVersion', () => {
  it("'26.3.2+2329565'는 확인한 판이다", () => {
    const check = checkGameVersion('26.3.2+2329565')
    expect(check.status).toBe('ok')
    expect(check.version).toBe('26.3.2')
    expect(check.row).toBe(row)
    expect(check.text).toContain('26.3.2')
  })

  it("'26.4.0'은 읽었지만 확인하지 않은 판이라 안내가 붙는다", () => {
    const check = checkGameVersion('26.4.0')
    expect(check.status).toBe('unsupported')
    expect(check.version).toBe('26.4.0')
    expect(check.row).toBeNull()
    expect(check.text).toContain('26.4.0')
    expect(check.text).toContain('26.3.2')
    expect(check.text).toContain('확인하지 않은 판')
  })

  it('빈 글자와 읽을 수 없는 글자는 확인 못 함이다', () => {
    for (const text of ['', null, undefined, '버전 모름', '26.3.2beta']) {
      const check = checkGameVersion(text)
      expect(check.status, String(text)).toBe('unknown')
      expect(check.version).toBeNull()
      expect(check.row).toBeNull()
      expect(check.text).toContain('확인 못 함')
    }
  })
})

describe('지원 표의 모양', () => {
  it('26.3.2 한 줄이고, 포지션 14개의 비트가 겹치지 않는 10진 글자다', () => {
    expect(SUPPORTED_VERSIONS.map((each) => each.game)).toEqual(['26.3.2'])
    expect(row.catalog).toEqual({ id: 'fm26', version: '26.3.2' })
    expect(Object.keys(row.positionBits).sort()).toEqual(Object.keys(DEFAULT_ROLE).sort())
    const bits = Object.values(row.positionBits)
    expect(new Set(bits).size).toBe(bits.length)
    for (const text of [...bits, row.sideBits.left, row.sideBits.right, row.attackerSideBits.left, row.attackerSideBits.right, ...row.dutyBits]) expect(text).toMatch(/^\d+$/)
  })

  it('게임 열거형(PlayingDataFlags.PositionMask)의 값 그대로다', () => {
    expect(row.positionBits).toEqual({
      GK: '1', DR: '4', DL: '8', DC: '16', WBR: '32', WBL: '64', DM: '128', MR: '256', ML: '512', MC: '1024', AMR: '2048', AML: '4096', AMC: '8192', ST: '16384'
    })
    expect(row.sideBits).toEqual({ left: '1048576', right: '2097152' })
    expect(row.attackerSideBits).toEqual({ left: '65536', right: '32768' })
  })

  it('임무 비트 여섯 개는 서로 다른 한 비트씩이다', () => {
    expect(row.dutyBits).toHaveLength(6)
    for (const text of row.dutyBits) {
      const bit = BigInt(text)
      expect(bit & (bit - 1n), text).toBe(0n)
      expect(bit, text).toBeGreaterThan(0n)
    }
    expect(new Set(row.dutyBits).size).toBe(6)
  })

  it('세이브 형식 글자는 세이브를 읽는 코드(container.ts)의 꾸러미 머리 서명과 같다', () => {
    // 서명: 02 01 "fmf." 08 00 00. 표에는 "fmf." 뒤의 판 바이트를 적는다
    expect(SIGNATURE.subarray(2, 6).toString('latin1')).toBe('fmf.')
    expect(row.saveFormat).toBe(`fmf.${SIGNATURE[6].toString(16).padStart(2, '0')}`)
  })

  it('기능마다 필요한 플러그인 버전은 0.14.0이다', () => {
    expect(row.plugin).toEqual({ tactic: '0.14.0', stars: '0.14.0' })
    expect(TACTIC_PLUGIN).toBe('0.14.0')
    // 앱의 기능이 모두 켜지는 플러그인 버전(안내 글이 따르는 값)이 지원 표의 기능 버전과 같다: 둘이 따로 어긋나지 않는다
    expect(FULL_PLUGIN).toBe(TACTIC_PLUGIN)
  })
})

describe('gameReadGate: 게임 전술 가져오기와 별점 대조의 문', () => {
  const open = { connected: true, pluginVersion: '0.14.0', gameVersion: '26.3.2+2329565' }

  it('게임이 켜져 있고 플러그인과 게임 판이 맞으면 열린다', () => {
    for (const feature of ['tactic', 'stars'] as const) {
      const gate = gameReadGate(open, feature)
      expect(gate.open, feature).toBe(true)
      expect(gate.reason).toBe('')
      expect(gate.row).toBe(row)
    }
  })

  it('게임이 꺼져 있으면 닫힌다', () => {
    const gate = gameReadGate({ connected: false, pluginVersion: '', gameVersion: undefined }, 'tactic')
    expect(gate.open).toBe(false)
    expect(gate.reason).toContain('FM이 켜져')
    expect(gate.row).toBeNull()
  })

  it('플러그인이 0.14.0보다 낮으면 그 기능만 닫히고 까닭에 버전이 적힌다', () => {
    for (const version of ['0.13.0', '0.11.0', NEEDED_PLUGIN]) {
      const gate = gameReadGate({ ...open, pluginVersion: version, gameVersion: undefined }, 'stars')
      expect(gate.open, version).toBe(false)
      expect(gate.reason).toContain('0.14.0 이상')
      expect(gate.reason).toContain(version)
    }
    expect(gameReadGate({ ...open, pluginVersion: '' }, 'tactic').reason).toContain('알 수 없는 버전')
  })

  it('게임 판이 표에 없거나 읽지 못했으면 닫힌다(역할 비트가 바뀌었을 수 있다)', () => {
    const unsupported = gameReadGate({ ...open, gameVersion: '26.4.0' }, 'tactic')
    expect(unsupported.open).toBe(false)
    expect(unsupported.reason).toContain('26.4.0')
    expect(unsupported.reason).toContain('끕니다')
    for (const gameVersion of ['', undefined]) {
      const unknown = gameReadGate({ ...open, gameVersion }, 'tactic')
      expect(unknown.open, String(gameVersion)).toBe(false)
      expect(unknown.reason).toContain('확인 못 함')
    }
  })

  it('표가 기능마다 더 높은 플러그인을 요구하면 그 기능만 닫힌다', () => {
    const strict = { ...row, plugin: { tactic: '0.14.0', stars: '0.15.0' } }
    const original = SUPPORTED_VERSIONS as unknown as Array<typeof row>
    original[0] = strict
    try {
      expect(gameReadGate(open, 'tactic').open).toBe(true)
      const stars = gameReadGate(open, 'stars')
      expect(stars.open).toBe(false)
      expect(stars.reason).toContain('0.15.0 이상')
    } finally {
      original[0] = row
    }
  })
})

describe('roleGameId: 역할 값에서 임무 비트를 지운다', () => {
  it('임무 비트가 없으면 그대로 돌려준다', () => {
    for (const text of ['1', '2', '4096', '9007199254740992', '144115188075855872']) expect(roleGameId(text, row), text).toBe(text)
  })

  it('임무 비트가 붙어도 같은 역할 번호가 나온다(여섯 임무 하나씩, 모두 함께)', () => {
    for (const role of ['4096', '16777216', '144115188075855872']) {
      for (const duty of row.dutyBits) expect(roleGameId((BigInt(role) | BigInt(duty)).toString(), row), `${role}+${duty}`).toBe(role)
      const all = row.dutyBits.reduce((sum, duty) => sum | BigInt(duty), BigInt(role))
      expect(roleGameId(all.toString(), row), `${role}+전부`).toBe(role)
    }
  })

  it('2^57 값은 숫자로 바꾸지 않고 BigInt로만 다룬다', () => {
    const big = (2n ** 57n + 4194304n).toString()
    // 숫자로 바꾸면 값이 깨진다(이 사례가 시험으로 의미가 있다는 증명)
    expect(String(Number(big))).not.toBe(big)
    expect(roleGameId(big, row)).toBe('144115188075855872')
  })

  it('임무 비트만 있거나 10진 정수 글자가 아니면 null이다', () => {
    for (const text of ['0', '4194304', '', 'abc', '-5', '4096.0', ' 4096', '4096 ', '1'.repeat(21), '0x10']) expect(roleGameId(text, row), JSON.stringify(text)).toBeNull()
    expect(roleGameId(4096 as unknown as string, row)).toBeNull()
  })
})
