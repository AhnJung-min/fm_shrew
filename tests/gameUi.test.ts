import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTree, plainText, readGameScene } from '../src/shared/gameUi'

/** 팀 대화 화면(26.3.2)의 구조를 줄여 옮긴 것. 문장은 지어낸 것이다 */
const TEAM_TALK = `=== panel 0
#1 UnityEngine.UIElements.PanelRootElement "DefaultLayerSettings" [0,0 1680x945]
 #2 SI.Bindable.Panel "TeamTalkPanel" .panel .panel--visible [0,0 1680x945]
  #3 UnityEngine.UIElements.VisualElement "TopBar" .row-direction-normal [48,16 365x48]
   #4 SI.Bindable.SIButton "BackButton" .sibutton [48,16 38x48] focusable text="뒤로"
   #5 SI.Bindable.SIText "PanelTitleText" .sitext [227,15 63x21] text="팀 대화"
   #6 SI.Bindable.SIText .sitext .white [251,43 50x14] text="<color=\\"#FFFFFF\\"><link=\\"0\\"><style=\\"Norml\\">상대 팀</style></link></color>"
  #7 SI.Bindable.SIButton "continue-button" .sibutton [1420,20 212x39] focusable
   #8 SI.Bindable.SIText "text" .sitext [1434,33 60x13] text="언론과 대화"
  #9 UnityEngine.UIElements.TemplateContainer "SpeakToContainer" [260,95 487x834]
   #31 SI.Bindable.SIButton "SIButton" .sibutton .shortcut-fake-button [260,95 475x834]
    #10 UnityEngine.UIElements.VisualElement "VisualElement" .sender-bubbles-frame [274,109 447x53]
     #11 UnityEngine.UIElements.TemplateContainer "SpeakToHeader" .content-ellipsis [274,109 447x53]
      #12 SI.Bindable.SIButton "ClubButton" .sibutton [290,124 24x24] focusable
      #13 SI.Bindable.SIText "Squad" .sitext [326,122 388x14] text="선수단"
      #14 SI.Bindable.SIText "Count" .sitext [326,136 388x16] text="20명의 선수"
     #15 SI.Bindable.SIVisible "HasBubbles" [274,163 447x0]
    #16 SI.Bindable.StreamedObjectList "NewsResponseOptionalButtons" .streamed-list-view [274,163 447x600]
     #17 SI.Bindable.AsyncBindingRoot .virtualised-list__item [274,164 447x44]
      #18 SI.Bindable.SIButton "StandardButton" .sibutton [274,164 447x44] focusable
       #19 SI.Bindable.SIVisible "TickedVisible" [290,186 0x0]
       #20 SI.Bindable.SIText "text" .sitext .button-regular [290,177 364x18] text="행운을 빈다."
     #21 SI.Bindable.AsyncBindingRoot .virtualised-list__item [274,207 447x62]
      #22 SI.Bindable.SIButton "StandardButton" .sibutton [274,207 447x62] focusable
       #23 SI.Bindable.SIText "text" .sitext .button-regular [290,221 364x18] text="\\"우리\\"가 이긴다.\\n보여 줘라."
     #24 SI.Bindable.AsyncBindingRoot .virtualised-list__item [274,270 447x44]
      #25 SI.Bindable.SIButton "StandardButton" .sibutton [274,270 447x44] disabled focusable
       #26 SI.Bindable.SIText "text" .sitext .button-regular [290,280 364x18] disabled text="지금은 고를 수 없는 말"
    #27 SI.Bindable.SIVisible "AdditionalActionsVisible" [261,898 473x31]
     #28 SI.Bindable.SIText "text" .sitext [462,907 46x16] text="일임하기:"
  #29 UnityEngine.UIElements.VisualElement "Other" [747,95 673x834]
   #30 SI.Bindable.SIText "Title" .sitext [763,100 46x31] text="팀 대화"
`

describe('parseTree: 플러그인이 보낸 화면 구조 읽기', () => {
  const nodes = parseTree(TEAM_TALK)

  it('요소마다 번호·종류·이름·부모를 읽는다', () => {
    expect(nodes).toHaveLength(31)
    const title = nodes.find((n) => n.id === 5)!
    expect(title.type).toBe('SI.Bindable.SIText')
    expect(title.name).toBe('PanelTitleText')
    expect(title.text).toBe('팀 대화')
    expect(nodes[title.parent].name).toBe('TopBar')
    expect(nodes.find((n) => n.id === 25)!.disabled).toBe(true)
  })

  it('따옴표와 줄바꿈 표기를 되돌린다', () => {
    expect(nodes.find((n) => n.id === 23)!.text).toBe('"우리"가 이긴다.\n보여 줘라.')
  })

  it('글자 꾸밈 표시를 뺀다', () => {
    expect(plainText(nodes.find((n) => n.id === 6)!.text)).toBe('상대 팀')
  })

  it('조사용 기록의 줄 끝에 붙는 값 경로(bind{…})는 건너뛴다', () => {
    const [text, image] = parseTree(
      `SI.Bindable.SIText "Name" .sitext [0,0 10x10] text="이 \\"선수\\"" bind{textBinding=row.Player.Name}\n` +
        ` SI.Bindable.SIImage [0,0 10x10] hidden bind{imageBinding=row.Player.Portrait}`
    )
    expect(text.text).toBe('이 "선수"')
    expect(image.type).toBe('SI.Bindable.SIImage')
    expect(image.parent).toBe(0)
  })
})

describe('readGameScene: 토크 장면 찾기', () => {
  it('팀 대화에서 상대·선택지를 찾고, 고를 수 없는 것과 틀 밖의 버튼은 뺀다', () => {
    const scene = readGameScene(parseTree(TEAM_TALK))!
    expect(scene.panel).toBe('TeamTalkPanel')
    expect(scene.screen).toBe('team_talk')
    expect(scene.situation).toBe('팀 대화, 상대 팀')
    expect(scene.speaker).toBe('선수단, 20명의 선수')
    expect(scene.question).toBe('')
    expect(scene.options).toEqual([
      { text: '행운을 빈다.', tone: '', ref: 18 },
      { text: '"우리"가 이긴다. 보여 줘라.', tone: '', ref: 22 }
    ])
    expect(scene.facts).toEqual([])
  })

  it('말풍선은 질문으로, 선택지 사이의 짧은 제목은 어조로 읽는다', () => {
    const scene = readGameScene(
      parseTree(`#1 SI.Bindable.Panel "PressConferencePanel" [0,0 100x100]
 #2 UnityEngine.UIElements.TemplateContainer "SpeakToContainer" [0,0 100x100]
  #3 UnityEngine.UIElements.TemplateContainer "SpeakToHeader" [0,0 10x10]
   #4 SI.Bindable.SIText .sitext [0,0 10x10] text="기자 이름"
  #5 SI.Bindable.SIVisible "HasBubbles" [0,0 10x10]
   #6 SI.Bindable.SIText .sitext [0,0 10x10] text="어떻게 준비하고 있습니까?"
  #7 SI.Bindable.SIText .sitext [0,0 10x10] text="긍정적"
  #8 SI.Bindable.SIButton .sibutton [0,0 10x10] focusable
   #9 SI.Bindable.SIText .sitext [0,0 10x10] text="잘해 줄 거라 믿습니다"
  #10 SI.Bindable.SIButton .sibutton [0,0 10x10] focusable
   #11 SI.Bindable.SIText .sitext [0,0 10x10] text="자신 있습니다"
  #12 SI.Bindable.SIText .sitext [0,0 10x10] text="부정적"
  #13 SI.Bindable.SIButton .sibutton [0,0 10x10] focusable
   #14 SI.Bindable.SIText .sitext [0,0 10x10] text="우리한테 달렸습니다"
`)
    )!
    expect(scene.screen).toBe('press_conference')
    expect(scene.speaker).toBe('기자 이름')
    expect(scene.question).toBe('어떻게 준비하고 있습니까?')
    expect(scene.options.map((o) => `${o.tone}:${o.ref}`)).toEqual(['긍정적:8', '긍정적:10', '부정적:13'])
  })

  it('토크 틀이 없는 화면은 null', () => {
    expect(readGameScene(parseTree('#1 SI.Bindable.Panel "Squad" [0,0 10x10]\n'))).toBeNull()
  })

  // 실제 게임에서 받은 구조로 확인할 때:  FMB_TREE=파일 npm test
  const real = process.env.FMB_TREE
  it.skipIf(!real || !existsSync(real))('실제 화면 구조 파일', () => {
    const scene = readGameScene(parseTree(readFileSync(real!, 'utf8')))
    console.log(JSON.stringify(scene, null, 1))
    expect(scene).not.toBeNull()
  })
})

describe('readMatchInfo: 경기 화면의 점수판과 중계', () => {
  it('점수·시간과 보이는 중계 문구를 읽는다', async () => {
    const { readMatchInfo } = await import('../src/shared/gameUi')
    const info = readMatchInfo(
      parseTree(`#1 SI.Bindable.Panel "OverviewHeader" [0,0 100x100]
 #2 SI.Bindable.SIText "Time" .sitext [0,0 10x10] text="74:27"
 #3 SI.Bindable.SIText "HomeTeamText" .sitext [0,0 10x10] text="HAN"
 #4 SI.Bindable.SIText "HomeScore" .sitext [0,0 10x10] text="1"
 #5 SI.Bindable.SIText "AwayScore" .sitext [0,0 10x10] text="2"
 #6 SI.Bindable.SIText "AwayTeamText" .sitext [0,0 10x10] text="GAO"
 #7 SI.Bindable.BindingExpect "BindingExpect_MatchCommentary" [0,0 10x10]
  #8 SI.Bindable.SIText .sitext [0,0 10x10] invisible text="지나간 중계 문구입니다"
  #9 SI.Bindable.SIText .sitext [0,0 10x10] text="도하람이 측면을 파고듭니다"
`)
    )
    expect(info.situation).toBe('HAN 1-2 GAO (앞이 홈), 경기 시간 74:27')
    expect(info.teams).toEqual(['HAN', 'GAO'])
    expect(info.facts).toEqual(['중계: 도하람이 측면을 파고듭니다'])
  })

  it('경기 화면이 아니면 비어 있다', async () => {
    const { readMatchInfo } = await import('../src/shared/gameUi')
    expect(readMatchInfo(parseTree('#1 SI.Bindable.Panel "Squad" [0,0 10x10]\n'))).toEqual({ situation: '', facts: [] })
  })
})

describe('guessOwnTeam: 여러 경기에 다 나오는 약칭이 우리 팀', () => {
  it('한 경기만 봤으면 알 수 없다', async () => {
    const { guessOwnTeam } = await import('../src/shared/gameUi')
    expect(guessOwnTeam([])).toBeNull()
    expect(guessOwnTeam(['HAN|GAO'])).toBeNull()
    expect(guessOwnTeam(['HAN|GAO', 'HAN|GAO'])).toBeNull()
  })

  it('서로 다른 두 경기에 나온 약칭을 고른다', async () => {
    const { guessOwnTeam } = await import('../src/shared/gameUi')
    expect(guessOwnTeam(['HAN|GAO', 'GAO|BUK'])).toBe('GAO')
    expect(guessOwnTeam(['HAN|GAO', 'GAO|BUK', 'BUK|NAM', 'GAO|NAM'])).toBe('GAO')
  })

  it('같은 횟수로 나온 약칭이 둘이면 정하지 않는다', async () => {
    const { guessOwnTeam } = await import('../src/shared/gameUi')
    expect(guessOwnTeam(['HAN|GAO', 'GAO|HAN'])).toBeNull()
  })
})
