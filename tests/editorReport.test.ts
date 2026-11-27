/**
 * 에디터 반영 결과(A-15, 앱 쪽)의 시험: 항목별로 들어간 것과 들어가지 않은 것을 가르고,
 * 플러그인 0.13.0의 실패 응답(되돌림, 온라인 게임 차단)을 그대로 보여 주는지 본다. 선수 이름은 지어낸 것이다.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fieldsOf, landedFields, playerResult, reportOf, skippedResult } from '../src/main/editorReport'
import { liveSetOutcome, type LivePlayer } from '../src/main/talk/bridge'
import { EDITOR_SAFE_PLUGIN, FULL_PLUGIN, PLUGIN_GATES } from '../src/shared/pluginGates'
import { versionOlder } from '../src/shared/game'

const positions = Array.from({ length: 15 }, (_, i) => i + 1)
const attributes = Array.from({ length: 54 }, (_, i) => i + 1)
const edit = { uid: 7, ca: 130, pa: 150, positions, attributes }
const after = (over: Partial<LivePlayer> = {}): LivePlayer => ({ found: 1, ca: 130, pa: 150, positions, attributes, ...over })

describe('항목별 확인', () => {
  it('보낸 항목만 센다', () => {
    expect(fieldsOf({ uid: 1 })).toEqual([])
    expect(fieldsOf({ uid: 1, ca: 100 })).toEqual(['ca'])
    expect(fieldsOf(edit)).toEqual(['ca', 'pa', 'positions', 'attributes'])
  })

  it('게임이 돌려준 값과 같은 항목은 들어간 것, 다른 항목은 들어가지 않은 것이다', () => {
    const wrong = after({ attributes: attributes.map((v, i) => (i === 5 ? v + 1 : v)), pa: 149 })
    expect(landedFields(edit, wrong)).toEqual({ written: ['ca', 'positions'], failed: ['pa', 'attributes'] })
  })
})

describe('선수 한 명의 결과', () => {
  it('모두 같으면 written', () => {
    expect(playerResult(edit, '가상', { kind: 'ok', player: after() })).toMatchObject({ status: 'written', written: ['ca', 'pa', 'positions', 'attributes'], failed: [] })
  })

  it('일부만 같으면 partial', () => {
    const result = playerResult(edit, '가상', { kind: 'ok', player: after({ pa: 1 }) })
    expect(result.status).toBe('partial')
    expect(result.written).toEqual(['ca', 'positions', 'attributes'])
    expect(result.failed).toEqual(['pa'])
  })

  it('하나도 같지 않으면 failed', () => {
    const result = playerResult(edit, '가상', { kind: 'ok', player: after({ ca: 1, pa: 1, positions: [], attributes: [] }) })
    expect(result.status).toBe('failed')
    expect(result.written).toEqual([])
  })

  it('게임에서 선수를 못 찾았으면(found 0) 모두 못 넣은 것이다', () => {
    const result = playerResult(edit, '가상', { kind: 'ok', player: { found: 0 } })
    expect(result.status).toBe('failed')
    expect(result.failed).toHaveLength(4)
  })

  it('게임이 답하지 않으면 모두 못 넣은 것이다', () => {
    const result = playerResult(edit, '가상', { kind: 'offline' })
    expect(result).toMatchObject({ status: 'failed', written: [] })
    expect(result.note).toContain('연결하지 못했습니다')
  })

  it('온라인 게임이라 막았으면 그렇게 알린다', () => {
    const result = playerResult(edit, '가상', { kind: 'online' })
    expect(result.online).toBe(true)
    expect(result.note).toContain('온라인')
    expect(result.written).toEqual([])
  })

  it('쓰다가 실패해 플러그인이 되돌렸으면 아무것도 들어가지 않았고, 되돌린 항목을 알린다', () => {
    const result = playerResult(edit, '가상', { kind: 'failed', failedAt: 'attributes', rolledBack: ['positions'], restored: true, error: 'write failed' })
    expect(result.written).toEqual([])
    expect(result.rolledBack).toEqual(['positions'])
    expect(result.restored).toBe(true)
    expect(result.note).toContain('능력치')
    expect(result.note).toContain('되돌렸습니다')
  })

  it('되돌리지도 못했으면(restored false) 게임에 값이 섞여 있을 수 있다고 분명히 알린다', () => {
    const result = playerResult(edit, '가상', { kind: 'failed', failedAt: 'ca', rolledBack: ['positions', 'attributes'], restored: false, error: 'x' })
    expect(result.restored).toBe(false)
    expect(result.note).toContain('섞여 있을 수 있습니다')
  })

  it('옛 플러그인의 실패(되돌림 정보 없음)는 오류 글만 보인다', () => {
    const result = playerResult(edit, '가상', { kind: 'failed', rolledBack: [], error: 'NullReferenceException: 값이 없음' })
    expect(result.note).toContain('NullReferenceException')
    expect(result.restored).toBeUndefined()
  })

  it('모르는 부분 이름은 버린다', () => {
    const result = playerResult(edit, '가상', { kind: 'failed', rolledBack: ['positions', 'mystery'], restored: true, error: '' })
    expect(result.rolledBack).toEqual(['positions'])
  })
})

describe('전체 결과 글', () => {
  it('모두 들어가면 ok', () => {
    const report = reportOf([playerResult(edit, '가상A', { kind: 'ok', player: after() })])
    expect(report.ok).toBe(true)
    expect(report.message).toContain('가상A')
  })

  it('앞에서 멈추면 뒤 선수는 보내지 않음으로 나온다', () => {
    const report = reportOf([playerResult(edit, '가상A', { kind: 'ok', player: after({ pa: 1 }) }), skippedResult({ uid: 8 }, '가상B')])
    expect(report.ok).toBe(false)
    expect(report.message).toContain('일부만 반영했습니다')
    expect(report.message).toContain('미반영 잠재 능력')
    expect(report.message).toContain('가상B: 보내지 않음')
  })

  it('하나도 못 넣었으면 "반영하지 못했습니다"', () => {
    const report = reportOf([playerResult(edit, '가상A', { kind: 'online' })])
    expect(report.message.startsWith('반영하지 못했습니다')).toBe(true)
  })
})

describe('플러그인 버전 문', () => {
  it('에디터 안전 기능은 앱의 버전 문 표에 있고 가장 높은 문이다', () => {
    expect(PLUGIN_GATES.some((gate) => gate.version === EDITOR_SAFE_PLUGIN)).toBe(true)
    expect(FULL_PLUGIN).toBe(EDITOR_SAFE_PLUGIN)
    expect(versionOlder('0.12.0', EDITOR_SAFE_PLUGIN)).toBe(true)
    expect(versionOlder('0.13.0', EDITOR_SAFE_PLUGIN)).toBe(false)
  })
})

describe('플러그인 응답 읽기(liveSetOutcome)', () => {
  let server: Server
  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '', 'http://x')
      const uid = url.searchParams.get('uid')
      if (uid === '1') response.end(JSON.stringify({ found: 1, ca: 130 }))
      else if (uid === '2') response.writeHead(500).end(JSON.stringify({ error: 'write failed', failedAt: 'attributes', rolledBack: ['positions'], restored: true }))
      else if (uid === '3') response.writeHead(500).end(JSON.stringify({ error: 'write failed', failedAt: 'ca', rolledBack: ['positions', 'attributes'], restored: false }))
      else if (uid === '4') response.writeHead(403).end('online game: editor writes are off')
      else if (uid === '5') response.writeHead(500).end('InvalidOperationException: 첫 줄')
      else response.writeHead(404).end('no')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const home = mkdtempSync(join(tmpdir(), 'fmb-report-'))
    mkdirSync(join(home, 'FmBojwagwan'))
    writeFileSync(join(home, 'FmBojwagwan', 'bridge.json'), JSON.stringify({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, token: 's' }))
    process.env.LOCALAPPDATA = home
  })
  afterAll(() => {
    server.close()
  })

  it('성공은 값을 돌려준다', async () => {
    expect(await liveSetOutcome({ uid: 1, ca: 130 })).toEqual({ kind: 'ok', player: { found: 1, ca: 130 } })
  })

  it('부분 실패(500)는 실패한 부분과 되돌림 결과를 읽는다', async () => {
    expect(await liveSetOutcome({ uid: 2, ca: 130 })).toMatchObject({ kind: 'failed', failedAt: 'attributes', rolledBack: ['positions'], restored: true })
    expect(await liveSetOutcome({ uid: 3, ca: 130 })).toMatchObject({ kind: 'failed', restored: false })
  })

  it('온라인 게임(403)은 online이다', async () => {
    expect(await liveSetOutcome({ uid: 4, ca: 130 })).toEqual({ kind: 'online' })
  })

  it('알 수 없는 오류(500, 글 한 줄)는 그 글을 담는다', async () => {
    expect(await liveSetOutcome({ uid: 5, ca: 130 })).toMatchObject({ kind: 'failed', rolledBack: [], error: 'InvalidOperationException: 첫 줄' })
  })

  it('게임이 꺼져 있으면(연결 실패) offline이다', async () => {
    const saved = process.env.LOCALAPPDATA
    process.env.LOCALAPPDATA = join(tmpdir(), 'fmb-no-such-home')
    expect(await liveSetOutcome({ uid: 1, ca: 130 })).toEqual({ kind: 'offline' })
    process.env.LOCALAPPDATA = saved
  })
})
