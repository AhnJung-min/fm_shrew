/**
 * FM26 역할 카탈로그 자료(src/shared/data/fm26-roles.json)를 만드는 생성기의 계산 부분(2단계 U4).
 * 세이브처럼 저장소에 둘 수 없는 원본(켜진 게임에서 읽은 파일, 메인 체크아웃의 review-notes/ingame)을 읽어 자료 파일의 글을 만든다.
 * 이 파일의 함수는 원본 없이도 모두 시험할 수 있다(tests/catalogBuild.test.ts). 원본으로 돌리는 것은 그 시험 파일이 환경 변수 FMB_CATALOG_SOURCE가 있을 때만 한다.
 *
 * 원본에서 읽는 것
 * - role-key-attributes.json: 역할마다 국면, 번호(gameId), 열거형 이름, 이름, 짧은 이름, 핵심 능력치 목록. 설명 글(help)은 모양(zod)에 없어서 읽히지 않는다.
 * - role-slots.json(role-slots*.json 모두): 켜진 게임의 전술 자리마다 포지션 비트와, 국면마다 고를 수 있는 역할 번호 목록. 선수 이름은 모양에 없어서 읽히지 않는다.
 * - role-stars.json(있을 때 검사에만): 1군 선수의 포지션 숙련과 역할 별점 표. 초안이 이 표와 어긋나지 않는지 본다. 선수 이름은 읽지 않는다.
 * - role-by-position.json(있을 때 검사에만): 한 포지션만 뛰는 선수의 역할 표로 정리한 포지션별 역할(번호, 이름, 짧은 이름. 선수 이름 없음).
 *   자료의 포지션별 역할이 이 표와 같은지 본다. 칸 종류 단위의 목록은 이 표로 알 수 없다(그 칸은 게임에서 전술을 바꿔 봐야 한다).
 *
 * 원본에서 오지 않는 것(이 파일의 표)
 * - 능력치 이름 → 앱 능력치 id(계획 부록 A), 이름이 없는 옛 역할 10개의 이름, 게임에서 보지 못한 칸 종류의 초안과 근거,
 *   칸 종류별 기본 역할, 옛 14역할 대응 표(부록 B), 앱 추가 능력치 규칙.
 * 열쇠 차례와 줄 모양이 고정이라 같은 원본이면 늘 같은 글이 나온다.
 */
import { z } from 'zod'
import type { Fm26Data, Fm26Role } from '../../src/shared/catalogFm26'
import type { Evidence } from '../../src/shared/roleCatalog'
import { DEFAULT_ROLE, ROLES, type PositionKey } from '../../src/shared/roles'
import type { Phase } from '../../src/shared/slotProfile'
import { SAVE_ATTRIBUTE_ORDER } from '../../src/shared/world'

/** 자료를 읽은 게임 판 */
export const GAME_VERSION = '26.3.2'

/**
 * 앱 추가 능력치 규칙(리드 결정 1)
 * - none: 앱이 더하는 능력치가 없다(게임이 보여 준 핵심 능력치만).
 * - default: 골키퍼가 아닌 역할의 두 국면에 가속도·민첩성을, 핵심이 아닐 때 앱 추가로 더한다(1회차 현재 능력 회귀 근거).
 * - legacy: 옛 14역할이 도움(가중치 2)으로 가진 능력치를, 1:1로 대응하는 점유 시 역할에만 더한다(핵심이 아닐 때).
 */
export type AppRule = 'none' | 'default' | 'legacy'
/**
 * 자료에 들어 있는 규칙. 리드가 다른 안을 고르면 이 한 줄을 바꾸고 `npm run catalog:build`를 다시 돌린다.
 * 시험(tests/catalogFm26.test.ts)이 이 값을 따라 앱 추가 목록을 확인한다. 규칙마다 달라지는 시험은 그 파일의 "앱 추가 능력치" 묶음 한 곳에 모아 두었다.
 */
export const COMMITTED_APP_RULE: AppRule = 'default'

export const PHASES: readonly Phase[] = ['ip', 'oop']
/** 포지션 14개의 차례(roles.ts의 DEFAULT_ROLE 차례) */
export const POSITION_ORDER: readonly PositionKey[] = Object.keys(DEFAULT_ROLE) as PositionKey[]
const CENTRE: ReadonlySet<string> = new Set(['DC', 'DM', 'MC', 'AMC', 'ST'])
const CENTRE_SUFFIXES = ['single', 'pair', 'trio.side', 'trio.centre'] as const
/** 칸 종류 전체(29개): 넓은 포지션은 포지션 그대로, 가운데 포지션은 같은 줄의 가운데 칸 수에 따라 넷 */
export const ALL_KINDS: readonly string[] = POSITION_ORDER.flatMap((position) => (CENTRE.has(position) ? CENTRE_SUFFIXES.map((suffix) => `${position}.${suffix}`) : [position]))
export const kindPosition = (kind: string): PositionKey => kind.split('.')[0] as PositionKey

/** 게임 능력치 이름 → 앱 능력치 id(계획 부록 A, 37개). 이 대응으로 89개 역할의 핵심 목록이 모두 세이브 능력치 순서로 늘어난다 */
export const ATTRIBUTE_NAMES: Readonly<Record<string, string>> = {
  '볼 핸들링': 'handling',
  '공중 장악력': 'aerialReach',
  '페널티 박스 장악력': 'commandOfArea',
  '수비 조율': 'communication',
  '골킥': 'kicking',
  '수비 위치 선정': 'positioning',
  '반사 신경': 'reflexes',
  '민첩성': 'agility',
  '집중력': 'concentration',
  '일대일 마크': 'marking',
  '태클': 'tackling',
  '예측력': 'anticipation',
  '팀워크': 'teamwork',
  '가속도': 'acceleration',
  '크로스': 'crossing',
  '활동량': 'workRate',
  '지구력': 'stamina',
  '주력': 'pace',
  '드리블': 'dribbling',
  '오프 더 볼': 'offTheBall',
  '개인기': 'technique',
  '패스': 'passing',
  '판단력': 'decisions',
  '침착성': 'composure',
  '헤더': 'heading',
  '몸싸움': 'strength',
  '점프 거리': 'jumping',
  '시야': 'vision',
  '퍼스트 터치': 'firstTouch',
  '중거리 슛': 'longShots',
  '천재성': 'flair',
  '균형 감각': 'balance',
  '골 결정력': 'finishing',
  '대담성': 'bravery',
  '적극성': 'aggression',
  '일대일 방어': 'oneOnOnes',
  '돌진(빈도)': 'rushingOut'
}

/**
 * 게임이 이름을 주지 않은 옛 방식(FM24식) 역할 10개의 이름. 게임 목록 어디에도 나오지 않아 고를 수 없는 역할이고(selectable false),
 * 화면에 보이지 않는다. 가져오기 보고나 문제 글에서 어느 역할인지 알아보려고 적는 관례 표기다(게임에서 읽은 이름이 아니다).
 */
export const NAMELESS_ROLE_NAMES: Readonly<Record<string, string>> = {
  NoNonsenseFullBack: '안정형 풀백',
  BalWinningMidfielder: '볼 위닝 미드',
  AnchorMan: '앵커맨',
  Enganche: '엥간체',
  Regista: '레지스타',
  Mezzala: '메짤라',
  SegundoVolante: '세군두 볼란치',
  DefensiveWinger: '수비형 윙어',
  WideTargetMan: '와이드 타깃맨',
  CompleteForward: '컴플리트 포워드'
}

/** 옛 14역할 → FM26 점유 시 역할의 열거형 이름(계획 부록 B). 리드 결정 3: 모두 1:1로 본다 */
export const LEGACY_TARGETS: Readonly<Record<string, string>> = {
  gk: 'Goalkeeper',
  cb: 'CentralDefender',
  bpd: 'BallPlayingDefender',
  fb: 'FullBack',
  wb: 'WingBack',
  dm: 'DefensiveMidfielder',
  dlp: 'DeepLyingPlaymaker',
  b2b: 'BoxToBoxMidfielder',
  ap: 'AdvancedPlaymaker',
  am: 'AttackingMidfielder',
  winger: 'Winger',
  if: 'InsideForward',
  st: 'CentreForward',
  tm: 'TargetMan'
}

/**
 * 포지션마다 처음에 고르는 역할(계획 부록 C): 옛 기본 역할의 대응 역할이고, 그 칸에서 고를 수 없으면 그 포지션의 일반 역할이다.
 * 같은 포지션이면 칸 종류가 달라도 같다. 중앙 미드(MC)는 옛 기본인 박스 투 박스를 이 포지션에서 고를 수 없어(아래 초안의 설명) 중앙 미드필더다.
 */
const DEFAULT_ENUMS: Readonly<Record<PositionKey, { ip: string; oop: string }>> = {
  GK: { ip: 'Goalkeeper', oop: 'OPGoalkeeper' },
  DL: { ip: 'FullBack', oop: 'OPFullBack' },
  DC: { ip: 'CentralDefender', oop: 'OPCentreBack' },
  DR: { ip: 'FullBack', oop: 'OPFullBack' },
  WBL: { ip: 'WingBack', oop: 'OPWingBack' },
  WBR: { ip: 'WingBack', oop: 'OPWingBack' },
  DM: { ip: 'DefensiveMidfielder', oop: 'OPDefensiveMidfielder' },
  ML: { ip: 'Winger', oop: 'OPWideMidfielder' },
  MC: { ip: 'CentralMidfielder', oop: 'OPCentralMidfielder' },
  MR: { ip: 'Winger', oop: 'OPWideMidfielder' },
  AML: { ip: 'InsideForward', oop: 'OPWinger' },
  AMC: { ip: 'AttackingMidfielder', oop: 'OPAtackingMidfielder' },
  AMR: { ip: 'InsideForward', oop: 'OPWinger' },
  ST: { ip: 'CentreForward', oop: 'OPCentreForward' }
}

// ---------- 게임에서 보지 못한 칸 종류의 초안 ----------

/**
 * 켜진 게임에서 역할 목록을 읽은 칸 종류는 GK, DL, DR, DC.pair, DM.single, MC.pair, AML, AMR, ST.single의 아홉이다(한 전술의 11칸).
 * 나머지 20개 칸 종류의 목록은 아래 초안이다.
 *
 * 초안의 뼈대는 1군 선수 25명의 역할 별점 표다. 이 표는 선수가 뛸 수 있는 포지션(숙련 12 이상) 전부에서 고를 수 있는 역할을 합친 것이고
 * 칸 종류와 상관없이 그 포지션의 역할을 모두 담는다. 선수의 포지션과 표를 견주면 역할이 어느 포지션에 있는지 알 수 있다(checkStarTables가 이 견주기를 한다).
 * - 포지션별 역할의 합집합이 고를 수 있는 역할(점유 시 40개, 비점유 시 39개)을 모두 덮는다.
 * - 게임에서 본 목록이 그 포지션의 합집합보다 작은 포지션(DC, DM, ST)은 남는 역할이 다른 칸 종류에 있다는 뜻이다.
 *   와이드 센터백 계열은 수비 셋 바깥 칸(trio.side), 박스 투 박스 계열과 압박형·와이드 커버링 수비형 미드는 수비형 미드 둘(pair),
 *   분리 지향 센터 포워드는 최전방 둘(pair)에 두었다. 어느 칸 종류인지는 이름에서 한 짐작이다.
 * - 박스 투 박스 미드필더와 박스 투 박스 플레이메이커는 중앙 미드(MC)가 아니라 수비형 미드(DM)의 역할이다: 중앙 미드만 뛰는 선수의 표에는 없고
 *   수비형 미드만 뛰는 선수의 표에는 있다. 계획 부록 C가 짐작한 것과 다르다(그래서 중앙 미드의 기본 역할이 중앙 미드필더다).
 * - 세컨드 스트라이커와 프리 롤은 최전방이 아니라 공격형 미드(AMC)의 역할이다.
 *
 * 근거(evidence): inferred = 1군 별점 표(와 공개 역할 목록)로 그 포지션에 있는 것을 확인하고 칸 종류에 놓은 것, unknown = 칸 종류까지 이름으로 짠 초안.
 * 둘 다 화면에서는 "게임에서 확인 전"이다. 게임에서 확인한 뒤에는 이 표를 고치거나 role-slots*.json을 원본에 더하고 생성기를 다시 돌린다.
 */
interface Draft {
  evidence: 'inferred' | 'unknown'
  /** 자료의 짧은 출처 메모(40자 이내). 공개 자료는 사이트 이름만 적는다 */
  note: string
  ip: readonly string[]
  oop: readonly string[]
}

const NOTE_TABLE = '1군 별점 표에서 짐작'
const NOTE_SITES = '1군 별점 표, fmscout.com, realsport101.com'
const NOTE_NAMES = '역할 이름으로 짠 초안'
/** 게임에서 읽은 목록의 출처 메모 */
export const NOTE_GAME = '게임 역할 목록에서 읽음'

const WING_BACK = {
  ip: ['WingBack', 'AdvancedWingBack', 'InvertedWingBack', 'PlaymakingWingBack'],
  oop: ['OPWingBack', 'OPPressingWingBack', 'OPHoldingWingBack']
}
const WIDE_MIDFIELDER = {
  ip: ['WideMidfielder', 'Winger', 'InvertedWinger', 'WidePlaymaker'],
  oop: ['OPWideMidfielder', 'OPTrackingWideMidfielder', 'OPWideOutletWideMidfielder']
}
const CENTRE_BACK_PAIR = {
  ip: ['CentralDefender', 'Libero', 'BallPlayingDefender', 'NoNonsenseCentreBack'],
  oop: ['OPCentreBack', 'OPStoppingCentreBack', 'OPCoveringCentreBack']
}
const CENTRE_BACK_SIDE = {
  ip: ['CentralDefender', 'BallPlayingDefender', 'NoNonsenseCentreBack', 'WideCentreBack', 'OverlappingCentreBack'],
  oop: ['OPCentreBack', 'OPStoppingCentreBack', 'OPCoveringCentreBack', 'OPWideCentreBack', 'OPStoppingWideCentreBack', 'OPCoveringWideCentreBack']
}
const DEFENSIVE_SINGLE = {
  ip: ['DefensiveMidfielder', 'DeepLyingPlaymaker', 'HalfBack'],
  oop: ['OPDefensiveMidfielder', 'OPDroppingDefensiveMidfielder', 'OPScreeningDefensiveMidfielder']
}
const DEFENSIVE_PAIR = {
  ip: ['DefensiveMidfielder', 'DeepLyingPlaymaker', 'HalfBack', 'BoxToBoxMidfielder', 'BoxToBoxPlaymaker'],
  oop: ['OPDefensiveMidfielder', 'OPDroppingDefensiveMidfielder', 'OPPressingDefensiveMidfielder', 'OPScreeningDefensiveMidfielder', 'OPWideCoverDefensiveMidfielder']
}
const CENTRAL_MIDFIELD = {
  ip: ['CentralMidfielder', 'AttackingMidfielder', 'AdvancedPlaymaker', 'WideCentralMidfielder', 'ChannelMidfielder', 'MidfieldPlaymaker'],
  oop: ['OPCentralMidfielder', 'OPPressingCentralMidfielder', 'OPScreeningCentralMidfielder', 'OPWideCoverCentralMidfielder']
}
const ATTACKING_MIDFIELD = {
  ip: ['AttackingMidfielder', 'ChannelMidfielder', 'AdvancedPlaymaker', 'Trequartista', 'ShadowStriker'],
  oop: ['OPAtackingMidfielder', 'OPTrackingAtackingMidfielder', 'OPCentralOutletMidfielder', 'OPSplittingOutletAtackingMidfielder']
}
const FORWARD_PAIR = {
  ip: ['DeepLyingForward', 'CentreForward', 'TargetMan', 'Poacher', 'ChannelForward', 'FalseNumberNine'],
  oop: ['OPCentreForward', 'OPTrackingCentreForward', 'OPCentralOutletCentreForward', 'OPSplittingOutletCentreForward']
}

/** 칸 종류 → 초안. 게임에서 읽은 칸 종류는 여기 없어도 된다(읽은 것이 먼저다) */
export const DRAFT_KINDS: Readonly<Record<string, Draft>> = {
  WBL: { evidence: 'inferred', note: NOTE_SITES, ...WING_BACK },
  WBR: { evidence: 'inferred', note: NOTE_SITES, ...WING_BACK },
  'DC.single': { evidence: 'unknown', note: NOTE_NAMES, ...CENTRE_BACK_PAIR },
  'DC.trio.side': { evidence: 'inferred', note: NOTE_SITES, ...CENTRE_BACK_SIDE },
  'DC.trio.centre': { evidence: 'inferred', note: NOTE_TABLE, ...CENTRE_BACK_PAIR },
  'DM.pair': { evidence: 'inferred', note: NOTE_TABLE, ...DEFENSIVE_PAIR },
  'DM.trio.side': { evidence: 'unknown', note: NOTE_NAMES, ...DEFENSIVE_PAIR },
  'DM.trio.centre': { evidence: 'unknown', note: NOTE_NAMES, ...DEFENSIVE_SINGLE },
  ML: { evidence: 'inferred', note: NOTE_SITES, ...WIDE_MIDFIELDER },
  MR: { evidence: 'inferred', note: NOTE_SITES, ...WIDE_MIDFIELDER },
  'MC.single': { evidence: 'inferred', note: NOTE_TABLE, ...CENTRAL_MIDFIELD },
  'MC.trio.side': { evidence: 'unknown', note: NOTE_NAMES, ...CENTRAL_MIDFIELD },
  'MC.trio.centre': { evidence: 'unknown', note: NOTE_NAMES, ...CENTRAL_MIDFIELD },
  'AMC.single': { evidence: 'inferred', note: NOTE_TABLE, ...ATTACKING_MIDFIELD },
  'AMC.pair': { evidence: 'unknown', note: NOTE_NAMES, ...ATTACKING_MIDFIELD },
  'AMC.trio.side': { evidence: 'unknown', note: NOTE_NAMES, ...ATTACKING_MIDFIELD },
  'AMC.trio.centre': { evidence: 'unknown', note: NOTE_NAMES, ...ATTACKING_MIDFIELD },
  'ST.pair': { evidence: 'inferred', note: NOTE_TABLE, ...FORWARD_PAIR },
  'ST.trio.side': { evidence: 'unknown', note: NOTE_NAMES, ...FORWARD_PAIR },
  'ST.trio.centre': { evidence: 'unknown', note: NOTE_NAMES, ...FORWARD_PAIR }
}

// ---------- 원본 읽기(zod로 필요한 칸만) ----------

const SourceRole = z.object({
  phase: z.enum(['ip', 'oop']),
  id: z.string().regex(/^\d+$/),
  enumName: z.string().min(1),
  name: z.string().nullish(),
  short: z.string().nullish(),
  keyAttributes: z.array(z.string())
})
const KeyAttributesFile = z.object({ readAt: z.string(), roles: z.array(SourceRole) })
const SlotPhase = z.object({ position: z.number().int().nonnegative(), available: z.array(z.object({ id: z.string().regex(/^\d+$/) })) })
const SlotsFile = z.object({ slots: z.array(z.object({ index: z.number().int(), ip: SlotPhase, oop: SlotPhase })) })
const StarsFile = z.object({
  players: z.array(
    z.object({
      positions: z.record(z.string(), z.number()),
      ip: z.array(z.object({ id: z.string() })),
      oop: z.array(z.object({ id: z.string() }))
    })
  )
})

const PositionRole = z.object({ id: z.string().regex(/^\d+$/), short: z.string().nullish(), name: z.string().nullish() })
const PositionTableFile = z.object({ positions: z.record(z.string(), z.object({ ip: z.array(PositionRole), oop: z.array(PositionRole) })) })

export type ParsedKeyAttributes = z.infer<typeof KeyAttributesFile>
export type ParsedSlots = z.infer<typeof SlotsFile>
export type ParsedStars = z.infer<typeof StarsFile>
export type ParsedPositionTable = z.infer<typeof PositionTableFile>

function parseWith<T>(schema: z.ZodType<T>, json: unknown, what: string): T {
  const result = schema.safeParse(json)
  if (!result.success) throw new Error(`${what}의 모양이 다릅니다.\n${z.prettifyError(result.error)}`)
  return result.data
}
/** 역할 목록 파일(role-key-attributes.json). 설명 글(help)과 모르는 칸은 읽지 않는다 */
export const parseKeyAttributes = (json: unknown): ParsedKeyAttributes => parseWith(KeyAttributesFile, json, 'role-key-attributes.json')
/** 전술 자리 파일(role-slots.json). 선수 이름과 모르는 칸은 읽지 않는다 */
export const parseSlots = (json: unknown): ParsedSlots => parseWith(SlotsFile, json, 'role-slots.json')
/** 1군 역할 별점 파일(role-stars.json). 포지션 숙련과 역할 번호만 읽고 선수 이름은 읽지 않는다 */
export const parseStars = (json: unknown): ParsedStars => parseWith(StarsFile, json, 'role-stars.json')
/** 포지션별 역할 표(role-by-position.json). 역할 번호와 이름만 읽는다 */
export const parsePositionTable = (json: unknown): ParsedPositionTable => parseWith(PositionTableFile, json, 'role-by-position.json')

// ---------- 포지션 비트 → 칸 종류 ----------

/** 게임 포지션 비트(PlayingDataFlags.PositionMask)와 포지션(계획 부록 D). 좌우 비트는 가운데 포지션의 왼쪽·오른쪽 칸이다 */
const POSITION_BITS: ReadonlyArray<readonly [number, PositionKey]> = [
  [1, 'GK'],
  [4, 'DR'],
  [8, 'DL'],
  [16, 'DC'],
  [32, 'WBR'],
  [64, 'WBL'],
  [128, 'DM'],
  [256, 'MR'],
  [512, 'ML'],
  [1024, 'MC'],
  [2048, 'AMR'],
  [4096, 'AML'],
  [8192, 'AMC'],
  [16384, 'ST']
]
const LEFT_SIDED = 1048576
const RIGHT_SIDED = 2097152
/** 최전방 둘 자리에서 오는 비트(AttackerRight, AttackerLeft). 부록 D에서 최전방의 오른쪽·왼쪽 칸으로 본다(확인 전) */
const STRIKER_RIGHT = 32768
const STRIKER_LEFT = 65536

/** 포지션 비트를 포지션과 좌우로 푼다. 모르는 비트가 있거나 포지션이 하나가 아니면 던진다(생성기를 고쳐야 한다는 뜻) */
export function decodePosition(bits: number): { position: PositionKey; side: 'left' | 'right' | null } {
  let rest = bits
  const found: PositionKey[] = []
  for (const [bit, position] of POSITION_BITS) {
    if ((rest & bit) !== 0) {
      found.push(position)
      rest &= ~bit
    }
  }
  let left = (rest & LEFT_SIDED) !== 0
  let right = (rest & RIGHT_SIDED) !== 0
  rest &= ~(LEFT_SIDED | RIGHT_SIDED)
  for (const [bit, isRight] of [[STRIKER_RIGHT, true], [STRIKER_LEFT, false]] as const) {
    if ((rest & bit) === 0) continue
    found.push('ST')
    rest &= ~bit
    if (isRight) right = true
    else left = true
  }
  if (found.length !== 1 || rest !== 0 || (left && right)) throw new Error(`포지션 비트 ${bits}를 풀 수 없습니다.`)
  return { position: found[0], side: left ? 'left' : right ? 'right' : null }
}

/**
 * 칸 종류. 넓은 포지션은 포지션 그대로, 가운데 포지션은 같은 줄의 가운데 칸 수가 1이면 single, 2면 pair,
 * 3 이상이면 한가운데 칸은 trio.centre, 바깥 칸은 trio.side다(tacticModel.ts의 slotKindOf와 같다).
 */
export function kindOfCell(position: PositionKey, side: 'left' | 'right' | null, centreCount: number): string {
  if (!CENTRE.has(position)) return position
  if (centreCount <= 1) return `${position}.single`
  if (centreCount === 2) return `${position}.pair`
  return side === null ? `${position}.trio.centre` : `${position}.trio.side`
}

// ---------- 만들기 ----------

type RoleRef = Pick<Fm26Role, 'id' | 'phase' | 'gameId'>
const byGameId = (a: RoleRef, b: RoleRef): number => {
  const x = BigInt(a.gameId)
  const y = BigInt(b.gameId)
  return x < y ? -1 : x > y ? 1 : 0
}
const SAVE_AT: ReadonlyMap<string, number> = new Map(SAVE_ATTRIBUTE_ORDER.map((id, i) => [id, i]))
const saveOrdered = (ids: Iterable<string>): string[] => [...new Set(ids)].sort((a, b) => (SAVE_AT.get(a) ?? -1) - (SAVE_AT.get(b) ?? -1))

export interface BuildSource {
  keyAttributes: ParsedKeyAttributes
  /** role-slots.json를 하나씩 읽은 것(여럿이면 모두) */
  slots: readonly ParsedSlots[]
}
export interface BuildOptions {
  appRule?: AppRule
}

/**
 * 게임에서 읽은 칸 종류 → 국면별 역할 id(게임 번호 오름차순). 칸 종류는 포지션 비트와 같은 국면의 같은 줄 가운데 칸 수로 정한다.
 * 같은 칸 종류를 여러 번 보았는데 목록이 다르면 던진다(한 칸 종류의 목록은 하나여야 한다).
 */
export function observedKinds(slotFiles: readonly ParsedSlots[], roleOf: (phase: Phase, gameId: string) => RoleRef | undefined): Map<string, Partial<Record<Phase, string[]>>> {
  const observed = new Map<string, Partial<Record<Phase, string[]>>>()
  for (const file of slotFiles) {
    for (const phase of PHASES) {
      const cells = file.slots.map((slot) => ({ slot, ...decodePosition(slot[phase].position) }))
      const countOf = new Map<PositionKey, number>()
      for (const cell of cells) countOf.set(cell.position, (countOf.get(cell.position) ?? 0) + 1)
      for (const cell of cells) {
        const kind = kindOfCell(cell.position, cell.side, countOf.get(cell.position) ?? 1)
        const roles = cell.slot[phase].available.map((each) => {
          const role = roleOf(phase, each.id)
          if (!role) throw new Error(`${kind} ${phase}: 역할 목록에 없는 역할 번호 ${each.id}`)
          return role
        })
        const ids = roles.sort(byGameId).map((role) => role.id)
        const before = observed.get(kind)?.[phase]
        if (before && before.join() !== ids.join()) throw new Error(`${kind} ${phase}: 같은 칸 종류를 두 번 보았는데 역할 목록이 다릅니다.`)
        observed.set(kind, { ...observed.get(kind), [phase]: ids })
      }
    }
  }
  return observed
}

/** 역할의 앱 추가 능력치(세이브 순서). 규칙 설명은 AppRule */
export function appAttributesOf(rule: AppRule, role: { id: string; enumName: string; goalkeeper: boolean; key: readonly string[] }): string[] {
  const own = new Set(role.key)
  if (rule === 'none') return []
  if (rule === 'default') return role.goalkeeper ? [] : saveOrdered(['acceleration', 'agility'].filter((attribute) => !own.has(attribute)))
  const old = role.id.startsWith('ip.') ? ROLES.find((each) => LEGACY_TARGETS[each.id] === role.enumName) : undefined
  if (!old) return []
  return saveOrdered(Object.entries(old.weights).filter(([attribute, weight]) => weight < 4 && !own.has(attribute)).map(([attribute]) => attribute))
}

/** 원본에서 자료를 만든다. 어긋나는 것(모르는 능력치 이름, 세이브 순서가 깨진 목록, 이름 없는 새 역할, 칸 종류의 빈 목록 등)은 던진다 */
export function buildFm26Data(source: BuildSource, options: BuildOptions = {}): Fm26Data {
  const rule = options.appRule ?? COMMITTED_APP_RULE

  // 역할
  const roles: Array<Omit<Fm26Role, 'app'>> = []
  const seenId = new Set<string>()
  const seenBit = new Set<string>()
  for (const each of source.keyAttributes.roles) {
    const id = `${each.phase}.${each.enumName}`
    if (seenId.has(id)) throw new Error(`역할 번호가 겹칩니다: ${id}`)
    seenId.add(id)
    if (seenBit.has(`${each.phase}:${each.id}`)) throw new Error(`(국면, 게임 번호)가 겹칩니다: ${each.phase} ${each.id}`)
    seenBit.add(`${each.phase}:${each.id}`)
    const key = each.keyAttributes.map((name) => {
      const attribute = Object.hasOwn(ATTRIBUTE_NAMES, name) ? ATTRIBUTE_NAMES[name] : undefined
      if (!attribute) throw new Error(`${id}: 모르는 능력치 이름 "${name}"`)
      return attribute
    })
    key.forEach((attribute, i) => {
      if (i > 0 && !((SAVE_AT.get(attribute) ?? -1) > (SAVE_AT.get(key[i - 1]) ?? -1))) throw new Error(`${id}: 핵심 능력치가 세이브 순서로 늘어나지 않습니다(${key[i - 1]} 다음 ${attribute})`)
    })
    const name = each.name ?? NAMELESS_ROLE_NAMES[each.enumName]
    if (!name) throw new Error(`${id}: 이름이 없는 역할의 이름을 NAMELESS_ROLE_NAMES에 적어야 합니다.`)
    roles.push({ id, phase: each.phase, gameId: each.id, enumName: each.enumName, name, short: each.short ?? '', selectable: each.name != null, key })
  }
  const roleById = new Map(roles.map((role) => [role.id, role]))
  const roleOf = (phase: Phase, gameId: string): RoleRef | undefined => roles.find((role) => role.phase === phase && role.gameId === gameId)
  const idOfEnum = (phase: Phase, enumName: string): string => {
    const id = `${phase}.${enumName}`
    if (!roleById.has(id)) throw new Error(`초안이 모르는 역할을 부릅니다: ${id}`)
    return id
  }

  // 칸 종류별 목록: 게임에서 읽은 것이 먼저이고, 없는 국면은 초안
  const observed = observedKinds(source.slots, roleOf)
  // 게임의 역할 목록에 나온 역할은 이름을 주지 않았어도 고를 수 있는 역할이다(옛 방식 역할이 어느 칸에 나오면 이렇게 알게 된다)
  for (const lists of observed.values()) for (const id of [...(lists.ip ?? []), ...(lists.oop ?? [])]) roleById.get(id)!.selectable = true
  const slotKinds: Fm26Data['slotKinds'] = {}
  const slotNotes: Fm26Data['slotNotes'] = {}
  for (const kind of ALL_KINDS) {
    const seen = observed.get(kind)
    const draft = DRAFT_KINDS[kind]
    const entries: Array<{ roleId: string; evidence: Evidence }> = []
    for (const phase of PHASES) {
      const own = seen?.[phase]
      if (!own && !draft) throw new Error(`${kind} ${phase}: 고를 수 있는 역할이 없습니다(게임에서 읽은 것도 초안도 없음).`)
      const ids = own ?? draft![phase].map((enumName) => idOfEnum(phase, enumName)).sort((a, b) => byGameId(roleById.get(a)!, roleById.get(b)!))
      if (ids.length === 0) throw new Error(`${kind} ${phase}: 고를 수 있는 역할이 비어 있습니다.`)
      const evidence: Evidence = own ? 'game' : draft!.evidence
      for (const roleId of ids) entries.push({ roleId, evidence })
    }
    slotKinds[kind] = entries
    slotNotes[kind] = seen?.ip && seen?.oop ? NOTE_GAME : (draft?.note ?? NOTE_GAME)
  }

  // 역할이 든 포지션
  const positionsOf = new Map<string, Set<PositionKey>>()
  for (const kind of ALL_KINDS) {
    for (const { roleId } of slotKinds[kind]) positionsOf.set(roleId, (positionsOf.get(roleId) ?? new Set<PositionKey>()).add(kindPosition(kind)))
  }
  for (const role of roles) {
    const where = positionsOf.get(role.id)
    if (role.selectable && !where) throw new Error(`${role.id}: 고를 수 있는 역할인데 어느 칸 종류의 목록에도 없습니다.`)
    if (!role.selectable && where) throw new Error(`${role.id}: 고를 수 없는 역할인데 목록에 있습니다.`)
    if (where?.has('GK') && where.size !== 1) throw new Error(`${role.id}: 골키퍼 역할이 골키퍼 칸 밖에도 있습니다.`)
  }

  // 기본 역할
  const defaultRoles: Fm26Data['defaultRoles'] = {}
  for (const kind of ALL_KINDS) {
    const wanted = DEFAULT_ENUMS[kindPosition(kind)]
    const pick: Partial<Record<Phase, string>> = {}
    for (const phase of PHASES) {
      const id = idOfEnum(phase, wanted[phase])
      if (!slotKinds[kind].some((entry) => entry.roleId === id)) throw new Error(`${kind} ${phase}: 기본 역할 ${id}가 그 칸의 목록에 없습니다.`)
      pick[phase] = id
    }
    defaultRoles[kind] = pick
  }

  // 옛 14역할 대응
  const legacyMap: Fm26Data['legacyMap'] = {}
  for (const old of ROLES) {
    const target = LEGACY_TARGETS[old.id]
    if (!target) throw new Error(`옛 역할 ${old.id}의 대응이 없습니다.`)
    legacyMap[old.id] = { to: idOfEnum('ip', target), oneToOne: true }
  }

  return {
    game: GAME_VERSION,
    readAt: source.keyAttributes.readAt.slice(0, 10),
    appRule: rule,
    attributeNames: { ...ATTRIBUTE_NAMES },
    roles: roles.map((role) => ({ ...role, app: appAttributesOf(rule, { id: role.id, enumName: role.enumName, goalkeeper: positionsOf.get(role.id)?.has('GK') ?? false, key: role.key }) })),
    slotKinds,
    slotNotes,
    defaultRoles,
    legacyMap
  }
}

// ---------- 글로 쓰기 ----------

const plain = (value: unknown): boolean => value === null || ['string', 'number', 'boolean'].includes(typeof value)

/** 한 줄 글: 객체와 배열을 `{ "a": 1, "b": [1, 2] }` 꼴로 */
function inline(value: unknown): string {
  if (plain(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`
  return `{ ${Object.entries(value as object).map(([key, each]) => `${JSON.stringify(key)}: ${inline(each)}`).join(', ')} }`
}

function rows(items: string[], indent: string, open: string, close: string): string {
  return items.length === 0 ? `${open}${close}` : `${open}\n${items.map((item) => `${indent}  ${item}`).join(',\n')}\n${indent}${close}`
}

/**
 * 자료 파일의 글. 열쇠 차례가 자료의 차례 그대로이고 줄 모양이 정해져 있어서 같은 자료는 늘 같은 글이다(줄 끝은 \n, 맨 끝에 줄바꿈 하나).
 * 맨 위 열쇠마다 한 줄이고, 목록(역할, 칸 종류의 역할)과 표(능력치 이름, 칸 종류, 기본 역할, 대응)는 항목마다 한 줄이다.
 */
export function formatFm26Data(data: Fm26Data): string {
  const top = Object.entries(data).map(([key, value]) => {
    let body: string
    if (plain(value)) body = JSON.stringify(value)
    else if (Array.isArray(value)) body = rows(value.map(inline), '  ', '[', ']')
    else {
      const items = Object.entries(value as object).map(([name, each]) => `${JSON.stringify(name)}: ${Array.isArray(each) ? rows(each.map(inline), '    ', '[', ']') : inline(each)}`)
      body = rows(items, '  ', '{', '}')
    }
    return `${JSON.stringify(key)}: ${body}`
  })
  return `${rows(top, '', '{', '}')}\n`
}

// ---------- 1군 별점 표와 견주기 ----------

/** 1군 표의 포지션 이름 → 앱 포지션 */
const STAR_POSITIONS: Readonly<Record<string, PositionKey>> = {
  GK: 'GK',
  'D (L)': 'DL',
  'D (C)': 'DC',
  'D (R)': 'DR',
  DM: 'DM',
  'M (L)': 'ML',
  'M (C)': 'MC',
  'M (R)': 'MR',
  'AM (L)': 'AML',
  'AM (C)': 'AMC',
  'AM (R)': 'AMR',
  'ST (C)': 'ST',
  'WB (L)': 'WBL',
  'WB (R)': 'WBR'
}

/** 역할 id → 그 역할이 든 칸 종류들의 포지션(자료의 칸 종류 목록에서) */
function positionsByRole(data: Fm26Data): Map<string, Set<PositionKey>> {
  const positionsOf = new Map<string, Set<PositionKey>>()
  for (const kind of Object.keys(data.slotKinds)) {
    for (const { roleId } of data.slotKinds[kind]) positionsOf.set(roleId, (positionsOf.get(roleId) ?? new Set<PositionKey>()).add(kindPosition(kind)))
  }
  return positionsOf
}

/**
 * 자료의 역할별 포지션이 1군 별점 표와 어긋나지 않는지 본다(선수 이름은 쓰지 않고 순번만). 표는 선수가 뛸 수 있는 포지션(숙련이 minRating 이상) 전부에서
 * 고를 수 있는 역할을 합친 것이라서, 선수마다 (가) 표에 있는 역할은 자료의 포지션 가운데 선수가 뛸 수 있는 것이 하나는 있어야 하고,
 * (나) 표에 없는 역할은 자료의 포지션 가운데 선수가 뛸 수 있는 것이 없어야 한다. 어긋난 것을 글로 모아 돌려준다(없으면 빈 목록).
 */
export function checkStarTables(data: Fm26Data, stars: ParsedStars, minRating = 12): string[] {
  const positionsOf = positionsByRole(data)
  const problems: string[] = []
  stars.players.forEach((player, at) => {
    const can = new Set<PositionKey>()
    for (const [label, rating] of Object.entries(player.positions)) {
      const position = STAR_POSITIONS[label]
      if (position && rating >= minRating) can.add(position)
    }
    for (const phase of PHASES) {
      const have = new Set<string>()
      for (const row of player[phase]) {
        const role = data.roles.find((each) => each.phase === phase && each.gameId === row.id)
        if (!role) problems.push(`선수 ${at}: 표에 있는 ${phase} 역할 번호 ${row.id}가 자료에 없습니다.`)
        else if (!role.selectable) problems.push(`선수 ${at}: 고를 수 없는 역할 ${role.id}가 표에 있습니다.`)
        else have.add(role.id)
      }
      for (const role of data.roles.filter((each) => each.phase === phase && each.selectable)) {
        const where = [...(positionsOf.get(role.id) ?? [])]
        const reachable = where.some((position) => can.has(position))
        if (have.has(role.id) && !reachable) problems.push(`선수 ${at}: ${role.id}가 표에 있는데 자료의 포지션(${where.join(',')})을 뛸 수 없습니다.`)
        if (!have.has(role.id) && reachable) problems.push(`선수 ${at}: ${role.id}가 표에 없는데 자료의 포지션(${where.join(',')})을 뛸 수 있습니다.`)
      }
    }
  })
  return problems
}

// ---------- 포지션별 역할 표와 견주기 ----------

/**
 * 자료의 포지션별 역할이 게임에서 읽은 포지션별 역할 표(role-by-position.json)와 같은지 본다. 이 표는 한 포지션만 뛰는 선수의 역할 표라서
 * 칸 종류로 가르기 전의 "그 포지션에서 고를 수 있는 역할 전체"다. 포지션 14개 × 두 국면마다 (가) 게임 표에만 있는 역할, (나) 자료에만 있는 역할,
 * (다) 둘 다 있는데 이름이나 짧은 이름이 다른 역할을 글로 모아 돌려준다(없으면 빈 목록). 칸 종류 단위의 어긋남은 이 표로 알 수 없다.
 */
export function checkPositionTables(data: Fm26Data, table: ParsedPositionTable): string[] {
  const positionsOf = positionsByRole(data)
  const problems: string[] = []
  for (const position of POSITION_ORDER) {
    const game = Object.hasOwn(table.positions, position) ? table.positions[position] : undefined
    if (!game) {
      problems.push(`${position}: 게임 표에 이 포지션이 없습니다.`)
      continue
    }
    for (const phase of PHASES) {
      const mine = data.roles.filter((role) => role.phase === phase && role.selectable && positionsOf.get(role.id)?.has(position))
      for (const row of game[phase]) {
        const role = mine.find((each) => each.gameId === row.id)
        if (role) {
          if ((row.name ?? role.name) !== role.name || (row.short ?? role.short) !== role.short) problems.push(`${position} ${phase}: ${role.id}의 이름이나 짧은 이름이 게임 표와 다릅니다.`)
          continue
        }
        const other = data.roles.find((each) => each.phase === phase && each.gameId === row.id)
        problems.push(other ? `${position} ${phase}: ${other.id}가 게임 표에는 있는데 자료는 이 포지션에서 고를 수 없게 되어 있습니다.` : `${position} ${phase}: 게임 표의 역할 번호 ${row.id}가 자료에 없습니다.`)
      }
      for (const role of mine) if (!game[phase].some((row) => row.id === role.gameId)) problems.push(`${position} ${phase}: ${role.id}가 자료에만 있습니다(게임 표에 없음).`)
    }
  }
  return problems
}
