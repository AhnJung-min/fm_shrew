import { describe, expect, it } from 'vitest'
import { buildSayPrompt, toTurn } from '../src/main/talk/advisor'
import type { TalkScene } from '../src/shared/talk'

const scene: TalkScene = {
  id: 1,
  screen: 'team_talk',
  readable: true,
  situation: '하프타임, 0-1',
  speaker: '',
  question: '',
  options: [
    { text: '이런 경기력은 받아들일 수 없다.', tone: '공격적으로' },
    { text: '아직 끝나지 않았다.', tone: '단호하게' },
    { text: '하던 대로 해라.', tone: '' }
  ],
  facts: []
}

const raw = {
  pick: 1,
  confidence: 0.8,
  reason: '뜻이 가장 가깝다',
  replies: [{ speaker: '선수단', text: '알겠습니다, 감독님.' }],
  nextAction: '',
  offer: { opening: '', structure: '', walkAway: '' },
  caution: ''
}

describe('toTurn: 모델의 답을 화면용으로 바꾸기', () => {
  it('고른 순번과 반응 대사를 그대로 넘긴다', () => {
    const turn = toTurn(raw, scene)
    expect(turn.pickIndex).toBe(1)
    expect(turn.replies).toEqual([{ speaker: '선수단', text: '알겠습니다, 감독님.' }])
  })

  it('범위를 벗어난 순번은 버린다', () => {
    expect(toTurn({ ...raw, pick: 7 }, scene).pickIndex).toBeNull()
    expect(toTurn({ ...raw, pick: -1 }, scene).pickIndex).toBeNull()
    expect(toTurn({ ...raw, pick: 1.5 }, scene).pickIndex).toBeNull()
  })

  it('확신도는 0과 1 사이로 맞추고, 반응 대사는 빈 줄을 빼고 둘까지만 남긴다', () => {
    const turn = toTurn(
      {
        ...raw,
        confidence: 3,
        replies: [
          { speaker: 'a', text: '하나' },
          { speaker: 'b', text: '  ' },
          { speaker: 'c', text: '둘' },
          { speaker: 'd', text: '셋' }
        ]
      },
      scene
    )
    expect(turn.confidence).toBe(1)
    expect(turn.replies.map((r) => r.text)).toEqual(['하나', '둘'])
  })

  it('협상이 아닌 장면에서는 제안 칸을 비운다', () => {
    const turn = toTurn({ ...raw, nextAction: '제안한다', offer: { opening: '700억', structure: '분할', walkAway: '800억' } }, scene)
    expect(turn.nextAction).toBe('')
    expect(turn.offer).toEqual({ opening: '', structure: '', walkAway: '' })
  })

  it('협상 장면에서는 제안을 그대로 둔다', () => {
    const deal: TalkScene = { ...scene, screen: 'transfer_negotiation', options: [], facts: ['요구 이적료 950억 원'] }
    const turn = toTurn({ ...raw, pick: -1, nextAction: '이적료 칸에 700억을 넣는다', offer: { opening: '700억', structure: '3년 분할', walkAway: '800억' } }, deal)
    expect(turn.pickIndex).toBeNull()
    expect(turn.nextAction).toBe('이적료 칸에 700억을 넣는다')
    expect(turn.offer.opening).toBe('700억')
  })
})

describe('buildSayPrompt: 대화 단계에 보내는 글', () => {
  it('선택지에 순번을 붙이고, 지난 대화와 방금 한 말을 넣는다', () => {
    const prompt = buildSayPrompt(
      scene,
      [
        { from: 'them', speaker: '기자', text: '각오는?' },
        { from: 'me', speaker: '감독', text: '이기겠다' }
      ],
      '(물병을 던지며) 이게 경기냐',
      ['마르코 델 바르코', '주앙 페레이로']
    )
    expect(prompt).toContain('  1: 아직 끝나지 않았다. (어조: 단호하게)')
    expect(prompt).toContain('[내 팀 선수] 마르코 델 바르코, 주앙 페레이로')
    expect(prompt).toContain('기자: 각오는?')
    expect(prompt).toContain('감독: 이기겠다')
    expect(prompt.trimEnd().endsWith('(물병을 던지며) 이게 경기냐')).toBe(true)
  })

  it('지난 대화는 최근 12줄만 보낸다', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ from: 'me' as const, speaker: '감독', text: `말 ${i}` }))
    const prompt = buildSayPrompt(scene, history, '끝', [])
    expect(prompt).not.toContain('말 7\n')
    expect(prompt).toContain('말 8')
    expect(prompt).toContain('말 19')
  })
})
