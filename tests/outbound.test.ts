/**
 * N-08: 이 PC 밖으로 나가는 것은 게임 안 "직접 답변"의 Claude 요청뿐이다.
 * 코드에서 바깥으로 나갈 수 있는 길을 모두 세어 두고(소스 검사), 길마다 막혀 있는지 본다.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { isLocalRequest } from '../src/main/netGuard'
import { gameState } from '../src/main/talk/bridge'
import { TalkController } from '../src/main/talk/controller'
import type { KeyStore } from '../src/main/talk/keyStore'
import type { SettingsStore } from '../src/main/settings'

const SRC = join(__dirname, '..', 'src')

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

/** 주석을 뺀 코드(주석 속 주소와 설명을 바깥 요청으로 세지 않으려고) */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const sources = filesUnder(SRC)
  .filter((path) => /\.(ts|tsx|css|html)$/.test(path))
  .map((path) => ({ file: relative(SRC, path).replace(/\\/g, '/'), text: code(path) }))
const mentioning = (pattern: RegExp): string[] => sources.filter((source) => pattern.test(source.text)).map((source) => source.file)

describe('주소 판정: 이 PC 안인가', () => {
  it('앱 자신의 파일, 얼굴·엠블럼 주소, 개발 서버(localhost)는 이 PC 안이다', () => {
    for (const url of [
      'file:///C:/app/out/renderer/index.html',
      'fmface://face/123',
      'fmface://club/9',
      'data:image/png;base64,AAAA',
      'blob:null/abc',
      'devtools://devtools/bundled/inspector.html',
      'about:blank',
      'http://localhost:5173/',
      'ws://localhost:5173/',
      'http://127.0.0.1:8080/x',
      'http://[::1]:3000/'
    ]) {
      expect(isLocalRequest(url), url).toBe(true)
    }
  })

  it('바깥 주소, 서버 이름을 흉내 낸 주소, 읽을 수 없는 주소, 모르는 종류는 바깥이다', () => {
    for (const url of [
      'https://fonts.googleapis.com/css2?family=X',
      'https://api.anthropic.com/v1/messages',
      'http://example.com/',
      'http://localhost.example.com/',
      'http://127.0.0.1.example.com/',
      'http://localhost@example.com/',
      'http://example.com/localhost',
      'https://cdn.example.com/a.png',
      'wss://example.com/socket',
      'ftp://localhost/file',
      'chrome-extension://abc/page.html',
      '//example.com/x',
      'not a url',
      ''
    ]) {
      expect(isLocalRequest(url), url).toBe(false)
    }
  })
})

describe('바깥으로 나갈 수 있는 길을 모두 센다(소스 검사)', () => {
  it('Claude SDK는 직접 답변의 호출 한 곳(advisor.ts)에서만 쓴다. 그 호출은 controller.ts에서만 부른다', () => {
    expect(mentioning(/@anthropic-ai\/sdk/)).toEqual(['main/talk/advisor.ts'])
    expect(mentioning(/\brespond\(/).sort()).toEqual(['main/talk/advisor.ts', 'main/talk/controller.ts'])
  })

  it('fetch는 플러그인 창구(bridge.ts, 주소를 이 PC로 못 박아 둔다)와 앱 파일 읽기(index.ts의 net.fetch(file URL))뿐이다', () => {
    expect(mentioning(/\bfetch\(/).sort()).toEqual(['main/index.ts', 'main/talk/bridge.ts'])
    const index = sources.find((source) => source.file === 'main/index.ts')!.text
    expect(index.match(/\bfetch\(/g)).toHaveLength(1)
    expect(index).toContain('net.fetch(pathToFileURL(file).toString())')
    // 플러그인 창구의 주소는 localhost나 127.0.0.1뿐이다
    const bridge = sources.find((source) => source.file === 'main/talk/bridge.ts')!.text
    expect(bridge).toContain("raw.host === 'localhost' ? 'localhost' : '127.0.0.1'")
    expect(bridge.match(/https?:\/\//g)).toEqual(['http://', 'http://'])
  })

  it('저수준 네트워크 모듈, 웹소켓, 비콘, 바깥 링크 열기, 자동 갱신, 충돌 보고는 어디에도 없다', () => {
    expect(mentioning(/node:(http|https|http2|net|tls|dgram|dns)['"]|from ['"](http|https|net|tls|dgram|dns)['"]/)).toEqual([])
    expect(mentioning(/\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection)\b/)).toEqual([])
    expect(mentioning(/openExternal|autoUpdater|crashReporter|child_process|node:cluster/)).toEqual([])
  })

  it('코드와 스타일에 바깥 주소 글자가 없다(플러그인 창구의 http://${host}와 개발 서버의 localhost뿐)', () => {
    const remote = sources.flatMap((source) =>
      [...source.text.matchAll(/(?:https?|wss?|ftp):\/\/(?!\$\{bridge\.host\}|localhost[:/*]|127\.0\.0\.1)[^\s'"`)]+/g)].map((match) => `${source.file}: ${match[0]}`)
    )
    expect(remote).toEqual([])
  })

  it('화면의 보안 정책(CSP)은 바깥 서버를 열어 주지 않는다: self, data, fmface, 개발 서버 웹소켓뿐', () => {
    const html = readFileSync(join(SRC, 'renderer', 'index.html'), 'utf8')
    const policy = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(policy).not.toBe('')
    expect(policy).toContain("default-src 'self'")
    expect(policy).not.toMatch(/https?:|\*\.|\s\*[;\s]|wss:/)
    expect(policy).toContain('connect-src \'self\' ws://localhost:*')
    // 원격 글꼴·이미지·스크립트 태그가 없다
    expect(html).not.toMatch(/<(link|script|img)[^>]+(https?:)?\/\/[a-z]/i)
  })
})

describe('길마다 막혀 있는가', () => {
  let server: Server
  const seen: string[] = []
  const replies: Array<Record<string, unknown>> = []
  let controller: TalkController | null = null

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = request.url ?? ''
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        seen.push(`${request.headers.host} ${url}`)
        if (url.startsWith('/talk/poll?after=0')) response.end('1\ntalk\n행운을 빈다')
        else if (url.startsWith('/talk/poll')) response.end('')
        else if (url.startsWith('/talk/reply')) {
          replies.push(JSON.parse(body) as Record<string, unknown>)
          response.end('ok')
          controller?.dispose()
        } else if (url === '/state') response.end('{"version":"0.11.0","loaded":true}')
        else response.writeHead(404).end('unknown path')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const home = mkdtempSync(join(tmpdir(), 'fmb-outbound-'))
    mkdirSync(join(home, 'FmBojwagwan'))
    // 접속 정보 파일이 바깥 서버 이름을 가리켜도 앱은 이 PC로만 묻는다
    writeFileSync(
      join(home, 'FmBojwagwan', 'bridge.json'),
      JSON.stringify({ host: 'evil.example.com', port: (server.address() as AddressInfo).port, token: 'secret' })
    )
    process.env.LOCALAPPDATA = home
  })

  afterAll(() => {
    server.close()
  })

  it('접속 정보 파일의 서버 이름이 바깥 주소여도 127.0.0.1로만 묻는다', async () => {
    expect((await gameState())?.version).toBe('0.11.0')
    expect(seen.at(-1)).toMatch(/^127\.0\.0\.1:\d+ \/state$/)
  })

  it('직접 답변이 꺼져 있으면(API 키 없음) 게임 안 칸에 말이 와도 Claude를 부르지 않고, 이 PC 밖으로 아무 요청도 가지 않는다', async () => {
    const original = globalThis.fetch
    const urls: string[] = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input instanceof Request ? input.url : input))
      return original(input, init)
    })
    try {
      const keys = { has: () => false, read: () => null } as unknown as KeyStore
      const settings = { get: () => ({}), set: () => ({}) } as unknown as SettingsStore
      controller = new TalkController(keys, settings, () => ['선수01'])
      await controller.serveGame()
      expect(replies).toHaveLength(1)
      expect(String(replies[0].error)).toContain('키가 없습니다')
      expect(urls.length).toBeGreaterThan(0)
      expect(urls.every((url) => isLocalRequest(url) && new URL(url).hostname === '127.0.0.1')).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
