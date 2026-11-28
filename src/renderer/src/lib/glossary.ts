/**
 * 낱말 사전(디자인 적용 1차, C-26·C-15). 풍선, 맥락 줄, 점수 풀이, 설정의 '용어 풀이'가 처음부터 같은 한 문장을 쓰도록 한 곳에 둔다.
 *
 * - word: 화면에 보이는 낱말. 게임의 말을 그대로 쓴다(두 국면은 "공 소유 시"와 "공 미소유 시").
 * - short: 한 문장 풀이(풍선). 줄바꿈 없이 한 문장이고, 어려운 통계 말('표준편차'와 기호)을 쓰지 않는다.
 * - long: 설정 목록의 '자세히'. 지금 있는 풀이(TERM_HELP)를 가져다 쓴다. 글을 옮겨 적지 않는다(그 글을 견주는 시험이 있다).
 *
 * 모르는 값은 세 낱말만 쓴다: 추정(앱이 어림한 값), 정보 없음(값을 받지 못해 보통으로 본 값), 없음(값이 원래 없음). 중립색이고 주황·빨강을 쓰지 않는다.
 */
import { TERM_HELP } from '@shared/recommend'

export type TermId =
  | 'fit' | 'need' | 'recommend' | 'surplus' | 'stature' | 'benchStarter' // 여섯 낱말(C-26)
  | 'ability' // 현재·잠재 능력(두 값 모두 최대 200)
  | 'estimate' | 'unknown' | 'none' // 추정, 정보 없음, 없음(C-15)
  | 'phaseIp' | 'phaseOop' // 공 소유 시, 공 미소유 시
  | 'coreAttr' | 'fitVsStars' // 굵은 이름의 뜻, 적합도와 게임 별점의 차이

export interface Term {
  id: TermId
  /** 화면에 보이는 낱말 */
  word: string
  /** 한 문장 풀이(풍선) */
  short: string
  /** 설정 목록의 자세히. 없으면 한 문장 풀이만 보인다 */
  long?: string
}

export const GLOSSARY: Readonly<Record<TermId, Term>> = {
  fit: {
    id: 'fit',
    word: '적합도',
    short: '선수가 그 자리 역할에 얼마나 맞는지를 중요한 능력치로 계산해 0~100점으로 나타낸 값입니다.',
    long: TERM_HELP.fit
  },
  need: {
    id: 'need',
    word: '보강 필요도',
    short: '그 자리에 선수를 더 영입해야 하는 정도를 0~100으로 나타낸 값입니다.',
    long: TERM_HELP.need
  },
  recommend: {
    id: 'recommend',
    word: '추천 점수',
    short: '영입 후보가 내 팀에 얼마나 도움이 될지를 전력, 나이, 비용, 영입 난이도 등으로 나눠 0~100점으로 매긴 값입니다.',
    long: TERM_HELP.recommend
  },
  surplus: {
    id: 'surplus',
    word: '잉여 점수',
    short: '내 선수를 정리해도 되는 정도를 적합도, 주급, 나이로 따져 0~100점으로 나타낸 값이고, 높을수록 정리할 만합니다.'
  },
  stature: {
    id: 'stature',
    word: '체급',
    short: '구단의 전체 수준을 선수들의 현재 능력으로 어림한 값이고, 영입이 얼마나 쉬운지를 가늠하는 데 씁니다.'
  },
  benchStarter: {
    id: 'benchStarter',
    word: '기준 주전',
    short: '영입 후보와 견주는 내 팀의 주전으로, 같은 자리가 여럿이면 그 가운데 가장 약한 주전입니다.'
  },
  ability: {
    id: 'ability',
    word: '현재 능력과 잠재 능력',
    short: '현재 능력은 지금의 실력이고 잠재 능력은 앞으로 닿을 수 있는 한계이며, 둘 다 최대 200입니다.'
  },
  estimate: {
    id: 'estimate',
    word: '추정',
    short: '앱이 값을 직접 받지 못해 어림해서 채운 값입니다.'
  },
  unknown: {
    id: 'unknown',
    word: '정보 없음',
    short: '값을 받지 못해 보통으로 보고 계산한 값입니다.'
  },
  none: {
    id: 'none',
    word: '없음',
    short: '값이 원래 없다는 뜻이고, 자유 계약 선수의 소속과 주급이 그런 경우입니다.'
  },
  phaseIp: {
    id: 'phaseIp',
    word: '공 소유 시',
    short: '우리 팀이 공을 가지고 있을 때의 역할과 비중입니다.'
  },
  phaseOop: {
    id: 'phaseOop',
    word: '공 미소유 시',
    short: '우리 팀이 공을 가지고 있지 않을 때의 역할과 비중입니다.'
  },
  coreAttr: {
    id: 'coreAttr',
    word: '핵심 능력치',
    short: '굵게 쓴 능력치 이름은 그 역할에서 가중치가 큰 핵심 능력치입니다.'
  },
  fitVsStars: {
    id: 'fitVsStars',
    word: '적합도와 게임 별점',
    short: '적합도는 이 앱이 능력치로 계산한 점수라서 게임이 보여 주는 역할 별점과 다를 수 있습니다.'
  }
}

/** 여섯 낱말(C-26): 설정의 '용어 풀이'에서 먼저 보이고, 표 머리와 맥락 줄의 풍선이 쓴다 */
export const SIX_TERMS: readonly TermId[] = ['fit', 'need', 'recommend', 'surplus', 'stature', 'benchStarter']

/** 풍선에 쓰는 한 문장 풀이 */
export function termTip(id: TermId): string {
  return GLOSSARY[id].short
}
