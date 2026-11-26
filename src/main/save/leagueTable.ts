/**
 * 리그 순위표 읽기.
 *
 * 구조는 공개 해독기 fmsave(Randal S. Olson, MIT. https://github.com/rhiever/fmsave)의 26.3.2 구조 설명을 따랐고,
 * 코드는 가져오지 않았다. 실제 세이브에서 20개 팀 순위표의 승점이 승 × 3 + 무와 같고, 득점 합과 실점 합이 같고
 * (575 대 575), 승 합과 패 합이 같은 것을 확인했다. 내 팀의 리그 경기 점수도 일정 기록과 모두 같았다.
 *
 * 팀마다 "블록" 하나가 있고(같은 구간, 경기 일정과 같은 곳), 블록은 이렇게 생겼다. H는 첫 줄이 시작하는 곳.
 *   H-23 팀 번호 u32, H-19 머리 19바이트(첫 바이트는 그 표에서 이 블록의 자리 0부터)
 *   H 줄 5개(전체, 홈, 원정, 전반, 후반), 줄은 17바이트씩
 *   H+85 u16 한 쪽(홈 또는 원정) 경기 수 = 라운드 수, H+87 경기 줄 (라운드 수 × 2)개
 * - 줄: [키 u32][치른 경기 u8][같은 값 u8][승][무][패][0][득점 u16][실점 u16][승점 u16][표시 u8]
 *   처음 5줄과 아직 치르지 않은 경기 줄의 키는 0xffffffff, 치른 경기 줄의 키는 상대 팀 번호다.
 * - 경기 줄은 짝수 번이 홈, 홀수 번이 원정이다(일정 기록과 모두 맞는 것을 확인).
 * - 표 안에서 블록은 순위 순서로 놓여 있고 머리의 첫 바이트가 0, 1, 2 … 로 늘어난다. 그 숫자가 다시 0으로 돌아가는 곳이
 *   다음 표의 시작이다. 같은 표가 한 번 더(순서가 섞인 채) 들어 있어 내용이 같은 블록은 하나만 쓴다.
 */

const KEY = Buffer.from([0xff, 0xff, 0xff, 0xff])
const ROW = 17
const AGGREGATES = 5
const MATCHES_AT = 87
const MAX_ROUNDS = 40
const LOOK_BEHIND = 23

export interface TableRow {
  teamId: number
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  points: number
}

export interface LeagueTable {
  /** 순위 순서(1위부터) */
  rows: TableRow[]
  /** 한 팀이 홈에서 치르는 경기 수. 더블 리그면 팀 수 - 1 */
  roundsPerVenue: number
}

interface Block {
  teamId: number
  index: number
  roundsPerVenue: number
  total: TableRow
}

/** 줄 하나. 키가 0xffffffff인 줄이거나 이 팀의 기록으로 말이 되는 줄인지는 부르는 쪽이 본다 */
function rowAt(db: Buffer, at: number): { key: number; played: number; copy: number; won: number; drawn: number; lost: number; gf: number; ga: number; pts: number } {
  return {
    key: db.readUInt32LE(at),
    played: db[at + 4],
    copy: db[at + 5],
    won: db[at + 6],
    drawn: db[at + 7],
    lost: db[at + 8],
    gf: db.readUInt16LE(at + 10),
    ga: db.readUInt16LE(at + 12),
    pts: db.readUInt16LE(at + 14)
  }
}

/** 파일 안의 블록들을 파일에 놓인 순서대로. 내용이 같은 것은 처음 하나만 */
function readBlocks(db: Buffer): Block[] {
  const blocks: Block[] = []
  const seen = new Set<string>()
  let from = LOOK_BEHIND
  for (;;) {
    const head = db.indexOf(KEY, from)
    if (head < 0) break
    from = head + 1
    if (head + MATCHES_AT > db.length) break
    // 다섯 줄 모두 키가 0xffffffff
    let keyed = true
    for (let i = 1; i < AGGREGATES; i++) {
      if (db.readUInt32LE(head + ROW * i) !== 0xffffffff) {
        keyed = false
        break
      }
    }
    if (!keyed) continue
    const rounds = db.readUInt16LE(head + 85)
    if (rounds < 1 || rounds > MAX_ROUNDS) continue
    const end = head + MATCHES_AT + ROW * 2 * rounds
    if (end > db.length) continue

    const rows = [0, 1, 2, 3, 4].map((i) => rowAt(db, head + ROW * i))
    const total = rows[0]
    if (total.played === 0) continue
    if (rows.some((row) => row.played !== row.copy || row.played !== row.won + row.drawn + row.lost)) continue
    if (rows[1].played + rows[2].played !== total.played || rows[3].played + rows[4].played !== total.played) continue

    const teamId = db.readUInt32LE(head - LOOK_BEHIND)
    const content = `${teamId}:${db.toString('latin1', head, end)}`
    if (seen.has(content)) continue
    seen.add(content)
    blocks.push({
      teamId,
      index: db[head - 19],
      roundsPerVenue: rounds,
      total: { teamId, played: total.played, won: total.won, drawn: total.drawn, lost: total.lost, goalsFor: total.gf, goalsAgainst: total.ga, points: total.pts }
    })
  }
  return blocks
}

/** 머리의 자리 숫자가 이어지는 블록끼리 한 표로 묶는다 */
function groupBlocks(blocks: Block[]): Block[][] {
  const groups: Block[][] = []
  let current: Block[] = []
  for (const block of blocks) {
    if (current.length > 0 && block.index !== current[current.length - 1].index + 1) {
      groups.push(current)
      current = []
    }
    current.push(block)
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/**
 * 그 팀이 속한 리그의 순위표. 팀이 든 표가 여럿(컵 조별 리그, 대륙 대회 등)이면
 * 한 팀이 가장 많은 경기를 치르는 표(라운드 수가 가장 큰 것)를 리그로 본다. 찾지 못하면 null.
 */
export function findLeagueTable(db: Buffer, teamId: number): LeagueTable | null {
  let best: Block[] | null = null
  for (const group of groupBlocks(readBlocks(db))) {
    if (group.length < 2) continue
    if (!group.some((block) => block.teamId === teamId)) continue
    // 한 팀이 두 번 나오는 묶음은 표가 아니다
    if (new Set(group.map((block) => block.teamId)).size !== group.length) continue
    if (!best || group[0].roundsPerVenue > best[0].roundsPerVenue) best = group
  }
  if (!best) return null
  return { rows: best.map((block) => block.total), roundsPerVenue: best[0].roundsPerVenue }
}
