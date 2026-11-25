import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { decodeBytes, parseExport } from '@shared/parse'
import type { ImportResult, SnapshotKind } from '@shared/types'
import type { Store } from './db'

const EXPORT_FILE_RE = /\.(csv|html?)$/i

export function isExportFile(path: string): boolean {
  return EXPORT_FILE_RE.test(path)
}

/** 선수 수로 스쿼드인지 검색 결과인지 어림한다. 화면에서 바꿀 수 있다. */
function guessKind(rowCount: number): SnapshotKind {
  return rowCount <= 60 ? 'squad' : 'search'
}

/** 내보내기 파일 하나를 읽어 스냅샷으로 저장한다. 같은 파일은 다시 저장하지 않는다. */
export async function importFile(
  store: Store,
  path: string,
  overrides: Record<string, string>
): Promise<ImportResult> {
  try {
    if (!isExportFile(path)) {
      return { ok: false, file: path, message: 'CSV나 HTML 파일만 가져올 수 있습니다.' }
    }
    const info = await stat(path)
    if (store.hasImported(path, info.mtimeMs, info.size)) {
      return { ok: true, skipped: true, file: path, message: '이미 가져온 파일입니다.' }
    }
    const text = decodeBytes(await readFile(path))
    const fileName = basename(path)
    const parsed = parseExport(text, fileName, overrides)
    const snapshot = store.insertSnapshot({
      kind: guessKind(parsed.rows.length),
      sourceFile: path,
      fileName,
      mtimeMs: info.mtimeMs,
      size: info.size,
      columns: parsed.columns,
      rows: parsed.rows
    })
    return { ok: true, file: path, snapshot }
  } catch (error) {
    return { ok: false, file: path, message: error instanceof Error ? error.message : String(error) }
  }
}
