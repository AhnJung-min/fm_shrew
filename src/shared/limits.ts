/**
 * 2단계(FM26 역할 체계)의 구조 상수. 점수 식을 조정하는 값이 아니라 자료의 모양과 한도라서 대장(ledger.ts)이 아니라 여기에 둔다.
 * 값을 바꾸면 저장된 설정과 화면의 선택지가 함께 바뀐다. 각 상수가 왜 구조인지는 tests/ledger.test.ts의 STRUCTURAL 목록에 적혀 있다.
 *
 * 규칙: 2단계에서 쓰는 src/shared의 새 숫자 상수는 맨 윗줄에 흩어 두지 않고 여기에 모은다(조정 상수는 대장).
 * 본체(src/main)의 캐시 크기·다시 해 보기 횟수 같은 입출력 값은 점수와 상관없으므로 그 파일 맨 윗줄에 이름을 붙여 둔다(숫자를 줄 안에 그냥 쓰지 않는다).
 * 이 모듈은 다른 모듈을 불러오지 않는다(맨 아래의 잎).
 */

/** 설정 파일 형식의 판(settingsVersion). 판 1은 2단계 앞(옛 14역할)의 설정이고, 판 2부터 FM26 역할 체계의 설정이다 */
export const SETTINGS_VERSION = 2
/** 전술의 자리 수(선수 11명) */
export const TACTIC_SLOTS = 11
/** 세이브마다 둘 수 있는 전술 수 */
export const TACTICS_PER_SAVE = 3
/** 점유 시 비중의 눈금: 비중은 0~이 값의 정수이고, 60이면 "공 소유 시 60 : 공 미소유 시 40"이다 */
export const SHARE_SCALE = 100
/** 역할 가중치의 최댓값(0~이 값의 정수) */
export const ROLE_WEIGHT_MAX = 5
/** 전술 추천 탐색이 되풀이하는 최대 횟수 */
export const SEARCH_MAX_ROUNDS = 10
/** 전술 이름의 최대 글자 수 */
export const TACTIC_NAME_MAX = 40
/** 사용자 역할 이름의 최대 글자 수 */
export const ROLE_NAME_MAX = 30
/** 사용자 역할의 최대 개수 */
export const CUSTOM_ROLES_MAX = 50
/** 가중치 묶음 파일의 최대 크기(바이트) */
export const ROLE_BUNDLE_MAX_BYTES = 256 * 1024
/** 게임에서 역할 별점을 한 번에 받는 선수 수 */
export const STARS_PER_REQUEST = 5
