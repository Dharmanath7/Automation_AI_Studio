import { describe, it, expect, beforeEach } from "vitest";
import type { SqlJsDatabase } from "../../electron/db/sqlJsWrapper";
import { openDatabase } from "../../electron/db/connection";
import { createProject } from "../../electron/services/projectService";
import { createEnvironment } from "../../electron/services/environmentService";
import { createTestCase, saveTestModel } from "../../electron/services/testCaseService";
import { getDashboardAnalytics } from "../../electron/services/analyticsService";
import { v4 as uuidv4 } from "uuid";

let db: SqlJsDatabase;

beforeEach(async () => {
  db = await openDatabase(":memory:");
});

function insertExecution(
  db: SqlJsDatabase,
  projectId: string,
  environmentId: string,
  testCaseId: string,
  opts: { status: "passed" | "failed"; failureClassification?: string; startedAt: string }
) {
  const executionId = uuidv4();
  db.prepare(
    `INSERT INTO executions (id, project_id, environment_id, trigger_type, mode, status, started_at, finished_at, triggered_by_user_id)
     VALUES (?, ?, ?, 'single', 'headless', ?, ?, ?, NULL)`
  ).run(executionId, projectId, environmentId, opts.status, opts.startedAt, opts.startedAt);
  db.prepare(
    `INSERT INTO execution_tests (id, execution_id, test_case_id, status, duration_ms, failure_classification, started_at, finished_at)
     VALUES (?, ?, ?, ?, 1000, ?, ?, ?)`
  ).run(uuidv4(), executionId, testCaseId, opts.status, opts.failureClassification ?? null, opts.startedAt, opts.startedAt);
  return executionId;
}

describe("getDashboardAnalytics", () => {
  it("counts test cases, suite tags, and computes overall pass rate across recent executions", () => {
    const project = createProject(db, { name: "P", code: `P${Date.now()}`, projectDirectory: "C:/tmp/p" });
    const environment = createEnvironment(db, { projectId: project.id, name: "TST", baseUrl: "https://tst.example.com" });

    const t1 = createTestCase(db, { projectId: project.id, title: "T1" });
    const model1 = { ...t1.testModel, tags: ["bvt", "smoke"], steps: [{ id: "s1", type: "navigate" as const, value: { kind: "variable" as const, path: "base_url" }, enabled: true }] };
    saveTestModel(db, t1.id, model1, []);

    const t2 = createTestCase(db, { projectId: project.id, title: "T2" });
    const model2 = { ...t2.testModel, tags: ["smoke"], steps: [{ id: "s1", type: "navigate" as const, value: { kind: "variable" as const, path: "base_url" }, enabled: true }] };
    saveTestModel(db, t2.id, model2, []);

    // Mark t1 as automated (what generation normally does).
    db.prepare("UPDATE test_cases SET automation_status = 'automated' WHERE id = ?").run(t1.id);

    insertExecution(db, project.id, environment.id, t1.id, { status: "passed", startedAt: "2026-01-01T00:00:00.000Z" });
    insertExecution(db, project.id, environment.id, t2.id, { status: "failed", failureClassification: "timeout", startedAt: "2026-01-02T00:00:00.000Z" });
    insertExecution(db, project.id, environment.id, t2.id, { status: "failed", failureClassification: "timeout", startedAt: "2026-01-03T00:00:00.000Z" });

    const analytics = getDashboardAnalytics(db, project.id);

    expect(analytics.totalTestCases).toBe(2);
    expect(analytics.automatedTestCases).toBe(1);
    expect(analytics.suiteCounts).toEqual({ bvt: 1, smoke: 2 });
    expect(analytics.recentExecutions).toHaveLength(3);
    // oldest -> newest
    expect(analytics.recentExecutions[0].startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(analytics.recentExecutions[2].startedAt).toBe("2026-01-03T00:00:00.000Z");
    expect(analytics.failureClassificationCounts).toEqual({ timeout: 2 });
    // 1 passed out of 3 total execution_tests rows (one per execution here)
    expect(analytics.overallPassRate).toBe(33);
  });

  it("returns nulls/zeros gracefully for a project with no executions yet", () => {
    const project = createProject(db, { name: "Empty", code: `E${Date.now()}`, projectDirectory: "C:/tmp/e" });
    const analytics = getDashboardAnalytics(db, project.id);
    expect(analytics.totalTestCases).toBe(0);
    expect(analytics.recentExecutions).toEqual([]);
    expect(analytics.overallPassRate).toBeNull();
    expect(analytics.failureClassificationCounts).toEqual({});
  });
});
