import { useState } from 'react'
import { api } from '@/api'

/**
 * 구단 엠블럼. 사용자가 설치해 둔 엠블럼 팩에 그 구단의 그림이 있으면 보여 주고, 없으면 아무것도 그리지 않는다
 * (이름이 바로 옆에 있으므로 빈 자리를 남기지 않는다). 크기는 size(px).
 */
export function ClubLogo(props: { uid: number | null | undefined; size: number; className?: string }) {
  const { uid, size, className } = props
  if (!uid) return null
  return <LogoInner key={uid} uid={uid} size={size} className={className} />
}

function LogoInner(props: { uid: number; size: number; className?: string }) {
  const { uid, size, className } = props
  const [missing, setMissing] = useState(false)
  const url = api.clubLogoUrl(uid)
  if (!url || missing) return null
  return (
    <img
      className={`club-logo ${className ?? ''}`}
      src={url}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      style={{ width: size, height: size, objectFit: 'contain', flex: 'none' }}
      onError={() => setMissing(true)}
    />
  )
}
