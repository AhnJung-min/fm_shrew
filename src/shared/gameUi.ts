import type { TalkScreen } from './talk'

/**
 * 게임 안 플러그인이 보내 주는 화면 구조(/tree)를 읽어, 토크 화면의 상대 말과 선택지를 찾는다.
 *
 * 플러그인의 한 줄은 이렇게 생겼다(들여쓰기 한 칸 = 한 단계 안쪽):
 *   #201 SI.Bindable.SIText "text" .sitext .button-regular [290,177 364x18] disabled text="..."
 *
 * FM26의 기자회견·면담·팀 대화는 모두 "SpeakTo"라는 같은 틀을 쓴다. 팀 대화 화면(26.3.2)에서 확인한 이름:
 *   SpeakToContainer   틀 전체
 *   SpeakToHeader      말하는 상대(이름, 소속)
 *   HasBubbles         상대의 말풍선
 *   SIButton           선택지 하나(안의 SIText가 문장)
 */

export interface UiNode {
  id: number
  depth: number
  /** 요소의 종류(클래스 전체 이름) */
  type: string
  name: string
  classes: string[]
  x: number
  y: number
  width: number
  height: number
  disabled: boolean
  /** 자리는 차지하지만 그려지지 않는 요소(지나간 중계 문구 등) */
  invisible: boolean
  /** 글자가 없으면 빈 문자열 */
  text: string
  /** 부모의 nodes 안 순번. 뿌리는 -1 */
  parent: number
}

const LINE =
  /^( *)(?:#(\d+) )?(\S+)(?: "([^"]*)")?((?: \.\S+)*) \[(-?[\d.NaInfity-]+),(-?[\d.NaInfity-]+) (-?[\d.NaInfity-]+)x(-?[\d.NaInfity-]+)\]((?: (?:hidden|invisible|disabled|focusable))*)(?: text="(.*)")?(?: !\w+)?$/

function unescape(text: string): string {
  return text.replace(/\\(["\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c))
}

/** 게임이 글자에 섞어 두는 꾸밈 표시(<color=...>, <link=...> 등)를 뺀다 */
export function plainText(text: string): string {
  return text
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseTree(text: string): UiNode[] {
  const nodes: UiNode[] = []
  /** 단계별로 가장 최근에 본 요소의 순번 */
  const lastAt: number[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('===')) {
      lastAt.length = 0
      continue
    }
    const m = LINE.exec(line)
    if (!m) continue
    const depth = m[1].length
    const node: UiNode = {
      id: m[2] === undefined ? 0 : Number(m[2]),
      depth,
      type: m[3],
      name: m[4] ?? '',
      classes: m[5] ? m[5].trim().split(' ').map((c) => c.slice(1)) : [],
      x: Number(m[6]),
      y: Number(m[7]),
      width: Number(m[8]),
      height: Number(m[9]),
      disabled: m[10].includes('disabled'),
      invisible: m[10].includes('invisible'),
      text: m[11] === undefined ? '' : unescape(m[11]),
      parent: depth > 0 ? (lastAt[depth - 1] ?? -1) : -1
    }
    lastAt[depth] = nodes.length
    lastAt.length = depth + 1
    nodes.push(node)
  }
  return nodes
}

/** 게임에서 직접 읽은 토크 장면 */
export interface GameScene {
  /** 게임이 붙인 화면 이름(예: TeamTalkPanel) */
  panel: string
  screen: TalkScreen
  situation: string
  speaker: string
  question: string
  options: Array<{ text: string; tone: string; ref: number }>
  facts: string[]
  /** 경기 중이면 점수판의 [홈, 원정] 약칭 */
  teams?: [string, string]
}

/** 플러그인이 대화 틀에 붙이는 "직접 답변" 칸의 이름. 장면을 읽을 때는 뺀다 */
const OUR_BOX = 'FmBojwagwanTalk'
const BUTTON = 'SI.Bindable.SIButton'
const PANEL = 'SI.Bindable.Panel'

export function screenOf(panel: string): TalkScreen {
  if (/team ?talk/i.test(panel)) return 'team_talk'
  if (/press|conference|interview|media/i.test(panel)) return 'press_conference'
  if (/touchline|shout/i.test(panel)) return 'touchline_shout'
  if (/contract/i.test(panel)) return 'contract_negotiation'
  if (/transfer|negotiat/i.test(panel)) return 'transfer_negotiation'
  return 'player_talk'
}

/**
 * 화면 구조에서 토크 장면을 찾는다. 토크 화면이 아니면 null.
 * 선택지는 화면에 놓인 순서대로이고, ref는 그 선택지를 누를 때 플러그인에 넘기는 번호다.
 */
export function readGameScene(nodes: UiNode[]): GameScene | null {
  const start = nodes.findIndex((n) => n.name === 'SpeakToContainer')
  if (start < 0) return null
  let end = start + 1
  while (end < nodes.length && nodes[end].depth > nodes[start].depth) end++

  /** 이 요소나 조상 가운데(틀 안에서) 조건에 맞는 것이 있는지 */
  const under = (index: number, test: (n: UiNode) => boolean): boolean => {
    for (let i = index; i >= start; i = nodes[i].parent) {
      if (test(nodes[i])) return true
      if (i === start) break
    }
    return false
  }
  const named = (...names: string[]) => (n: UiNode) => names.includes(n.name)

  // 틀이 놓인 화면과 그 화면의 머리글(제목, 상대 팀, 대회)
  let panelIndex = -1
  for (let i = nodes[start].parent; i >= 0; i = nodes[i].parent) {
    if (nodes[i].type === PANEL) {
      panelIndex = i
      break
    }
  }
  const panel = panelIndex >= 0 ? nodes[panelIndex].name : ''
  const heading: string[] = []
  // 기자회견은 질문과 기자 이름이 대화 틀 밖(같은 화면의 다른 자리)에 있다
  const asked: string[] = []
  const asker: string[] = []
  if (panelIndex >= 0) {
    let panelEnd = panelIndex + 1
    while (panelEnd < nodes.length && nodes[panelEnd].depth > nodes[panelIndex].depth) panelEnd++
    for (let i = panelIndex + 1; i < panelEnd; i++) {
      if (i >= start && i < end) continue
      const text = plainText(nodes[i].text)
      if (!text || nodes[i].type === BUTTON) continue
      let inTopBar = false
      let inButton = false
      let inBubble = false
      let inName = false
      for (let p = nodes[i].parent; p > panelIndex; p = nodes[p].parent) {
        const name = nodes[p].name
        if (name === 'TopBar') inTopBar = true
        if (nodes[p].type === BUTTON) inButton = true
        if (/bubble/i.test(name)) inBubble = true
        if (/^NameAndHierar/i.test(name)) inName = true
      }
      if (inButton) continue
      if (inBubble) asked.push(text)
      else if (inName) asker.push(text)
      else if (nodes[i].name === 'FinishedText' || inTopBar) heading.push(text)
    }
  }

  const options: GameScene['options'] = []
  const speaker: string[] = []
  const question: string[] = []
  const facts: string[] = []
  let tone = ''
  /** 지금 훑고 있는 선택지 버튼이 끝나는 순번 */
  let optionEnd = -1

  for (let i = start; i < end; i++) {
    if (i < optionEnd) continue
    const node = nodes[i]
    if (under(i, named('AdditionalActionsVisible', OUR_BOX))) continue

    if (node.type === BUTTON && node.width > 0 && node.height > 0 && !under(i, named('SpeakToHeader'))) {
      let last = i + 1
      const parts = [plainText(node.text)]
      // 글자가 든 버튼을 또 품고 있으면 선택지가 아니라 묶음이다(틀 전체를 덮는 버튼이 있다)
      let wrapsButtons = false
      while (last < end && nodes[last].depth > node.depth) {
        if (nodes[last].type === BUTTON) {
          for (let k = last; k < end && (k === last || nodes[k].depth > nodes[last].depth); k++) {
            if (plainText(nodes[k].text)) wrapsButtons = true
          }
        }
        parts.push(plainText(nodes[last].text))
        last++
      }
      const text = [...new Set(parts.filter(Boolean))].join(' ')
      if (text && !wrapsButtons) {
        optionEnd = last
        if (!node.disabled) options.push({ text, tone, ref: node.id })
        continue
      }
    }

    const text = plainText(node.text)
    if (!text || node.type === BUTTON) continue
    if (under(i, named('SpeakToHeader'))) speaker.push(text)
    else if (under(i, named('HasBubbles'))) question.push(text)
    else if (under(i, named('SenderFrame'))) continue // 기자회견에서는 답하는 사람(감독 자신)이 적혀 있다
    else if (node.name === 'GroupTitle' || (text.length <= 14 && !under(i, (n) => n.classes.includes('sender-bubbles-frame')))) tone = text
    else facts.push(text)
  }

  return {
    panel,
    screen: screenOf(panel),
    situation: heading.join(' · '),
    speaker: [...new Set(speaker.length > 0 ? speaker : asker)].join(' · '),
    question: (question.length > 0 ? question : asked).join('\n'),
    options,
    facts
  }
}

/**
 * 경기 화면에서 점수판과 방금 나온 중계 문구를 읽는다. 경기 중 외침을 고를 때 AI에게 상황으로 알려 준다.
 * 경기 화면이 아니면 빈 값.
 */
export function readMatchInfo(nodes: UiNode[]): { situation: string; facts: string[]; teams?: [string, string] } {
  const byName = (name: string): string => plainText(nodes.find((n) => n.name === name && n.text !== '')?.text ?? '')
  const home = byName('HomeTeamText')
  const away = byName('AwayTeamText')
  const time = byName('Time')
  if (!home || !away) return { situation: '', facts: [] }

  const facts: string[] = []
  const commentary = nodes.findIndex((n) => n.name === 'BindingExpect_MatchCommentary')
  if (commentary >= 0) {
    for (let i = commentary + 1; i < nodes.length && nodes[i].depth > nodes[commentary].depth; i++) {
      const text = plainText(nodes[i].text)
      // 선수단 표(포지션, 평점)는 중계가 아니다. 문장만 고른다
      if (text.length >= 8 && !nodes[i].invisible && !nodes[i].disabled && /\s/.test(text)) {
        facts.push(`중계: ${text}`)
        break
      }
    }
  }
  const score = `${home} ${byName('HomeScore')}-${byName('AwayScore')} ${away}`
  return { situation: time ? `${score} (앞이 홈), 경기 시간 ${time}` : `${score} (앞이 홈)`, facts, teams: [home, away] }
}

/**
 * 지금까지 본 경기들의 "홈|원정" 약칭에서 우리 팀을 짐작한다.
 * 우리 팀은 모든 경기에 나오므로, 서로 다른 경기 두 번 이상에 나온 약칭이 하나뿐이면 그것이 우리 팀이다.
 * 아직 알 수 없으면 null.
 */
export function guessOwnTeam(pairs: string[]): string | null {
  const counts = new Map<string, number>()
  for (const pair of new Set(pairs)) {
    for (const team of new Set(pair.split('|'))) counts.set(team, (counts.get(team) ?? 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (ranked.length === 0 || ranked[0][1] < 2) return null
  if (ranked.length > 1 && ranked[1][1] === ranked[0][1]) return null
  return ranked[0][0]
}
