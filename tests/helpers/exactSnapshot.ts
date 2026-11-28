/**
 * 정밀 기준 결과(FMB_BASELINE_EXACT)의 순수한 부분: 분석과 후보 찾기 결과에서 반올림하지 않은 값만 뽑아 JSON으로 만든다.
 * 세이브를 읽지 않으므로 늘 시험한다(tests/baseline.test.ts의 도구 시험). 1자리 기준 결과(FMB_BASELINE)와 달리 값을 1자리로 줄이지 않아,
 * 반올림이 가리는 흔들림(끝자리가 바뀌는 계산 순서나 합성 방식의 차이)도 잡는다.
 *
 * 규칙
 * - 선수는 고유 번호(idx, uid)로만 적는다. 이름은 적지 않는다(기준 결과는 저장소 밖에 두지만 이름이 새지 않게 처음부터 뺀다).
 * - 숫자는 있는 그대로 적는다. 유한하지 않은 수(NaN, 무한)는 JSON에서 null로 바뀌어 가려지므로 만나면 멈춘다.
 * - 목록은 선수 번호나 자리 번호를 열쇠로 한 객체로 적는다(차이를 경로로 읽을 수 있게).
 */
import type { DashboardData } from '../../src/shared/dashboard'
import type { DepthPlayer } from '../../src/shared/depth'
import type { Formation } from '../../src/shared/formations'
import type { RoleNorm, RoleNorms } from '../../src/shared/norms'
import { DEFAULT_ROLE, rolesFor } from '../../src/shared/roles'
import type { SlotAnalysis, SlotGroup, TacticAnalysis } from '../../src/shared/tactic'
import type { CandidateBench, CandidateResult } from '../../src/shared/world'
import type { Json } from './baselineDiff'

/** 숫자 하나. 없으면 null이고, 유한하지 않으면 멈춘다 */
export function exact(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value)) throw new Error(`정밀 기준 결과에 유한하지 않은 수가 있습니다: ${value}`)
  return value
}

/** 주전과 후보 한 명 */
export function exactPlayer(player: DepthPlayer): Json {
  return {
    idx: player.idx,
    score: exact(player.score),
    effScore: exact(player.effScore),
    z: exact(player.z),
    rating: exact(player.rating),
    temporary: player.temporary,
    uncertain: player.uncertain
  }
}

/** 역할 하나의 기준 분포 전 항목 */
export function exactNorm(norm: RoleNorm): Json {
  return {
    mu: exact(norm.mu),
    sigma: exact(norm.sigma),
    beta: exact(norm.beta),
    betaGrow: exact(norm.betaGrow),
    n: exact(norm.n),
    caRef: exact(norm.caRef),
    poolCa: exact(norm.poolCa),
    shift: exact(norm.shift)
  }
}

/** 역할마다 기준 분포(스쿼드 결과의 roleNorms). 없으면 빈 객체 */
export function exactNorms(norms: RoleNorms | undefined): Json {
  return Object.fromEntries(Object.entries(norms ?? {}).map(([roleId, norm]) => [roleId, exactNorm(norm)]))
}

/** 영입 후보 화면이 견주는 기준(내 팀의 가장 약한 주전과 두 번째 선수). 이름은 뺀다 */
export function exactBench(bench: CandidateBench): Json {
  return {
    starter: bench.starter ? { score: exact(bench.starter.score), ca: exact(bench.starter.ca), age: exact(bench.starter.age), shownScore: exact(bench.starter.shownScore) } : null,
    backup: bench.backup ? { score: exact(bench.backup.score), shownScore: exact(bench.backup.shownScore), age: exact(bench.backup.age) } : null,
    thin: bench.thin ?? null
  }
}

/** 같은 포지션·같은 역할의 자리 묶음 */
export function exactGroup(group: SlotGroup): Json {
  return { position: group.position, role: group.roleId, slots: group.slots, need: exact(group.need), level: group.level, bench: exactBench(group.bench) }
}

/** 자리 하나: 주전과 후보, 필요도와 항목 점수, 이 자리에 맞는 내 선수들 */
export function exactSlot(slot: SlotAnalysis): Json {
  return {
    position: slot.slot.position,
    role: slot.slot.roleId,
    row: slot.slot.row,
    group: slot.group.id,
    starter: slot.slot.starter ? exactPlayer(slot.slot.starter) : null,
    backups: slot.slot.backups.map(exactPlayer),
    weak: slot.slot.weak,
    thin: slot.slot.thin,
    starterScore: exact(slot.starterScore),
    starterEff: exact(slot.starterEff),
    starterRating: exact(slot.starterRating),
    starterZ: exact(slot.starterZ),
    starterCa: exact(slot.starterCa),
    starterAge: exact(slot.starterAge),
    backupScore: exact(slot.backupScore),
    backupEff: exact(slot.backupEff),
    backupAge: exact(slot.backupAge),
    eligible: slot.eligible,
    need: exact(slot.need),
    level: slot.level,
    factors: Object.fromEntries(slot.factors.map((factor) => [factor.id, { points: exact(factor.points), max: exact(factor.max), counted: factor.counted, assumed: factor.assumed }])),
    normSource: slot.normSource,
    norm: exactNorm(slot.norm),
    options: Object.fromEntries(
      slot.options.map((option, rank) => [String(option.idx), { rank: rank + 1, score: exact(option.score), uncertain: option.uncertain, role: option.role, playable: option.playable, ca: exact(option.ca), age: exact(option.age) }])
    )
  }
}

/** 전술 분석 하나(후보 찾기 없이): 자리, 묶음, 줄 요약 */
export function exactAnalysis(analysis: TacticAnalysis): Json {
  return {
    slots: Object.fromEntries(analysis.slots.map((slot) => [String(slot.slot.index), exactSlot(slot)])),
    groups: Object.fromEntries(analysis.groups.map((group) => [group.id, exactGroup(group)])),
    lines: Object.fromEntries(
      analysis.lines.map((line) => [line.id, { slots: line.slots, fitAverage: exact(line.fitAverage), zAverage: exact(line.zAverage), needAverage: exact(line.needAverage) }])
    ),
    strongest: analysis.strongest?.id ?? null,
    weakest: analysis.weakest?.id ?? null,
    fitAverage: exact(analysis.fitAverage),
    needAverage: exact(analysis.needAverage)
  }
}

/** 후보 찾기 결과 하나(탭 하나, 자리 묶음 하나): 앞쪽 top명의 점수와 풀이 값 */
export function exactCandidates(result: CandidateResult, top: number): Json {
  const rows: Record<string, Json> = {}
  result.rows.slice(0, top).forEach((row, rank) => {
    const fit = row.recommend.fit
    rows[String(row.uid)] = {
      rank: rank + 1,
      score: exact(row.score),
      gap: exact(row.gap),
      gapEff: exact(row.gapEff),
      categories: row.categories,
      tier: row.tier,
      total: exact(row.recommend.total),
      base: exact(row.recommend.base),
      gate: exact(row.recommend.gate),
      fit: { shown: exact(fit.shown), effective: exact(fit.effective), positionPoints: exact(fit.positionPoints), positionSigma: exact(fit.positionSigma), agePoints: exact(fit.agePoints) },
      low: row.recommend.realism.low,
      components: Object.fromEntries(row.recommend.components.map((component) => [component.id, exact(component.points)]))
    }
  })
  return {
    counts: { ...result.counts },
    matched: result.matched,
    ranked: exact(result.ranked),
    need: exact(result.need),
    rows
  }
}

const keyed = <T extends { uid: number }>(list: readonly T[], value: (item: T) => Json): Json => Object.fromEntries(list.map((item) => [String(item.uid), value(item)]))

/** 대시보드의 목록들: 정리 후보, 성장 여지, 주급 과다 의심, 계약 만료, 영입 추천 */
export function exactDashboard(board: DashboardData): Json {
  const { surplus, overpaid, contracts, recommend } = board
  const model = overpaid.model
  return {
    surplus: {
      rows: keyed(surplus.rows, (row) => ({
        score: exact(row.score),
        wage: exact(row.wage),
        parts: { fit: exact(row.parts.fit), wage: exact(row.parts.wage), age: exact(row.parts.age) },
        unknown: row.unknown,
        fit: row.fit,
        slotLabel: row.slotLabel,
        fitGap: exact(row.fitGap),
        fitGapSigma: exact(row.fitGapSigma),
        bestRole: row.bestRole,
        wageZ: exact(row.wageZ)
      })),
      prospects: keyed(surplus.prospects, (row) => ({ room: exact(row.room), gain: exact(row.gain) }))
    },
    overpaid: {
      rows: keyed(overpaid.rows, (row) => ({ wage: exact(row.wage), expected: exact(row.expected), ratio: exact(row.ratio), z: exact(row.z), strong: row.strong, excess: exact(row.excess) })),
      total: overpaid.total,
      model: model ? { a: exact(model.a), b: exact(model.b), b2: exact(model.b2), c1: exact(model.c1), c2: exact(model.c2), r2: exact(model.r2), s: exact(model.s), n: exact(model.n), teams: exact(model.teams), removed: exact(model.removed) } : null
    },
    contracts: {
      known: contracts.known,
      expired: keyed(contracts.expired, (row) => ({ daysLeft: row.daysLeft, wage: exact(row.wage) })),
      within1y: keyed(contracts.within1y, (row) => ({ daysLeft: row.daysLeft, wage: exact(row.wage) })),
      within2y: keyed(contracts.within2y, (row) => ({ daysLeft: row.daysLeft, wage: exact(row.wage) })),
      wageWithin1y: exact(contracts.wageWithin1y)
    },
    recommend: {
      matched: recommend.matched,
      slot: recommend.slot
        ? {
            formation: recommend.slot.formation,
            index: recommend.slot.index,
            need: exact(recommend.slot.need),
            level: recommend.slot.level,
            groupSlots: recommend.slot.groupSlots,
            bench: exactBench(recommend.slot.bench)
          }
        : null,
      rows: keyed(recommend.rows, (row) => ({ total: exact(row.total), tier: row.tier, score: exact(row.score), gap: exact(row.gap), gapEff: exact(row.gapEff), low: row.realism.low }))
    }
  }
}

/**
 * 포메이션마다 자리 하나씩 기본이 아닌 옛 역할로 바꾼 전술들(분석만 돌린다. 후보 찾기는 하지 않는다).
 * 역할이 하나뿐인 자리(골키퍼)는 바꿀 것이 없어 뺀다. 자리의 기본 역할이 아닌 첫 역할(rolesFor 순서)을 쓴다.
 */
export function alternativeRoleVariants(formations: readonly Formation[]): Array<{ key: string; formation: string; slotRoles: Record<string, string> }> {
  const variants: Array<{ key: string; formation: string; slotRoles: Record<string, string> }> = []
  for (const formation of formations) {
    formation.rows.flat().forEach((position, index) => {
      const other = rolesFor(position).find((role) => role.id !== DEFAULT_ROLE[position])
      if (!other) return
      variants.push({ key: `${formation.id}:${index}=${other.id}`, formation: formation.id, slotRoles: { [`${formation.id}:${index}`]: other.id } })
    })
  }
  return variants
}
