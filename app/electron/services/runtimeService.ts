import { v4 as uuidv4 } from "uuid";
import type { SqlJsDatabase } from "../db/sqlJsWrapper";
import { PythonExecutionAdapter } from "./execution/PythonExecutionAdapter";
import type { RuntimeCheckResult } from "./execution/ExecutionAdapter";

/** Runs the Python stack's runtime checks and caches the result (product brief §44). */
export async function checkAndCacheRuntime(db: SqlJsDatabase, projectDirectory: string): Promise<RuntimeCheckResult[]> {
  const results = await PythonExecutionAdapter.checkRuntime(projectDirectory);
  const now = new Date().toISOString();
  for (const r of results) {
    db.prepare(
      `INSERT INTO runtime_configs (id, tool, detected_version, status, details, checked_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(uuidv4(), r.tool, r.version ?? null, r.installed ? "installed" : "missing", r.details ?? null, now);
  }
  return results;
}

export function getLastRuntimeCheck(db: SqlJsDatabase): RuntimeCheckResult[] {
  const rows = db
    .prepare(
      `SELECT tool, detected_version, status, details FROM runtime_configs
       WHERE checked_at = (SELECT MAX(checked_at) FROM runtime_configs r2 WHERE r2.tool = runtime_configs.tool)
       ORDER BY tool`
    )
    .all() as { tool: string; detected_version: string | null; status: string; details: string | null }[];
  return rows.map((r) => ({
    tool: r.tool,
    installed: r.status === "installed",
    version: r.detected_version ?? undefined,
    details: r.details ?? undefined,
  }));
}
