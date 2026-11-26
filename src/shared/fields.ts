import type { ColumnGroup } from './types'

export interface FieldDef {
  id: string
  /** 전체 이름 */
  label: string
  /** 표 머리에 쓰는 짧은 이름 */
  short: string
  group: ColumnGroup
  /** 1~20 능력치인지 */
  isAttr: boolean
  /** 파일에서 이 항목으로 볼 열 이름들(한국어·영어·약어). 비교는 normalizeHeader 후에 한다 */
  aliases: string[]
}

/** 열 이름 비교용 정규화: 소문자, 공백·구두점 제거 */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s._\-·/()[\]]+/g, '')
}

const attr = (
  id: string,
  group: ColumnGroup,
  label: string,
  short: string,
  aliases: string[]
): FieldDef => ({ id, label, short, group, isAttr: true, aliases: [label, short, ...aliases] })

const info = (id: string, label: string, aliases: string[], group: ColumnGroup = 'info'): FieldDef => ({
  id,
  label,
  short: label,
  group,
  isAttr: false,
  aliases: [label, ...aliases]
})

/**
 * 앱이 아는 항목 사전.
 * 한국어 열 이름은 게임 버전과 뷰에 따라 표기가 조금씩 달라서 별칭을 넉넉히 둔다.
 * 그래도 못 알아본 열은 설정 화면에서 직접 지정할 수 있다.
 */
export const FIELDS: FieldDef[] = [
  // 기본 정보
  info('name', '이름', ['선수', '선수명', 'name', 'player']),
  info('uid', '고유 ID', ['uid', 'id', '고유id', '고유번호']),
  info('age', '나이', ['age', '연령']),
  info('position', '포지션', ['position', 'pos', '위치', '주 포지션', 'positions']),
  info('nationality', '국적', ['nationality', 'nation', 'nat', '국가']),
  info('club', '소속 구단', ['club', '클럽', '구단', '소속', '소속팀', 'team']),
  info('value', '몸값', ['value', 'transfer value', '이적 가치', '시장 가치', '예상 가치', '가치'], 'contract'),
  info('wage', '주급', ['wage', 'salary', '급료', '급여', '임금', '연봉'], 'contract'),
  info('contractEnd', '계약 만료', ['expires', 'contract expiry', '만료', '계약 만료일', '계약 종료', '계약'], 'contract'),
  info('squadStatus', '계약상 입지', ['squad status', 'status in squad', '입지', '팀 내 입지', '역할 약속'], 'contract'),
  info('height', '키', ['height', '신장']),
  info('weight', '몸무게', ['weight', '체중']),
  info('foot', '주발', ['preferred foot', 'foot', '주로 쓰는 발', '선호하는 발']),
  info('leftFoot', '왼발', ['left foot']),
  info('rightFoot', '오른발', ['right foot']),
  info('dob', '생년월일', ['date of birth', 'dob', '생일', '출생']),
  info('personality', '성격', ['personality', '성향']),
  info('ability', '현재 능력', ['ability', 'ca', '능력', '현재 능력치', '현재능력']),
  info('potential', '잠재 능력', ['potential', 'pa', '잠재력', '잠재 능력치', '잠재능력']),
  info('bestRole', '최적 역할', ['best role', '역할', '최고 역할', '최적 포지션', 'best position']),
  info('morale', '사기', ['morale']),
  info('condition', '컨디션', ['condition', 'con', '몸 상태', '종합 신체 컨디션', '신체 컨디션']),
  info('sharpness', '경기력', ['match sharpness', 'sharpness', '경기 감각']),
  info('playingTime', '출전 시간 만족도', ['playing time', '출전 시간', '출장 시간 만족도']),
  info('form', '최근 전적', ['form', 'last 5 games', '최근 경기', '최근 5경기']),
  info('status', '상태', ['status', 'information', 'inf', '정보']),
  info('picked', '선발됨', ['picked', 'selected', '선발']),
  info('apps', '출전', ['apps', 'appearances', '출장', '출전 수', '경기']),
  info('goals', '득점', ['goals', 'gls', '골']),
  info('assists', '도움', ['assists', 'ast', '어시스트']),
  info('avgRating', '평균 평점', ['av rat', 'avg rating', 'average rating', '평점', '평균평점', '평균']),

  // 기술
  attr('corners', 'technical', '코너킥', '코너', ['corners', 'cor']),
  attr('crossing', 'technical', '크로스', '크로', ['crossing', 'cro']),
  attr('dribbling', 'technical', '드리블', '드리', ['dribbling', 'dri']),
  attr('finishing', 'technical', '골 결정력', '결정', ['finishing', 'fin', '결정력', '마무리']),
  attr('firstTouch', 'technical', '퍼스트 터치', '퍼터', ['first touch', 'fir', '볼 트래핑', '트래핑']),
  attr('freeKick', 'technical', '프리킥', '프리', ['free kick taking', 'free kicks', 'fre']),
  attr('heading', 'technical', '헤더', '헤더', ['heading', 'hea', '헤딩']),
  attr('longShots', 'technical', '중거리 슛', '중슛', ['long shots', 'lon', '중거리슛', '롱슛']),
  attr('longThrows', 'technical', '롱 스로인', '스로', ['long throws', 'l th', 'lth', '장거리 스로인', '스로인']),
  attr('marking', 'technical', '대인 방어', '마크', ['marking', 'mar', '대인 수비', '대인 마크', '마킹']),
  attr('passing', 'technical', '패스', '패스', ['passing', 'pas']),
  attr('penalty', 'technical', '페널티킥', 'PK', ['penalty taking', 'penalties', 'pen', '승부차기']),
  attr('tackling', 'technical', '태클', '태클', ['tackling', 'tck']),
  attr('technique', 'technical', '개인기', '개인', ['technique', 'tec', '테크닉', '기술']),

  // 정신
  attr('aggression', 'mental', '적극성', '적극', ['aggression', 'agg', '공격성']),
  attr('anticipation', 'mental', '예측력', '예측', ['anticipation', 'ant']),
  attr('bravery', 'mental', '대담성', '대담', ['bravery', 'bra', '용감성', '용기']),
  attr('composure', 'mental', '침착성', '침착', ['composure', 'cmp']),
  attr('concentration', 'mental', '집중력', '집중', ['concentration', 'cnt']),
  attr('decisions', 'mental', '판단력', '판단', ['decisions', 'dec']),
  attr('determination', 'mental', '결단력', '결단', ['determination', 'det', '승부욕', '투지']),
  attr('flair', 'mental', '천재성', '천재', ['flair', 'fla', '창의성']),
  attr('leadership', 'mental', '리더십', '리더', ['leadership', 'ldr', '통솔력']),
  attr('offTheBall', 'mental', '오프 더 볼', '오프', ['off the ball', 'otb', '공 없는 움직임']),
  attr('positioning', 'mental', '위치 선정', '위치', ['positioning', 'pos', '포지셔닝']),
  attr('teamwork', 'mental', '팀워크', '팀웍', ['teamwork', 'tea']),
  attr('vision', 'mental', '시야', '시야', ['vision', 'vis']),
  attr('workRate', 'mental', '활동량', '활동', ['work rate', 'wor', '운동량']),

  // 신체
  attr('acceleration', 'physical', '가속도', '가속', ['acceleration', 'acc', '순간 속도']),
  attr('agility', 'physical', '민첩성', '민첩', ['agility', 'agi']),
  attr('balance', 'physical', '밸런스', '밸런', ['balance', 'bal', '균형 감각', '균형']),
  attr('jumping', 'physical', '점프 거리', '점프', ['jumping reach', 'jumping', 'jum', '점프력', '제공권']),
  attr('naturalFitness', 'physical', '타고난 체력', '체력', ['natural fitness', 'nat', '천부적 체력', '자연 체력']),
  attr('pace', 'physical', '주력', '주력', ['pace', 'pac', '속도', '스피드']),
  attr('stamina', 'physical', '지구력', '지구', ['stamina', 'sta']),
  attr('strength', 'physical', '몸싸움', '몸쌈', ['strength', 'str', '힘', '근력']),

  // 골키퍼
  attr('aerialReach', 'goalkeeping', '공중볼 처리', '공중', ['aerial reach', 'aer', '공중볼 장악', '공중 장악']),
  attr('commandOfArea', 'goalkeeping', '수비 조율', '조율', ['command of area', 'cmd', '지역 장악', '페널티 지역 장악']),
  attr('communication', 'goalkeeping', '의사소통', '소통', ['communication', 'com']),
  attr('eccentricity', 'goalkeeping', '엉뚱함', '엉뚱', ['eccentricity', 'ecc', '기이함', '돌발 행동']),
  attr('handling', 'goalkeeping', '핸들링', '핸들', ['handling', 'han', '볼 핸들링']),
  attr('kicking', 'goalkeeping', '골킥', '골킥', ['kicking', 'kic', '킥']),
  attr('oneOnOnes', 'goalkeeping', '일대일', '1대1', ['one on ones', '1v1', '1대1', '일대일 대처']),
  attr('punching', 'goalkeeping', '펀칭', '펀칭', ['punching', 'pun', 'punching tendency', '펀칭 성향']),
  attr('reflexes', 'goalkeeping', '반사 신경', '반사', ['reflexes', 'ref', '반사신경']),
  attr('rushingOut', 'goalkeeping', '달려 나오기', '전진', ['rushing out', 'tro', 'rushing out tendency', '뛰쳐나오기', '전진 수비']),
  attr('throwing', 'goalkeeping', '던지기', '던짐', ['throwing', 'thr', '스로잉'])
]

export const FIELD_BY_ID: Record<string, FieldDef> = Object.fromEntries(FIELDS.map((f) => [f.id, f]))

/** 정규화한 별칭 → 후보 항목들. 같은 약어를 두 항목이 쓰는 경우(nat, pos)가 있어 배열이다. */
const ALIAS_INDEX: Map<string, FieldDef[]> = (() => {
  const index = new Map<string, FieldDef[]>()
  for (const field of FIELDS) {
    for (const alias of field.aliases) {
      const key = normalizeHeader(alias)
      const list = index.get(key) ?? []
      if (!list.includes(field)) list.push(field)
      index.set(key, list)
    }
  }
  return index
})()

/**
 * 열 이름으로 항목을 찾는다.
 * 후보가 둘 이상이면 값이 숫자인지로 가른다(예: Nat → 숫자면 타고난 체력, 글자면 국적).
 */
export function matchField(header: string, valuesAreNumeric: boolean): FieldDef | null {
  const candidates = ALIAS_INDEX.get(normalizeHeader(header))
  if (!candidates || candidates.length === 0) return null
  if (candidates.length === 1) {
    const only = candidates[0]
    // 능력치로 알아봤는데 값이 숫자가 아니면 잘못 짚은 것이다
    if (only.isAttr && !valuesAreNumeric) return null
    return only
  }
  return candidates.find((c) => c.isAttr === valuesAreNumeric) ?? null
}

export const GROUP_LABEL: Record<ColumnGroup, string> = {
  info: '정보',
  contract: '계약',
  technical: '기술',
  mental: '정신',
  physical: '신체',
  goalkeeping: '골키퍼',
  other: '기타'
}

export const GROUP_ORDER: ColumnGroup[] = ['info', 'contract', 'technical', 'mental', 'physical', 'goalkeeping', 'other']
