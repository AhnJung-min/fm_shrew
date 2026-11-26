import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 그래픽 폴더 아래로 몇 단계까지 사진 폴더를 찾는지 */
const MAX_DEPTH = 3

/**
 * 사용자가 그래픽 폴더에 설치해 둔 그림 모음(페이스팩, 엠블럼 팩)에서 번호에 맞는 파일을 찾는다.
 * 그림 폴더에는 파일이 수십만 개라 목록을 읽지 않고, 번호마다 파일이 있는지만 확인해 결과를 기억해 둔다.
 * 그림은 사용자의 파일이므로 읽기만 하고 어디에도 복사하지 않는다.
 */
class ImageFinder {
  private dirs: string[] | null = null
  private readonly cache = new Map<number, string | null>()

  constructor(
    private readonly graphicsDir: string,
    /** 이 이름(소문자)의 폴더가 그림 폴더다 */
    private readonly folderName: string,
    /** 그림 폴더 안에서 먼저 볼 하위 폴더(소문자). 있으면 그것도 그림 폴더로 본다 */
    private readonly preferredSub: string | null,
    /** 번호 → 볼 파일 이름들(앞의 것부터) */
    private readonly fileNames: (uid: number) => string[]
  ) {}

  /** 그림 폴더들을 찾는다(처음 한 번만). 폴더 이름의 대소문자는 가리지 않는다 */
  folders(): string[] {
    if (this.dirs) return this.dirs
    const found: string[] = []
    const walk = (dir: string, depth: number): void => {
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const path = join(dir, entry.name)
        if (entry.name.toLowerCase() === this.folderName) {
          if (this.preferredSub) {
            try {
              const sub = readdirSync(path, { withFileTypes: true }).find(
                (each) => each.isDirectory() && each.name.toLowerCase() === this.preferredSub
              )
              if (sub) found.push(join(path, sub.name))
            } catch {
              // 읽지 못하는 폴더는 건너뛴다
            }
          }
          found.push(path)
        } else if (depth < MAX_DEPTH) walk(path, depth + 1)
      }
    }
    walk(this.graphicsDir, 1)
    this.dirs = found
    return found
  }

  /** 번호의 그림 파일 경로. 없으면 null */
  find(uid: number): string | null {
    if (!Number.isInteger(uid) || uid <= 0) return null
    const kept = this.cache.get(uid)
    if (kept !== undefined) return kept
    let file: string | null = null
    for (const dir of this.folders()) {
      for (const name of this.fileNames(uid)) {
        const path = join(dir, name)
        if (existsSync(path)) {
          file = path
          break
        }
      }
      if (file) break
    }
    this.cache.set(uid, file)
    return file
  }
}

/** 선수 사진: `<그래픽 폴더>/<팩>/faces/face_<선수 번호>.png`(팩에 따라 `<번호>.png`) */
export class FaceFinder extends ImageFinder {
  constructor(graphicsDir: string) {
    super(graphicsDir, 'faces', null, (uid) => [`face_${uid}.png`, `${uid}.png`])
  }
}

/** 구단 엠블럼: `<그래픽 폴더>/<팩>/Clubs/Normal/<구단 번호>_club.png`(팩에 따라 `<번호>.png`) */
export class LogoFinder extends ImageFinder {
  constructor(graphicsDir: string) {
    super(graphicsDir, 'clubs', 'normal', (uid) => [`${uid}_club.png`, `${uid}.png`])
  }
}

export type ImageKind = 'face' | 'club'

/** fmface://face/12345, fmface://club/678 에서 그림 종류와 번호를 뽑는다. 숫자가 아니면 null(경로 조작을 막는다) */
export function imageRequestFrom(url: string): { kind: ImageKind; uid: number } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const kind = parsed.hostname === 'club' ? 'club' : parsed.hostname === 'face' ? 'face' : null
  const text = parsed.pathname.replace(/^\/+/, '')
  if (!kind || !/^\d{1,10}$/.test(text)) return null
  return { kind, uid: Number(text) }
}

/** fmface://face/12345 에서 선수 번호만 뽑는다 */
export function faceUidFrom(url: string): number | null {
  const request = imageRequestFrom(url)
  return request?.kind === 'face' ? request.uid : null
}
