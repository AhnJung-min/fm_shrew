import { PencilRuler, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FIELDS } from '@shared/fields'
import { ROLES } from '@shared/roles'
import type { CellValue, ColumnInfo, PlayerRow, Settings } from '@shared/types'
import {
  CATEGORY_HELP,
  CATEGORY_LABEL,
  SAVE_ATTRIBUTE_ORDER,
  type CandidateCategory,
  type CandidateQuery,
  type CandidateResult,
  type CandidateRow
} from '@shared/world'
import { api } from '@/api'
import { PlayerDrawer } from '@/components/PlayerDrawer'
import { PlayerTable, sortRows, type SortState } from '@/components/PlayerTable'

const CATEGORIES: CandidateCategory[] = ['all', 'starter', 'rotation', 'prospect', 'free']

const info = (header: string, field: string, label: string, numeric: boolean): ColumnInfo => ({
  header, field, group: 'info', short: header, label, isAttr: false, numeric
})

const NAME = info('이름', 'name', '이름', false)
const KIND = info('유형', 'candidateKind', '이 선수가 드는 유형', false)
const SCORE = info('역할 점수', 'roleScore', '고른 역할의 적합도 (0~100)', true)
const GAP = info('주전 대비', 'starterGap', '내 팀에서 이 역할 점수가 가장 높은 선수와의 차이', true)
const AGE = info('나이', 'age', '나이', true)
const POSITION = info('포지션', 'position', '포지션', false)
const CLUB = info('소속 구단', 'club', '소속 구단', false)
const ABILITY = info('현재 능력', 'ability', '현재 능력 (1~200)', true)
const POTENTIAL = info('잠재 능력', 'potential', '잠재 능력 (1~200)', true)

/** 게임 화면에 보이는 능력치 열들: 기술 → 정신 → 신체 → 골키퍼 */
const ATTRIBUTE_COLUMNS: Array<{ column: ColumnInfo; index: number }> = FIELDS.filter((field) => field.isAttr).map((field) => ({
  column: { header: field.label, field: field.id, group: field.group, short: field.short, label: field.label, isAttr: true, numeric: true },
  index: SAVE_ATTRIBUTE_ORDER.indexOf(field.id as (typeof SAVE_ATTRIBUTE_ORDER)[number])
}))

const COLUMNS: ColumnInfo[] = [NAME, KIND, SCORE, GAP, AGE, POSITION, CLUB, ABILITY, POTENTIAL, ...ATTRIBUTE_COLUMNS.map((each) => each.column)]

const text = (raw: string): CellValue => ({ raw, num: null })
const number = (value: number | null, raw?: string): CellValue => (value === null ? { raw: '', num: null } : { raw: raw ?? String(value), num: value })

function toRow(row: CandidateRow, idx: number): PlayerRow {
  const cells: Record<string, CellValue> = {
    [NAME.header]: text(row.name),
    [KIND.header]: text(row.categories.map((category) => CATEGORY_LABEL[category]).join(' · ')),
    [SCORE.header]: number(row.score, String(Math.round(row.score))),
    [GAP.header]: number(row.gap, row.gap === null ? '' : `${row.gap > 0 ? '+' : ''}${row.gap.toFixed(1)}`),
    [AGE.header]: number(row.age),
    [POSITION.header]: text(row.position),
    [CLUB.header]: text(row.club || '알 수 없음'),
    [ABILITY.header]: number(row.ca),
    [POTENTIAL.header]: number(row.pa)
  }
  for (const { column, index } of ATTRIBUTE_COLUMNS) cells[column.header] = number(row.attributes[index] ?? null)
  return { idx, name: row.name, cells }
}

function benchLine(result: CandidateResult): string {
  const { starter, backup } = result.bench
  if (!starter) return '내 팀에 이 역할을 뛸 선수가 없어 비교 기준이 없습니다'
  const second = backup ? `, 두 번째 ${backup.name} ${Math.round(backup.score)}점` : ''
  return `내 팀 주전 ${starter.name} ${Math.round(starter.score)}점${second}`
}

/**
 * 세이브에 든 모든 구단의 선수를 고른 역할의 점수로 줄 세우고, 내 팀 주전과 견주어 유형별로 보여 준다.
 * 계산은 메인 프로세스가 한다(선수가 10만 명쯤이라 화면으로 다 가져오지 않는다).
 */
export function Targets(props: { settings: Settings; onEdit: (uid: number) => void }) {
  const { settings, onEdit } = props
  const [roleId, setRoleId] = useState('cb')
  const [category, setCategory] = useState<CandidateCategory>('starter')
  const [maxAge, setMaxAge] = useState('')
  const [onlyEligible, setOnlyEligible] = useState(true)
  const [includeUnknownClub, setIncludeUnknownClub] = useState(false)
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<CandidateResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortState | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const query: CandidateQuery = useMemo(
    () => ({ roleId, category, maxAge: Number(maxAge) || null, onlyEligible, includeUnknownClub, search }),
    [roleId, category, maxAge, onlyEligible, includeUnknownClub, search]
  )

  useEffect(() => {
    let alive = true
    setLoading(true)
    // 글자를 치는 동안에는 기다렸다가 한 번만 묻는다
    const timer = window.setTimeout(() => {
      void api.worldCandidates(query).then((next) => {
        if (!alive) return
        setResult(next)
        setLoading(false)
        setSelectedIdx(null)
      })
    }, 180)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // 역할 가중치를 고치면 점수가 달라지므로 다시 묻는다
  }, [query, settings.roleWeights])

  const rows = useMemo(() => (result?.rows ?? []).map(toRow), [result])
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])
  const selected = selectedIdx === null ? null : (rows.find((row) => row.idx === selectedIdx) ?? null)
  const selectedUid = selectedIdx === null ? null : (result?.rows[selectedIdx]?.uid ?? null)

  if (result && !result.ok) {
    return (
      <>
        <header className="page-head">
          <h1>영입 후보</h1>
        </header>
        <div className="page-body">
          <div className="empty" style={{ maxWidth: 560, margin: '0 auto' }}>
            <strong>세이브를 읽지 못했습니다</strong>
            <p style={{ marginTop: 8 }}>{result.message}</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <header className="page-head">
        <h1>영입 후보</h1>
        <span className="page-sub">
          {result?.saveName ? `세이브 “${result.saveName}”의 모든 구단 선수에서 찾습니다.` : '세이브를 읽는 중입니다. 몇 초 걸립니다.'}
        </span>
        <div className="spacer" />
        {result?.ok && <span className="page-sub num">{benchLine(result)}</span>}
      </header>

      <div className="toolbar">
        <label className="inline-field">
          <span className="muted">역할</span>
          <select className="field" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
            {ROLES.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
        </label>
        <div className="chips" role="group" aria-label="유형">
          {CATEGORIES.map((each) => (
            <button
              key={each}
              className="chip"
              aria-pressed={category === each}
              title={CATEGORY_HELP[each]}
              onClick={() => setCategory(each)}
            >
              {CATEGORY_LABEL[each]}
              {result?.ok && <span className="num faint"> {result.counts[each].toLocaleString()}</span>}
            </button>
          ))}
        </div>
        <label className="inline-field">
          <input
            className="field num"
            type="number"
            min={15}
            max={45}
            placeholder="나이"
            aria-label="나이 상한"
            value={maxAge}
            onChange={(event) => setMaxAge(event.target.value)}
            style={{ width: 76 }}
          />
          <span className="muted">세 이하</span>
        </label>
        <label className="search-box">
          <Search size={15} />
          <input
            className="field"
            placeholder="이름으로 찾기"
            aria-label="이름으로 찾기"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <div className="toolbar">
        <label className="inline-field">
          <input type="checkbox" checked={onlyEligible} onChange={(event) => setOnlyEligible(event.target.checked)} />
          <span>이 역할의 자리에서 뛸 수 있는 선수만</span>
        </label>
        <label className="inline-field" title="세이브에서 소속 구단을 알아내지 못한 선수들입니다. 여자 팀 선수가 섞여 있을 수 있습니다.">
          <input type="checkbox" checked={includeUnknownClub} onChange={(event) => setIncludeUnknownClub(event.target.checked)} />
          <span>구단을 알아내지 못한 선수도</span>
        </label>
        <div className="spacer" />
        <span className="page-sub num">
          {result?.ok &&
            (result.matched > result.rows.length
              ? `${CATEGORY_HELP[category]}: ${result.matched.toLocaleString()}명 중 위에서 ${result.rows.length}명`
              : `${CATEGORY_HELP[category]}: ${result.matched.toLocaleString()}명`)}
        </span>
      </div>

      <div className="table-wrap">
        {result === null || (loading && rows.length === 0) ? (
          <div className="empty" style={{ flex: 1 }}>
            <strong>세이브를 읽는 중입니다</strong>
            모든 구단의 선수를 읽느라 처음 한 번은 몇 초 걸립니다.
          </div>
        ) : sorted.length === 0 ? (
          <div className="empty" style={{ flex: 1 }}>
            <strong>조건에 맞는 선수가 없습니다</strong>
            유형을 “전체”로 바꾸거나 역할·나이 조건을 풀어 보세요.
          </div>
        ) : (
          <PlayerTable
            columns={COLUMNS}
            rows={sorted}
            density={settings.density}
            sort={sort}
            onSort={setSort}
            selectedIdx={selectedIdx}
            onSelect={(row) => setSelectedIdx(selectedIdx === row.idx ? null : row.idx)}
          />
        )}
        {selected && (
          <PlayerDrawer
            columns={COLUMNS}
            row={selected}
            onClose={() => setSelectedIdx(null)}
            action={
              selectedUid !== null && (
                <button className="btn" onClick={() => onEdit(selectedUid)}>
                  <PencilRuler size={15} />
                  에디터에서 열기
                </button>
              )
            }
          />
        )}
      </div>
    </>
  )
}
