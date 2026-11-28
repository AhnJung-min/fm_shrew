/**
 * 이 PC에 기억하는 작은 취향(고른 보기, 메뉴 접기, 한 번만 보이는 알림). 브라우저 저장소(localStorage)에 적는다.
 * 읽기와 쓰기 모두 try/catch라서 저장소가 막혀 있거나(개인 창, 사이트 데이터 차단) 값이 깨져 있어도 화면은 기본값으로 그대로 돈다.
 * 창 배율, 항상 위에, 창 자리는 여기가 아니라 본체가 가진다. 앱을 다시 켤 때 남아야 하는 취향만 둔다.
 *
 * 열쇠는 'fmb.<구역>.<이름>' 꼴이다(지금 있는 fmb.targets.keyOnly, fmb.squad.positionView와 같다).
 */

/**
 * 기억해 둔 값을 읽는다. 못 읽거나, 기억해 둔 것이 없거나, parse가 알아보지 못하면(undefined를 돌려주거나 던지면) 기본값을 돌려준다.
 */
export function readPref<T>(key: string, parse: (raw: string) => T | undefined, fallback: T): T {
  try {
    const raw = globalThis.localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = parse(raw)
    return parsed === undefined ? fallback : parsed
  } catch {
    return fallback
  }
}

/** 값을 기억한다. null이면 지운다. 기억하지 못해도 이번에는 고른 대로 보이므로 조용히 넘어간다 */
export function writePref(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage.removeItem(key)
    else globalThis.localStorage.setItem(key, value)
  } catch {
    // 기억하지 못해도 이번에는 고른 대로 보인다
  }
}
