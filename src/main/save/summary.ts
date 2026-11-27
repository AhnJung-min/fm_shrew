import type { SaveWorld } from './world'

/**
 * 세이브 꾸러미의 save_game_summary(저장 목록에 보이는 요약)에는 감독이 맡은 구단의 이름과 1군 선수 이름이 글자로 들어 있다.
 * 26.3.2 세이브 하나에서 확인한 것: 글자는 [길이 u32][UTF-8] 꼴이고, 구단 이름 뒤에 선수 이름 23개가 이어진다.
 * 형식을 더 자세히 모르므로 "길이 + 글자" 모양을 모두 뽑아, 선수 이름과 겹치는 팀을 사람이 맡은 팀으로 본다(구단 고르기에서 먼저 보여 주는 용도).
 */

/** 글자 하나의 길이 한도(바이트) */
const MAX_STRING = 80

/** 요약에서 "길이 + UTF-8 글자" 모양의 글자를 모두 뽑는다. 깨진 곳은 건너뛴다. */
export function summaryStrings(summary: Buffer): string[] {
  const found: string[] = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let at = 0
  while (at + 5 <= summary.length) {
    const length = summary.readUInt32LE(at)
    if (length >= 2 && length <= MAX_STRING && at + 4 + length <= summary.length) {
      try {
        const text = decoder.decode(summary.subarray(at + 4, at + 4 + length))
        // 줄바꿈 같은 제어 문자가 섞여 있으면 글자가 아니다
        if (!/[\u0000-\u001f]/.test(text)) {
          found.push(text)
          at += 4 + length
          continue
        }
      } catch {
        // 글자가 아니다. 한 바이트 뒤에서 다시 본다
      }
    }
    at++
  }
  return found
}

/** 사람이 맡은 것으로 보려면 팀의 선수 이름이 요약에 이만큼은 있어야 한다(요약에는 1군 선수가 20명 남짓 적힌다) */
const MIN_NAME_HITS = 8

/**
 * 요약에 이름이 가장 많이 겹치는 팀(들). 겹친 선수가 MIN_NAME_HITS명 이상이고 가장 많이 겹친 팀의 절반 이상인 팀만, 많이 겹친 순서로.
 * 선수 이름만 보므로 구단 이름과 겹치는 글자는 세지 않는다.
 */
export function humanTeamsOf(world: Pick<SaveWorld, 'count' | 'names' | 'teamIds'>, strings: string[]): number[] {
  const wanted = new Set(strings)
  const hits = new Map<number, number>()
  for (let k = 0; k < world.count; k++) {
    const name = world.names[k]
    if (!name || !wanted.has(name) || world.teamIds[k] === 0xffffffff) continue
    hits.set(world.teamIds[k], (hits.get(world.teamIds[k]) ?? 0) + 1)
  }
  const best = Math.max(0, ...hits.values())
  if (best < MIN_NAME_HITS) return []
  return [...hits.entries()]
    .filter(([, count]) => count >= MIN_NAME_HITS && count * 2 >= best)
    .sort((a, b) => b[1] - a[1])
    .map(([team]) => team)
}
