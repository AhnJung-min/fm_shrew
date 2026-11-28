#!/usr/bin/env node
/*
  화면 검증 틀(디자인 적용 1차). 미리보기(`npm run web -- --port <포트>`)를 이 PC의 Edge나 Chrome으로 headless로 찍고, 화면 안에서 재고, 앞뒤를 견준다.
  새 의존성이 없다(Node 내장 WebSocket으로 DevTools 규약을 직접 말한다). 앱(Electron)과 게임은 켜지 않는다.

  명령
    shoot    --url http://localhost:<포트> --out <폴더> [--sets core,states,table,narrow,zoom,motion,forced]
             [--sizes 1304x800,960x700] [--themes blue,black] [--only targets,squad] [--extra "pick=123"] [--browser <실행 파일>]
    compare  <앞 폴더> <뒤 폴더> [--out <폴더>] [--expect-same]
             앞뒤 폴더의 json(재기 결과와 요소별 지문)과 png(픽셀)를 견줘 compare.html과 summary.md를 쓴다. 쓰는 자리는 --out, 없으면
             앞뒤 폴더가 같은 폴더(예: shots/B/before와 shots/B/after) 밑의 형제일 때 그 위 폴더(shots/B), 아니면 뒤 폴더다.
             --expect-same은 지문이나 픽셀이 하나라도 다르면 1로 끝난다(같은 커밋을 두 번 찍어 틀이 흔들리지 않는지 볼 때).
    run      <시나리오.mjs> --url http://localhost:<포트> --out <폴더> [--only 이름,이름]
             걸음(goto, viewport, media, click, hover, key, type, wheel, wait, eval, measure, assert, shot)을 따라 하고 단언이 하나라도 틀리면 1로 끝난다
    help

  묶음(--sets)
    core     화면 8개(dashboard, home, squad, targets, compare, editor, backups, settings) × --sizes × --themes
    states   dashboard와 home의 ?empty ?off ?off&seen ?old ?noteam ?badformat
    table    영입 후보의 창 열림과 오른쪽으로 민 표, 스쿼드의 오른쪽으로 민 표·전술판·뎁스·창 열림
    narrow   880x640과 380x520의 core 화면들과 영입 후보 창 열림
    zoom     110%·125%와 같은 배치(1185x727@1.1, 1043x640@1.25, 873x636@1.1, 768x560@1.25). 참고용
    motion   움직임 줄이기 흉내    forced   고대비(forced-colors) 흉내
  사진 이름: <화면>-<상태>-<가로>x<세로>[@배율]-<테마>.png, 같은 이름의 .json(ui-audit.js의 결과와 지문)과 폴더의 _run.json(찍은 설정)

  지키는 것
    - localhost, 127.0.0.1, [::1]의 미리보기에만 붙는다. 사용자의 브라우저 프로필을 쓰지 않는다.
    - 브라우저는 운영 체제 임시 폴더의 새 프로필로 --remote-debugging-port=0(빈 포트를 스스로 고른다)으로 켜고,
      끝나면(오류와 Ctrl+C 포함) 반드시 끄고 임시 폴더를 지운다.
    - 결과(사진과 json)는 --out 폴더에만 쓴다. 기본은 이 저장소의 .smoke/shots/<때>(git이 무시한다).
    - 실제 세이브로 찍은 앱 화면에는 실제 선수 이름이 나온다. 그런 결과는 저장소 밖에만 둔다. 미리보기의 지어낸 자료만 이 저장소 안에 둔다.
  환경 값: FMB_BROWSER(브라우저 실행 파일). 없으면 Edge, 그다음 Chrome의 기본 설치 자리.
  끝 값: 0 성공, 1 찍기·단언 실패, 2 환경 문제(브라우저나 미리보기를 못 찾음), 3 글꼴을 받지 못함(찍어 봐야 거짓 사진이다).
*/
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const AUDIT_SOURCE_PATH = join(HERE, 'ui-audit.js')

const SCREENS = ['dashboard', 'home', 'squad', 'targets', 'compare', 'editor', 'backups', 'settings']
const DEFAULT_SIZES = '1304x800,960x700'
const DEFAULT_THEMES = 'blue,black'
const STATES = [
  { id: 'empty', query: 'empty' },
  { id: 'off', query: 'off' },
  { id: 'offseen', query: 'off&seen' },
  { id: 'old', query: 'old' },
  { id: 'noteam', query: 'noteam' },
  { id: 'badformat', query: 'badformat' }
]
/** 시계는 이 때(한국 시각 12시 30분 30초)에서 출발해 실제 속도로 흐른다: 분 경계에서 30초 떨어져 있어 글자가 흔들리지 않는다 */
const FIXED_NOW = Date.UTC(2026, 6, 15, 3, 30, 30)
const TIMEZONE = 'Asia/Seoul'
const LOCALE = 'ko-KR'
/** 화면이 가라앉기를 기다리는 조용한 시간(DOM이 이만큼 바뀌지 않으면 가라앉은 것)과 가장 오래 기다릴 시간 */
const QUIET_MS = 700
const SETTLE_MAX_MS = 12_000

class FontMissingError extends Error {}
class EnvironmentError extends Error {}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
const log = (...parts) => console.log(...parts)
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 1) + '\n')

// =====================================================================================================================
// 인자
// =====================================================================================================================

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    if (eq > 0) flags[arg.slice(2, eq)] = arg.slice(eq + 1)
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[arg.slice(2)] = argv[++i]
    else flags[arg.slice(2)] = true
  }
  return { positional, flags }
}

const csv = (value) => (typeof value === 'string' ? value.split(',').map((part) => part.trim()).filter(Boolean) : [])

/** '1304x800', '1185x727@1.1' → { width, height, scale } */
function parseSize(text) {
  const match = /^(\d+)x(\d+)(?:@([\d.]+))?$/.exec(text)
  if (!match) throw new EnvironmentError(`크기를 읽지 못했습니다: "${text}" (예: 1304x800 또는 1185x727@1.1)`)
  return { width: Number(match[1]), height: Number(match[2]), scale: match[3] ? Number(match[3]) : 1 }
}

function checkLocalUrl(text) {
  let url
  try {
    url = new URL(text)
  } catch {
    throw new EnvironmentError(`--url을 읽지 못했습니다: "${text}" (예: http://localhost:5284)`)
  }
  const host = url.hostname
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    throw new EnvironmentError(`localhost의 미리보기에만 붙습니다(받은 주소: ${host}). 다른 주소는 거절합니다.`)
  }
  return url.origin
}

// =====================================================================================================================
// 브라우저를 켜고 끄기
// =====================================================================================================================

const live = { child: null, profile: null, ws: null, cdp: null, shuttingDown: false, done: false }

function findBrowser(flagPath) {
  const given = flagPath || process.env.FMB_BROWSER
  if (given) {
    if (!existsSync(given)) throw new EnvironmentError(`브라우저를 찾지 못했습니다: ${given}`)
    return given
  }
  const candidates = []
  if (process.platform === 'win32') {
    const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)
    for (const base of roots) candidates.push(join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    for (const base of roots) candidates.push(join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  } else {
    candidates.push('/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser')
  }
  const found = candidates.find((path) => existsSync(path))
  if (!found) throw new EnvironmentError('Edge나 Chrome을 찾지 못했습니다. 환경 값 FMB_BROWSER에 실행 파일 경로를 적어 주세요.')
  return found
}

function killTree(pid) {
  if (!pid) return
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else process.kill(pid, 'SIGKILL')
  } catch {
    /* 이미 끝난 것 */
  }
}

/** 동기로 잠깐 쉰다(exit 처리기 안에서도 쓸 수 있게) */
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function removeProfile(dir) {
  if (!dir) return
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      // 브라우저가 막 끝나 파일을 놓지 않은 때: 잠깐 뒤에 다시
      sleepSync(200)
    }
  }
  console.error(`임시 프로필 폴더를 지우지 못했습니다: ${dir}`)
}

/** 브라우저와 임시 폴더를 모두 정리한다. 여러 번 불러도 한 번만 한다 */
async function shutdown() {
  if (live.shuttingDown) return
  live.shuttingDown = true
  const { child, profile, ws, cdp } = live
  try {
    if (cdp && ws && ws.readyState === 1) await Promise.race([cdp.send('Browser.close'), sleep(3000)])
  } catch {
    /* 이미 닫힘 */
  }
  try {
    ws?.close()
  } catch {
    /* 이미 닫힘 */
  }
  if (child && child.exitCode === null) {
    const exited = new Promise((done) => child.once('exit', done))
    await Promise.race([exited, sleep(5000)])
    if (child.exitCode === null) {
      killTree(child.pid)
      await Promise.race([exited, sleep(3000)])
    }
  }
  removeProfile(profile)
  live.done = true
}

// 마지막 안전장치: 어떤 길로 끝나도 브라우저가 남지 않게 한다(동기로만 할 수 있는 것)
process.on('exit', () => {
  if (live.done) return
  live.done = true
  if (live.child && live.child.exitCode === null) killTree(live.child.pid)
  removeProfile(live.profile)
})
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    console.error(`\n${signal}: 브라우저를 끄고 정리합니다.`)
    shutdown().finally(() => process.exit(130))
  })
}

async function launchBrowser(browserPath) {
  const profile = mkdtempSync(join(tmpdir(), 'fmb-ui-shots-'))
  live.profile = profile
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-client-side-phishing-detection',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=Translate,OptimizationHints,MediaRouter,msEdgeSync,msEdgeShopping',
    '--metrics-recording-only',
    '--no-pings',
    '--lang=ko-KR',
    '--window-size=1500,1000',
    'about:blank'
  ]
  const child = spawn(browserPath, args, { stdio: 'ignore', windowsHide: true })
  live.child = child
  let spawnError = null
  child.once('error', (error) => {
    spawnError = error
  })
  // DevToolsActivePort: 첫 줄이 고른 포트, 둘째 줄이 브라우저 주소 뒷부분
  const portFile = join(profile, 'DevToolsActivePort')
  const deadline = Date.now() + 30_000
  while (!existsSync(portFile)) {
    if (spawnError) throw new EnvironmentError(`브라우저를 켜지 못했습니다: ${spawnError.message}`)
    if (child.exitCode !== null) throw new EnvironmentError(`브라우저가 바로 끝났습니다(끝 값 ${child.exitCode}).`)
    if (Date.now() > deadline) throw new EnvironmentError('브라우저가 디버깅 포트를 열지 않았습니다(30초).')
    await sleep(100)
  }
  const [port, path] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/)
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  await new Promise((done, fail) => {
    ws.addEventListener('open', done, { once: true })
    ws.addEventListener('error', () => fail(new EnvironmentError('DevTools에 연결하지 못했습니다.')), { once: true })
  })
  live.ws = ws
  const cdp = new Cdp(ws)
  live.cdp = cdp
  return cdp
}

// =====================================================================================================================
// DevTools 규약
// =====================================================================================================================

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.handlers = []
    ws.addEventListener('message', (event) => this.receive(typeof event.data === 'string' ? event.data : String(event.data)))
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('DevTools 연결이 끊어졌습니다'))
      this.pending.clear()
    })
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    const message = { id, method, params }
    if (sessionId) message.sessionId = sessionId
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject, method })
      this.ws.send(JSON.stringify(message))
    })
  }

  on(method, handler, sessionId) {
    const entry = { method, handler, sessionId }
    this.handlers.push(entry)
    return () => {
      this.handlers = this.handlers.filter((each) => each !== entry)
    }
  }

  /** 사건 하나를 기다린다 */
  waitFor(method, sessionId, timeout = 30_000) {
    return new Promise((resolveWait, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error(`${method}를 ${timeout}ms 안에 받지 못했습니다`))
      }, timeout)
      const off = this.on(
        method,
        (params) => {
          clearTimeout(timer)
          off()
          resolveWait(params)
        },
        sessionId
      )
    })
  }

  receive(text) {
    const message = JSON.parse(text)
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`))
      else entry.resolve(message.result)
      return
    }
    for (const { method, handler, sessionId } of [...this.handlers]) {
      if (method === message.method && (sessionId === undefined || sessionId === message.sessionId)) handler(message.params)
    }
  }
}

const CLOCK_SHIM = `(() => {
  const RealDate = Date
  const base = ${FIXED_NOW}
  const started = performance.now()
  const now = () => base + Math.floor(performance.now() - started)
  function FakeDate(...args) {
    if (!new.target) return new RealDate(now()).toString()
    return args.length === 0 ? new RealDate(now()) : new RealDate(...args)
  }
  FakeDate.prototype = RealDate.prototype
  Object.setPrototypeOf(FakeDate, RealDate)
  FakeDate.now = now
  globalThis.Date = FakeDate
})()`

/** 화면이 가라앉을 때까지 기다린다: 글꼴을 다 받고, DOM이 한동안 바뀌지 않고, 그림 두 번 */
const SETTLE_SOURCE = (quiet, max) => `(async () => {
  const t0 = performance.now()
  let last = performance.now()
  const observer = new MutationObserver(() => { last = performance.now() })
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
  const waitQuiet = () => new Promise((done) => {
    const tick = () => {
      const now = performance.now()
      if (now - last >= ${quiet} || now - t0 >= ${max}) done()
      else setTimeout(tick, 40)
    }
    tick()
  })
  try {
    for (let i = 0; i < 4; i++) {
      await document.fonts.ready
      await waitQuiet()
      if (![...document.fonts].some((face) => face.status === 'loading')) break
    }
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  } finally {
    observer.disconnect()
  }
  return Math.round(performance.now() - t0)
})()`

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  F5: { key: 'F5', code: 'F5', vk: 116 }
}
const MODIFIER_BITS = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Shift: 8 }

class Page {
  constructor(cdp, sessionId, origin) {
    this.cdp = cdp
    this.sessionId = sessionId
    this.origin = origin
    this.problems = []
    this.auditSource = readFileSync(AUDIT_SOURCE_PATH, 'utf8')
  }

  send(method, params) {
    return this.cdp.send(method, params, this.sessionId)
  }

  static async open(cdp, origin) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const page = new Page(cdp, sessionId, origin)
    await Promise.all([page.send('Page.enable'), page.send('Runtime.enable'), page.send('Network.enable'), page.send('Log.enable')])
    cdp.on('Runtime.exceptionThrown', (p) => page.problems.push({ kind: 'exception', text: p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '' }), sessionId)
    cdp.on(
      'Runtime.consoleAPICalled',
      (p) => {
        if (p.type === 'error') page.problems.push({ kind: 'console', text: (p.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 300) })
      },
      sessionId
    )
    // 사이트 아이콘이 없는 404는 늘 있는 일이라 적지 않는다
    cdp.on('Network.responseReceived', (p) => p.response.status >= 400 && !p.response.url.endsWith('/favicon.ico') && page.problems.push({ kind: 'http', text: `${p.response.status} ${p.response.url}`.slice(0, 300) }), sessionId)
    cdp.on('Network.loadingFailed', (p) => !p.canceled && page.problems.push({ kind: 'network', text: `${p.errorText} ${p.type || ''}`.trim() }), sessionId)
    // 포커스가 있는 창으로 보이게 한다(:focus-visible이 키보드 입력에 맞게 걸린다)
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.send('Emulation.setTimezoneOverride', { timezoneId: TIMEZONE }).catch(() => undefined)
    await page.send('Emulation.setLocaleOverride', { locale: LOCALE }).catch(() => undefined)
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK_SHIM })
    return page
  }

  async eval(expression, { awaitPromise = true } = {}) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true })
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails
      throw new Error(detail.exception?.description || detail.text || '화면 안의 식이 실패했습니다')
    }
    return result.result.value
  }

  /** 빈 문서로 돌아가 앞 시나리오의 상태를 모두 버린다 */
  async reset() {
    const blank = this.cdp.waitFor('Page.loadEventFired', this.sessionId)
    await this.send('Page.navigate', { url: 'about:blank' })
    await blank
  }

  async setViewport({ width, height, scale = 1 }) {
    this.viewport = { width, height, scale }
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
  }

  /** 켜는 쪽: { 'prefers-reduced-motion': 'reduce' }, { 'forced-colors': 'active' }. 빈 객체면 모두 푼다 */
  async setMedia(features) {
    await this.send('Emulation.setEmulatedMedia', { features: Object.entries(features).map(([name, value]) => ({ name, value })) })
  }

  async settle(quiet = QUIET_MS, max = SETTLE_MAX_MS) {
    return this.eval(SETTLE_SOURCE(quiet, max))
  }

  /**
   * 주소로 간다. 같은 문서의 #만 다르면(사용자가 화면을 옮기는 것처럼) 주소의 #만 바꾸고, fresh면 늘 새로 불러 처음 상태에서 찍는다.
   * 새로 불러올 때는 빈 문서를 거쳐서 #만 다른 주소도 정말 다시 불러온다.
   */
  async goto(target, { fresh = false } = {}) {
    const url = target.startsWith('http') ? target : this.origin + (target.startsWith('/') ? target : '/' + target)
    this.problems = []
    const current = await this.eval('location.href').catch(() => '')
    const strip = (text) => text.replace(/#.*$/, '')
    if (!fresh && current && strip(current) === strip(url) && url.includes('#')) {
      await this.eval(`location.hash = ${JSON.stringify(url.slice(url.indexOf('#')))}`)
    } else {
      if (fresh && current && current !== 'about:blank') {
        const blank = this.cdp.waitFor('Page.loadEventFired', this.sessionId)
        await this.send('Page.navigate', { url: 'about:blank' })
        await blank
      }
      const loaded = this.cdp.waitFor('Page.loadEventFired', this.sessionId)
      const navigated = await this.send('Page.navigate', { url })
      if (navigated.errorText) throw new EnvironmentError(`${url}을 열지 못했습니다: ${navigated.errorText} (미리보기가 켜져 있나요?)`)
      await loaded
    }
    return this.settle()
  }

  /** 글꼴을 받았는지 보고, 못 받았으면 던진다(대체 글꼴로 찍은 사진과 잰 값은 거짓이다) */
  async checkFonts() {
    const fonts = await this.eval(`(() => {
      const faces = [...document.fonts].filter((face) => /pretendard/i.test(face.family)).map((face) => ({ family: face.family, status: face.status }))
      return { faces, loaded: faces.some((face) => face.status === 'loaded'), error: faces.some((face) => face.status === 'error') }
    })()`)
    if (!fonts.loaded) {
      const detail = fonts.faces.length ? fonts.faces.map((face) => `${face.family}=${face.status}`).join(', ') : 'Pretendard 글꼴 규칙이 없습니다'
      const failed = this.problems.filter((problem) => problem.kind === 'http' || problem.kind === 'network').map((problem) => problem.text)
      throw new FontMissingError(`Pretendard 글꼴을 받지 못했습니다(${detail}). 대체 글꼴로 찍은 사진과 잰 값은 실제와 다릅니다.${failed.length ? ' 실패한 요청: ' + failed.join(' / ') : ''}`)
    }
    return fonts
  }

  async audit({ fingerprint = true } = {}) {
    await this.eval(`window.__fmbAuditOptions = ${JSON.stringify({ noFingerprint: !fingerprint })}`)
    return this.eval(this.auditSource, { awaitPromise: false })
  }

  async screenshot() {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    return Buffer.from(data, 'base64')
  }

  // ---------- 입력 ----------

  async box(target) {
    const spec = typeof target === 'string' ? { selector: target } : target
    if (typeof spec.x === 'number' && typeof spec.y === 'number') return { x: spec.x, y: spec.y }
    const found = await this.eval(`(() => {
      const spec = ${JSON.stringify(spec)}
      let list = [...document.querySelectorAll(spec.selector)]
      if (spec.text !== undefined) list = list.filter((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().includes(spec.text))
      const el = list[spec.nth || 0]
      if (!el) return null
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const rect = el.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, count: list.length }
    })()`)
    if (!found) throw new Error(`누를 요소가 없습니다: ${JSON.stringify(spec)}`)
    return found
  }

  async mouse(type, x, y, extra = {}) {
    await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1, ...extra })
  }

  async hover(target) {
    const { x, y } = await this.box(target)
    await this.mouse('mouseMoved', x, y)
    await sleep(180)
  }

  async click(target) {
    const { x, y } = await this.box(target)
    await this.mouse('mouseMoved', x, y)
    await this.mouse('mousePressed', x, y)
    await this.mouse('mouseReleased', x, y)
  }

  async wheel(spec) {
    const point = spec.selector ? await this.box(spec) : { x: spec.x ?? 10, y: spec.y ?? 10 }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: spec.deltaX ?? 0, deltaY: spec.deltaY ?? 0 })
  }

  async key(combo) {
    const parts = combo.split('+')
    const name = parts.pop() || '+'
    let modifiers = 0
    for (const part of parts) {
      if (!(part in MODIFIER_BITS)) throw new Error(`알 수 없는 조합 글쇠: ${part} (${combo})`)
      modifiers |= MODIFIER_BITS[part]
    }
    let info = KEYS[name]
    if (!info) {
      if ([...name].length !== 1) throw new Error(`알 수 없는 글쇠: ${name}`)
      const upper = name.toUpperCase()
      const isLetter = /[a-z]/i.test(name)
      info = { key: modifiers & 8 ? upper : name, code: isLetter ? `Key${upper}` : /\d/.test(name) ? `Digit${name}` : '', vk: isLetter || /\d/.test(name) ? upper.charCodeAt(0) : name.charCodeAt(0), text: name }
    }
    // Ctrl·Alt·Meta가 눌린 글자 글쇠는 글자가 입력되지 않는다(글쇠 처리기만 반응한다)
    const text = modifiers & 7 ? undefined : info.text
    const base = { modifiers, key: info.key, code: info.code, windowsVirtualKeyCode: info.vk, nativeVirtualKeyCode: info.vk }
    await this.send('Input.dispatchKeyEvent', { ...base, type: text ? 'keyDown' : 'rawKeyDown', ...(text ? { text, unmodifiedText: text } : {}) })
    await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
  }

  async type(text) {
    await this.send('Input.insertText', { text })
  }
}

// =====================================================================================================================
// 걸음
// =====================================================================================================================

function describeStep(step) {
  const [kind] = Object.keys(step).filter((key) => !['message', 'name', 'full', 'quiet', 'fresh', 'meta'].includes(key))
  // 단언은 식 대신 그 뜻(message)을 보인다
  if (kind === 'assert' && step.message) return `assert ${step.message}`
  const value = step[kind]
  return `${kind}${value === true || value === undefined ? '' : ' ' + (typeof value === 'string' ? value : JSON.stringify(value)).replace(/\s+/g, ' ').slice(0, 90)}`
}

/** 걸음 하나. 단언이 틀리면 던진다(AssertionFailure). ctx: { page, out, results, scenario, saveShot } */
class AssertionFailure extends Error {}

async function runStep(step, ctx) {
  const { page } = ctx
  if ('goto' in step) return void (await page.goto(step.goto, { fresh: !!step.fresh }))
  if ('viewport' in step) return void (await page.setViewport(typeof step.viewport === 'string' ? parseSize(step.viewport) : step.viewport))
  if ('media' in step) return void (await page.setMedia(step.media))
  if ('click' in step) {
    await page.click(step.click)
    return void (await page.settle(step.quiet ?? 350, 4000))
  }
  if ('hover' in step) return void (await page.hover(step.hover))
  if ('key' in step) {
    await page.key(step.key)
    return void (await sleep(120))
  }
  if ('type' in step) return void (await page.type(step.type))
  if ('wheel' in step) {
    await page.wheel(step.wheel)
    return void (await sleep(200))
  }
  if ('wait' in step) {
    if (typeof step.wait === 'number') return void (await sleep(step.wait))
    // { wait: { until: '식', timeout: 3000 } }: 식이 참이 될 때까지
    const { until, timeout = 5000 } = step.wait
    const deadline = Date.now() + timeout
    while (!(await page.eval(until))) {
      if (Date.now() > deadline) throw new AssertionFailure(`기다리던 조건이 ${timeout}ms 안에 참이 되지 않았습니다: ${until}`)
      await sleep(80)
    }
    return
  }
  if ('eval' in step) return void (await page.eval(step.eval))
  if ('measure' in step) {
    const name = typeof step.measure === 'string' ? step.measure : step.measure.name
    const value = typeof step.measure === 'object' && step.measure.eval ? await page.eval(step.measure.eval) : await page.audit({ fingerprint: !!step.full })
    ctx.results.measures[`${ctx.scenario}/${name}`] = value
    return
  }
  if ('assert' in step) {
    let value
    try {
      value = await page.eval(step.assert)
    } catch (error) {
      throw new AssertionFailure(`${step.message || step.assert}: 식이 실패했습니다(${String(error.message).split('\n')[0]})`)
    }
    if (!value) throw new AssertionFailure(`${step.message || '단언이 틀렸습니다'}\n      식: ${step.assert.replace(/\s+/g, ' ').slice(0, 200)}\n      값: ${JSON.stringify(value)}`)
    return
  }
  if ('shot' in step) return void (await ctx.saveShot(typeof step.shot === 'string' ? step.shot : step.shot.name, step.meta))
  throw new Error(`알 수 없는 걸음: ${JSON.stringify(step).slice(0, 120)}`)
}

// =====================================================================================================================
// shoot: 묶음 → 찍을 목록
// =====================================================================================================================

function nameOf(spec) {
  const { width, height, scale } = spec.size
  return `${spec.screen}-${spec.state}-${width}x${height}${scale !== 1 ? `@${scale}` : ''}-${spec.theme}`
}

function urlOf(spec, extra) {
  const params = []
  if (spec.query) params.push(spec.query)
  if (spec.theme === 'black') params.push('theme=black')
  if (extra) params.push(extra.replace(/^[?&]/, ''))
  return `/${params.length ? '?' + params.join('&') : ''}#${spec.screen}`
}

// 줄의 이름 칸을 누른다(고정 칸이라 표가 가로로 밀리지 않는다)
const CLICK_FIRST_ROW = { click: '.table-scroll tbody tr.row td.sticky-col' }
const SCROLL_TABLE_RIGHT = { eval: "(() => { const el = document.querySelector('.table-scroll'); if (el) el.scrollLeft = 600 })()" }
const VIEW_BUTTON = (text) => ({ click: { selector: '[aria-label="보기 방식"] button', text } })

/** 묶음 이름 → (사용자가 준 크기와 테마를 받아) 찍을 것들 */
function expandSets(sets, { sizes, themes, only }) {
  const specs = []
  const push = (screen, state, query, size, theme, steps = []) => specs.push({ screen, state, query, size, theme, steps })
  for (const set of sets) {
    if (set === 'core') {
      for (const size of sizes) for (const theme of themes) for (const screen of SCREENS) push(screen, 'base', '', size, theme)
    } else if (set === 'states') {
      for (const size of sizes) for (const theme of themes) for (const screen of ['dashboard', 'home']) for (const state of STATES) push(screen, state.id, state.query, size, theme)
    } else if (set === 'table') {
      for (const size of sizes) {
        for (const theme of themes) {
          push('targets', 'open', '', size, theme, [CLICK_FIRST_ROW])
          push('targets', 'scrollright', '', size, theme, [SCROLL_TABLE_RIGHT, { wait: 200 }])
          push('squad', 'scrollright', '', size, theme, [SCROLL_TABLE_RIGHT, { wait: 200 }])
          push('squad', 'tactics', '', size, theme, [VIEW_BUTTON('전술판')])
          push('squad', 'depth', '', size, theme, [VIEW_BUTTON('뎁스 차트')])
          push('squad', 'open', '', size, theme, [CLICK_FIRST_ROW])
        }
      }
    } else if (set === 'narrow') {
      for (const size of ['880x640', '380x520'].map(parseSize)) {
        for (const theme of themes) {
          for (const screen of SCREENS) push(screen, 'base', '', size, theme)
          push('targets', 'open', '', size, theme, [CLICK_FIRST_ROW])
        }
      }
    } else if (set === 'zoom') {
      for (const size of ['1185x727@1.1', '1043x640@1.25', '873x636@1.1', '768x560@1.25'].map(parseSize)) {
        for (const theme of themes) for (const screen of SCREENS) push(screen, 'zoom', '', size, theme)
      }
    } else if (set === 'motion' || set === 'forced') {
      for (const size of sizes) for (const theme of themes) for (const screen of ['dashboard', 'squad', 'targets', 'home']) push(screen, set, '', size, theme)
    } else {
      throw new EnvironmentError(`알 수 없는 묶음: ${set} (core, states, table, narrow, zoom, motion, forced)`)
    }
  }
  return only.length ? specs.filter((spec) => only.includes(spec.screen)) : specs
}

const MEDIA_OF_SET = {
  motion: { 'prefers-reduced-motion': 'reduce' },
  forced: { 'forced-colors': 'active' }
}

async function commandShoot(flags) {
  const origin = checkLocalUrl(flags.url ?? '')
  const out = resolve(typeof flags.out === 'string' ? flags.out : join(ROOT, '.smoke', 'shots', new Date().toISOString().replace(/[:.]/g, '-')))
  const sets = csv(typeof flags.sets === 'string' ? flags.sets : 'core')
  const sizes = csv(typeof flags.sizes === 'string' ? flags.sizes : DEFAULT_SIZES).map(parseSize)
  const themes = csv(typeof flags.themes === 'string' ? flags.themes : DEFAULT_THEMES)
  for (const theme of themes) if (!['blue', 'black'].includes(theme)) throw new EnvironmentError(`알 수 없는 테마: ${theme} (blue, black)`)
  const only = csv(typeof flags.only === 'string' ? flags.only : '')
  const extra = typeof flags.extra === 'string' ? flags.extra : ''
  const specs = []
  for (const set of sets) for (const spec of expandSets([set], { sizes, themes, only })) specs.push({ ...spec, set })
  if (!specs.length) throw new EnvironmentError('찍을 것이 없습니다(--sets나 --only를 확인하세요).')
  await assertPreviewUp(origin)
  mkdirSync(out, { recursive: true })

  const browserPath = findBrowser(typeof flags.browser === 'string' ? flags.browser : undefined)
  log(`브라우저: ${browserPath}`)
  const cdp = await launchBrowser(browserPath)
  const page = await Page.open(cdp, origin)
  const version = await cdp.send('Browser.getVersion')
  log(`${version.product} / 찍을 것 ${specs.length}장 → ${out}`)

  const done = []
  const failed = []
  let currentMedia = '{}'
  const started = Date.now()
  for (const [index, spec] of specs.entries()) {
    const name = nameOf(spec)
    const url = urlOf(spec, extra)
    const label = `[${index + 1}/${specs.length}] ${name}`
    try {
      const media = JSON.stringify(MEDIA_OF_SET[spec.set] ?? {})
      if (media !== currentMedia) {
        // 움직임 줄이기·고대비 흉내는 그 묶음에만 건다
        await page.setMedia({ 'prefers-reduced-motion': 'no-preference', 'forced-colors': 'none', ...(MEDIA_OF_SET[spec.set] ?? {}) })
        currentMedia = media
      }
      await page.setViewport(spec.size)
      await page.goto(url, { fresh: true })
      const fonts = await page.checkFonts()
      for (const step of spec.steps) await runStep(step, { page, out, results: { measures: {} }, scenario: name, saveShot: async () => undefined })
      const shot = await writeShot(page, out, name, { screen: spec.screen, state: spec.state, set: spec.set, url, theme: spec.theme, size: spec.size, fonts })
      done.push({ name, ...shot })
      log(`${label}  ok  글자 ${shot.summary.minFontPx}px 이상, 줄 ${shot.summary.tableRows ?? '-'}/${shot.summary.tableRowCapacity ?? '-'}${shot.problems ? `, 브라우저 문제 ${shot.problems}건` : ''}`)
    } catch (error) {
      if (error instanceof FontMissingError || error instanceof EnvironmentError) throw error
      failed.push({ name, error: String(error.message).split('\n')[0] })
      console.error(`${label}  실패: ${String(error.message).split('\n')[0]}`)
    }
  }
  const version2 = await page.eval('navigator.userAgent')
  writeJson(join(out, '_run.json'), {
    tool: 'scripts/ui-shots.mjs',
    at: new Date().toISOString(),
    seconds: Math.round((Date.now() - started) / 1000),
    origin,
    sets,
    sizes: sizes.map((size) => `${size.width}x${size.height}`),
    themes,
    only,
    extra,
    browser: version.product,
    userAgent: version2,
    fixedClock: new Date(FIXED_NOW).toISOString(),
    timezone: TIMEZONE,
    shots: done.map((shot) => ({ name: shot.name, ...shot.summary, problems: shot.problems })),
    failed
  })
  log(`끝: 성공 ${done.length}장, 실패 ${failed.length}장, ${Math.round((Date.now() - started) / 1000)}초`)
  return failed.length ? 1 : 0
}

async function assertPreviewUp(origin) {
  try {
    const response = await fetch(origin + '/', { signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  } catch (error) {
    throw new EnvironmentError(`${origin}에 미리보기가 없습니다(${error.message}). 먼저 npm run web -- --port <포트>로 켜세요.`)
  }
}

/** 사진 한 장과 잰 값 json을 쓴다 */
async function writeShot(page, out, name, meta) {
  const png = await page.screenshot()
  const audit = await page.audit()
  const problems = page.problems.slice(0, 20)
  writeFileSync(join(out, `${name}.png`), png)
  writeJson(join(out, `${name}.json`), { name, ...meta, problems, audit })
  const { minFontPx, tableRows, tableRowCapacity, smallDimText, contrastFails, overflowX } = audit
  return { problems: problems.length, summary: { minFontPx, tableRows, tableRowCapacity, smallDimText, contrastFails, overflowX } }
}

// =====================================================================================================================
// run: 시나리오
// =====================================================================================================================

async function commandRun(positional, flags) {
  const file = positional[0]
  if (!file) throw new EnvironmentError('시나리오 파일을 적어 주세요: run scripts/scenarios/B.mjs --url ... --out ...')
  const origin = checkLocalUrl(flags.url ?? '')
  const out = resolve(typeof flags.out === 'string' ? flags.out : join(ROOT, '.smoke', 'shots', 'run-' + new Date().toISOString().replace(/[:.]/g, '-')))
  const only = csv(typeof flags.only === 'string' ? flags.only : '')
  const module = await import(pathToFileURL(resolve(file)).href)
  const definition = module.default
  const scenarios = (typeof definition === 'function' ? await definition({ origin }) : definition).scenarios.filter((each) => !only.length || only.includes(each.name))
  if (!scenarios.length) throw new EnvironmentError('돌릴 시나리오가 없습니다.')
  await assertPreviewUp(origin)
  mkdirSync(out, { recursive: true })

  const cdp = await launchBrowser(findBrowser(typeof flags.browser === 'string' ? flags.browser : undefined))
  const page = await Page.open(cdp, origin)
  const results = { unit: definition.unit ?? basename(file), at: new Date().toISOString(), origin, scenarios: [], measures: {} }
  let failures = 0
  for (const scenario of scenarios) {
    const record = { name: scenario.name, ok: true, steps: [] }
    log(`시나리오 ${scenario.name}`)
    await page.reset()
    await page.setMedia({ 'prefers-reduced-motion': 'no-preference', 'forced-colors': 'none' })
    await page.setViewport(scenario.viewport ? parseSize(scenario.viewport) : { width: 1304, height: 800, scale: 1 })
    const saveShot = async (shotName, meta) => {
      const fullName = `${scenario.name}-${shotName}`
      const saved = await writeShot(page, out, fullName, { scenario: scenario.name, ...(meta || {}) })
      record.steps.push({ step: `shot ${fullName}`, ok: true })
      return saved
    }
    for (const step of scenario.steps) {
      const text = describeStep(step)
      try {
        await runStep(step, { page, out, results, scenario: scenario.name, saveShot })
        record.steps.push({ step: text, ok: true })
        log(`  ok   ${text}`)
        if ('goto' in step) await page.checkFonts()
      } catch (error) {
        if (error instanceof FontMissingError) throw error
        record.ok = false
        record.steps.push({ step: text, ok: false, error: String(error.message).slice(0, 600) })
        console.error(`  틀림 ${text}\n      ${String(error.message).replace(/\n/g, '\n      ')}`)
        break
      }
    }
    if (!record.ok) failures++
    results.scenarios.push(record)
  }
  results.userAgent = await page.eval('navigator.userAgent')
  writeJson(join(out, 'results.json'), results)
  log(`시나리오 ${scenarios.length}개 중 ${scenarios.length - failures}개 통과, ${failures}개 실패 → ${join(out, 'results.json')}`)
  return failures ? 1 : 0
}

// =====================================================================================================================
// compare: 앞뒤 비교
// =====================================================================================================================

function loadShots(dir) {
  if (!existsSync(dir)) throw new EnvironmentError(`폴더가 없습니다: ${dir}`)
  const shots = new Map()
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json') && !name.startsWith('_'))) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      if (data.audit) shots.set(basename(file, '.json'), data)
    } catch {
      console.error(`읽지 못한 json을 건너뜁니다: ${join(dir, file)}`)
    }
  }
  return shots
}

function parseStyle(text) {
  const styles = {}
  for (const part of (text || '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) styles[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return styles
}

function indexFingerprint(list) {
  const index = new Map()
  const seen = new Map()
  for (const line of list || []) {
    const [path, box, text, style] = line.split('\t')
    const count = (seen.get(path) ?? 0) + 1
    seen.set(path, count)
    index.set(count > 1 ? `${path}#${count}` : path, { path, box, text, style: parseStyle(style) })
  }
  return index
}

/** 요소별 지문 비교: 바뀐 것(칸의 값이 다름), 늘어난 것, 사라진 것 */
function diffFingerprints(before, after) {
  const a = indexFingerprint(before)
  const b = indexFingerprint(after)
  const changed = []
  const removed = []
  const added = []
  for (const [key, x] of a) {
    const y = b.get(key)
    if (!y) {
      removed.push(x)
      continue
    }
    const fields = []
    if (x.box !== y.box) fields.push({ field: 'box', from: x.box, to: y.box })
    if (x.text !== y.text) fields.push({ field: 'text', from: x.text, to: y.text })
    for (const name of new Set([...Object.keys(x.style), ...Object.keys(y.style)])) {
      if (x.style[name] !== y.style[name]) fields.push({ field: name, from: x.style[name] ?? '', to: y.style[name] ?? '' })
    }
    if (fields.length) changed.push({ key, path: x.path, fields })
  }
  for (const [key, y] of b) if (!a.has(key)) added.push(y)
  return { changed, added, removed }
}

const STYLE_LABEL = { c: 'color', bg: 'background', fs: 'font-size', fw: 'font-weight', lh: 'line-height', bd: 'border', ol: 'outline', op: 'opacity', sh: 'box-shadow', z: 'z-index', nv: 'tabular', ws: 'white-space', bi: 'background-image', fill: 'fill', stroke: 'stroke' }
/** 지문 경로에서 끝 둘만(자리 번호는 떼고): 'div.panel:2>h2.x:1' → 'div.panel > h2.x' */
const leafOf = (path) => {
  const parts = path.split('>')
  const last = parts[parts.length - 1] ?? ''
  const parent = parts[parts.length - 2] ?? ''
  const strip = (part) => part.replace(/:\d+(::(before|after))?$/, '$1')
  return `${parent ? strip(parent) + ' > ' : ''}${strip(last)}`
}

/** PNG(8비트, 줄 섞임 없음)를 { width, height, channels, data }로 푼다. 브라우저가 내는 사진이 이 꼴이다 */
function decodePng(buffer) {
  let position = 8
  let width = 0
  let height = 0
  let channels = 0
  const parts = []
  while (position < buffer.length) {
    const length = buffer.readUInt32BE(position)
    const type = buffer.toString('ascii', position + 4, position + 8)
    const data = buffer.subarray(position + 8, position + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      channels = { 2: 3, 6: 4 }[data[9]] ?? 0
      if (data[8] !== 8 || !channels || data[12] !== 0) throw new Error('PNG 꼴을 풀 수 없습니다(8비트 RGB/RGBA, 줄 섞임 없음만)')
    } else if (type === 'IDAT') parts.push(data)
    position += 12 + length
  }
  const raw = inflateSync(Buffer.concat(parts))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[y * stride + x - channels] : 0
      const up = y > 0 ? out[(y - 1) * stride + x] : 0
      const upLeft = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0
      let value = line[x]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += Math.floor((left + up) / 2)
      else if (filter === 4) {
        const guess = left + up - upLeft
        const toLeft = Math.abs(guess - left)
        const toUp = Math.abs(guess - up)
        const toUpLeft = Math.abs(guess - upLeft)
        value += toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft
      }
      out[y * stride + x] = value & 255
    }
  }
  return { width, height, channels, data: out }
}

/** 두 사진에서 어느 색 칸이든 tolerance보다 더 다른 점의 수와 그 상자(둥근 모서리 가장자리의 몇 점이 일고여덟 단계쯤 흔들리는 것은 그리기 잡음이라 센 점에 넣지 않는다) */
function pixelDiff(fileA, fileB, tolerance = 8) {
  if (!existsSync(fileA) || !existsSync(fileB)) return null
  try {
    const a = decodePng(readFileSync(fileA))
    const b = decodePng(readFileSync(fileB))
    if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) return { sizeDiffers: true, changed: Infinity }
    let changed = 0
    let box = null
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        const at = (y * a.width + x) * a.channels
        let delta = 0
        for (let k = 0; k < a.channels; k++) delta = Math.max(delta, Math.abs(a.data[at + k] - b.data[at + k]))
        if (delta <= tolerance) continue
        changed++
        box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y]
      }
    }
    return { changed, box }
  } catch (error) {
    return { error: String(error.message), changed: Infinity }
  }
}

const offLadderCount = (audit) => Object.entries(audit.weights?.counts ?? {}).filter(([weight]) => ![400, 600, 700, 800].includes(Number(weight))).reduce((sum, [, count]) => sum + count, 0)
const METRICS = [
  ['smallDimText', '12.5px 이하 흐린 글자', (a) => a.smallDimText],
  ['contrastFails', '대비 4.5 미만', (a) => a.contrastFails],
  ['minFontPx', '가장 작은 글자(px)', (a) => a.minFontPx],
  ['offLadder', '굵기 사다리 밖', offLadderCount],
  ['heavy', '800을 쓴 요소', (a) => a.weights?.heavyCount],
  ['overflowX', '가로 넘침', (a) => a.overflowX],
  ['tableRows', '표 줄(보임)', (a) => a.tableRows],
  ['tableRowCapacity', '표 줄(들어감)', (a) => a.tableRowCapacity],
  ['stickyCols', '고정 칸', (a) => a.stickyCols],
  ['sidebarFree', '사이드바 남는 높이', (a) => a.sidebarFits?.free],
  ['titles', 'title 속성', (a) => a.titleCount?.total],
  ['tabStops', '표 Tab 멈춤', (a) => a.tabStops],
  ['smallColorNoIcon', '작은 뜻 색 글자(아이콘 없음)', (a) => a.smallColorNoIcon]
]
const arrow = (from, to) => (from === to ? String(from ?? '-') : `${from ?? '-'} → ${to ?? '-'}`)
const sumOf = (shots, pick) => [...shots.values()].reduce((sum, shot) => sum + (Number(pick(shot.audit)) || 0), 0)

function commandCompare(positional, flags) {
  const [beforeDir, afterDir] = positional.map((path) => resolve(path))
  if (!beforeDir || !afterDir) throw new EnvironmentError('compare <앞 폴더> <뒤 폴더> 꼴로 적어 주세요.')
  const before = loadShots(beforeDir)
  const after = loadShots(afterDir)
  // 앞뒤 폴더가 같은 폴더 밑의 형제면 그 위 폴더(예: shots/B)에, 아니면 뒤 폴더에 쓴다
  const out = resolve(typeof flags.out === 'string' ? flags.out : dirname(beforeDir) === dirname(afterDir) ? dirname(afterDir) : afterDir)
  mkdirSync(out, { recursive: true })
  const names = [...new Set([...before.keys(), ...after.keys()])].sort()
  const rows = []
  const aggregate = new Map()
  let totalChanged = 0
  let totalAdded = 0
  let totalRemoved = 0
  let pixelTotal = 0
  for (const name of names) {
    const x = before.get(name)
    const y = after.get(name)
    if (!x || !y) {
      rows.push({ name, only: x ? '앞에만 있음' : '뒤에만 있음', x, y })
      continue
    }
    const diff = diffFingerprints(x.audit.fingerprint, y.audit.fingerprint)
    const pixels = pixelDiff(join(beforeDir, `${name}.png`), join(afterDir, `${name}.png`))
    pixelTotal += pixels ? pixels.changed : 0
    totalChanged += diff.changed.length
    totalAdded += diff.added.length
    totalRemoved += diff.removed.length
    for (const item of diff.changed) {
      for (const field of item.fields) {
        if (field.field === 'box' || field.field === 'text') continue
        const key = `${leafOf(item.path)}\u0001${STYLE_LABEL[field.field] ?? field.field}\u0001${field.from}\u0001${field.to}`
        const entry = aggregate.get(key) ?? { count: 0, shots: new Set() }
        entry.count++
        entry.shots.add(name)
        aggregate.set(key, entry)
      }
    }
    rows.push({ name, x, y, diff, pixels })
  }
  const pairs = rows.filter((row) => row.diff)
  const diffTotal = totalChanged + totalAdded + totalRemoved
  const boxOnly = pairs.reduce((sum, row) => sum + row.diff.changed.filter((item) => item.fields.every((field) => field.field === 'box')).length, 0)

  // ---------- summary.md ----------
  const lines = []
  lines.push('# 앞뒤 비교', '')
  lines.push(`- 앞: \`${beforeDir}\``, `- 뒤: \`${afterDir}\``)
  // 브라우저 판: 찍을 때 적어 둔 _run.json이 있으면 그것, 없으면 사진의 userAgent에서(Edge는 Edg/ 가 뒤에 붙는다)
  const browserOf = (dir, shots) => {
    try {
      const run = JSON.parse(readFileSync(join(dir, '_run.json'), 'utf8'))
      if (run.browser) return run.browser
    } catch {
      /* 없으면 아래로 */
    }
    const agent = [...shots.values()][0]?.audit?.userAgent ?? ''
    return agent.match(/Edg\/[\d.]+/)?.[0] ?? agent.match(/Chrome\/[\d.]+/)?.[0] ?? '-'
  }
  const pixelText = (pixels) => (!pixels ? '-' : pixels.sizeDiffers ? '크기 다름' : pixels.error ? '읽지 못함' : String(pixels.changed))
  lines.push(`- 브라우저: 앞 ${browserOf(beforeDir, before)}, 뒤 ${browserOf(afterDir, after)}`)
  lines.push(`- 찍은 것: 앞 ${before.size}장, 뒤 ${after.size}장, 짝 ${pairs.length}장${rows.length - pairs.length ? `, 한쪽에만 있는 것 ${rows.length - pairs.length}장` : ''}`)
  lines.push(`- 지문 차이: 바뀐 요소 ${totalChanged}개(그 가운데 상자만 달라진 것 ${boxOnly}개), 늘어난 요소 ${totalAdded}개, 사라진 요소 ${totalRemoved}개${diffTotal === 0 ? ' → 차이 없음' : ''}`)
  lines.push(`- 픽셀 차이: 어느 색이든 8단계(256 중) 넘게 다른 점 ${Number.isFinite(pixelTotal) ? pixelTotal : '(크기가 다른 사진 있음)'}개${pixelTotal === 0 ? ' → 차이 없음' : ''}`, '')
  lines.push('## 합계(짝이 있는 사진 전부)', '')
  const sum = (pick) => {
    const subset = (shots) => new Map([...shots].filter(([name]) => pairs.some((row) => row.name === name)))
    return arrow(sumOf(subset(before), pick), sumOf(subset(after), pick))
  }
  lines.push('| 재는 것 | 앞 → 뒤(사진 합) |', '|---|---|')
  for (const [id, label, pick] of METRICS) if (['smallDimText', 'contrastFails', 'offLadder', 'heavy', 'overflowX', 'smallColorNoIcon', 'titles'].includes(id)) lines.push(`| ${label} | ${sum(pick)} |`)
  lines.push('')
  lines.push('## 사진마다', '')
  lines.push(`| 사진 | ${METRICS.map(([, label]) => label).join(' | ')} | 바뀐 요소 | 픽셀 차이 |`)
  lines.push(`|---|${METRICS.map(() => '---').join('|')}|---|---|`)
  for (const row of rows) {
    const cells = row.diff ? METRICS.map(([, , pick]) => arrow(pick(row.x.audit), pick(row.y.audit))) : [row.only, ...METRICS.slice(1).map(() => '')]
    const changes = row.diff ? row.diff.changed.length + row.diff.added.length + row.diff.removed.length : ''
    lines.push(`| ${[row.name, ...cells, changes, row.diff ? pixelText(row.pixels) : ''].join(' | ')} |`)
  }
  lines.push('')
  const ranked = [...aggregate].sort((p, q) => q[1].count - p[1].count)
  lines.push('## 바뀐 스타일(요소 이름, 속성, 값, 몇 곳, 몇 장)', '')
  if (!ranked.length) lines.push('스타일이 바뀐 요소가 없습니다.', '')
  else {
    lines.push('| 요소 | 속성 | 앞 | 뒤 | 곳 | 장 |', '|---|---|---|---|---|---|')
    for (const [key, entry] of ranked.slice(0, 120)) {
      const [leaf, field, from, to] = key.split('\u0001')
      const cut = (text) => text.replace(/\|/g, '\\|').slice(0, 70)
      lines.push(`| \`${cut(leaf)}\` | ${field} | ${cut(from) || '(없음)'} | ${cut(to) || '(없음)'} | ${entry.count} | ${entry.shots.size} |`)
    }
    if (ranked.length > 120) lines.push('', `(${ranked.length - 120}줄 더 있음. 사진마다의 json에서 직접 견주세요)`)
    lines.push('')
  }
  const moved = pairs.filter((row) => row.diff.added.length || row.diff.removed.length)
  if (moved.length) {
    lines.push('## 늘거나 줄어든 요소', '')
    for (const row of moved.slice(0, 40)) {
      lines.push(`- ${row.name}: 늘어남 ${row.diff.added.length}, 사라짐 ${row.diff.removed.length}${row.diff.added[0] ? `, 예: \`${leafOf(row.diff.added[0].path)}\`` : ''}`)
    }
    lines.push('')
  }
  writeFileSync(join(out, 'summary.md'), lines.join('\n'))

  // ---------- compare.html ----------
  writeFileSync(join(out, 'compare.html'), renderCompareHtml({ rows, out, beforeDir, afterDir, diffTotal, pixelText }))
  log(`지문 차이: 바뀐 요소 ${totalChanged}, 늘어난 요소 ${totalAdded}, 사라진 요소 ${totalRemoved} (짝 ${pairs.length}장)`)
  log(`픽셀 차이: ${Number.isFinite(pixelTotal) ? pixelTotal : '크기가 다른 사진 있음'}`)
  log(`→ ${join(out, 'summary.md')}\n→ ${join(out, 'compare.html')}`)
  if (flags['expect-same'] && (diffTotal > 0 || pixelTotal > 0 || rows.length !== pairs.length)) {
    console.error('--expect-same: 앞뒤가 같지 않습니다.')
    return 1
  }
  return 0
}

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])

function renderCompareHtml({ rows, out, beforeDir, afterDir, diffTotal, pixelText }) {
  const rel = (dir, name) => relative(out, join(dir, `${name}.png`)).split('\\').join('/')
  const groups = new Map()
  for (const row of rows) {
    const screen = row.name.split('-')[0]
    groups.set(screen, [...(groups.get(screen) ?? []), row])
  }
  const sections = [...groups].map(([screen, list]) => {
    const items = list
      .map((row) => {
        const nums = row.diff ? METRICS.filter(([id]) => ['smallDimText', 'contrastFails', 'heavy', 'tableRows', 'tableRowCapacity'].includes(id)).map(([, label, pick]) => `${label} ${arrow(pick(row.x.audit), pick(row.y.audit))}`).join(' · ') : ''
        const changed = row.diff ? row.diff.changed.length + row.diff.added.length + row.diff.removed.length : 0
        const pixelNote = row.diff ? ` · 픽셀 차이 ${pixelText(row.pixels)}` : ''
        const figure = (dir, side, shot) => (shot ? `<figure><figcaption>${side}</figcaption><a href="${rel(dir, row.name)}" target="_blank"><img loading="lazy" src="${rel(dir, row.name)}" alt="${side}"></a></figure>` : `<figure><figcaption>${side}: 없음</figcaption></figure>`)
        const overlay = row.x && row.y ? `<figure class="diff"><figcaption>차이(겹쳐 뺀 것, 검정이면 같음)</figcaption><div class="stack"><img loading="lazy" src="${rel(beforeDir, row.name)}" alt=""><img loading="lazy" class="top" src="${rel(afterDir, row.name)}" alt=""></div></figure>` : ''
        return `<article><h3>${escapeHtml(row.name)}<small>${changed ? ` 바뀐 요소 ${changed}` : ' 지문 같음'}</small></h3><p class="nums">${escapeHtml(nums + pixelNote)}</p><div class="trio">${figure(beforeDir, '앞', row.x)}${figure(afterDir, '뒤', row.y)}${overlay}</div></article>`
      })
      .join('\n')
    return `<section><h2>${escapeHtml(screen)} <small>${list.length}장</small></h2>${items}</section>`
  })
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>앞뒤 비교</title>
<style>
:root{color-scheme:dark;--bg:#0a1324;--surface:#0f1b31;--line:#263756;--text:#eef3fb;--text2:#c6d1e4}
body{margin:0;padding:20px 28px 60px;background:var(--bg);color:var(--text);font:14px/1.5 'Pretendard Variable',Pretendard,'Malgun Gothic',system-ui,sans-serif}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px;padding-top:12px;border-top:1px solid var(--line)}h3{font-size:14px;margin:18px 0 2px}
small{color:var(--text2);font-weight:400}.top-note{color:var(--text2);margin:0 0 12px}.nums{margin:0 0 6px;color:var(--text2);font-size:12.5px}
.trio{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}figure{margin:0;min-width:0}figcaption{color:var(--text2);font-size:12.5px;margin-bottom:2px}
img{display:block;width:100%;height:auto;border:1px solid var(--line);background:var(--surface)}
.stack{position:relative;isolation:isolate}.stack img.top{position:absolute;inset:0;mix-blend-mode:difference}.stack img{border:0}
@media (max-width:900px){.trio{grid-template-columns:minmax(0,1fr)}}
</style></head><body>
<h1>앞뒤 비교</h1>
<p class="top-note">앞: ${escapeHtml(beforeDir)}<br>뒤: ${escapeHtml(afterDir)}<br>지문 차이 합계 ${diffTotal}개. 사진을 누르면 원래 크기로 열립니다. 셋째 칸은 앞과 뒤를 겹쳐 뺀 것이라 같은 곳은 검게 보입니다.</p>
${sections.join('\n')}
</body></html>
`
}

// =====================================================================================================================
// 들머리
// =====================================================================================================================

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const command = positional.shift()
  if (!command || command === 'help' || flags.help) {
    log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\n?/, ''))
    return 0
  }
  if (command === 'shoot') return commandShoot(flags)
  if (command === 'run') return commandRun(positional, flags)
  if (command === 'compare') return commandCompare(positional, flags)
  throw new EnvironmentError(`알 수 없는 명령: ${command} (shoot, compare, run, help)`)
}

let exitCode = 1
try {
  exitCode = await main()
} catch (error) {
  console.error(`\n${error instanceof FontMissingError ? '글꼴 문제' : error instanceof EnvironmentError ? '환경 문제' : '오류'}: ${error.message}`)
  if (!(error instanceof FontMissingError || error instanceof EnvironmentError)) console.error(error.stack)
  exitCode = error instanceof FontMissingError ? 3 : error instanceof EnvironmentError ? 2 : 1
} finally {
  await shutdown()
}
process.exit(exitCode)
