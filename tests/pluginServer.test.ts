/**
 * 플러그인(C#) 소스를 글로 읽어 보는 검사. C#은 여기서 돌릴 수 없어서, 지켜야 하는 구조만 소스에서 본다(N-03, N-04):
 *  - 일반 배포본에 들어가는 창구와 개발용(#if DEV_ENDPOINTS) 창구가 어디에 있는가
 *  - 새 읽기 창구(/tactic, /rolestars)가 읽기만 하고, 숫자 인자를 검사하고, 오류에 요약만 싣는가
 *  - 플러그인 버전이 앱의 버전 문 표와 맞는가
 * 빌드는 `dotnet build plugin/FmBojwagwanBridge.csproj -c Release`(그리고 -p:DevEndpoints=true)로 따로 본다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FULL_PLUGIN } from '../src/shared/pluginGates'
import { TACTIC_PLUGIN, versionOlder } from '../src/shared/game'

const PLUGIN = join(__dirname, '..', 'plugin')
const read = (name: string): string => readFileSync(join(PLUGIN, name), 'utf8')
const server = read('Server.cs')

/**
 * Server.cs의 `case "/경로":`마다 개발용 블록(#if DEV_ENDPOINTS 안, #else 앞) 안인지 본다.
 * #if/#else/#endif를 줄 단위로 따라가며, DEV_ENDPOINTS 조건이 참인 쪽에 있을 때만 "개발용"이다.
 */
function routes(source: string): Map<string, boolean> {
  const found = new Map<string, boolean>()
  // 조건부 컴파일 겹침: 각 칸은 그 #if가 DEV_ENDPOINTS 참인 쪽에 있는지(DEV_ENDPOINTS 아닌 조건이면 null)
  const stack: Array<'dev' | 'other' | 'notDev'> = []
  for (const line of source.split('\n')) {
    const trimmed = line.trim()
    if (/^#if\s+DEV_ENDPOINTS\s*$/.test(trimmed)) stack.push('dev')
    else if (trimmed.startsWith('#if')) stack.push('other')
    else if (trimmed.startsWith('#else')) {
      const top = stack.pop()
      stack.push(top === 'dev' ? 'notDev' : (top ?? 'other'))
    } else if (trimmed.startsWith('#endif')) stack.pop()
    const match = /case "(\/[^"]*)":/.exec(trimmed)
    if (match) found.set(match[1], stack.includes('dev'))
  }
  return found
}

describe('Server.cs의 창구 위치(개발용 블록 안팎)', () => {
  const where = routes(server)

  it('/tactic과 /rolestars는 개발용 블록 밖(일반 배포본에도 들어간다)이다', () => {
    expect(where.has('/tactic')).toBe(true)
    expect(where.has('/rolestars')).toBe(true)
    expect(where.get('/tactic')).toBe(false)
    expect(where.get('/rolestars')).toBe(false)
  })

  it('/fields와 그 밖의 조사용 창구는 개발용 블록 안이다', () => {
    for (const path of ['/fields', '/props', '/bind', '/alias', '/probe/clear', '/get', '/inspect', '/click']) {
      expect(where.get(path), path).toBe(true)
    }
  })

  it('배포본의 기존 창구는 개발용 블록 밖이다', () => {
    for (const path of ['/ping', '/state', '/talk/poll', '/talk/reply', '/people', '/names', '/club', '/health', '/live/player', '/live/set']) {
      expect(where.get(path), path).toBe(false)
    }
  })

  it('읽기 창구의 검사기가 따라가는 조건부 컴파일 규칙이 맞다(#else 쪽은 개발용이 아니다)', () => {
    const sample = ['switch (path)', '{', 'case "/a":', '#if DEV_ENDPOINTS', 'case "/b":', '#else', 'case "/c":', '#endif', 'case "/d":', '#if OTHER', 'case "/e":', '#endif', '}'].join('\n')
    expect([...routes(sample)]).toEqual([
      ['/a', false],
      ['/b', true],
      ['/c', false],
      ['/d', false],
      ['/e', false]
    ])
  })
})

describe('새 읽기 창구(TacticInfo.cs)', () => {
  const tactic = read('TacticInfo.cs')
  const code = tactic.replace(/\/\/.*$/gm, '')

  it('Server.cs가 두 창구를 TacticInfo로 잇고, 숫자 인자는 TacticInfo가 검사한다(번호는 숫자만, 0 이하와 넘침은 400)', () => {
    expect(server).toMatch(/case "\/tactic":\s*return TacticInfo\.Tactic\(Need\("team"\), Need\("uid"\), Flag\("roles"\)\);/)
    expect(server).toMatch(/case "\/rolestars":\s*return TacticInfo\.RoleStars\(Need\("team"\), Need\("uids"\)\);/)
    expect(code).toContain('int.TryParse(text, NumberStyles.None')
    expect(code).toContain('uint.TryParse(text, NumberStyles.None')
    expect(code).toMatch(/throw new HttpError\(400, "bad team"\)/)
    expect(code).toMatch(/throw new HttpError\(400, "bad uid"\)/)
    // 별점은 한 번에 5명까지(PersonInfo.Parse가 개수와 번호를 검사한다)
    expect(code).toContain('PersonInfo.Parse(uidsText, MaxStarPlayers)')
    expect(code).toMatch(/MaxStarPlayers = 5;/)
  })

  it('읽기만 한다: 값을 쓰거나, 누르거나, 게임 객체를 고치는 호출이 없다', () => {
    for (const forbidden of ['LiveMemory.Set', 'Clicker', 'GameData.Put(', 'GameData.PutRecord(', 'PutValue(', 'File.Write', 'Handles.', 'MemoryStream', '.Invoke(', 'DataProbe']) {
      expect(code, forbidden).not.toContain(forbidden)
    }
    // 게임에 묻는 것은 PersonInfo.Probe(조회 통로) 하나뿐이다
    expect([...code.matchAll(/PersonInfo\.Probe\(/g)]).toHaveLength(3)
  })

  it('이 창구의 실패는 따로 센다(몸값·건강 조회를 멈추지 않는다)', () => {
    const probes = [...code.matchAll(/PersonInfo\.Probe\([\s\S]*?\);/g)].map((match) => match[0])
    expect(probes).toHaveLength(3)
    for (const call of probes) expect(call).toContain('PersonInfo.TacticFailures')
    const info = read('PersonInfo.cs')
    expect(info).toContain('internal static readonly FailureCount TacticFailures = new();')
    expect(info).toMatch(/private static readonly FailureCount Common = new\(\);/)
    // 옛 조회(Run)는 공통 칸만 쓰고, 새 칸은 건드리지 않는다
    const run = /internal static Answer Run\([\s\S]*?\n    }\n/.exec(info)?.[0] ?? ''
    expect(run).toContain('Common.Value')
    expect(run).not.toContain('TacticFailures')
    // Probe는 실패 칸을 인자로 받고, 주지 않으면 공통 칸을 쓴다
    expect(info).toContain('FailureCount failures = null)')
    expect(info).toContain('failures ??= Common;')
  })

  it('오류에는 요약만 싣는다: 서버가 예외의 종류와 첫 줄만 응답하고, 이 창구는 직접 예외 글을 응답에 붙이지 않는다', () => {
    expect(server).toMatch(/body = Summary\(error\);/)
    expect(code).not.toContain('StackTrace')
    // 이 창구가 던지는 것은 짧은 고정 글의 HttpError뿐이다(예외의 글을 응답에 붙이지 않는다)
    for (const thrown of code.matchAll(/throw new HttpError\(([^;]*)\);/g)) expect(thrown[1], thrown[0]).toMatch(/^\d{3}, "[a-z ]+"$/)
    // 로그에는 메시지만 남긴다(응답에는 싣지 않는다)
    expect([...code.matchAll(/Plugin\.Logger\.LogWarning\(/g)].length).toBeGreaterThan(0)
  })
})

/** `header`로 시작하는 catch 블록의 본문({ … })을 모두 모은다. 중괄호를 세어 자른다(보간 글자의 {…}는 짝이 맞는다) */
function catchBodies(source: string, header: string): string[] {
  const bodies: string[] = []
  for (let from = source.indexOf(header); from >= 0; from = source.indexOf(header, from + header.length)) {
    const open = source.indexOf('{', from)
    let depth = 0
    let end = open
    for (; end < source.length; end++) {
      if (source[end] === '{') depth++
      else if (source[end] === '}' && --depth === 0) break
    }
    bodies.push(source.slice(open, end + 1))
  }
  return bodies
}

describe('게임 쪽 예외의 글은 응답에 싣지 않는다(N-03)', () => {
  // 새 창구는 처음으로 배포본 창구가 PersonInfo.Probe와 GameData.PutValue를 쓴다. 게임(Il2Cpp)의 예외 글에는 호출 경로가 여러 줄로 붙을 수 있다
  const strip = (source: string): string => source.replace(/\/\/.*$/gm, '')
  const info = strip(read('PersonInfo.cs'))
  const gameData = strip(read('GameData.cs'))

  it('Server.Summary(예외의 종류와 첫 줄만)를 다른 파일도 쓸 수 있게 열어 두고, 서버의 500 응답은 그것을 쓴다', () => {
    expect(server).toMatch(/internal static string Summary\(Exception error\)/)
    expect(server).toMatch(/body = Summary\(error\);/)
    expect(server).toMatch(/\.Split\([^)]*\)\[0\]/)
  })

  it('게임에 묻는 조회(Run, Probe)의 일반 예외 catch는 요약만 503 응답에 싣고, 예외의 글은 기록에만 남긴다', () => {
    const throwing = catchBodies(info, 'catch (Exception error)').filter((body) => body.includes('throw new HttpError('))
    expect(throwing).toHaveLength(2) // Run과 Probe
    for (const body of throwing) {
      expect(body).toContain('throw new HttpError(503, Server.Summary(error));')
      expect(body).toContain('Plugin.Logger.LogWarning(')
    }
    // 응답에 예외 객체의 글을 붙이는 곳이 없다. 예외: TimeoutException의 catch(우리 코드(MainThread)가 던지는 고정 글이다)
    let rest = info
    for (const body of catchBodies(info, 'catch (TimeoutException error)')) rest = rest.replace(body, '')
    expect(rest).not.toMatch(/HttpError\([^;]*\berror\.\w+/)
  })

  it('조건 값을 올리다 실패한 알림("failed: …")도 요약만 싣는다(앱으로 가는 응답의 notes에 실린다)', () => {
    expect(gameData).toContain('return "failed: " + Server.Summary(error);')
    expect(gameData).not.toMatch(/return[^;]*\berror\.(Message|ToString|StackTrace)/)
  })

  it('검사기가 catch 블록을 중괄호 짝으로 자른다(보간 글자의 중괄호가 있어도)', () => {
    const sample = 'try { a(); } catch (Exception error) { Log($"x {error.Message} {1}"); throw new HttpError(503, Server.Summary(error)); } finally { b(); } catch (Exception error) { c(); }'
    expect(catchBodies(sample, 'catch (Exception error)')).toEqual(['{ Log($"x {error.Message} {1}"); throw new HttpError(503, Server.Summary(error)); }', '{ c(); }'])
  })
})

describe('플러그인 버전', () => {
  it('Plugin.cs의 버전은 앱의 버전 문 표의 가장 높은 문(모든 기능이 켜지는 버전) 이상이고, 게임 전술 읽기 기능이 들어간 0.14.0이다', () => {
    const version = /public const string Version = "([^"]+)";/.exec(read('Plugin.cs'))?.[1] ?? ''
    expect(version).toBe('0.14.0')
    expect(versionOlder(version, FULL_PLUGIN)).toBe(false)
    expect(versionOlder(version, TACTIC_PLUGIN)).toBe(false)
  })

  it('/state 답에 게임 버전(gameVersion)이 들어가고, 유니티는 게임 스레드에서 한 번만 읽는다', () => {
    const live = read('LiveState.cs')
    // C# 소스의 글자 그대로: Append(",\"gameVersion\":")
    expect(live).toContain('\\"gameVersion\\":')
    expect(live).toContain('UnityEngine.Application.version')
    // 읽는 곳은 화면 스레드가 부르는 Step 안(ReadGameVersion)이고, 응답을 만드는 Build에서는 부르지 않는다
    const build = /private static string Build\([\s\S]*?\n    }\n/.exec(live)?.[0] ?? ''
    expect(build).not.toContain('Application.version')
    expect(live).toMatch(/private static void Step\(long now\)\s*\{\s*ReadGameVersion\(\);/)
  })
})

describe('경기 평점 기록의 득점과 도움(RatingsRecorder.cs, 0.14.0)', () => {
  const code = read('RatingsRecorder.cs').replace(/\/\/.*$/gm, '')

  it('선수 줄마다 Goals와 Assists를 청하고, 도착을 기다리는 항목(RowPaths)에 들어 있다', () => {
    expect(code).toMatch(/RowPaths = \{[^}]*"Goals"[^}]*"Assists"[^}]*\}/)
    // 기존 항목도 그대로 있다
    for (const path of ['Player.UniqueId', 'TotalRating', 'Position', 'IncidentType', 'MatchTime', 'PlayerTeamSelectionIndex']) expect(code, path).toContain(`"${path}"`)
    expect(code).toContain('Goals = Int($"{item}.Goals")')
    expect(code).toContain('Assists = Int($"{item}.Assists")')
  })

  it('줄 형식은 v:1 그대로이고, goals와 assists는 slot 뒤에 값이 온 선수에게만 선택 칸으로 붙는다(0도 적는다)', () => {
    expect(code).toContain(String.raw`new StringBuilder("{\"v\":1")`)
    const slot = code.indexOf(String.raw`json.Append(",\"slot\":").Append(row.Slot);`)
    const goals = code.indexOf(String.raw`if (row.Goals != null) json.Append(",\"goals\":").Append(Num(row.Goals));`)
    const assists = code.indexOf(String.raw`if (row.Assists != null) json.Append(",\"assists\":").Append(Num(row.Assists));`)
    expect(slot).toBeGreaterThan(0)
    expect(goals).toBeGreaterThan(slot)
    expect(assists).toBeGreaterThan(goals)
    // 값이 0이어도 적는다(0과 모름을 앱이 가른다): 0이면 건너뛰는 조건이 없다
    expect(code).not.toMatch(/row\.(Goals|Assists) (>|!=) 0/)
  })
})
