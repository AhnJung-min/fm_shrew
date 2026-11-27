import { ClubLogo } from '@/components/ClubLogo'
import {
  Archive,
  House,
  LayoutDashboard,
  PencilRuler,
  Scale,
  Settings as SettingsIcon,
  UserSearch,
  Users,
  type LucideIcon
} from 'lucide-react'
import type { LinkStatus } from '@shared/game'

export type Route = 'dashboard' | 'home' | 'squad' | 'targets' | 'compare' | 'editor' | 'backups' | 'settings'

interface NavEntry {
  id: Route | null
  label: string
  /** 이 화면에서 하는 일(메뉴 아래 작은 글씨) */
  hint: string
  icon: LucideIcon
  /** 아직 만들지 않은 화면이면 몇 단계에서 나오는지 */
  later?: string
}

const ENTRIES: NavEntry[] = [
  { id: 'dashboard', label: '대시보드', hint: '구단 현황과 할 일', icon: LayoutDashboard },
  { id: 'home', label: '시작', hint: 'FM 연결과 세이브 고르기', icon: House },
  { id: 'squad', label: '스쿼드', hint: '내 팀 선수 능력치와 뎁스', icon: Users },
  { id: 'targets', label: '영입 후보', hint: '모든 구단에서 선수 찾기', icon: UserSearch },
  { id: 'compare', label: '선수 비교', hint: '최대 3명 나란히 보기', icon: Scale },
  { id: 'editor', label: '에디터', hint: '능력치를 고쳐 게임에 넣기', icon: PencilRuler },
  { id: 'backups', label: '백업', hint: '세이브 사본과 되돌리기', icon: Archive }
]

/**
 * 로고: 전술판의 한 수. 선수(O)에서 출발한 패스(노란 화살표)가 공격수(X)에게 닿는다.
 * 분필 선만 쓰고 패스 화살표만 노랑이다. 구단이나 FM의 상표를 쓰지 않는다. 24px 이상에서 쓴다.
 */
export function BrandMark(props: { size?: number }) {
  const size = props.size ?? 32
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none" aria-hidden="true">
      <rect width="256" height="256" rx="56" fill="var(--raised)" />
      <g transform="translate(37 34) scale(0.72)" strokeLinecap="round" strokeLinejoin="round">
        <g stroke="currentColor" strokeWidth="26">
          <circle cx="58" cy="198" r="30" />
          <path d="M172 32L224 84M224 32L172 84" />
        </g>
        <path d="M97 160Q138 154 144 132" stroke="var(--gold)" strokeWidth="22" />
        <path d="M154 102L128 130L160 140Z" fill="var(--gold)" stroke="var(--gold)" strokeWidth="5" />
      </g>
    </svg>
  )
}

export function Sidebar(props: { route: Route; onNavigate: (route: Route) => void; link: LinkStatus }) {
  const { route, onNavigate, link } = props
  const { game, data } = link
  const gameLine = !game.connected
    ? 'FM이 꺼져 있습니다'
    : game.pluginOld
      ? 'FM을 다시 켜야 합니다(플러그인 옛 버전)'
      : game.loaded
        ? `FM 연결됨 (${game.team})`
        : 'FM 연결됨 (메인 메뉴)'

  // FM이 꺼져 있거나 세이브 파일 값을 쓰는 것은 평소 상태라 중립 점으로 두고, 옛 플러그인 같은 진짜 문제만 주황으로 알린다
  const gameDot = game.connected && !game.pluginOld ? 'on' : game.connected ? 'warn' : 'idle'
  const saveDot = data.save && data.source === 'game' ? 'on' : data.save && game.connected ? 'warn' : 'idle'
  const saveLine = data.save
    ? `${data.save.name}: ${data.source === 'game' ? '게임의 지금 값을 쓰는 중' : '세이브에 저장된 값을 쓰는 중'}`
    : '적용한 세이브 없음'

  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark size={34} />
        <span>FM 보좌관</span>
      </div>
      {data.club && (
        <div className="sidebar-club" title="적용한 세이브의 내 구단">
          <ClubLogo uid={data.clubUid} size={28} />
          <span>{data.club}</span>
        </div>
      )}

      <nav className="nav" aria-label="화면">
        {ENTRIES.map((entry) => {
          const Icon = entry.icon
          return (
            <button
              key={entry.label}
              className="nav-item"
              disabled={entry.id === null}
              aria-current={entry.id === route ? 'page' : undefined}
              title={entry.later ? `${entry.label}: ${entry.later}에서 추가됩니다` : entry.label}
              onClick={() => entry.id && onNavigate(entry.id)}
            >
              <Icon size={19} />
              <span className="nav-text">
                <span className="nav-label">{entry.label}</span>
                <span className="nav-hint">{entry.hint}</span>
              </span>
              {entry.later && <span className="nav-later">{entry.later}</span>}
            </button>
          )
        })}
        <div className="nav-divider" />
        <button
          className="nav-item"
          aria-current={route === 'settings' ? 'page' : undefined}
          title="설정"
          onClick={() => onNavigate('settings')}
        >
          <SettingsIcon size={19} />
          <span className="nav-text">
            <span className="nav-label">설정</span>
            <span className="nav-hint">AI 키, 역할 가중치</span>
          </span>
        </button>
      </nav>

      <button className="status-card" title={data.note || '시작 화면에서 자세히 보기'} onClick={() => onNavigate('home')}>
        <span className="status-row">
          <span className={`dot ${gameDot}`} role="img" aria-label={gameLine} title={gameLine} />
          <span>{gameLine}</span>
        </span>
        <span className="status-row">
          <span className={`dot ${saveDot}`} role="img" aria-label={saveLine} title={saveLine} />
          <span>
            {data.save ? (
              <>
                <span className="status-save">{data.save.name}</span>
                <span className="status-sub">{data.source === 'game' ? '게임의 지금 값을 쓰는 중' : '세이브에 저장된 값을 쓰는 중'}</span>
              </>
            ) : (
              '적용한 세이브 없음'
            )}
          </span>
        </span>
      </button>
    </aside>
  )
}
