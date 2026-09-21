import path from "node:path";
import { app } from "electron";
import { openDatabase } from "./connection";
import type { SqlJsDatabase } from "./sqlJsWrapper";

let dbInstance: SqlJsDatabase | null = null;

/** Must be awaited once, at app startup, before any getDb() call (see electron/main.ts). */
export async function initializeDatabase(): Promise<void> {
  if (dbInstance) return;
  const userDataDir = app.getPath("userData");
  dbInstance = await openDatabase(path.join(userDataDir, "studio.db"));
}

/** Synchronous accessor — safe because initializeDatabase() always runs first (see electron/main.ts). */
export function getDb(): SqlJsDatabase {
  if (!dbInstance) {
    throw new Error("Database not initialized yet — initializeDatabase() must be awaited before getDb() is called.");
  }
  return dbInstance;
}

/** Test-only: inject a database instance (e.g. an in-memory one) in place of the real one. */
export function setDbForTesting(db: SqlJsDatabase): void {
  dbInstance = db;
}

export function closeDb(): void {
  dbInstance?.close();
  dbInstance = null;
}
