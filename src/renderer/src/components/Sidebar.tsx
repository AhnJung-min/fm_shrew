import { ClubLogo } from '@/components/ClubLogo'
import {
  Archive,
  House,
  PencilRuler,
  Scale,
  Settings as SettingsIcon,
  UserSearch,
  Users,
  type LucideIcon
} from 'lucide-react'
import type { LinkStatus } from '@shared/game'

export type Route = 'home' | 'squad' | 'targets' | 'compare' | 'editor' | 'backups' | 'settings'

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
  { id: 'home', label: '홈', hint: 'FM 연결과 세이브 고르기', icon: House },
  { id: 'squad', label: '스쿼드', hint: '내 팀 선수 능력치와 뎁스', icon: Users },
  { id: 'targets', label: '영입 후보', hint: '모든 구단에서 선수 찾기', icon: UserSearch },
  { id: 'compare', label: '선수 비교', hint: '최대 3명 나란히 보기', icon: Scale },
  { id: 'editor', label: '에디터', hint: '능력치를 고쳐 게임에 넣기', icon: PencilRuler },
  { id: 'backups', label: '백업', hint: '세이브 사본과 되돌리기', icon: Archive }
]

/** 경기장 센터 서클을 딴 표식 */
function BrandMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <rect x="1.5" y="3.5" width="23" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <line x1="13" y1="3.5" x2="13" y2="22.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="13" cy="13" r="4.2" stroke="currentColor" strokeWidth="1.6" />
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
        ? `FM 연결됨 · ${game.team}`
        : 'FM 연결됨 · 메인 메뉴'

  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark />
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

      <button className="status-card" title={data.note || '홈에서 자세히 보기'} onClick={() => onNavigate('home')}>
        <span className="status-row">
          <span className={`dot ${game.connected && !game.pluginOld ? 'on' : game.connected ? 'warn' : 'off'}`} />
          <span>{gameLine}</span>
        </span>
        <span className="status-row">
          <span className={`dot ${data.save ? (data.source === 'game' ? 'on' : 'warn') : 'off'}`} />
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
