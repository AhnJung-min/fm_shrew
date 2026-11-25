import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bridgeAlive, readFromGame, readMatchFromGame, sendReply, waitForWords } from '../src/main/talk/bridge'

/** 게임 안 플러그인 흉내. 앱이 주소·암호를 파일에서 읽어 제대로 묻는지 본다 */
const TREE = `#1 SI.Bindable.Panel "TeamTalkPanel" [0,0 100x100]
 #2 UnityEngine.UIElements.TemplateContainer "SpeakToContainer" [0,0 100x100]
  #3 SI.Bindable.SIButton "StandardButton" .sibutton [0,0 10x10] focusable
   #4 SI.Bindable.SIText "text" .sitext [0,0 10x10] text="행운을 빈다."
  #5 UnityEngine.UIElements.VisualElement "FmBojwagwanTalk" [0,0 10x10]
   #6 UnityEngine.UIElements.Label [0,0 10x10] text="직접 답변"
`

let server: Server
const seen: Array<{ url: string; token: string | undefined; body: string }> = []

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      const url = request.url ?? ''
      seen.push({ url, token: request.headers['x-bridge-token'] as string | undefined, body })
      if (request.headers['x-bridge-token'] !== 'secret') {
        response.writeHead(401).end('bad token')
      } else if (url === '/ping') {
        response.end('fm-bojwagwan-bridge test')
      } else if (url === '/tree') {
        response.end(TREE)
      } else if (url === '/talk/shouts') {
        response.end(['1', '격려하기'].join(String.fromCharCode(9)) + String.fromCharCode(10) + ['8', '질책하기'].join(String.fromCharCode(9)))
      } else if (url.startsWith('/talk/poll?after=3')) {
        response.end(['4', 'shout', '더 뛰어!'].join(String.fromCharCode(10)))
      } else if (url.startsWith('/talk/poll?after=0')) {
        response.end('3\n이기고 와라\n꼭')
      } else if (url.startsWith('/talk/poll')) {
        response.end('')
      } else if (url.startsWith('/talk/reply')) {
        response.end('ok')
      } else {
        response.writeHead(404).end('unknown path')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const home = mkdtempSync(join(tmpdir(), 'fmb-bridge-'))
  mkdirSync(join(home, 'FmBojwagwan'))
  writeFileSync(
    join(home, 'FmBojwagwan', 'bridge.json'),
    JSON.stringify({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, token: 'secret', pid: 1, version: 'test' })
  )
  process.env.LOCALAPPDATA = home
})

afterAll(() => {
  server.close()
})

describe('게임 안 플러그인과 주고받기', () => {
  it('접속 정보 파일을 읽어 암호와 함께 묻는다', async () => {
    expect(await bridgeAlive()).toBe(true)
    expect(seen.at(-1)?.token).toBe('secret')
  })

  it('화면 구조에서 장면을 읽고, 우리가 붙인 칸은 뺀다', async () => {
    const scene = await readFromGame()
    expect(scene?.screen).toBe('team_talk')
    expect(scene?.options).toEqual([{ text: '행운을 빈다.', tone: '', ref: 3 }])
    expect(scene?.facts).toEqual([])
  })

  it('게임 안 칸에 적힌 말을 순번과 함께 받는다(말 속의 줄바꿈은 그대로)', async () => {
    // 예전 플러그인은 종류 없이 말만 보낸다
    expect(await waitForWords(0)).toEqual({ seq: 3, kind: 'talk', words: '이기고 와라\n꼭' })
    expect(await waitForWords(3)).toEqual({ seq: 4, kind: 'shout', words: '더 뛰어!' })
    expect(await waitForWords(4)).toBeNull()
  })

  it('경기 중에는 외침 목록이 선택지가 된다', async () => {
    const scene = await readMatchFromGame()
    expect(scene?.screen).toBe('touchline_shout')
    expect(scene?.options).toEqual([
      { text: '격려하기', tone: '', ref: 1 },
      { text: '질책하기', tone: '', ref: 8 }
    ])
  })

  it('답을 JSON으로 돌려보낸다', async () => {
    await sendReply(3, { pick: 3, pickText: '행운을 빈다.', note: '적용할 선택지: 행운을 빈다.', replies: [{ speaker: '선수단', text: '네!' }] })
    const last = seen.at(-1)!
    expect(last.url).toBe('/talk/reply?seq=3')
    expect(JSON.parse(last.body).replies[0].text).toBe('네!')
  })
})
