// A D1Database over in-browser SQLite (sql.js), with just the surface Drizzle's D1 driver uses:
// prepare().bind().all() / raw() / first() / run(), batch() and exec().
import type { Database, SqlValue } from "sql.js"

type Row = Record<string, SqlValue>

function toSql(v: unknown): SqlValue {
  if (v === undefined || v === null) return null
  if (typeof v === "boolean") return v ? 1 : 0
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (typeof v === "number" || typeof v === "string" || v instanceof Uint8Array) return v
  return String(v)
}

class Statement {
  private db: Database
  private sql: string
  private params: unknown[]
  constructor(db: Database, sql: string, params: unknown[] = []) {
    this.db = db
    this.sql = sql
    this.params = params
  }

  bind(...params: unknown[]): Statement {
    return new Statement(this.db, this.sql, params)
  }

  /** Run synchronously and return column names plus row arrays. */
  exec(): { columns: string[]; rows: SqlValue[][]; changes: number } {
    const stmt = this.db.prepare(this.sql)
    try {
      stmt.bind(this.params.map(toSql))
      const rows: SqlValue[][] = []
      while (stmt.step()) rows.push(stmt.get())
      return { columns: stmt.getColumnNames(), rows, changes: this.db.getRowsModified() }
    } finally {
      stmt.free()
    }
  }

  result() {
    const { columns, rows, changes } = this.exec()
    const results = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])) as Row)
    return { results, success: true, meta: { changes, rows_read: rows.length, rows_written: changes } }
  }

  async all() { return this.result() }
  async run() { return this.result() }

  async first(column?: string) {
    const row = this.result().results[0]
    if (!row) return null
    return column ? row[column] : row
  }

  async raw(opts?: { columnNames?: boolean }) {
    const { columns, rows } = this.exec()
    return opts?.columnNames ? [columns, ...rows] : rows
  }
}

export function d1(db: Database) {
  return {
    prepare: (sql: string) => new Statement(db, sql),
    /** All statements in one transaction, like D1. */
    async batch(statements: Statement[]) {
      db.exec("BEGIN")
      try {
        const results = statements.map((s) => s.result())
        db.exec("COMMIT")
        return results
      } catch (e) {
        db.exec("ROLLBACK")
        throw e
      }
    },
    async exec(sql: string) {
      db.exec(sql)
      return { count: 1, duration: 0 }
    },
  }
}
