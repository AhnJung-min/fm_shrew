import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'

/**
 * Claude API 키 보관.
 * Windows 계정에 묶인 암호화(safeStorage)로 파일에 저장하고, 화면(렌더러)에는 키를 돌려주지 않는다.
 */
export class KeyStore {
  constructor(private file: string) {}

  has(): boolean {
    return existsSync(this.file) || Boolean(process.env.ANTHROPIC_API_KEY)
  }

  /** 저장된 키. 없으면 환경 변수의 키를 쓴다. */
  read(): string | null {
    if (existsSync(this.file)) {
      try {
        return safeStorage.decryptString(readFileSync(this.file))
      } catch {
        // 다른 Windows 계정에서 만든 파일이거나 손상된 경우
        return null
      }
    }
    return process.env.ANTHROPIC_API_KEY ?? null
  }

  save(key: string): void {
    const trimmed = key.trim()
    if (!trimmed) throw new Error('키가 비어 있습니다.')
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('이 PC에서는 키를 암호화해 저장할 수 없습니다.')
    }
    writeFileSync(this.file, safeStorage.encryptString(trimmed))
  }

  clear(): void {
    rmSync(this.file, { force: true })
  }
}
