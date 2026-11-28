import { TACTIC_PLUGIN, versionOlder, type GameStatus, type VersionStatus } from './game'
import type { CatalogId } from './roleCatalog'
import type { PositionKey } from './roles'

/**
 * 지원 버전 표(N-02): 앱이 확인한 게임 판과 그 판에서 읽는 값의 뜻. 지금은 26.3.2 하나다(리드 결정).
 * 게임이 업데이트되면 세이브 형식, 포지션·역할 비트, 역할 목록이 달라질 수 있다. 그래서 표에 없는 판은
 * (1) 세이브를 적용하기 전에 사용자에게 묻고(앱을 켤 때의 자동 적용은 건너뛴다), (2) 게임 전술 가져오기와 별점 대조를 끈다.
 * 새 판을 확인하면 이 표에 줄을 더한다.
 *
 * 게임의 포지션·역할 값은 64비트 비트값이다(역할은 2^57까지). 숫자로 바꾸면 값이 깨지므로 표에도 글자로 적고, 쓸 때는 BigInt로만 다룬다.
 */
export interface SupportedVersion {
  /** 게임 판("26.3.2") */
  game: string
  /** 세이브 꾸러미의 머리 서명 글자("fmf." 다음의 판 바이트). 이 판의 세이브에서 확인한 값이다 */
  saveFormat: string
  /** 이 판의 비트를 풀어 읽는 역할 목록(카탈로그)과 그 판 */
  catalog: { id: CatalogId; version: string }
  /** 포지션 → 게임의 포지션 비트(10진 글자) */
  positionBits: Record<PositionKey, string>
  /** 가운데 포지션의 왼쪽·오른쪽을 가리키는 비트(수비형 미드, 중앙 미드, 공격형 미드, 최전방 둘 이상일 때 붙는다) */
  sideBits: { left: string; right: string }
  /** 최전방 왼쪽·오른쪽 비트(옛 방식. 쓰이는지 확인하지 못해, 만나면 가운데 왼쪽·오른쪽 칸으로 보고 알린다) */
  attackerSideBits: { left: string; right: string }
  /** 역할 값에 함께 실려 오는 임무 비트들(역할을 찾기 전에 지운다) */
  dutyBits: readonly string[]
  /** 기능마다 필요한 플러그인 버전 */
  plugin: { tactic: string; stars: string }
}

export const SUPPORTED_VERSIONS: readonly SupportedVersion[] = [
  {
    game: '26.3.2',
    saveFormat: 'fmf.08',
    catalog: { id: 'fm26', version: '26.3.2' },
    positionBits: {
      GK: '1',
      DR: '4',
      DL: '8',
      DC: '16',
      WBR: '32',
      WBL: '64',
      DM: '128',
      MR: '256',
      ML: '512',
      MC: '1024',
      AMR: '2048',
      AML: '4096',
      AMC: '8192',
      ST: '16384'
    },
    sideBits: { left: '1048576', right: '2097152' },
    attackerSideBits: { left: '65536', right: '32768' },
    // 방어, 지원, 공격, 스토퍼(방어), 커버링(방어), 자유 임무. 점유 시와 비점유 시가 같은 값이다
    dutyBits: ['2097152', '4194304', '8388608', '33554432', '67108864', '17179869184'],
    plugin: { tactic: TACTIC_PLUGIN, stars: TACTIC_PLUGIN }
  }
]

/**
 * 게임 버전 글자에서 "주.부.수"만 뽑는다: '26.3.2+2329565' → '26.3.2'. "26.4"처럼 둘만 있어도 뽑고, 읽을 수 없으면 null이다.
 * 뒤에 올 수 있는 것은 빌드 번호("+…")나 넷째 숫자(".1234")뿐이다. 그 밖의 꼬리("26.3.2beta" 등)는 확인할 수 없는 판으로 본다.
 */
export function normalizeVersion(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  const match = /^\s*v?(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?(?:[+.][0-9A-Za-z.-]*)?\s*$/.exec(text)
  if (!match) return null
  return match[3] === undefined ? `${match[1]}.${match[2]}` : `${match[1]}.${match[2]}.${match[3]}`
}

export interface VersionCheck {
  status: VersionStatus
  /** 읽은 판("주.부.수"). 읽지 못했으면 null */
  version: string | null
  /** 지원 표의 줄(ok일 때만) */
  row: SupportedVersion | null
  /** 사용자에게 보여 줄 한 줄 안내 */
  text: string
}

const supportedList = (): string => SUPPORTED_VERSIONS.map((row) => row.game).join(', ')

/** 게임 버전 글자가 지원 표에 있는지 본다. ok 표에 있음, unsupported 읽었지만 표에 없음, unknown 읽지 못함(빈 글자 포함) */
export function checkGameVersion(text: string | null | undefined): VersionCheck {
  const version = normalizeVersion(text)
  if (version === null) return { status: 'unknown', version: null, row: null, text: '게임 판을 읽지 못했습니다(확인 못 함).' }
  const row = SUPPORTED_VERSIONS.find((each) => each.game === version) ?? null
  if (row) return { status: 'ok', version, row, text: `게임 판 ${version}: 앱이 확인한 판입니다.` }
  return {
    status: 'unsupported',
    version,
    row: null,
    text: `게임 판 ${version}: 앱이 확인하지 않은 판입니다(확인한 판은 ${supportedList()}). 세이브 형식과 역할 번호가 달라졌을 수 있습니다.`
  }
}

/** 게임에서 읽는 기능: tactic 게임 전술 가져오기, stars 역할 별점 대조 */
export type GameReadFeature = 'tactic' | 'stars'

export interface GameReadGate {
  open: boolean
  /** 닫혀 있을 때 사용자에게 보여 줄 까닭(열려 있으면 빈 글자) */
  reason: string
  /** 열려 있을 때 쓸 지원 표의 줄 */
  row: SupportedVersion | null
}

/**
 * 게임 전술 가져오기와 별점 대조를 쓸 수 있는가(N-02): 게임이 켜져 있고, 플러그인이 TACTIC_PLUGIN 이상이고(표의 기능별 버전도 만족하고),
 * 게임 판이 지원 표에 있어야 한다. 하나라도 아니면 그 기능만 끄고(나머지 기능은 그대로다) 까닭을 준다. 게임 판을 읽지 못해도 끈다.
 */
export function gameReadGate(game: Pick<GameStatus, 'connected' | 'pluginVersion' | 'gameVersion'>, feature: GameReadFeature): GameReadGate {
  const closed = (reason: string): GameReadGate => ({ open: false, reason, row: null })
  if (!game.connected) return closed('FM이 켜져 있어야 게임에서 읽을 수 있습니다. 게임을 켜고 세이브를 불러와 주세요.')
  const tooOld = (needed: string): GameReadGate =>
    closed(`이 기능은 게임 안 플러그인 ${needed} 이상에서 읽습니다(지금 올라가 있는 것은 ${game.pluginVersion || '알 수 없는 버전'}). FM을 완전히 껐다가 다시 켜 주세요.`)
  if (versionOlder(game.pluginVersion, TACTIC_PLUGIN)) return tooOld(TACTIC_PLUGIN)
  const check = checkGameVersion(game.gameVersion)
  if (check.status !== 'ok' || !check.row) return closed(`${check.text} 그래서 게임에서 전술과 별점을 읽는 기능은 끕니다.`)
  const needed = check.row.plugin[feature]
  if (versionOlder(game.pluginVersion, needed)) return tooOld(needed)
  return { open: true, reason: '', row: check.row }
}

/**
 * 게임의 역할 값(10진 글자)에서 임무 비트를 지워 역할 번호(gameId)를 만든다. 64비트 값이라 BigInt로만 다룬다(숫자로 바꾸지 않는다).
 * 10진 정수 글자가 아니거나, 임무 비트를 지우고 남은 것이 없으면 null이다.
 */
export function roleGameId(text: string, row: SupportedVersion): string | null {
  if (typeof text !== 'string' || !/^\d{1,20}$/.test(text)) return null
  let bits = BigInt(text)
  for (const duty of row.dutyBits) bits &= ~BigInt(duty)
  return bits === 0n ? null : bits.toString()
}
