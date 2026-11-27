import { X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { GROUP_LABEL } from '@shared/fields'
import { footSummary, formatDate, growthRoom, HIDDEN_HELP, hiddenBand } from '@shared/playerView'
import type { CellValue, ColumnGroup, ColumnInfo, PlayerRow } from '@shared/types'
import type { PlayerProfile, SaveAttributeId } from '@shared/world'
import { api } from '@/api'
import { AttributeColumns } from '@/components/AttributeColumns'
import { ClubLogo } from '@/components/ClubLogo'
import { MetaLine } from '@/components/MetaLine'
import { PlayerFace } from '@/components/PlayerFace'
import { PositionMap } from '@/components/PositionMap'
import { attrBand, attrText, attrTitle, plainText } from '@/lib/format'
import '@/styles/player.css'

const ATTR_GROUPS: ColumnGroup[] = ['technical', 'mental', 'physical', 'goalkeeping']
const BAND_WORD: Record<string, string> = { a1: '나쁨', a2: '보통', a3: '좋음', a4: '매우 좋음' }

/** 선수 한 명의 상세. 게임의 선수 프로필처럼 능력치를 묶음별로 나란히 보여 준다. */
export interface DrawerCompare {
  included: boolean
  count: number
  full: boolean
  onToggle: () => void
  onOpen: () => void
}

type Loaded = { uid: number; profile: PlayerProfile | null }

export function PlayerDrawer(props: {
  columns: ColumnInfo[]
  row: PlayerRow
  onClose: () => void
  /** 선수 비교에 담는 버튼을 보여 줄 때만 넘긴다 */
  compare?: DrawerCompare
  /** 그 밖에 이 선수로 할 수 있는 일(버튼) */
  action?: ReactNode
  /**
   * 세이브에서 이 선수를 찾는 번호. 넘기지 않으면 행 번호(스쿼드 표에서는 선수 번호와 같다)를 쓴다.
   * null이면 표에 있는 값만 보여 준다.
   */
  uid?: number | null
}) {
  const { columns, row, onClose, compare, action } = props
  const uid = props.uid === undefined ? row.idx : props.uid

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  useEffect(() => {
    if (uid === null) return
    let cancelled = false
    api
      .worldProfile(uid)
      .then((profile) => !cancelled && setLoaded({ uid, profile }))
      .catch(() => !cancelled && setLoaded({ uid, profile: null }))
    return () => {
      cancelled = true
    }
  }, [uid])

  const profile = loaded && loaded.uid === uid ? loaded.profile : null
  const waiting = uid !== null && !(loaded && loaded.uid === uid)

  const byField = (field: string): string | undefined => {
    const col = columns.find((c) => c.field === field)
    return col ? row.cells[col.header]?.raw || undefined : undefined
  }
  const cellOf = (field: string): CellValue | undefined => {
    const col = columns.find((c) => c.field === field)
    return col ? row.cells[col.header] : undefined
  }
  const ranged = columns.some((col) => col.isAttr && row.cells[col.header]?.range)

  const headline = profile
    ? [
        profile.position,
        profile.age !== null && `${profile.age}세`,
        profile.club && (
          <span key="club" className="with-logo">
            <ClubLogo uid={profile.clubUid} size={18} />
            {profile.club}
            {profile.loanedTo ? ` (임대 중: ${profile.loanedTo})` : ''}
          </span>
        )
      ]
    : [byField('position'), byField('age') && `${byField('age')}세`, byField('nationality')]

  return (
    <aside className="drawer player-drawer" aria-label={`${row.name} 상세`}>
      <div className="drawer-head">
        <PlayerFace uid={uid} name={row.name} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{profile?.name ?? row.name}</h2>
          <p className="muted">
            <MetaLine items={headline} />
          </p>
        </div>
        <button className="btn ghost icon" onClick={onClose} aria-label="상세 닫기" title="닫기">
          <X size={18} />
        </button>
      </div>

      <div className="drawer-body pl-body">
        {waiting && <p className="faint pl-wait">선수 정보를 불러오는 중입니다.</p>}
        {profile ? (
          <Profile profile={profile} rangeOf={(id) => (cellOf(id)?.range ? cellOf(id) : undefined)} />
        ) : (
          !waiting && <Basic columns={columns} row={row} />
        )}
        {ranged && <p className="faint pl-note">점선 밑줄이 있는 값은 스카우트 정보가 부족해 범위로 나온 능력치입니다.</p>}
      </div>

      {(compare || action) && (
        <div className="pl-foot">
          {compare && (
            <>
              <button
                className="btn"
                disabled={!compare.included && compare.full}
                onClick={compare.onToggle}
                title={!compare.included && compare.full ? '비교는 세 명까지 담을 수 있습니다' : undefined}
              >
                {compare.included ? '비교에서 빼기' : '비교에 담기'}
              </button>
              {compare.count > 0 && (
                <button className="btn ghost" onClick={compare.onOpen}>
                  비교 보기 ({compare.count}명)
                </button>
              )}
            </>
          )}
          {action}
        </div>
      )}
    </aside>
  )
}

function Profile(props: { profile: PlayerProfile; rangeOf: (id: string) => CellValue | undefined }) {
  const { profile, rangeOf } = props
  const room = growthRoom(profile.ca, profile.pa)
  const foot = footSummary(profile.foot.left, profile.foot.right)
  const unknown = <span className="faint">정보 없음</span>
  const info: Array<[string, ReactNode]> = [
    ['나이', profile.age !== null ? `${profile.age}세` : unknown],
    ['생년월일', profile.birth ? formatDate(profile.birth) : unknown],
    ['국적', profile.nation || unknown],
    [
      '소속',
      profile.club ? (
        <span className="with-logo">
          <ClubLogo uid={profile.clubUid} size={18} />
          {profile.club}
          {profile.loanedTo ? ` (임대 중: ${profile.loanedTo})` : ''}
        </span>
      ) : (
        unknown
      )
    ],
    ['몸값', profile.value || unknown],
    ['주급', profile.wage || unknown],
    ['계약 만료', profile.contractEnd ? formatDate(profile.contractEnd) : unknown],
    ['계약상 입지', profile.squadStatus || unknown],
    ['주발', `${foot.main} (${foot.mainNote})`],
    ['약발', foot.weak ? `${foot.weak} (${foot.weakNote})` : '없음']
  ]

  return (
    <>
      {profile.source === 'save' && profile.sourceNote && <p className="pl-source">{profile.sourceNote}</p>}

      <section className="pl-ability" aria-label="능력">
        <div className="pl-score">
          <span className="pl-score-label">현재 능력</span>
          <b className="pl-score-num">{profile.ca}</b>
          <span className="pl-bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (profile.ca / 200) * 100)}%` }} />
          </span>
        </div>
        <div className="pl-score pot">
          <span className="pl-score-label">잠재 능력</span>
          <b className="pl-score-num">{profile.pa}</b>
          <span className="pl-bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (profile.pa / 200) * 100)}%` }} />
          </span>
        </div>
        <p className="pl-scale">두 값 모두 최대 200입니다. 잠재 능력은 이 선수가 앞으로 도달할 수 있는 한계입니다.</p>
        {room !== null && <p className="pl-room">성장 여지 +{room}</p>}
      </section>

      <section aria-label="기본 정보">
        <dl className="pl-info">
          {info.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="pl-note">
          {profile.moneyFrom === 'game'
            ? '몸값과 주급은 게임이 보여 주는 금액입니다.'
            : '몸값과 주급은 세이브에 적힌 기준 금액(파운드)을 원화로 바꿔(1파운드 = 1,920원) 보여 줍니다.'}
        </p>
      </section>

      <section aria-label="능력치">
        <h3 className="pl-h">능력치</h3>
        <AttributeColumns mode="view" attributes={profile.attributes} rangeOf={rangeOf} />
        <p className="pl-legend">
          {(['a1', 'a2', 'a3', 'a4'] as const).map((band, i) => (
            <span key={band}>
              <span className={`attr-chip ${band}`}>{['1~5', '6~10', '11~15', '16~20'][i]}</span> {['약함', '보통', '좋음', '뛰어남'][i]}
            </span>
          ))}
        </p>
      </section>

      <section aria-label="포지션">
        <h3 className="pl-h">포지션별 소화 능력</h3>
        <PositionMap ratings={profile.positions} />
      </section>

      <section aria-label="숨은 능력치">
        <h3 className="pl-h">숨은 능력치</h3>
        <p className="pl-note first">게임 화면에는 나오지 않지만 선수의 활약과 부상에 영향을 주는 값입니다.</p>
        <ul className="pl-hidden">
          {profile.hidden.map((each) => {
            const help = HIDDEN_HELP[each.id as SaveAttributeId]
            const band = hiddenBand(each.value, help?.higherIsBetter ?? true)
            return (
              <li key={each.id}>
                <div>
                  <b>{each.label}</b>
                  {help && <span className="faint">{help.help}</span>}
                </div>
                <span className="pl-hidden-val">
                  <span className={`attr-chip ${band}`}>{each.value}</span>
                  <span className="pl-hidden-word">{BAND_WORD[band]}</span>
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}

/** 정보를 불러오지 못했을 때: 표에 있는 값만 묶음별로 보여 준다 */
function Basic(props: { columns: ColumnInfo[]; row: PlayerRow }) {
  const { columns, row } = props
  const facts = columns.filter((col) => !col.isAttr && col.field !== 'name' && row.cells[col.header]?.raw)
  return (
    <>
      <dl className="facts">
        {facts.map((col) => (
          <div key={col.header} style={{ display: 'contents' }}>
            <dt>{col.label}</dt>
            <dd className="num">{plainText(row.cells[col.header])}</dd>
          </div>
        ))}
      </dl>
      {ATTR_GROUPS.map((group) => {
        const cols = columns.filter((col) => col.isAttr && col.group === group)
        if (cols.length === 0) return null
        return (
          <section className="attr-group" key={group}>
            <h3>{GROUP_LABEL[group]}</h3>
            <dl className="attr-list">
              {cols.map((col) => {
                const cell = row.cells[col.header]
                return (
                  <div key={col.header} title={attrTitle(col.label, cell)}>
                    <dt>{col.label}</dt>
                    <dd>
                      <span className={`attr-chip ${attrBand(cell?.num ?? null)} ${cell?.range ? 'ranged' : ''}`}>{attrText(cell)}</span>
                    </dd>
                  </div>
                )
              })}
            </dl>
          </section>
        )
      })}
    </>
  )
}
