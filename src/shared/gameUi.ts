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
  /** 글자가 없으면 빈 문자열 */
  text: string
  /** 부모의 nodes 안 순번. 뿌리는 -1 */
  parent: number
}

const LINE =
  /^( *)#(\d+) (\S+)(?: "([^"]*)")?((?: \.\S+)*) \[(-?[\d.NaInfity-]+),(-?[\d.NaInfity-]+) (-?[\d.NaInfity-]+)x(-?[\d.NaInfity-]+)\]((?: (?:hidden|invisible|disabled|focusable))*)(?: text="(.*)")?(?: !\w+)?$/

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
      id: Number(m[2]),
      depth,
      type: m[3],
      name: m[4] ?? '',
      classes: m[5] ? m[5].trim().split(' ').map((c) => c.slice(1)) : [],
      x: Number(m[6]),
      y: Number(m[7]),
      width: Number(m[8]),
      height: Number(m[9]),
      disabled: m[10].includes('disabled'),
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
  if (panelIndex >= 0) {
    for (let i = panelIndex + 1; i < start; i++) {
      const text = plainText(nodes[i].text)
      if (!text || nodes[i].type === BUTTON) continue
      let inTopBar = false
      let inButton = false
      for (let p = nodes[i].parent; p > panelIndex; p = nodes[p].parent) {
        if (nodes[p].name === 'TopBar') inTopBar = true
        if (nodes[p].type === BUTTON) inButton = true
      }
      if (inTopBar && !inButton) heading.push(text)
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
    else if (text.length <= 14 && !under(i, (n) => n.classes.includes('sender-bubbles-frame'))) tone = text
    else facts.push(text)
  }

  return {
    panel,
    screen: screenOf(panel),
    situation: heading.join(' · '),
    speaker: [...new Set(speaker)].join(' · '),
    question: question.join('\n'),
    options,
    facts
  }
}
