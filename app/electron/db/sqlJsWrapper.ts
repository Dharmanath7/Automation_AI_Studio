import fs from "node:fs";
import type { Database as SqlJsRawDatabase } from "sql.js";

/**
 * A small better-sqlite3-shaped compatibility layer over sql.js (pure WASM
 * SQLite — no native compilation required). sql.js keeps the whole database
 * in memory; this wrapper re-exports and writes it to disk after every
 * mutating statement so it behaves like a normal durable SQLite file on
 * disk, the way the rest of this codebase (written against better-sqlite3's
 * synchronous API) expects. See docs/ARCHITECTURE.md §8 risk #1.
 */

export interface RunResult {
  changes: number;
}

class PreparedStatement {
  constructor(
    private readonly db: SqlJsDatabase,
    private readonly sql: string
  ) {}

  run(...params: unknown[]): RunResult {
    const stmt = this.db.raw.prepare(this.sql);
    try {
      if (params.length > 0) stmt.bind(params as never);
      stmt.step();
    } finally {
      stmt.free();
    }
    const changes = this.db.raw.getRowsModified();
    if (!this.db.inTransaction) this.db.persist();
    return { changes };
  }

  get(...params: unknown[]): any {
    const stmt = this.db.raw.prepare(this.sql);
    try {
      if (params.length > 0) stmt.bind(params as never);
      const hasRow = stmt.step();
      return hasRow ? normalizeRow(stmt.getAsObject()) : undefined;
    } finally {
      stmt.free();
    }
  }

  all(...params: unknown[]): any[] {
    const stmt = this.db.raw.prepare(this.sql);
    const rows: Record<string, unknown>[] = [];
    try {
      if (params.length > 0) stmt.bind(params as never);
      while (stmt.step()) rows.push(normalizeRow(stmt.getAsObject()));
    } finally {
      stmt.free();
    }
    return rows;
  }
}

/** sql.js returns BLOB columns as Uint8Array; normalize to Node Buffer to match the rest of the codebase's expectations. */
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
      row[key] = Buffer.from(value);
    }
  }
  return row;
}

export class SqlJsDatabase {
  inTransaction = false;

  constructor(
    public readonly raw: SqlJsRawDatabase,
    private readonly filePath: string
  ) {}

  prepare(sql: string): PreparedStatement {
    return new PreparedStatement(this, sql);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
    if (!this.inTransaction) this.persist();
  }

  pragma(pragmaString: string): void {
    if (pragmaString.startsWith("journal_mode")) return; // WAL doesn't apply to sql.js's in-memory VFS
    this.raw.exec(`PRAGMA ${pragmaString}`);
  }

  transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
    return (...args: Args) => {
      this.raw.exec("BEGIN");
      this.inTransaction = true;
      try {
        const result = fn(...args);
        this.raw.exec("COMMIT");
        this.inTransaction = false;
        this.persist();
        return result;
      } catch (err) {
        this.raw.exec("ROLLBACK");
        this.inTransaction = false;
        throw err;
      }
    };
  }

  persist(): void {
    if (this.filePath === ":memory:") return;
    fs.writeFileSync(this.filePath, Buffer.from(this.raw.export()));
  }

  close(): void {
    this.persist();
    this.raw.close();
  }
}
