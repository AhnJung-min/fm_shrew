import { describe, expect, it } from 'vitest'
import { GLOSSARY, SIX_TERMS, termTip, type TermId } from '../src/renderer/src/lib/glossary'
import { TRUST } from '../src/renderer/src/lib/trust'
import { TERM_HELP } from '../src/shared/recommend'

const IDS = Object.keys(GLOSSARY) as TermId[]

/** 화면에 쓰지 않기로 한 옛 말과 어려운 통계 말 */
const BANNED = ['표준편차', 'σ', '점유 시', '확인 못 함', '알 수 없음', '값 없음', '읽지 못함']

describe('낱말 사전(C-26, C-15)', () => {
  it('여섯 낱말이 있다: 적합도, 보강 필요도, 추천 점수, 잉여 점수, 체급, 기준 주전', () => {
    expect([...SIX_TERMS]).toEqual(['fit', 'need', 'recommend', 'surplus', 'stature', 'benchStarter'])
    expect(SIX_TERMS.map((id) => GLOSSARY[id].word)).toEqual(['적합도', '보강 필요도', '추천 점수', '잉여 점수', '체급', '기준 주전'])
  })

  it('모르는 값의 낱말은 셋뿐이다: 추정, 정보 없음, 없음', () => {
    expect(GLOSSARY.estimate.word).toBe('추정')
    expect(GLOSSARY.unknown.word).toBe('정보 없음')
    expect(GLOSSARY.none.word).toBe('없음')
  })

  it('두 국면은 게임 낱말 그대로다: 공 소유 시, 공 미소유 시', () => {
    expect(GLOSSARY.phaseIp.word).toBe('공 소유 시')
    expect(GLOSSARY.phaseOop.word).toBe('공 미소유 시')
  })

  it('현재·잠재 능력, 굵은 이름(핵심 능력치), 적합도와 게임 별점의 차이가 있다', () => {
    for (const id of ['ability', 'coreAttr', 'fitVsStars'] as const) {
      expect(GLOSSARY[id].word.length, id).toBeGreaterThan(0)
      expect(GLOSSARY[id].short.length, id).toBeGreaterThan(0)
    }
    expect(GLOSSARY.ability.short).toContain('200')
    expect(GLOSSARY.fitVsStars.short).toContain('별점')
  })

  it('사전의 열쇠와 낱말 id가 같고, 낱말이 서로 겹치지 않는다', () => {
    for (const id of IDS) expect(GLOSSARY[id].id).toBe(id)
    expect(new Set(IDS.map((id) => GLOSSARY[id].word)).size).toBe(IDS.length)
    expect(IDS).toHaveLength(14)
  })

  it('short는 한 문장이다: 줄바꿈이 없고, 마침표 하나로 끝나며, 풍선에 맞게 짧다', () => {
    for (const id of IDS) {
      const { short } = GLOSSARY[id]
      expect(short, id).not.toMatch(/[\r\n]/)
      expect(short.endsWith('.'), `${id}는 마침표로 끝난다`).toBe(true)
      expect(short.indexOf('.'), `${id}는 문장이 하나다`).toBe(short.length - 1)
      expect(short.length, id).toBeLessThanOrEqual(100)
      expect(short, id).toBe(short.trim())
    }
  })

  it("short와 long 어디에도 '표준편차'와 기호 σ가 없고, 화면에 쓰지 않기로 한 옛 말도 없다", () => {
    for (const id of IDS) {
      for (const text of [GLOSSARY[id].word, GLOSSARY[id].short, GLOSSARY[id].long ?? '']) {
        for (const banned of BANNED) expect(text, `${id}에 '${banned}'`).not.toContain(banned)
      }
    }
  })

  it('낱말을 가운뎃점으로 잇지 않는다', () => {
    for (const id of IDS) {
      expect(GLOSSARY[id].word, id).not.toContain('·')
      expect(GLOSSARY[id].short, id).not.toContain('·')
    }
  })

  it('long은 지금 있는 풀이를 그대로 가져다 쓴다(글을 옮겨 적지 않는다)', () => {
    expect(GLOSSARY.fit.long).toBe(TERM_HELP.fit)
    expect(GLOSSARY.need.long).toBe(TERM_HELP.need)
    expect(GLOSSARY.recommend.long).toBe(TERM_HELP.recommend)
  })

  it('termTip은 한 문장 풀이를 돌려준다', () => {
    for (const id of IDS) expect(termTip(id)).toBe(GLOSSARY[id].short)
  })
})

describe('믿음 문장 세 줄(C-61)', () => {
  it('세 줄이 있고, 줄바꿈 없이 마침표로 끝난다', () => {
    expect(Object.keys(TRUST).sort()).toEqual(['game', 'outbound', 'save'])
    for (const text of Object.values(TRUST)) {
      expect(text.length).toBeGreaterThan(20)
      expect(text).not.toMatch(/[\r\n]/)
      expect(text.endsWith('.')).toBe(true)
    }
  })

  it('말하는 사실이 맞는 자리를 가리킨다: 세이브는 읽기만, 게임은 누를 때만과 게임에서 저장, 밖으로는 Claude에 보내는 것뿐', () => {
    expect(TRUST.save).toContain('읽기만')
    expect(TRUST.save).toContain('사본')
    expect(TRUST.game).toContain('누를 때만')
    expect(TRUST.game).toContain('게임에서 저장')
    expect(TRUST.outbound).toContain('이 PC 밖')
    expect(TRUST.outbound).toContain('Claude')
  })

  it('옛 말과 어려운 통계 말이 없다', () => {
    for (const text of Object.values(TRUST)) for (const banned of BANNED) expect(text).not.toContain(banned)
  })
})
