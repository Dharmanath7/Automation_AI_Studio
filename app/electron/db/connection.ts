import fs from "node:fs";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import { SqlJsDatabase } from "./sqlJsWrapper";
import { runMigrations } from "./migrate";

// Resolved via Node's own module resolution (walks up to whichever
// node_modules applies) so this works both from source (tests, under
// electron/db/) and from the bundled dist-electron/main.js — a fixed
// relative "../.." would only be correct for one of the two.
const nodeRequire = createRequire(import.meta.url);

let sqlJsModulePromise: ReturnType<typeof initSqlJs> | null = null;

function loadSqlJs() {
  if (!sqlJsModulePromise) {
    sqlJsModulePromise = initSqlJs({
      locateFile: (file: string) => nodeRequire.resolve(`sql.js/dist/${file}`),
    });
  }
  return sqlJsModulePromise;
}

/** Opens (creating if needed) a SQLite database at filePath and brings it up to date. Pass ":memory:" for an ephemeral, non-persisted database (used in tests). */
export async function openDatabase(filePath: string): Promise<SqlJsDatabase> {
  const SQL = await loadSqlJs();
  const existingBytes = filePath !== ":memory:" && fs.existsSync(filePath) ? fs.readFileSync(filePath) : undefined;
  const raw = new SQL.Database(existingBytes);
  const db = new SqlJsDatabase(raw, filePath);
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}
