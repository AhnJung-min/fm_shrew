import { NOT_READY, simpleFailed, tacticSaveFailed, type SimpleResult, type TacticSaveResult } from '@shared/tacticApi'
import type { TacticSet } from '@shared/tacticModel'
import type { Phase2Deps } from './tacticIpc'

/**
 * 전술 묶음 저장과 설정 이전 알림 확인(빈 틀). 2단계의 U6(전환과 설정 이전)이 채운다:
 * saveTactics는 쓰는 카탈로그로 validateTacticSet을 돌려 통과한 묶음만 settings.json의 tactics[세이브 파일 이름](saveKey가 null이면 tacticsDefault)에 쓰고,
 * ackMigration은 이전 기록의 acknowledged를 참으로 만든다. 지금은 아무것도 쓰지 않고 "준비되지 않았습니다"를 돌려준다.
 */

export function saveTactics(_deps: Phase2Deps, _saveKey: string | null, _set: TacticSet): TacticSaveResult {
  return tacticSaveFailed(NOT_READY)
}

export function ackMigration(_deps: Phase2Deps): SimpleResult {
  return simpleFailed(NOT_READY)
}
