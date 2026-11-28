import type { IpcMain } from 'electron'
import type { CustomRole } from '@shared/roleCatalog'
import type { SlotProfile } from '@shared/slotProfile'
import {
  normsFailed,
  roleBundlePreviewFailed,
  roleStarFailed,
  simpleFailed,
  TACTIC_CHANNELS,
  tacticImportFailed,
  tacticRecommendFailed,
  tacticSaveFailed,
  type NormsResult
} from '@shared/tacticApi'
import type { Tactic, TacticSet } from '@shared/tacticModel'
import type { GameLink } from './gameLink'
import { importTactic } from './tacticImportService'
import { applyRoleBundle, exportRoleBundle, previewRoleBundle, saveCustomRoles } from './roleShareService'
import { checkRoleStars } from './roleStarService'
import { recommendTactics } from './tacticSearchService'
import { ackMigration, saveTactics } from './tacticStore'
import type { SettingsStore } from './settings'
import type { WorldService } from './worldService'

/**
 * 2단계 새 창구(전술 저장, 기준 분포, 게임 전술 가져오기, 전술 추천, 사용자 역할과 가중치 묶음, 별점 대조, 이전 알림 확인)를 등록한다.
 * 이 파일은 받은 값을 가볍게 걸러 서비스 함수로 넘기기만 한다. 검사와 계산은 서비스가 한다(채우는 단위는 아래 서비스 파일 머리에 있다).
 * 채널 이름은 shared/tacticApi.ts의 TACTIC_CHANNELS이고, preload와 목업이 같은 이름을 쓰는지는 tests/phase2Contract.test.ts가 본다.
 */

/** 새 창구의 서비스들이 함께 받는 것 */
export interface Phase2Deps {
  settings: SettingsStore
  world: WorldService
  link: GameLink
  /** 프로파일마다 기준 분포. 처음에는 "준비 중"을 돌려주고, 본체가 world.normsFor로 잇는다 */
  norms(profiles: SlotProfile[]): NormsResult
  /** 저장 대화상자를 열어 고른 경로를 준다. 취소하면 null. 파일 경로는 화면이 주지 않는다(N-03) */
  pickSavePath(defaultName: string): Promise<string | null>
  /** 열기 대화상자를 열어 고른 경로를 준다. 취소하면 null */
  pickOpenPath(): Promise<string | null>
  /** 앱 데이터 폴더 */
  dataDir: string
}

/** 서비스가 예기치 않게 실패했을 때 화면에 주는 글. 오류 내용은 콘솔에만 남긴다(N-03) */
const FAILED_MESSAGE = '처리하지 못했습니다. 잠시 뒤에 다시 해 주세요.'

/** 창구 하나를 등록한다. 서비스가 던져도 화면에는 실패 결과를 주고, 처리하지 못한 요청이 화면의 창구를 깨뜨리지 않게 한다 */
function register<R>(ipc: IpcMain, channel: string, failed: (message: string) => R, run: (...args: unknown[]) => R | Promise<R>): void {
  ipc.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await run(...args)
    } catch (error) {
      console.error(`[${channel}]`, error)
      return failed(FAILED_MESSAGE)
    }
  })
}

const asList = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

export function registerTacticIpc(ipc: IpcMain, deps: Phase2Deps): void {
  register(ipc, TACTIC_CHANNELS.tacticsSave, tacticSaveFailed, (saveKey, set) =>
    saveTactics(deps, typeof saveKey === 'string' && saveKey.length > 0 ? saveKey : null, set as TacticSet)
  )
  register(ipc, TACTIC_CHANNELS.worldNorms, normsFailed, (profiles) => deps.norms(asList<SlotProfile>(profiles)))
  register(ipc, TACTIC_CHANNELS.tacticImport, tacticImportFailed, (options) =>
    importTactic(deps, options && typeof options === 'object' && (options as { readRoleLists?: unknown }).readRoleLists === true ? { readRoleLists: true } : {})
  )
  register(ipc, TACTIC_CHANNELS.tacticRecommend, tacticRecommendFailed, (tactic) => recommendTactics(deps, tactic as Tactic))
  register(ipc, TACTIC_CHANNELS.customRolesSave, simpleFailed, (roles) => saveCustomRoles(deps, asList<CustomRole>(roles)))
  register(ipc, TACTIC_CHANNELS.roleBundleExport, simpleFailed, () => exportRoleBundle(deps))
  register(ipc, TACTIC_CHANNELS.roleBundlePreview, roleBundlePreviewFailed, () => previewRoleBundle(deps))
  register(ipc, TACTIC_CHANNELS.roleBundleApply, simpleFailed, (token, mode) =>
    applyRoleBundle(deps, typeof token === 'string' ? token : '', mode === 'replace' ? 'replace' : 'merge')
  )
  register(ipc, TACTIC_CHANNELS.roleStarCheck, roleStarFailed, () => checkRoleStars(deps))
  register(ipc, TACTIC_CHANNELS.migrationAck, simpleFailed, () => ackMigration(deps))
}
