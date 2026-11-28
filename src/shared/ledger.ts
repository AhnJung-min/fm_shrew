/**
 * 상수 대장(F-07). 점수 식의 조정 상수(경계, 가중치와 가중치 표, 문턱, 등급, 여유, 감소·성장 표, 최소 표본, 감점 표)는
 * 모두 이 파일에 모은다. src/shared의 다른 모듈은 값을 여기서 읽는다(`K.이름`).
 *
 * 규칙
 * - 새 조정 상수는 이 파일에 항목으로 더한다. 모듈 위쪽에 `const 이름 = 숫자`로 두지 않는다(tests/ledger.test.ts가 막는다).
 * - 조정 상수가 아닌 것은 제자리에 둔다: 열거형·이름표·글자, 능력치 순서 표, 배열 크기, 포메이션 정의, 화면 글,
 *   역할별 능력치 가중치(roles.ts, 사용자가 고치는 자료이고 2단계에서 바뀐다), 화면에 보이는 줄 수, 알고리즘 뼈대 값.
 *   제자리에 두는 숫자 상수는 tests/ledger.test.ts의 STRUCTURAL 목록에 이유와 함께 적는다.
 * - 항목마다 이름, 값, 단위, 상태(추정·실측·검증됨), 근거, 마지막으로 확인한 날짜와 세이브, 민감도를 적는다.
 *   상태가 추정이면 게임의 실제 결과로 맞춰 본 적이 없다는 뜻이다. 세이브는 파일 이름이 아니라 중립 이름("시험 세이브 A")으로 적는다.
 * - 민감도는 손으로 적지 않는다. tests/sensitivity.test.ts가 잰 결과를 아래 MEASURED 표에 옮겨 적으면 항목의 민감도가 거기서 정해진다
 *   (겹침이 SENSITIVE_BELOW 미만이면 민감, 이상이면 보통, 표에 없으면 미측정). 상수나 식을 바꾸면 검사를 다시 돌려 표를 고친다.
 * - 값은 `K.이름`으로 그때그때 읽는다. 모듈 바깥으로 복사해 두지 않는다(withLedger가 바꾸는 값을 따라가려면).
 * - 문서의 상수 목록(docs/scoring.md)은 이 대장에서 만든다(shared/ledgerDoc.ts, `npm run docs:ledger`).
 * - FM26 역할별 목록(역할 이름, 핵심 능력치와 앱이 더한 능력치의 목록)은 src/shared/data/fm26-roles.json에 있고, 그 기본 가중치 값
 *   (핵심 ROLE_KEY_WEIGHT, 앱 추가 ROLE_APP_WEIGHT)은 이 대장에 있다. 목록은 자료이고 값은 조정 상수라서 나눠 두었다.
 * - 2단계의 구조 상수(전술 자리 수, 전술 개수 한도, 비중 눈금, 가중치 최댓값, 이름 길이 한도 등)는 조정 상수가 아니라 src/shared/limits.ts에 있다.
 *
 * 이 모듈은 다른 모듈을 불러오지 않는다(맨 아래의 잎).
 */

export type LedgerStatus = '추정' | '실측' | '검증됨'
export type LedgerSensitivity = '민감' | '보통' | '미측정'

/** 상수를 바꿨을 때 탭별 상위 10명이 그대로인 비율(겹침)이 이 값 미만이면 민감 */
export const SENSITIVE_BELOW = 0.8

/** 민감도 검사(tests/sensitivity.test.ts)가 잰 결과 하나 */
export interface LedgerMeasure {
  /** 탭별 겹침 가운데 가장 낮은 값(소수 둘째 자리까지) */
  overlap: number
  /** 그 값이 나온 탭. 값을 바꿔도 어느 목록도 안 바뀐 상수(overlap 1)에는 없다 */
  tab?: string
  /** 그 값이 영입 후보 화면의 "이 자리를 뛸 수 있는 선수만"을 끈 조건(넓힘)에서 나왔다 */
  wide?: true
  /** 그 값을 만든 변화: "-20%", "+20%", "×0.5", "×2". 표의 항목 하나만 바꾼 경우 그 항목 이름이 앞에 붙는다 */
  direction?: string
}

export function sensitivityOf(measured: LedgerMeasure | undefined): LedgerSensitivity {
  return measured === undefined ? '미측정' : measured.overlap < SENSITIVE_BELOW ? '민감' : '보통'
}

export interface LedgerEntry<V = unknown> {
  name: string
  /** 기본값. 현재 값은 K에서 읽는다 */
  value: V
  unit: string
  status: LedgerStatus
  /** 근거(짧게) */
  basis: string
  lastChecked: { date: string; save: string }
  /** 민감: 상수를 ±20%(숙련 감점은 절반·두 배) 바꿨을 때 탭별 상위 10명 겹침이 0.8 미만이다. 미측정: 아래 MEASURED 표에 없다 */
  sensitivity: LedgerSensitivity
  /** 민감도 검사의 결과. 잰 적이 없으면 없다 */
  measured?: LedgerMeasure
}

const CHECKED = { date: '2026-11-28', save: '시험 세이브 A' }

function def<V>(
  value: V,
  unit: string,
  basis: string,
  more: { status?: LedgerStatus } = {}
): Omit<LedgerEntry<V>, 'name'> {
  return { value, unit, status: more.status ?? '추정', basis, lastChecked: CHECKED, sensitivity: '미측정' }
}

type NeedFactorWeights = { quality: number; depth: number; age: number; contract: number }
type NeedLevelMin = { urgent: number; recommended: number; normal: number; fine: number }
type TraitWeights = {
  consistency: number
  injuryProneness: number
  importantMatches: number
  naturalFitness: number
  determination: number
  dirtiness: number
}
type Category = 'all' | 'starter' | 'rotation' | 'prospect' | 'free'
type Component = 'immediate' | 'maturity' | 'age' | 'cost' | 'ease' | 'reliability'

const DEFS = {
  // ---------- 역할 기준 분포(norms.ts) ----------
  NORM_MIN_RATING: def(15, '숙련', '이 숙련 이상이어야 그 역할의 자리를 뛰는 선수로 본다. PLAYABLE_RATING과 같은 15(게임의 능숙 이상)'),
  NORM_CA_FLOOR: def(100, '현재 능력', '기준 능력의 하한. 내 팀이 약해도 상위권을 100 아래로 잡지 않는다'),
  NORM_CA_MARGIN: def(10, '현재 능력', '내 주전 11명 현재 능력의 중간값에서 이만큼 낮은 선수부터를 "데려올 수준의 상위권"으로 본다'),
  NORM_TOP_COUNT: def(11, '명', '중간값을 구하는 내 선수 수(한 경기 선발진)'),
  NORM_MIN_POPULATION: def(40, '명', '기준 분포의 모집단이 이보다 적으면 기준 능력을 한 걸음씩 낮춰 다시 센다'),
  NORM_CA_STEP: def(10, '현재 능력', '모집단이 모자랄 때 기준 능력을 낮추는 한 걸음'),
  NORM_CA_MIN: def(60, '현재 능력', '기준 능력을 이보다 낮추지 않는다'),
  NORM_MIN_SIGMA: def(2.5, '점', '표준편차 하한. 모집단이 너무 모여 있으면 작은 차이가 과장된다(역할별 실측은 2.8 이상)'),
  DEFAULT_BETA: def(0.28, '점/현재 능력', '기울기를 못 구할 때의 값. 시험 세이브 A에서 역할별 0.236~0.336의 가운데쯤'),
  BETA_MIN_CA: def(60, '현재 능력', '기울기를 구하는 데 쓰는 선수의 최소 현재 능력'),
  BETA_MIN_POPULATION: def(40, '명', '기울기를 구하는 데 필요한 최소 인원'),
  BETA_GROW_MIN_CA: def(110, '현재 능력', '성장 기울기를 재는 현재 능력 구간의 아래쪽(5회차). 어린 선수가 실제로 지나가는 구간'),
  BETA_GROW_MAX_CA: def(180, '현재 능력', '성장 기울기를 재는 현재 능력 구간의 위쪽(5회차)'),
  GAIN_WIDTH_SIGMAS: def(1.5, 'σ', '점수 차이를 충족도로 바꾸는 폭. 1.5σ 높으면 0.88에 이른다'),
  FALLBACK_MU: def(72, '점', '기준 분포를 못 구했을 때(옛 호출, 미리보기)의 상위권 적합도 평균. 전술 분석과 영입 추천이 같은 값을 쓴다(F-08)'),
  FALLBACK_SIGMA: def(4, '점', '기준 분포를 못 구했을 때의 표준편차. 역할별 실측 평균이 약 3.9'),

  // ---------- 포지션 숙련(positions.ts) ----------
  PLAYABLE_RATING: def(15, '숙련', '이 값 이상이면 그 자리에서 뛸 수 있는 것으로 본다(게임의 "능숙" 이상)'),
  TEMPORARY_MIN_RATING: def(10, '숙련', '이 값 이상 15 미만이면 임시 주전으로 세울 수 있다(4회차). 10 미만은 빈 자리로 둔다'),
  PENALTY_ACCOMPLISHED_PER_POINT: def(0.08, 'σ/숙련 1점', '숙련 15~19의 적합도 감점 계수(20에서 0, 15에서 0.40σ). 게임에서 숙련 차이를 대조한 적이 없다'),
  PENALTY_AWKWARD_BASE: def(0.4, 'σ', '숙련 15 미만 구간의 감점 시작값. 15에서 끊기지 않게 0.08×5로 정했다'),
  PENALTY_AWKWARD_PER_POINT: def(0.3, 'σ/숙련 1점', '숙련 10~14의 감점 계수(10에서 1.90σ)'),
  PENALTY_AWKWARD_FROM: def(10, '숙련', '감점 구간이 바뀌는 숙련(10 이상은 어색, 미만은 서투름)'),
  PENALTY_POOR_BASE: def(1.9, 'σ', '숙련 10 미만 구간의 감점 시작값. 10에서 끊기지 않게 0.4+0.30×5로 정했다'),
  PENALTY_POOR_PER_POINT: def(0.5, 'σ/숙련 1점', '숙련 10 미만의 감점 계수(1에서 6.40σ)'),
  LOW_GATE_BELOW: def(10, '숙련', '숙련이 이 값 미만이면 총점에 곱셈 보정을 건다'),
  LOW_GATE_BASE: def(0.1, '배', '숙련 1에서의 곱셈 보정. 뛸 수 없는 자리의 선수가 다른 항목 점수로 위에 오르는 것을 막는 안전장치'),
  LOW_GATE_STEP: def(0.1, '배/숙련 1점', '숙련이 1 오를 때마다 곱셈 보정에 더하는 값(9에서 0.90)'),

  // ---------- 역할 적합도(roles.ts) ----------
  ROLE_COVERAGE_MIN: def(0.6, '비율', '가중치가 걸린 능력치 가운데 값이 있는 것의 가중치 합이 전체의 이 비율 미만이면 적합도를 계산하지 않는다. 표 경로와 세이브 경로가 같이 쓴다(F-08)'),

  // ---------- 점유 시·비점유 시 역할(slotProfile.ts, roleCatalog.ts), 전술 추천, 별점 대조 ----------
  IP_SHARE_DEFAULT: def(0.6, '비율', '전술의 공 소유 시 비중 기본값(공 소유 시 60 : 공 미소유 시 40). 요구서 F-02의 기본값을 따랐고 게임의 실제 결과와 맞춰 본 근거가 없다. 전술에 비중을 직접 적으면 그 값을 쓴다'),
  ROLE_KEY_WEIGHT: def(4, '가중치', 'FM26 역할 목록(src/shared/data/fm26-roles.json)에서 핵심 능력치로 적힌 항목의 기본 가중치. 게임 역할 화면의 핵심 표시를 따른 값이다(F-04)'),
  ROLE_APP_WEIGHT: def(2, '가중치', 'FM26 역할에 앱이 더한 능력치(1회차 현재 능력 회귀 근거)의 기본 가중치. 게임 역할 화면에는 없는 추가분이다(F-04)'),
  ROLE_SWAP_MIN_GAIN: def(0.1, 'z 합', '전술 추천이 자리별 역할 바꾸기를 제안하는 문턱: 그 자리 짝만 바꿔 다시 배정했을 때 주전 전력 합이 이만큼 이상 늘어야 한다(A-20)'),
  ROLE_STAR_RANK_MIN: def(0.7, '순위 상관', '게임 별점과의 대조에서 순위 상관이 이 값 미만인 역할을 "가중치 점검 대상"으로 알린다. 점수에는 넣지 않는다(F-05)'),
  ROLE_STAR_MIN_PLAYERS: def(5, '명', '별점 대조에서 역할마다 이만큼 이상의 선수가 있어야 순위 상관을 낸다. 모자라면 "표본 부족"으로 둔다(F-05)'),

  // ---------- 주전 배정(depth.ts) ----------
  WEAK_GAP: def(5, '점', '약한 자리 기준(기준 분포가 없을 때): 주전 점수가 주전들 평균보다 이만큼 낮을 때'),
  WEAK_GAP_SIGMAS: def(1.2, 'σ', '약한 자리 기준(기준 분포가 있을 때): 주전의 z가 주전들 z 평균보다 이만큼 낮을 때'),
  TEMPORARY_BONUS: def(700, '가중치', '숙련 10~14 선수를 임시 주전으로 세울 때의 배정 가중치. 숙련 15 이상(1000)보다 낮고 빈 자리(0)보다 높다(4회차)'),

  // ---------- 보강 필요도(tactic.ts) ----------
  NEED_FACTOR_WEIGHTS: def<NeedFactorWeights>({ quality: 45, depth: 25, age: 15, contract: 15 }, '점(합 100)', '주전 전력이 보강의 가장 큰 이유라 45, 후보 두께 25, 곧 사라질 주전을 위한 나이·계약 15씩'),
  QUALITY_Z_GOOD: def(1, 'σ', '주전 전력 위험이 0이 되는 z(z_eff +1 이상이면 위험 없음)'),
  QUALITY_Z_SPAN: def(3, 'σ', '주전 전력 위험 = clamp01((1 - z_eff) / 3). z_eff -2 이하면 1'),
  DEPTH_COUNT_RISK: def<number[]>([1, 0.5, 0], '위험(0~1)', '후보가 없으면 1, 한 명이면 0.5, 두 명 이상이면 0'),
  DEPTH_GAP_FREE_SIGMAS: def(1.2, 'σ', '첫 후보가 주전보다 이만큼 낮은 것까지는 무료. σ 4점인 역할에서 예전의 5점 고정값과 같다'),
  DEPTH_GAP_SPAN_SIGMAS: def(3.6, 'σ', '무료 구간에서 이만큼 더 벌어지면 후보 격차 위험이 최대'),
  DEPTH_GAP_MAX: def(0.8, '위험(0~1)', '후보 격차 위험의 최대값'),
  AGE_RISK_BASE: def(0.4, '위험(0~1)', '주전 나이 위험: 시작 나이에서 0.4'),
  AGE_RISK_STEP: def(0.15, '위험/년', '시작 나이 이후 한 해마다 올라 시작+4세에서 1'),
  CONTRACT_RISK_BASE: def(0.3, '위험(0~1)', '주전 계약 위험: 365일 이내가 되면 0.3에서 시작해 만료 직전 1'),
  NEED_UNKNOWN_RISK: def(0.15, '위험(0~1)', '나이나 계약을 알 수 없을 때 위험으로 두는 값. 알려진 주전들의 평균 위험이 0.15쯤'),
  SUCCESSOR_MAX_AGE: def(23, '세', '후계자로 보는 내 선수의 최대 나이'),
  SUCCESSOR_MAX_GAP_SIGMAS: def(2.5, 'σ', '후계자의 적합도가 주전보다 이만큼 넘게 낮지 않아야 한다'),
  SUCCESSOR_RELIEF: def(0.5, '배', '후계자가 있으면 주전의 나이·계약 위험에 곱한다'),
  REASON_MIN_POINTS: def(5, '점', '이유 문장에 올리려면 그 항목이 필요도에 이만큼 이상 더해야 한다(표시용)'),
  NEED_LEVEL_MIN: def<NeedLevelMin>({ urgent: 55, recommended: 30, normal: 12, fine: 0 }, '점', '필요도 등급 경계: 이상이면 그 등급(시급, 보강 권장, 보통, 충분)'),

  // ---------- 계약 기간(F-08: "12개월"은 365일) ----------
  CONTRACT_SOON_DAYS: def(365, '일', '"12개월 안"의 정의. 대시보드 계약 카드, 스쿼드 진단 카드, 보강 필요도의 주전 계약 위험이 모두 이 값을 쓴다(F-08)'),
  CONTRACT_FAR_DAYS: def(730, '일', '계약 만료 두 번째 창(1년 넘게 2년 안)의 끝'),

  // ---------- 성장·나이·경계(world.ts) ----------
  PROSPECT_MAX_AGE: def(23, '세', '유망주 자격의 나이 한도(1회차 21세, 2회차 23세로 올려 22~23세 고잠재 선수가 어느 탭에도 못 드는 것을 막았다)'),
  PROSPECT_MIN_ROOM: def(10, '능력', '유망주 자격의 최소 성장 여지(잠재 능력 - 현재 능력)'),
  PROSPECT_MIN_GAIN_SIGMA: def(0.5, 'σ', '성숙 시 적합도 이득이 이 값 × σ 이상이어야 클 여지가 있다고 본다. "한 시즌 주전 경쟁에 보탬이 될 크기"라는 어림(3회차)'),
  REPRESENTATIVE_BETA: def(0.265, '점/현재 능력', '역할을 정할 수 없을 때 쓰는 대표 기울기. 시험 세이브 A에서 역할별 0.24~0.34의 가운데쯤(3회차)', { status: '실측' }),
  REPRESENTATIVE_SIGMA: def(3.2, '점', '역할을 정할 수 없을 때 쓰는 대표 표준편차. 시험 세이브 A에서 역할별 2.8~5.9의 가운데쯤(3회차)', { status: '실측' }),
  GROWTH_SHARE_TABLE: def<Array<[number, number]>>(
    [[17, 0.78], [18, 0.7], [20, 0.57], [22, 0.38], [24, 0.15], [26, 0]],
    '[나이, 몫]',
    '필드 선수의 성장 몫(성숙까지 채워질 비율). 단면 실측이라 세대 차이와 은퇴 편향이 섞여 있다. 두 날짜 세이브로 다시 재야 한다. ±20%에 유망주 탭 상위 10명의 절반이 바뀐다'
  ),
  GROWTH_SHARE_TABLE_GOALKEEPER: def<Array<[number, number]>>(
    [[17, 0.73], [18, 0.72], [20, 0.58], [22, 0.46], [24, 0.28], [26, 0]],
    '[나이, 몫]',
    '골키퍼의 성장 몫(5회차). 같은 단면 자료에서 골키퍼가 필드 선수보다 늦게 큰다. 단면 실측이라 두 날짜 세이브로 다시 재야 한다'
  ),
  AGING_START_AGE: def(31, '세', '이 나이를 넘으면 한 해마다 적합도가 내려갈 것으로 본다(필드 선수)'),
  AGING_START_AGE_GOALKEEPER: def(34, '세', '골키퍼의 하락 시작 나이. 골키퍼는 늦게 내려간다'),
  AGING_DROP_PER_YEAR: def(1.0, '점/년', '하락 속도. 단면 자료(세이브 하나)로 구할 수 없어 한 해 1점으로 어림했다'),
  STARTER_TOLERANCE_SIGMAS: def(0.25, 'σ', '주전보다 이만큼 낮아도 "주전 수준"으로 본다(반올림·표본 오차 여유). 로테이션 탭의 위쪽 경계라 0이나 0.5로 바꾸면 상위 10명이 많이 바뀐다(4회차)'),
  ROTATION_REACH_SIGMAS: def(1.5, 'σ', '로테이션: 주전보다 이만큼보다 많이 낮은 선수는 번갈아 쓸 수준이 아니다'),
  THIN_REACH_SIGMAS: def(1.0, 'σ', '후보가 2명 미만인 그룹은 로테이션 창을 아래로 이만큼까지 열어 둔다(5회차)'),
  CA_GATE: def(0.85, '비율', '주전·로테이션 후보의 현재 능력은 내 주전의 이 비율 이상이어야 한다. 로테이션 탭의 경계라 0.95로 바꾸면 상위 10명이 많이 바뀐다(4회차)'),

  // ---------- 추천 점수(recommend.ts) ----------
  RECOMMEND_WEIGHTS: def<Record<Category, Record<Component, number>>>(
    {
      all: { immediate: 40, maturity: 12, age: 10, cost: 14, ease: 12, reliability: 12 },
      starter: { immediate: 50, maturity: 4, age: 10, cost: 14, ease: 10, reliability: 12 },
      rotation: { immediate: 36, maturity: 6, age: 8, cost: 20, ease: 16, reliability: 14 },
      prospect: { immediate: 12, maturity: 40, age: 10, cost: 14, ease: 12, reliability: 12 },
      free: { immediate: 44, maturity: 10, age: 12, cost: 10, ease: 8, reliability: 16 }
    },
    '점(유형마다 합 100)',
    '유형별 항목 가중치 표. 무엇을 찾느냐에 따라 중요한 것이 다르다는 판단으로 직접 정했다. 자유 계약 탭은 4회차에 비용·난이도를 0에서 올렸다'
  ),
  TIER_CUMULATIVE_SHARE: def<number[]>([0.05, 0.2, 0.5], '누적 비율', '등급 경계: 상위 5% 강력 추천, 20%까지 추천, 50%까지 고려, 나머지 보류. 이 앱이 정한 어림'),
  TIER_MIN_TOTAL: def(60, '점', '점수가 이보다 낮으면 순위가 높아도 보류(절대 하한). 2회차에 총점 눈금이 10점 올라 50에서 60으로 올렸다'),
  NEED_WEIGHT_LOW: def(0.8, '배', '필요도 0일 때 즉시 전력 비중에 곱하는 값(1회차에 0.6~1.4배가 지나치다고 보아 줄였다)'),
  NEED_WEIGHT_HIGH: def(1.2, '배', '필요도 100일 때 즉시 전력 비중에 곱하는 값'),
  NEED_DEFAULT: def(50, '점', '자리를 고르지 않았을 때 보는 필요도'),
  STARTER_SHARE: def<Record<Category, number>>(
    { all: 0.7, starter: 0.85, rotation: 0.3, prospect: 0.7, free: 0.7 },
    '비율',
    '즉시 전력에서 주전과 견주는 몫(나머지는 두 번째 선수). 로테이션은 두 번째 선수를 넘는지가 핵심이라 주전 몫을 줄였다'
  ),
  PEAK_OUTFIELD: def<[number, number]>([24, 29], '세', '필드 선수의 전성기(이 범위에서 나이 가치 1)'),
  PEAK_GOALKEEPER: def<[number, number]>([27, 33], '세', '골키퍼의 전성기. 골키퍼는 늦게 피고 오래 간다'),
  AGE_YOUNG_FLOOR: def(0.7, '충족도', '18세 이하의 나이 가치. 되팔 가치는 높지만 당장의 힘은 약하다'),
  AGE_YOUNG_FROM: def(18, '세', '이 나이 이하는 AGE_YOUNG_FLOOR이고, 전성기 시작 나이까지 1로 오른다'),
  AGE_DECLINE_PER_YEAR: def(0.12, '충족도/년', '전성기가 지난 뒤 한 해마다 깎는 충족도'),
  AGE_PROSPECT_FROM: def(17, '세', '유망주 탭의 나이 가치가 1인 나이(17세 이하 1)'),
  AGE_PROSPECT_SPAN: def(9, '년', '유망주 탭의 나이 가치가 0이 되기까지의 햇수(26세 이상 0)'),
  MIN_SQUAD_SAMPLE: def(8, '명', '내 팀 주급·몸값 수준을 알려면 필요한 최소 선수 수(너무 적으면 중간값을 믿을 수 없다)'),
  WAGE_SHARE: def(0.6, '비율', '비용 부담에서 주급 충족도의 비중. 주급은 계약 기간 내내 나가는 돈이고 몸값은 한 번이다'),
  COST_LOW_RATIO: def(0.5, '배', '충족도 곡선: 내 팀 중간값의 이 배수 이하면 1'),
  COST_AT_MEDIAN: def(0.8, '충족도', '충족도 곡선: 내 팀 중간값에서의 값'),
  COST_AT_TOP: def(0.2, '충족도', '충족도 곡선: 내 팀 최고에서의 값. 팀에서 제일 많이 받는 선수가 되는 영입은 라커룸과 재정에 부담이라 크게 깎는다'),
  COST_OVER_TOP_RATIO: def(1.3, '배', '충족도 곡선: 내 팀 최고의 이 배수 이상이면 0. 영입 현실성의 주급 조건(최고 주급의 1.3배)도 같은 값을 쓴다'),
  COST_MIN_TOP_RATIO: def(1.2, '배', '최고가 중간값의 이 배수보다 작으면(팀이 거의 평평하면) 곡선이 무너지지 않게 이 배수로 본다'),
  FEE_FULL_DAYS: def(730, '일', '계약이 짧게 남은 선수는 이적료가 내려간다. 남은 일수 / 730만큼 몸값에 곱한다(방향만 반영한 어림)'),
  FEE_FLOOR: def(0.2, '비율', '계약이 짧아도 몸값을 이 비율 밑으로는 내리지 않는다'),
  UNKNOWN_FIT: def(0.5, '충족도', '값을 모를 때의 충족도. 좋지도 나쁘지도 않다고 본다(값이 없는 선수가 유리해지지 않게)'),
  CONTRACT_EASE: def<Array<[number, number]>>(
    [[0, 1], [183, 0.9], [365, 0.75], [730, 0.5], [1460, 0.25]],
    '[남은 일수, 쉬움]',
    '남은 계약 일수 → 쉬움. 자유 계약 1, 6개월 0.9, 1년 0.75, 2년 0.5, 4년 이상 0.25. 직접 정한 어림'
  ),
  EASE_CONTRACT_SHARE: def(0.4, '비율', '영입 난이도(소속 있음)에서 계약 기간의 몫. 계약과 입지를 같은 비중으로 둔 것은 1회차부터 이어 온 어림'),
  EASE_STATUS_SHARE: def(0.4, '비율', '영입 난이도(소속 있음)에서 계약상 입지의 몫'),
  EASE_STATURE_SHARE: def(0.2, '비율', '영입 난이도에서 체급의 몫. 이적 의사·평판을 못 읽는 동안의 임시 대용(2회차)'),
  STATURE_SPAN_CA: def(25, '현재 능력', '체급 = 1 - clamp01((CA - 내 약한 주전 CA) / 25). 현재 능력이 훨씬 높은 선수는 우리 구단으로 오려 하지 않을 것이라는 어림. 영입 현실성의 체급 조건도 같은 값을 쓴다'),
  STATUS_EASE: def<Record<number, number>>(
    { 1: 0.1, 2: 0.3, 3: 0.5, 4: 0.7, 5: 0.75, 7: 0.95, 9: 0.9, 10: 0.4, 11: 0.4, 13: 0.5, 14: 0.6, 15: 0.5, 16: 0.7, 17: 0.7, 18: 0.7, 20: 0.8, 21: 0.9 },
    '{입지 코드: 쉬움}',
    '계약상 입지 → 쉬움. 핵심 선수는 구단이 놓아주지 않으려 하고(0.1), 비주전·비상 백업은 내놓기 쉽다(0.9 이상). 직접 정한 어림'
  ),
  TRAIT_WEIGHTS: def<TraitWeights>(
    { consistency: 3, injuryProneness: 3, importantMatches: 2, naturalFitness: 1.5, determination: 1.5, dirtiness: 1 },
    '상대 비중',
    '신뢰성 항목의 숨은 능력치 비중. 일관성·부상 빈도는 사 오고 나서 뛰는 경기 수와 기복을 가장 직접 좌우한다고 보았다'
  ),
  STATURE_TOP_COUNT: def(11, '명', '구단 체급 = 그 팀 남자 선수 현재 능력 상위 11명의 중간값(5회차)'),
  STATURE_MIN_PLAYERS: def(5, '명', '구단 체급을 구하려면 필요한 최소 선수 수. 미만이면 모른다'),
  STATURE_CLUB_MARGIN: def(3, '현재 능력', '파는 구단의 체급이 내 체급보다 이만큼 낮은 데까지는 "비슷하다"고 본다. 게임에서 협상 시작 비율로 맞춘다(5회차 4.2절)'),
  WARN_CA_MARGIN: def(10, '현재 능력', '현재 능력이 내 주전보다 이만큼 이상 높으면 큰 구단의 핵심일 수 있다고 알린다(경고만)'),
  WARN_LONG_CONTRACT_DAYS: def(1460, '일', '계약이 이 일수(4년) 이상 남았으면 이적료가 비쌀 수 있다고 알린다(경고만)'),

  // ---------- 대시보드(dashboard.ts) ----------
  OVERPAID_Z: def(1, 'σ', '주급 과다 의심: 기대 주급보다 잔차 표준편차의 이만큼 이상 높은 선수. 리그에서 약 10~11%'),
  OVERPAID_Z_STRONG: def(1.5, 'σ', '강한 주급 과다 의심 기준(OVERPAID_Z보다 엄격). 추정'),
  WAGE_MODEL_MIN_SAMPLE: def(30, '명', '주급 회귀를 믿으려면 필요한 최소 표본'),
  WAGE_YOUNG_BELOW: def(21, '세', '주급 모델의 나이 더미: 이 나이 미만은 같은 능력이라도 덜 받는다'),
  WAGE_OLD_FROM: def(30, '세', '주급 모델의 나이 더미: 이 나이 이상은 경험이 많으면 더 받는다'),
  WAGE_SD_FLOOR: def(0.05, 'ln 주급', '잔차 표준편차가 0에 가까운 자료에서 z가 폭주하지 않게 하는 하한'),
  WAGE_OUTLIER_Z: def(3, 'σ', '첫 적합에서 잔차가 이 배수를 넘는 선수는 빼고 한 번만 다시 맞춘다(극단값이 s를 부풀린다. 4회차)'),
  SURPLUS_WEIGHTS: def<{ fit: number; wage: number; age: number }>({ fit: 50, wage: 25, age: 25 }, '점(합 100)', '잉여 점수의 항목 가중치: 적합도 50, 주급 25, 나이·정체 25'),
  FIT_GAP_SIGMAS: def(3, 'σ', '첫 후보보다 이만큼 낮으면 적합도 위험이 최대'),
  NO_SLOT_PREMIUM: def(0.5, 'σ', '전술에 뛸 자리가 없는 선수의 적합도 차이에 더하는 가산. 자리가 없다는 사실 자체의 무게'),
  WAGE_Z_FULL: def(2, 'σ', '주급이 기대보다 이만큼 높으면 주급 위험이 최대(기대 이하는 0)'),
  SURPLUS_UNKNOWN_RISK: def(0.5, '위험(0~1)', '주급이나 나이를 몰라 위험을 정할 수 없을 때 쓰는 보통 값(tactic.ts·recommend.ts와 같은 방침)'),
  AGE_RISK_FROM: def(24, '세', '정리 후보의 나이 위험: 이 나이 이하 0'),
  AGE_RISK_FULL: def(32, '세', '정리 후보의 나이 위험: 이 나이 이상 1'),
  STAGNATION_ROOM_FULL: def(20, '능력', '잠재가 현재보다 이만큼 높으면 정체 위험 0, 같으면 1'),
  AGE_SHARE: def(0.6, '비율', '나이·정체 항목에서 나이 위험의 몫(정체는 나머지 0.4)'),
  STAGNATION_AGE_FROM: def(26, '세', '정체 위험을 나이와 함께 보는 구간의 시작(26세는 PA - CA 그대로)'),
  STAGNATION_AGE_FULL: def(28, '세', '정체 위험을 나이와 함께 보는 구간의 끝(28세 이상은 정체 위험 1. 4회차)'),
  SURPLUS_MIN_SHOWN: def(30, '점', '이 점수 미만이면 정리 후보로 보여 주지 않는다. 20점 이하는 정리를 생각해 볼 이유가 약하다는 어림(4회차)'),
  GOALKEEPERS_KEPT: def(3, '명', '골키퍼는 이만큼은 두어야 하므로 정리 후보로 보지 않는다'),
  FORM_MIN_GAMES: def(3, '경기', '최근 경기 어조(좋음·위험)를 매기려면 점수를 읽은 경기가 이만큼은 있어야 한다(4회차)'),

  // ---------- 스쿼드 진단·건강·직접 답변 ----------
  ROOM_CARD_MAX_AGE: def(23, '세', '스쿼드 진단의 "성장 여지" 카드가 보는 나이(23세 이하). 영입 후보의 유망주 자격(PROSPECT_MAX_AGE)과 따로 둔 더 느슨한 요약'),
  DEPTH_CARD_MIN_NEED: def(30, '점', '보강 필요도가 이 값 이상인 자리를 진단 카드에 올린다(전술 분석의 "보강 권장" 이상)'),
  LOW_CONDITION: def(85, '%', '컨디션이 이 값보다 낮으면 "낮은 선수"로 모아 보여 준다'),
  LOW_SHARPNESS: def(80, '%', '경기 감각이 이 값보다 낮으면 "낮은 선수"로 모아 보여 준다'),
  MIN_APPEARANCES_FOR_FORM: def(3, '경기', '평점 비교에 넣으려면 이번 시즌 이만큼은 뛰었어야 한다'),
  LOW_CONFIDENCE: def(0.4, '확신도', '직접 답변의 확신도가 이 값보다 낮으면 "딱 맞는 선택지가 없었다"고 알린다')
}

type Defs = typeof DEFS
export type LedgerName = keyof Defs
export type LedgerValues = { [N in LedgerName]: Defs[N]['value'] }

/**
 * 민감도 검사의 결과(F-11). 2026-11-28, 시험 세이브 A, 포메이션 4-2-3-1, 역할 가중치는 기본값.
 * 영입 후보 화면의 "이 자리를 뛸 수 있는 선수만"을 켠 조건(기본)과 끈 조건(넓힘)을 모두 재서 가장 낮은 겹침을 적는다.
 * 검사(`tests/sensitivity.test.ts`, 환경 변수는 그 파일의 머리 설명)를 끝까지 돌리면 출력 끝에 이 표에 붙일 줄이 나온다.
 * overlap만 있는 줄은 값을 바꿔도 이 세이브의 어느 목록도 바뀌지 않았다는 뜻이다(그 상수가 걸리는 곳을 이 세이브가 지나지 않았을 수도 있다).
 * 표에 없는 상수는 검사로 잴 수 없었던 것이다(미측정): 후보 찾기가 읽지 않거나(대시보드, 스쿼드 진단, 직접 답변 전용이거나 이 세이브가 지나지 않는 경로), 점수에 영향이 없는 표시용이다.
 */
const MEASURED: Partial<Record<LedgerName, LedgerMeasure>> = {
  NORM_MIN_RATING: { overlap: 0.88, tab: '로테이션', direction: '+20%' },
  NORM_CA_FLOOR: { overlap: 1 },
  NORM_CA_MARGIN: { overlap: 0.85, tab: '로테이션', direction: '+20%' },
  NORM_TOP_COUNT: { overlap: 0.89, tab: '로테이션', direction: '+20%' },
  NORM_MIN_POPULATION: { overlap: 0.94, tab: '로테이션', direction: '-20%' },
  NORM_CA_STEP: { overlap: 0.95, tab: '로테이션', direction: '-20%' },
  NORM_CA_MIN: { overlap: 1 },
  NORM_MIN_SIGMA: { overlap: 1 },
  BETA_MIN_CA: { overlap: 1 },
  BETA_MIN_POPULATION: { overlap: 1 },
  BETA_GROW_MIN_CA: { overlap: 0.92, tab: '유망주', direction: '+20%' },
  BETA_GROW_MAX_CA: { overlap: 0.96, tab: '유망주', direction: '-20%' },
  GAIN_WIDTH_SIGMAS: { overlap: 0.93, tab: '로테이션', direction: '-20%' },
  PLAYABLE_RATING: { overlap: 0.62, tab: '로테이션', direction: '+20%' },
  TEMPORARY_MIN_RATING: { overlap: 1 },
  PENALTY_ACCOMPLISHED_PER_POINT: { overlap: 0.52, tab: '로테이션', direction: '×2' },
  PENALTY_AWKWARD_BASE: { overlap: 0.96, tab: '로테이션', wide: true, direction: '×0.5' },
  PENALTY_AWKWARD_PER_POINT: { overlap: 0.92, tab: '로테이션', wide: true, direction: '×0.5' },
  PENALTY_AWKWARD_FROM: { overlap: 1 },
  PENALTY_POOR_BASE: { overlap: 1 },
  PENALTY_POOR_PER_POINT: { overlap: 1 },
  LOW_GATE_BELOW: { overlap: 1 },
  ROLE_COVERAGE_MIN: { overlap: 1 },
  WEAK_GAP_SIGMAS: { overlap: 1 },
  TEMPORARY_BONUS: { overlap: 1 },
  NEED_FACTOR_WEIGHTS: { overlap: 0.98, tab: '즉시 전력', direction: 'quality -20%' },
  QUALITY_Z_GOOD: { overlap: 0.98, tab: '즉시 전력', direction: '-20%' },
  QUALITY_Z_SPAN: { overlap: 0.98, tab: '즉시 전력', direction: '+20%' },
  DEPTH_COUNT_RISK: { overlap: 0.99, tab: '즉시 전력', direction: '-20%' },
  DEPTH_GAP_FREE_SIGMAS: { overlap: 1 },
  DEPTH_GAP_SPAN_SIGMAS: { overlap: 1 },
  DEPTH_GAP_MAX: { overlap: 1 },
  AGE_RISK_BASE: { overlap: 1 },
  AGE_RISK_STEP: { overlap: 1 },
  CONTRACT_RISK_BASE: { overlap: 1 },
  NEED_UNKNOWN_RISK: { overlap: 1 },
  SUCCESSOR_MAX_AGE: { overlap: 0.99, tab: '즉시 전력', direction: '-20%' },
  SUCCESSOR_MAX_GAP_SIGMAS: { overlap: 1 },
  SUCCESSOR_RELIEF: { overlap: 0.99, tab: '즉시 전력', direction: '-20%' },
  NEED_LEVEL_MIN: { overlap: 1 },
  CONTRACT_SOON_DAYS: { overlap: 1 },
  PROSPECT_MAX_AGE: { overlap: 0.39, tab: '유망주', direction: '-20%' },
  PROSPECT_MIN_ROOM: { overlap: 1 },
  PROSPECT_MIN_GAIN_SIGMA: { overlap: 0.9, tab: '유망주', direction: '+20%' },
  GROWTH_SHARE_TABLE: { overlap: 0.54, tab: '유망주', direction: '-20%' },
  GROWTH_SHARE_TABLE_GOALKEEPER: { overlap: 1 },
  AGING_START_AGE: { overlap: 0.5, tab: '로테이션', direction: '-20%' },
  AGING_START_AGE_GOALKEEPER: { overlap: 0.89, tab: '로테이션', direction: '-20%' },
  AGING_DROP_PER_YEAR: { overlap: 0.99, tab: '즉시 전력', direction: '-20%' },
  STARTER_TOLERANCE_SIGMAS: { overlap: 0.82, tab: '로테이션', wide: true, direction: '-20%' },
  ROTATION_REACH_SIGMAS: { overlap: 0.95, tab: '로테이션', direction: '-20%' },
  THIN_REACH_SIGMAS: { overlap: 1 },
  CA_GATE: { overlap: 0.07, tab: '로테이션', direction: '+20%' },
  RECOMMEND_WEIGHTS: { overlap: 0.93, tab: '즉시 전력', direction: 'immediate -20%' },
  TIER_CUMULATIVE_SHARE: { overlap: 1 },
  TIER_MIN_TOTAL: { overlap: 1 },
  NEED_WEIGHT_LOW: { overlap: 0.93, tab: '즉시 전력', direction: '-20%' },
  NEED_WEIGHT_HIGH: { overlap: 0.97, tab: '전체', direction: '-20%' },
  STARTER_SHARE: { overlap: 0.97, tab: '전체', direction: '-20%' },
  PEAK_OUTFIELD: { overlap: 0.77, tab: '로테이션', wide: true, direction: '-20%' },
  PEAK_GOALKEEPER: { overlap: 1 },
  AGE_YOUNG_FLOOR: { overlap: 0.94, tab: '로테이션', wide: true, direction: '-20%' },
  AGE_YOUNG_FROM: { overlap: 0.92, tab: '로테이션', direction: '+20%' },
  AGE_DECLINE_PER_YEAR: { overlap: 0.97, tab: '전체', direction: '+20%' },
  AGE_PROSPECT_FROM: { overlap: 0.93, tab: '유망주', wide: true, direction: '+20%' },
  AGE_PROSPECT_SPAN: { overlap: 0.96, tab: '유망주', wide: true, direction: '+20%' },
  MIN_SQUAD_SAMPLE: { overlap: 1 },
  WAGE_SHARE: { overlap: 0.92, tab: '전체', direction: '-20%' },
  COST_LOW_RATIO: { overlap: 0.96, tab: '로테이션', direction: '-20%' },
  COST_AT_MEDIAN: { overlap: 0.89, tab: '로테이션', wide: true, direction: '-20%' },
  COST_AT_TOP: { overlap: 0.98, tab: '즉시 전력', direction: '-20%' },
  COST_OVER_TOP_RATIO: { overlap: 0.99, tab: '유망주', direction: '-20%' },
  COST_MIN_TOP_RATIO: { overlap: 1 },
  FEE_FULL_DAYS: { overlap: 0.99, tab: '로테이션', direction: '-20%' },
  FEE_FLOOR: { overlap: 1 },
  UNKNOWN_FIT: { overlap: 0.99, tab: '즉시 전력', direction: '-20%' },
  CONTRACT_EASE: { overlap: 0.98, tab: '로테이션', direction: '+20%' },
  EASE_CONTRACT_SHARE: { overlap: 0.98, tab: '로테이션', direction: '+20%' },
  EASE_STATUS_SHARE: { overlap: 0.96, tab: '로테이션', direction: '-20%' },
  EASE_STATURE_SHARE: { overlap: 0.98, tab: '전체', direction: '-20%' },
  STATURE_SPAN_CA: { overlap: 0.98, tab: '즉시 전력', direction: '-20%' },
  STATUS_EASE: { overlap: 0.96, tab: '로테이션', direction: '-20%' },
  TRAIT_WEIGHTS: { overlap: 0.98, tab: '즉시 전력', direction: 'injuryProneness -20%' },
  STATURE_TOP_COUNT: { overlap: 1 },
  STATURE_MIN_PLAYERS: { overlap: 1 },
  STATURE_CLUB_MARGIN: { overlap: 1 },
  WARN_CA_MARGIN: { overlap: 1 },
  WARN_LONG_CONTRACT_DAYS: { overlap: 1 },
  WAGE_MODEL_MIN_SAMPLE: { overlap: 1 },
  WAGE_YOUNG_BELOW: { overlap: 1 },
  WAGE_OLD_FROM: { overlap: 1 },
  WAGE_SD_FLOOR: { overlap: 1 },
  WAGE_OUTLIER_Z: { overlap: 1 },
}

/** 대장 전체(기본값). 순서는 위의 정의 순서다. 표(MEASURED)에 있는 상수는 그 결과와, 거기서 정해진 민감도를 갖는다 */
export const LEDGER: ReadonlyArray<LedgerEntry & { name: LedgerName }> = (Object.keys(DEFS) as LedgerName[]).map((name) => {
  const measured = MEASURED[name]
  return measured ? { name, ...DEFS[name], measured, sensitivity: sensitivityOf(measured) } : { name, ...DEFS[name] }
})

/**
 * 지금 값. 모듈은 `K.이름`으로 읽는다(복사해 두지 않는다). withLedger가 잠깐 바꾸고 되돌린다.
 * 값 읽기는 일반 속성 읽기라 후보 찾기 같은 안쪽 반복에서도 느려지지 않는다.
 */
export const K: Readonly<LedgerValues> = Object.fromEntries(LEDGER.map((entry) => [entry.name, structuredClone(entry.value)])) as LedgerValues

/**
 * 대장의 값 몇 개를 잠깐 바꿔 `run`을 돌리고, 끝나면(예외나 비동기 끝도) 원래 값으로 되돌린다.
 * 상수 하나를 ±20%로 바꿔 보는 민감도 검사(F-11)가 파일을 고치지 않고 쓰는 길이다.
 * 바뀐 값을 읽어 만든 캐시(예: WorldService의 역할 기준 분포)는 이 함수가 비우지 않으므로, 그런 값을 보려면 새로 만들어 쓴다.
 */
export function withLedger<R>(overrides: Partial<LedgerValues>, run: () => R): R {
  const names = Object.keys(overrides) as LedgerName[]
  const saved = names.map((name) => [name, K[name]] as const)
  const put = (name: LedgerName, value: unknown): void => {
    ;(K as Record<string, unknown>)[name] = value
  }
  for (const name of names) put(name, overrides[name])
  const restore = (): void => {
    for (const [name, value] of saved) put(name, value)
  }
  let result: R
  try {
    result = run()
  } catch (error) {
    restore()
    throw error
  }
  if (result instanceof Promise) {
    return result.finally(restore) as R
  }
  restore()
  return result
}
