/**
 * 미리보기(npm run web)의 장면 열쇠. 주소는 `/?열쇠&열쇠=값#화면` 꼴이다(물음표가 #보다 앞).
 * 앱(preload가 window.api를 넣은 때)에서는 늘 null이라서 사용자 화면에는 아무 영향이 없다.
 * 열쇠마다의 뜻은 디자인 적용 1차 계획 2.10절에 있고, 목업(api.ts)과 각 화면이 필요한 것을 읽는다.
 */

/** 미리보기인가. 앱에서는 preload가 window.api를 넣어 주므로 거짓이다 */
export function isPreview(): boolean {
  return typeof window !== 'undefined' && (window as { api?: unknown }).api === undefined
}

/**
 * 주소에서 장면 열쇠 하나를 읽는다. '?open=123#targets'에서 open → '123'.
 * 값이 없는 열쇠('?seen')는 빈 글자이고, 열쇠가 없으면 null이다. 앱에서는 늘 null.
 */
export function sceneParam(name: string): string | null {
  if (!isPreview()) return null
  try {
    return new URLSearchParams(window.location.search).get(name)
  } catch {
    return null
  }
}
