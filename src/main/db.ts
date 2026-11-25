import { DatabaseSync } from 'node:sqlite'
import type { ColumnInfo, PlayerRow, Snapshot, SnapshotKind, SnapshotMeta } from '@shared/types'

interface SnapshotRecord {
  id: number
  kind: string
  source_file: string
  file_name: string
  imported_at: string
  row_count: number
  columns_json: string
}

/** 스냅샷 저장소. 내보낼 때마다 한 묶음(스냅샷)으로 쌓는다. */
export class Store {
  private db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        source_file TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_mtime INTEGER NOT NULL,
        file_size INTEGER NOT NULL,
        imported_at TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        columns_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshot_rows (
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        idx INTEGER NOT NULL,
        name TEXT NOT NULL,
        cells_json TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, idx)
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_source ON snapshots(source_file, file_mtime, file_size);
      PRAGMA foreign_keys = ON;
    `)
  }

  /** 같은 파일(경로·수정 시각·크기)을 이미 가져왔는지 */
  hasImported(sourceFile: string, mtimeMs: number, size: number): boolean {
    const row = this.db
      .prepare('SELECT 1 AS hit FROM snapshots WHERE source_file = ? AND file_mtime = ? AND file_size = ? LIMIT 1')
      .get(sourceFile, Math.round(mtimeMs), size)
    return row !== undefined
  }

  insertSnapshot(input: {
    kind: SnapshotKind
    sourceFile: string
    fileName: string
    mtimeMs: number
    size: number
    columns: ColumnInfo[]
    rows: PlayerRow[]
  }): SnapshotMeta {
    const importedAt = new Date().toISOString()
    this.db.exec('BEGIN')
    try {
      const result = this.db
        .prepare(
          `INSERT INTO snapshots (kind, source_file, file_name, file_mtime, file_size, imported_at, row_count, columns_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.kind,
          input.sourceFile,
          input.fileName,
          Math.round(input.mtimeMs),
          input.size,
          importedAt,
          input.rows.length,
          JSON.stringify(input.columns)
        )
      const id = Number(result.lastInsertRowid)
      const insertRow = this.db.prepare(
        'INSERT INTO snapshot_rows (snapshot_id, idx, name, cells_json) VALUES (?, ?, ?, ?)'
      )
      for (const row of input.rows) insertRow.run(id, row.idx, row.name, JSON.stringify(row.cells))
      this.db.exec('COMMIT')
      return {
        id,
        kind: input.kind,
        sourceFile: input.sourceFile,
        fileName: input.fileName,
        importedAt,
        rowCount: input.rows.length,
        columnCount: input.columns.length
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private toMeta(record: SnapshotRecord): SnapshotMeta {
    return {
      id: record.id,
      kind: record.kind === 'search' ? 'search' : 'squad',
      sourceFile: record.source_file,
      fileName: record.file_name,
      importedAt: record.imported_at,
      rowCount: record.row_count,
      columnCount: (JSON.parse(record.columns_json) as ColumnInfo[]).length
    }
  }

  listSnapshots(): SnapshotMeta[] {
    const records = this.db
      .prepare('SELECT * FROM snapshots ORDER BY imported_at DESC, id DESC')
      .all() as unknown as SnapshotRecord[]
    return records.map((record) => this.toMeta(record))
  }

  getSnapshot(id: number): Snapshot | null {
    const record = this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as unknown as
      | SnapshotRecord
      | undefined
    if (!record) return null
    const rowRecords = this.db
      .prepare('SELECT idx, name, cells_json FROM snapshot_rows WHERE snapshot_id = ? ORDER BY idx')
      .all(id) as unknown as Array<{ idx: number; name: string; cells_json: string }>
    return {
      ...this.toMeta(record),
      columns: JSON.parse(record.columns_json) as ColumnInfo[],
      rows: rowRecords.map((r) => ({ idx: r.idx, name: r.name, cells: JSON.parse(r.cells_json) }))
    }
  }

  setKind(id: number, kind: SnapshotKind): void {
    this.db.prepare('UPDATE snapshots SET kind = ? WHERE id = ?').run(kind, id)
  }

  deleteSnapshot(id: number): void {
    this.db.prepare('DELETE FROM snapshot_rows WHERE snapshot_id = ?').run(id)
    this.db.prepare('DELETE FROM snapshots WHERE id = ?').run(id)
  }

  close(): void {
    this.db.close()
  }
}
