import { NOT_READY, normsFailed, simpleFailed, tacticSaveFailed } from '@shared/tacticApi'
import type { Api, Settings } from '@shared/types'

/**
 * 미리보기(`npm run web`)의 전술 창구 목업(빈 틀). 2단계의 U7(화면 전환)이 채운다: 전술 저장은 설정 상태에 쓰고,
 * 기준 분포는 미리보기용 대신 값으로 주고, 이전 알림 확인은 한 번만 뜨게 한다.
 * 지금은 아무것도 바꾸지 않고 "준비되지 않았습니다"를 돌려준다(던지지 않는다).
 */
export function mockTacticsApi(_state: { getSettings(): Settings; setSettings(next: Settings): void }): Pick<Api, 'tacticsSave' | 'worldNorms' | 'migrationAck'> {
  return {
    tacticsSave: async () => tacticSaveFailed(NOT_READY),
    worldNorms: async () => normsFailed(NOT_READY),
    migrationAck: async () => simpleFailed(NOT_READY)
  }
}
