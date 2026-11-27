import type { ClubChoice } from '@shared/connect'
import { NO_TEAM, type SaveWorld } from './save/world'

/** 1군 선수가 이만큼 이상 있는 구단만 고르기 목록에 올린다(선수 없는 빈 구단과 유스 팀뿐인 구단을 뺀다) */
const MIN_SQUAD = 11
/** 구단 체급을 가늠하는 값은 현재 능력 상위 이 인원의 평균이다 */
const STRENGTH_TOP = 22

/**
 * 내 구단을 직접 고를 수 있게, 세이브의 구단 목록을 만든다(A-14).
 * 구단마다 대표 팀(1군)의 선수만 센다. 세이브 요약에 감독이 맡은 구단으로 적힌 곳은 human이고 맨 앞에 둔다.
 * 나머지는 체급(상위 22명 평균 현재 능력)이 높은 순이다. nationName은 나라 번호의 이름(게임에 물어 알아 둔 것, 모르면 빈 글자).
 */
export function clubChoices(world: SaveWorld, nationName: (nationId: number) => string): ClubChoice[] {
  const mainOf = new Map<number, number>()
  world.clubs.forEach((club, i) => {
    if (club.mainTeam !== undefined && club.mainTeam !== NO_TEAM && !mainOf.has(club.mainTeam)) mainOf.set(club.mainTeam, i)
  })
  /** 구단 순번 → 대표 팀 선수들의 현재 능력 */
  const abilities = new Map<number, number[]>()
  /** 대표 팀을 모르는 구단: 팀별 선수 수(가장 많은 팀을 대표로 본다) */
  const byTeam = new Map<number, Map<number, number>>()
  for (let k = 0; k < world.count; k++) {
    const club = world.club[k]
    if (club < 0 || !world.names[k]) continue
    const team = world.teamIds[k]
    if (mainOf.get(team) === club) {
      const list = abilities.get(club)
      if (list) list.push(world.ca[k])
      else abilities.set(club, [world.ca[k]])
    } else if (world.clubs[club].mainTeam === undefined) {
      const teams = byTeam.get(club) ?? new Map<number, number>()
      teams.set(team, (teams.get(team) ?? 0) + 1)
      byTeam.set(club, teams)
    }
  }
  const human = new Set(world.humanTeams ?? [])
  const choices: ClubChoice[] = []
  const add = (club: number, teamId: number, ca: number[]): void => {
    if (ca.length < MIN_SQUAD) return
    const info = world.clubs[club]
    const top = [...ca].sort((a, b) => b - a).slice(0, STRENGTH_TOP)
    const nationId = (info.nationFields ?? []).find((id) => id >= 0)
    choices.push({
      teamId,
      uid: info.uid,
      name: info.name,
      short: info.short,
      nation: nationId === undefined ? '' : nationName(nationId),
      women: info.women,
      players: ca.length,
      strength: Math.round(top.reduce((sum, value) => sum + value, 0) / top.length),
      human: human.has(teamId)
    })
  }
  for (const [club, ca] of abilities) add(club, world.clubs[club].mainTeam!, ca)
  // 대표 팀을 모르는 구단(팀 목록을 읽지 못한 경우)은 선수가 가장 많은 팀으로 어림한다
  for (const [club, teams] of byTeam) {
    const [teamId] = [...teams.entries()].sort((a, b) => b[1] - a[1])[0]
    const ca: number[] = []
    for (let k = 0; k < world.count; k++) if (world.club[k] === club && world.teamIds[k] === teamId && world.names[k]) ca.push(world.ca[k])
    add(club, teamId, ca)
  }
  return choices.sort((a, b) => Number(b.human) - Number(a.human) || b.strength - a.strength || a.name.localeCompare(b.name, 'ko'))
}
