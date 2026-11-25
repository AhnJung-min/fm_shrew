/**
 * 실제 내보내기 파일을 받기 전까지 쓰는 가상 스쿼드.
 * 선수 이름은 모두 지어낸 것이고, 형식은 FM26 Player Export의 설명(세미콜론 구분, 쉼표 소수)을 따른다.
 */

const POSITIONS: Array<[string, number]> = [
  ['GK', 3],
  ['D (C)', 5],
  ['D (R)', 2],
  ['D (L)', 2],
  ['DM', 2],
  ['M (C)', 4],
  ['AM (R)', 2],
  ['AM (L)', 2],
  ['AM (C)', 1],
  ['ST (C)', 3]
]

const NAMES = [
  '마르코 벨리니', '요나스 하르트만', '이든 캘러웨이', '루카 페르난드', '다비드 오소리오', '카이 린드크비스트',
  '토마스 브레너', '안드레 실베이라', '한지우', '니코 파파스', '에밀 요한손', '라파엘 몬테로',
  '오스카 델가도', '줄리앙 모로', '세르지오 아란다', '윤태성', '미켈 에체베리아', '벤 애슈포드',
  '아론 비요르크', '파블로 카스티요', '레오 반더미어', '제이든 오코예', '마테오 리치', '시몬 노바크',
  '테오 뒤부아', '알렉스 헤이우드'
]

const NATIONS = ['이탈리아', '독일', '잉글랜드', '프랑스', '콜롬비아', '스웨덴', '오스트리아', '브라질', '대한민국', '그리스', '스페인', '네덜란드', '나이지리아', '체코']

const OUTFIELD = [
  '코너킥', '크로스', '드리블', '골 결정력', '퍼스트 터치', '프리킥', '헤더', '중거리 슛', '롱 스로인', '대인 방어', '패스', '페널티킥', '태클', '개인기',
  '적극성', '예측력', '대담성', '침착성', '집중력', '판단력', '결단력', '천재성', '리더십', '오프 더 볼', '위치 선정', '팀워크', '시야', '활동량',
  '가속도', '민첩성', '밸런스', '점프 거리', '타고난 체력', '주력', '지구력', '몸싸움'
]

const HEADERS = ['이름', '포지션', '나이', '국적', '현재 능력', '잠재 능력', '주급', '계약 만료', ...OUTFIELD]

/** 포지션별로 높게 나올 능력치 */
const STRONG: Record<string, string[]> = {
  GK: ['위치 선정', '집중력', '침착성', '점프 거리', '민첩성'],
  D: ['태클', '대인 방어', '헤더', '위치 선정', '몸싸움', '점프 거리', '예측력', '대담성'],
  DM: ['태클', '패스', '위치 선정', '활동량', '팀워크', '판단력', '지구력'],
  M: ['패스', '퍼스트 터치', '시야', '판단력', '개인기', '팀워크', '활동량'],
  AM: ['드리블', '개인기', '천재성', '가속도', '주력', '크로스', '오프 더 볼', '민첩성'],
  ST: ['골 결정력', '오프 더 볼', '침착성', '가속도', '헤더', '퍼스트 터치', '예측력']
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function sampleSquadCsv(seed = 26): string {
  const rand = mulberry32(seed)
  const between = (lo: number, hi: number): number => Math.round(lo + rand() * (hi - lo))
  const lines: string[] = [HEADERS.join(';')]

  let n = 0
  for (const [position, count] of POSITIONS) {
    const family = position.split(' ')[0]
    const strong = new Set(STRONG[family] ?? [])
    for (let i = 0; i < count; i++) {
      const name = NAMES[n % NAMES.length]
      const age = between(17, 33)
      const quality = between(-2, 3)
      // 어린 선수 몇 명은 스카우트 정보가 덜 모인 것처럼 범위로 내보낸다
      const masked = age <= 19 && rand() < 0.7
      const ability = Math.max(1, Math.min(5, 2.5 + quality * 0.5 + (rand() < 0.5 ? 0 : 0.5)))
      const potential = Math.min(5, ability + (age < 23 ? between(1, 3) * 0.5 : 0))
      const wage = between(3, 30) * 1000

      const attrs = OUTFIELD.map((label) => {
        const base = strong.has(label) ? between(12, 17) : between(6, 13)
        const value = Math.max(1, Math.min(20, base + quality))
        if (masked && rand() < 0.35) {
          const lo = Math.max(1, value - 2)
          return `${lo}-${Math.min(20, lo + 3)}`
        }
        return String(value)
      })

      lines.push(
        [
          name,
          position,
          age,
          NATIONS[between(0, NATIONS.length - 1)],
          String(ability).replace('.', ','),
          String(potential).replace('.', ','),
          `₩${wage.toLocaleString('en-US')}`,
          `${between(2027, 2031)}.6.30`,
          ...attrs
        ].join(';')
      )
      n++
    }
  }
  return lines.join('\r\n')
}
