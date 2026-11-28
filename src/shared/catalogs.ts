import { FM26_CATALOG } from './catalogFm26'
import { LEGACY_CATALOG, withCustomRoles, type CatalogId, type RoleCatalog } from './roleCatalog'
import type { Settings } from './types'

/**
 * 쓰는 카탈로그를 고르는 한 곳. 화면, 본체, 시험이 모두 여기서 카탈로그를 받는다.
 * FM26으로 바꾸는 것은 아래 DEFAULT_CATALOG 한 줄이다(2단계 전환 묶음의 마지막 커밋에서 한다). 그 전에는 옛 14역할이다.
 *
 * 설정의 catalog 칸이 있으면 그것이 먼저다. 'legacy14'로 두면 전환 뒤에도 옛 계산으로 돈다(화면에는 없는 되돌림 스위치).
 */
export const DEFAULT_CATALOG: CatalogId = 'legacy14'

export function catalogOf(id: CatalogId): RoleCatalog {
  return id === 'fm26' ? FM26_CATALOG : LEGACY_CATALOG
}

/** 설정이 고른 카탈로그(없거나 모르는 값이면 기본)에 사용자 역할을 얹은 것 */
export function activeCatalog(settings: Pick<Settings, 'catalog' | 'customRoles'>): RoleCatalog {
  const id = settings.catalog === 'fm26' || settings.catalog === 'legacy14' ? settings.catalog : DEFAULT_CATALOG
  return withCustomRoles(catalogOf(id), settings.customRoles ?? [])
}
