/**
 * 바깥 전송 막기(N-08). 이 PC 밖으로 나가는 것은 게임 안 "직접 답변"의 Claude 요청뿐이고, 그것은 앱 본체(main)가 보낸다.
 * 화면(렌더러)은 이 PC 안 주소만 쓸 수 있다: 앱 자신의 파일, 얼굴·엠블럼 주소(fmface), 개발 서버(localhost).
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
/** 주소에 서버 이름이 없는 종류(파일, 앱이 등록한 주소, 인라인 값, 개발자 도구) */
const LOCAL_SCHEMES = new Set(['file:', 'fmface:', 'data:', 'blob:', 'devtools:', 'about:'])
const NETWORK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:'])

/** 이 PC 안에서 끝나는 주소인가. 읽을 수 없는 주소와 모르는 종류는 바깥으로 본다 */
export function isLocalRequest(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (LOCAL_SCHEMES.has(parsed.protocol)) return true
  return NETWORK_SCHEMES.has(parsed.protocol) && LOCAL_HOSTS.has(parsed.hostname)
}
