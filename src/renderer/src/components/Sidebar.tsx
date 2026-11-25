import {
  Archive,
  House,
  MessageSquareText,
  Scale,
  Settings as SettingsIcon,
  UserSearch,
  Users,
  type LucideIcon
} from 'lucide-react'
import type { AppStatus } from '@shared/types'

export type Route = 'home' | 'squad' | 'targets' | 'compare' | 'talk' | 'backups' | 'settings'

interface NavEntry {
  id: Route | null
  label: string
  icon: LucideIcon
  /** 아직 만들지 않은 화면이면 몇 단계에서 나오는지 */
  later?: string
}

const ENTRIES: NavEntry[] = [
  { id: 'home', label: '홈', icon: House },
  { id: 'squad', label: '스쿼드', icon: Users },
  { id: 'targets', label: '영입 후보', icon: UserSearch },
  { id: 'compare', label: '선수 비교', icon: Scale },
  { id: 'talk', label: '토크 도우미', icon: MessageSquareText },
  { id: 'backups', label: '백업', icon: Archive }
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

export function Sidebar(props: { route: Route; onNavigate: (route: Route) => void; status: AppStatus | null }) {
  const { route, onNavigate, status } = props
  const watching = (status?.watchDirs.filter((d) => d.exists).length ?? 0) + (status?.saveDir.exists ? 1 : 0)

  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark />
        <span>FM 보좌관</span>
      </div>

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
              <Icon size={18} />
              <span className="nav-label">{entry.label}</span>
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
          <SettingsIcon size={18} />
          <span className="nav-label">설정</span>
        </button>
      </nav>

      <div className="watch-state" title={status?.watchDirs.map((d) => d.dir).join('\n')}>
        <span className={`dot ${watching > 0 ? 'on' : 'off'}`} />
        <span>
          {status === null
            ? '상태 확인 중'
            : watching > 0
              ? '세이브와 내보내기를 지켜보는 중'
              : '지켜볼 폴더가 없습니다. 설정에서 지정하세요.'}
        </span>
      </div>
    </aside>
  )
}
