/**
 * 고정 세이브를 앱과 같은 길로 열고, 포메이션의 자리 묶음마다 후보 찾기 요청을 만든다.
 * 기준 결과 대조(tests/baseline.test.ts)와 민감도 검사(tests/sensitivity.test.ts)가 함께 쓴다.
 * 역할 가중치는 언제나 기본값이고 사용자 설정은 읽지 않는다. 이름 저장소는 임시 폴더를 쓴다.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardService } from '../../src/main/dashboardService'
import { SeasonService } from '../../src/main/seasonService'
import { WorldService } from '../../src/main/worldService'
import { type SlotGroup } from '../../src/shared/tactic'
import { type CandidateCategory, type CandidateQuery } from '../../src/shared/world'

export interface BaselineWorld {
  ws: WorldService
  dash: DashboardService
  /** 대시보드가 읽는 설정 가운데 바뀌는 것(포메이션) */
  state: { formation: string }
  /** 세이브를 읽는 데 걸린 ms */
  readMs: number
}

/** 세이브 하나를 적용하고 주급 모델까지 준비한 세계를 만든다(읽는 데 4초쯤 걸린다) */
export async function openBaselineWorld(save: string, team: number): Promise<BaselineWorld> {
  const namesDir = mkdtempSync(join(tmpdir(), 'fmb-baseline-names-'))
  let dash: DashboardService | null = null
  const state = { formation: '4-2-3-1' }
  const ws = new WorldService({
    knownTeam: () => team,
    rosterNames: () => [],
    rememberTeam: () => undefined,
    roleWeights: () => ({}),
    wageModel: () => dash?.currentWageModel() ?? null,
    namesDir
  })
  const readStart = performance.now()
  ws.apply(save)
  const readMs = performance.now() - readStart
  const world = ws.world!
  const season = new SeasonService({ current: () => ({ path: save, world }), namesDir })
  dash = new DashboardService({ world: ws, season, settings: () => ({ formation: state.formation, slotRoles: {}, roleWeights: {} }), namesDir })
  await dash.prepareWageModel()
  return { ws, dash, state, readMs }
}

/** 자리 묶음 하나, 유형 하나의 후보 찾기 요청. widest가 참이면 자격 없는 선수와 소속 모르는 구단 선수도 넣는 가장 넓은 조건 */
export function groupQuery(group: SlotGroup, formation: string, category: CandidateCategory, widest = false): CandidateQuery {
  return {
    roleId: group.roleId,
    category,
    maxAge: null,
    onlyEligible: !widest,
    includeUnknownClub: widest,
    search: '',
    expiringWithinMonths: null,
    slot: { formation, slotRoles: {}, index: group.slots[0] }
  }
}
