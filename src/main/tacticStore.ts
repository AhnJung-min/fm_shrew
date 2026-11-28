import { activeCatalog } from '@shared/catalogs'
import { simpleFailed, tacticSaveFailed, type SimpleResult, type TacticSaveResult } from '@shared/tacticApi'
import { saveKeyOf, validateTacticSet, type Tactic, type TacticSet } from '@shared/tacticModel'
import type { Settings } from '@shared/types'
import type { Phase2Deps } from './tacticIpc'

/**
 * 전술 묶음 저장과 설정 이전 알림 확인(2단계 U6).
 * 화면은 전술을 이 창구(tacticsSave, migrationAck)로만 쓴다. 화면이 보낸 settings:set에서는 전술 열쇠를 버리므로(MAIN_OWNED_KEYS),
 * 오래된 설정 객체를 통째로 보내도 전술이 사라지지 않고, 저장은 여기서 검사를 통과한 묶음만 설정 파일에 쓴다.
 */

type StoreDeps = Pick<Phase2Deps, 'settings'>

/** 검사를 통과한 전술에서 아는 칸만 옮겨 담는다(화면이 보낸 엉뚱한 칸이 설정 파일에 남지 않게) */
function cleanTactic(tactic: Tactic): Tactic {
  const spot = (each: Tactic['slots'][number]['ip']): Tactic['slots'][number]['ip'] => ({ cell: { line: each.cell.line, lane: each.cell.lane }, roleId: each.roleId })
  return {
    id: tactic.id,
    name: tactic.name,
    preset: tactic.preset,
    slots: tactic.slots.map((slot) => ({ ip: spot(slot.ip), oop: spot(slot.oop) })),
    sharePct: tactic.sharePct,
    source: tactic.source,
    catalog: tactic.catalog
  }
}

/**
 * 전술 묶음을 저장한다. 쓰는 카탈로그로 validateTacticSet(전술 1~3개, 주 전술, 전술마다 오류 없음)을 통과해야 한다:
 * 4번째 전술이나 검사에 걸린 전술은 이유(problems)와 함께 거절하고 설정은 바뀌지 않는다. 게임에서 확인하지 못한 칸의 알림(level 'note')은 막지 않는다.
 * saveKey는 세이브 파일 이름(경로가 오면 파일 이름만 쓴다)이고 설정의 tactics[세이브 파일 이름]에 쓴다. null이면 모든 세이브의 기본 묶음(tacticsDefault)이다.
 */
export function saveTactics(deps: StoreDeps, saveKey: string | null, set: TacticSet): TacticSaveResult {
  const key = saveKey === null ? null : saveKeyOf(saveKey)
  if (saveKey !== null && key === null) return tacticSaveFailed('세이브 파일 이름이 올바르지 않아 전술을 저장하지 못했습니다.')
  const current = deps.settings.get()
  const problems = validateTacticSet(set, activeCatalog(current))
  if (problems.length > 0) {
    const more = problems.length > 1 ? ` 고칠 곳이 모두 ${problems.length}곳입니다.` : ''
    return { ok: false, message: `전술을 저장하지 못했습니다. ${problems[0].message}${more}`, problems }
  }
  const clean: TacticSet = { catalog: set.catalog, tactics: set.tactics.map(cleanTactic), mainId: set.mainId }
  // 손으로 고친 설정 파일의 tactics가 객체가 아니어도(배열, 글자) 그것을 풀어 쓰지 않는다
  const others = typeof current.tactics === 'object' && current.tactics !== null && !Array.isArray(current.tactics) ? current.tactics : {}
  const patch: Partial<Settings> = key === null ? { tacticsDefault: clean } : { tactics: { ...others, [key]: clean } }
  try {
    return { ok: true, problems: [], settings: deps.settings.set(patch) }
  } catch (error) {
    // 오류 내용(파일 경로가 들어 있을 수 있다)은 콘솔에만 남기고 화면에는 주지 않는다(N-03)
    console.error('[tactics:save]', error)
    return tacticSaveFailed('설정 파일에 쓰지 못해 전술을 저장하지 못했습니다. 디스크 공간과 폴더 권한을 확인해 주세요.')
  }
}

/**
 * 설정 이전 알림을 확인했다고 적는다(화면이 알림을 한 번 보인 뒤 부른다. 다시 불러도 같다).
 * 설정 파일이 깨져 기본값으로 시작했다는 알림(settingsProblem)도 같은 확인으로 지운다: 지우는 길이 이것 하나뿐이고, 그대로 두면 켤 때마다 다시 보인다.
 */
export function ackMigration(deps: StoreDeps): SimpleResult {
  const current = deps.settings.get()
  const patch: Partial<Settings> = {}
  if (current.migration && current.migration.acknowledged !== true) patch.migration = { ...current.migration, acknowledged: true }
  if (current.settingsProblem) patch.settingsProblem = undefined
  if (Object.keys(patch).length === 0) return { ok: true, settings: current }
  try {
    return { ok: true, settings: deps.settings.set(patch) }
  } catch (error) {
    console.error('[settings:ackMigration]', error)
    return simpleFailed('설정 파일에 쓰지 못해 확인을 기록하지 못했습니다. 디스크 공간과 폴더 권한을 확인해 주세요.')
  }
}
