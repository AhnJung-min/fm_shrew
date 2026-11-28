import type { ReactNode } from 'react'

/**
 * 화면 머리의 틀(틀만 있고 몸은 뒤 단위가 채운다): 제목(h1), 한 줄 설명, 조작과 주 단추가 들어간다.
 * 지금은 .page-head로 감싸기만 한다. S가 맨 앞에 뒤로 단추(BackButton), 맨 끝에 항상 위 단추(PinButton)를 채우고,
 * 각 화면의 주인이 자기 머리를 이 틀로 바꾼다.
 */
export function PageHead(props: { children: ReactNode; className?: string }) {
  return <header className={['page-head', props.className].filter(Boolean).join(' ')}>{props.children}</header>
}
