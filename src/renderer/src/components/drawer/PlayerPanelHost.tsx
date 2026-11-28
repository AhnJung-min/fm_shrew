import type { ReactElement } from 'react'
import type { Route } from '@/components/Sidebar'

/**
 * 붙는 자리(DrawerDock)가 없는 화면에서 오른쪽에 얹어 여는 선수 정보 창의 자리(틀).
 * F는 틀만 만들어 null을 돌려준다. A가 App에 꽂고, P가 화면마다 열린 선수(playerPanel)를 읽어 채운다.
 * 붙는 자리가 있는 화면에서는 스스로 비킨다.
 */
export function PlayerPanelHost(_props: { route: Route; dataKey: string }): ReactElement | null {
  return null
}
