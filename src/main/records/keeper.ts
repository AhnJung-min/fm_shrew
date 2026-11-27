import type { SaveRecords } from '@shared/records'
import { buildGrowth, growthDate, takeGrowthInput } from './growth'
import { importRatings } from './ratings'
import { RecordStore, saveLabel } from './store'
import type { SaveWorld } from '../save/world'

/**
 * 기록을 남기는 일을 한데 묶는다: 세이브를 읽으면 성장 스냅샷을 남기고, 평점 기록을 가져온다.
 * 스냅샷의 압축과 쓰기는 비동기라 세이브를 적용하는 길을 늦추지 않는다. 실패해도 앱은 그대로 돈다(콘솔에만 남긴다).
 */
export class RecordKeeper {
  constructor(
    readonly store: RecordStore,
    /** 플러그인이 평점 기록을 덧붙이는 파일 */
    private readonly pluginRatings: () => string,
    private readonly report: (error: unknown) => void = (error) => console.error('[records]', error)
  ) {}

  /**
   * 세이브를 읽은 직후에 부른다(게임의 지금 값을 덮어쓰기 전). 그 달의 스냅샷이 없으면 남기고, 평점 기록을 가져온다.
   * 반환한 Promise는 스냅샷을 다 쓰면 끝난다(앱은 기다리지 않는다. 테스트가 기다린다).
   */
  onRead(path: string, world: SaveWorld): Promise<void> {
    const label = saveLabel(path)
    this.importRatings(path, world.teamId)
    const today = world.gameDate
    try {
      if (!today || this.store.hasMonth(label, growthDate(today))) return Promise.resolve()
      const input = takeGrowthInput(world)
      const teamId = world.teamId
      return new Promise((resolve) => {
        setImmediate(() => {
          const snap = buildGrowth(input)
          if (!snap) return resolve()
          this.store
            .writeSnapshot(label, teamId, snap)
            .catch(this.report)
            .finally(resolve)
        })
      })
    } catch (error) {
      this.report(error)
      return Promise.resolve()
    }
  }

  /** 플러그인의 새 평점 기록을 이 세이브의 기록 폴더로 가져온다. 내 팀을 모르면 하지 않는다 */
  importRatings(path: string, teamId: number | null | undefined): void {
    try {
      importRatings(this.store, saveLabel(path), teamId, this.pluginRatings())
    } catch (error) {
      this.report(error)
    }
  }

  summaries(): SaveRecords[] {
    return this.store.summaries()
  }
}
