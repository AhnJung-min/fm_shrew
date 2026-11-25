import { describe, expect, it } from 'vitest'
import { toAdvice } from '../src/main/talk/advisor'

const base = {
  screen: 'team_talk' as const,
  situation: '하프타임, 0-1',
  readable: true,
  options: [
    { text: '이런 경기력은 받아들일 수 없다.', tone: '공격적으로' },
    { text: '아직 끝나지 않았다.', tone: '단호하게' },
    { text: '하던 대로 해라.', tone: '' }
  ],
  pick: 1,
  confidence: 0.8,
  reason: '뜻이 가장 가깝다',
  nextAction: '',
  alternatives: [{ pick: 0, why: '믿음의 뜻이 빠진다' }],
  offer: { opening: '', structure: '', walkAway: '' },
  caution: ''
}

describe('toAdvice: 모델의 답을 화면용으로 바꾸기', () => {
  it('고른 순번의 선택지를 화면 문구 그대로 추천으로 쓴다', () => {
    const advice = toAdvice(base)
    expect(advice.pickIndex).toBe(1)
    expect(advice.recommendation).toMatchObject({ option: '아직 끝나지 않았다.', tone: '단호하게' })
    expect(advice.alternatives).toEqual([
      { index: 0, option: '이런 경기력은 받아들일 수 없다.', tone: '공격적으로', reason: '믿음의 뜻이 빠진다' }
    ])
  })

  it('범위를 벗어난 순번은 버리고, 읽지 못한 것으로 표시한다', () => {
    const advice = toAdvice({ ...base, pick: 7, alternatives: [{ pick: 9, why: '' }] })
    expect(advice.pickIndex).toBeNull()
    expect(advice.recommendation.option).toBe('')
    expect(advice.alternatives).toEqual([])
    expect(advice.readable).toBe(false)
  })

  it('차선책은 추천과 겹치지 않게 둘까지만 남긴다', () => {
    const advice = toAdvice({
      ...base,
      alternatives: [
        { pick: 1, why: '추천과 같음' },
        { pick: 0, why: 'a' },
        { pick: 2, why: 'b' },
        { pick: 0, why: '중복' }
      ]
    })
    expect(advice.alternatives.map((a) => a.index)).toEqual([0, 2])
  })

  it('확신도는 0과 1 사이로 맞춘다', () => {
    expect(toAdvice({ ...base, confidence: 3 }).confidence).toBe(1)
    expect(toAdvice({ ...base, confidence: -1 }).confidence).toBe(0)
  })

  it('협상 화면은 선택지 없이 지금 할 일을 추천으로 쓴다', () => {
    const advice = toAdvice({
      ...base,
      screen: 'transfer_negotiation',
      options: [],
      pick: -1,
      nextAction: '이적료 칸에 700억을 넣고 제안한다',
      offer: { opening: '700억', structure: '3년 분할', walkAway: '800억' }
    })
    expect(advice.pickIndex).toBeNull()
    expect(advice.readable).toBe(true)
    expect(advice.recommendation.option).toBe('이적료 칸에 700억을 넣고 제안한다')
  })
})
