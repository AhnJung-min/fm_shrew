import { CLUB_PLUGIN, MARKET_PLUGIN, NEEDED_PLUGIN, TACTIC_PLUGIN, versionOlder } from './game'

/** 에디터가 쓰다가 실패하면 앞에서 쓴 값을 되돌리고, 온라인(네트워크) 게임에서는 쓰기를 막는 플러그인 버전. 이보다 낮으면 온라인 게임인지 알 수 없다 */
export const EDITOR_SAFE_PLUGIN = '0.13.0'

/**
 * 앱이 기능마다 요구하는 게임 안 플러그인 버전(game.ts의 상수들)을 한 줄 안내로 바꾼다.
 * 옛 플러그인 안내가 버전 숫자를 따로 적지 않고 이 표에서 만들어지므로, 새 기능을 더해 상수가 늘면 안내도 따라간다.
 */
export interface PluginGate {
  /** 이 버전 이상이어야 켜진다 */
  version: string
  /** 켜지는 기능 */
  feature: string
}

/** 낮은 버전부터 */
export const PLUGIN_GATES: PluginGate[] = [
  { version: NEEDED_PLUGIN, feature: '게임의 지금 값 읽기와 에디터' },
  { version: MARKET_PLUGIN, feature: '몸값·주급·나라·구단 이름' },
  { version: CLUB_PLUGIN, feature: '구단 현황·건강 카드' },
  { version: EDITOR_SAFE_PLUGIN, feature: '에디터의 되돌림과 온라인 게임 쓰기 차단' },
  { version: TACTIC_PLUGIN, feature: '게임 전술 가져오기·역할 별점 읽기·게임 버전 확인' }
].sort((a, b) => (versionOlder(a.version, b.version) ? -1 : versionOlder(b.version, a.version) ? 1 : 0))

/** 앱의 기능이 모두 켜지는 가장 낮은 플러그인 버전 */
export const FULL_PLUGIN = PLUGIN_GATES[PLUGIN_GATES.length - 1].version

const shown = (version: string): string => version || '알 수 없음'

/** "0.9.0 이상(게임의 지금 값 읽기와 에디터), 0.10.0 이상(…), …" */
export function pluginNeedLine(): string {
  return PLUGIN_GATES.map((gate) => `${gate.version} 이상(${gate.feature})`).join(', ')
}

/** 이 버전에서 꺼져 있는 기능들 */
export function pluginUnmet(version: string): PluginGate[] {
  return PLUGIN_GATES.filter((gate) => versionOlder(version, gate.version))
}

/** 앱이 읽고 고치는 데 필요한 최소 버전(NEEDED_PLUGIN)보다 낮은 플러그인이 올라가 있을 때의 안내 */
export function oldPluginNotice(installed: string): string {
  return (
    `게임에 올라가 있는 연결 플러그인이 옛 버전(${shown(installed)})입니다. 앱에 필요한 버전은 ${pluginNeedLine()}입니다. ` +
    `게임 폴더의 플러그인을 ${FULL_PLUGIN} 이상으로 바꾼 뒤 FM을 완전히 껐다가 다시 켜세요.`
  )
}

/** 읽고 고치는 데는 충분하지만 일부 기능이 꺼진 버전일 때의 한 줄. 모두 켜졌으면 빈 글자 */
export function pluginUnmetLine(installed: string): string {
  const unmet = pluginUnmet(installed)
  if (unmet.length === 0) return ''
  return `이 버전에서 꺼진 기능: ${unmet.map((gate) => `${gate.feature}(${gate.version} 이상)`).join(', ')}`
}
