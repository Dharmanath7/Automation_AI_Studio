import type { SqlJsDatabase } from "../db/sqlJsWrapper";

export interface ExecutionTrendPoint {
  id: string;
  startedAt: string;
  triggerType: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface DashboardAnalytics {
  totalTestCases: number;
  automatedTestCases: number;
  /** Suite tag name -> count of test cases carrying that tag (a test can count toward more than one). */
  suiteCounts: Record<string, number>;
  /** Oldest -> newest, so a trend chart reads left-to-right. */
  recentExecutions: ExecutionTrendPoint[];
  /** Failure classification -> count, across the same recent executions. */
  failureClassificationCounts: Record<string, number>;
  /** Pass rate across all tests in the recent executions window, or null if none have run yet. */
  overallPassRate: number | null;
}

const RECENT_EXECUTIONS_WINDOW = 10;

export function getDashboardAnalytics(db: SqlJsDatabase, projectId: string): DashboardAnalytics {
  const totalRow = db.prepare("SELECT COUNT(*) as c FROM test_cases WHERE project_id = ?").get(projectId) as { c: number };
  const automatedRow = db
    .prepare("SELECT COUNT(*) as c FROM test_cases WHERE project_id = ? AND automation_status = 'automated'")
    .get(projectId) as { c: number };

  const suiteRows = db
    .prepare(
      `SELECT t.name as tag, COUNT(*) as c
       FROM test_case_tags ct
       JOIN test_tags t ON t.id = ct.tag_id
       JOIN test_cases tc ON tc.id = ct.test_case_id
       WHERE tc.project_id = ?
       GROUP BY t.name`
    )
    .all(projectId) as { tag: string; c: number }[];
  const suiteCounts: Record<string, number> = {};
  for (const r of suiteRows) suiteCounts[r.tag] = r.c;

  const execRows = db
    .prepare(
      `SELECT e.id, e.started_at, e.trigger_type,
        (SELECT COUNT(*) FROM execution_tests et WHERE et.execution_id = e.id) as total,
        (SELECT COUNT(*) FROM execution_tests et WHERE et.execution_id = e.id AND et.status = 'passed') as passed,
        (SELECT COUNT(*) FROM execution_tests et WHERE et.execution_id = e.id AND et.status IN ('failed','errored')) as failed,
        (SELECT COUNT(*) FROM execution_tests et WHERE et.execution_id = e.id AND et.status = 'skipped') as skipped
       FROM executions e
       WHERE e.project_id = ?
       ORDER BY e.started_at DESC
       LIMIT ${RECENT_EXECUTIONS_WINDOW}`
    )
    .all(projectId) as any[];

  const recentExecutions: ExecutionTrendPoint[] = execRows
    .map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      triggerType: r.trigger_type,
      total: r.total,
      passed: r.passed,
      failed: r.failed,
      skipped: r.skipped,
    }))
    .reverse(); // oldest -> newest for the chart

  const failureClassificationCounts: Record<string, number> = {};
  if (execRows.length > 0) {
    const placeholders = execRows.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT failure_classification as cls, COUNT(*) as c
         FROM execution_tests
         WHERE execution_id IN (${placeholders}) AND status IN ('failed','errored') AND failure_classification IS NOT NULL
         GROUP BY failure_classification`
      )
      .all(...execRows.map((r) => r.id)) as { cls: string; c: number }[];
    for (const r of rows) failureClassificationCounts[r.cls] = r.c;
  }

  const totalTests = recentExecutions.reduce((s, e) => s + e.total, 0);
  const totalPassed = recentExecutions.reduce((s, e) => s + e.passed, 0);
  const overallPassRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : null;

  return {
    totalTestCases: totalRow.c,
    automatedTestCases: automatedRow.c,
    suiteCounts,
    recentExecutions,
    failureClassificationCounts,
    overallPassRate,
  };
}
