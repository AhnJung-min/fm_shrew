/**
 * 연결 상태의 종류를 가려내는 함수 하나(C-18). 사이드바의 연결 단추, 대시보드 길잡이, 빈 화면, 꺼진 기능 태그, 연결 화면이 같은 값을 읽는다.
 *
 * 말은 까닭을 알 수 있을 때만 까닭을 적는다.
 * - 앱은 "게임이 꺼져 있음"과 "플러그인이 없거나 낮음"을 가려내지 못한다. 그래서 이번 실행에서 플러그인이 한 번이라도 대답했다면(seenConnected)
 *   지금 끊긴 것은 게임이 꺼진 것이라 "FM이 꺼져 있음", 한 번도 대답한 적이 없다면 "게임과 연결되지 않음"으로 적는다(두 말 모두 중립색, 평소 상태).
 * - 주황은 옛 플러그인에만 쓴다. 게임의 팀이 적용한 세이브와 다른지는 따지지 않는다(앱이 게임의 팀을 이미 따라간다).
 */
import { withJosa } from '@shared/korean'
import type { LinkStatus } from '@shared/game'
import { formatTime } from './format'
import { sceneParam } from './preview'

export type LinkKind = 'noSave' | 'busy' | 'noTeam' | 'pluginOld' | 'connected' | 'mainMenu' | 'gameOff' | 'notConnected'

export interface LinkView {
  kind: LinkKind
  /** 연결 단추의 굵은 글: '세이브 고르기', '가온 시티와 연결됨', 'FM이 꺼져 있음', '게임과 연결되지 않음', '플러그인을 바꿔야 합니다' 등 */
  title: string
  /** 그 아래 작은 글: '능력치는 게임의 지금 값, 그 밖은 마지막 저장분(저장한 때)', '세이브 값으로 보는 중' 등 */
  detail: string
  /** warn은 옛 플러그인에만, good은 연결됨에만 쓴다 */
  tone: 'neutral' | 'good' | 'warn'
  icon: 'check' | 'pause' | 'alert' | 'dot'
  /** 접힌 사이드바의 낭독 이름 */
  label: string
}

function view(kind: LinkKind, title: string, detail: string, tone: LinkView['tone'], icon: LinkView['icon']): LinkView {
  return { kind, title, detail, tone, icon, label: `${title}, ${detail}` }
}

/**
 * 지금 연결의 종류와 말. 차례: 읽는 중(세이브가 아직 없는데 읽는 중) → 세이브 없음 → 내 팀 모름 → 옛 플러그인 → 연결됨 또는 메인 메뉴 → 꺼져 있음 또는 연결되지 않음.
 * 적용한 세이브가 있는 동안의 busy(3분마다 게임 값을 다시 받는 때)는 종류를 바꾸지 않는다(연결 단추가 깜빡이지 않게. 작은 읽는 중 표시는 각 화면의 Loading이 맡는다).
 *
 * seenConnected: 이번 실행에서 플러그인이 한 번이라도 대답했는가.
 */
export function linkViewOf(link: LinkStatus, seenConnected: boolean): LinkView {
  const { game, data } = link
  if (data.save === null) {
    return link.busy
      ? view('busy', '세이브 읽는 중입니다', '세이브의 모든 선수를 읽고 있습니다', 'neutral', 'dot')
      : view('noSave', '세이브 고르기', '적용한 세이브가 없습니다', 'neutral', 'dot')
  }
  if (!data.hasTeam) return view('noTeam', '내 팀 확인', '세이브에서 내 팀을 아직 찾지 못했습니다', 'neutral', 'dot')
  if (game.connected && game.pluginOld) {
    return view('pluginOld', '플러그인을 바꿔야 합니다', '게임에 올라간 플러그인이 옛 버전이라 세이브 값으로 봅니다', 'warn', 'alert')
  }
  if (game.connected) {
    if (!game.loaded) return view('mainMenu', 'FM이 켜져 있음', '메인 메뉴 상태이고, 세이브를 불러오면 능력치가 게임의 지금 값으로 바뀝니다', 'neutral', 'dot')
    const title = game.team ? `${withJosa(game.team, '과/와')} 연결됨` : '연결됨'
    const detail =
      data.source === 'game' ? `능력치는 게임의 지금 값, 그 밖은 마지막 저장분(${formatTime(data.save.savedAt)} 저장)` : '세이브 값으로 보는 중'
    return view('connected', title, detail, 'good', 'check')
  }
  return seenConnected
    ? view('gameOff', 'FM이 꺼져 있음', '세이브에 저장된 값으로 보는 중', 'neutral', 'pause')
    : view('notConnected', '게임과 연결되지 않음', '세이브에 저장된 값으로 보는 중', 'neutral', 'pause')
}

/** 이번 실행에서 플러그인이 대답한 적이 있는가. 처음 부를 때 미리보기 ?seen이면 참으로 시작한다 */
let seen: boolean | null = null

/**
 * 연결된 link를 한 번 보면 모듈 안에 기억하는 linkViewOf. 화면 어디서 불러도 같은 기억을 쓴다(React의 상태가 아니다: 값이 한 번 참이 되면 그대로다).
 * 미리보기에서 ?seen을 붙이면 처음부터 참이라, ?off&seen으로 'FM이 꺼져 있음'을 본다.
 */
export function useLinkView(link: LinkStatus): LinkView {
  if (seen === null) seen = sceneParam('seen') !== null
  if (link.game.connected) seen = true
  return linkViewOf(link, seen)
}
