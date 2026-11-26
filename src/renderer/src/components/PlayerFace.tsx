import { useState } from 'react'
import { initialsOf } from '@shared/playerView'
import { api } from '@/api'

/**
 * 선수 얼굴. 사용자가 설치해 둔 얼굴 사진이 있으면 그것을, 없으면(또는 미리보기에서는) 이름의 머리글자를 보여 준다.
 * 크기는 CSS의 --face 값으로 정한다.
 */
export function PlayerFace(props: { uid: number | null; name: string; size: number; className?: string }) {
  const { uid, name, size, className } = props
  return <FaceInner key={uid ?? 'none'} uid={uid} name={name} size={size} className={className} />
}

function FaceInner(props: { uid: number | null; name: string; size: number; className?: string }) {
  const { uid, name, size, className } = props
  const [missing, setMissing] = useState(false)
  const url = uid === null ? null : api.faceUrl(uid)
  return (
    <span className={`face ${className ?? ''}`} style={{ ['--face' as string]: `${size}px` }} aria-hidden="true">
      {url && !missing ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setMissing(true)} /> : <b>{initialsOf(name)}</b>}
    </span>
  )
}
