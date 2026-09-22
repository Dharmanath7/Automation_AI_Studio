import { describe, it, expect, beforeEach } from "vitest";
import type { SqlJsDatabase } from "../../electron/db/sqlJsWrapper";
import { openDatabase } from "../../electron/db/connection";
import { createProject } from "../../electron/services/projectService";
import { createEnvironment } from "../../electron/services/environmentService";
import { createTestCase, deleteTestCase, getTestCase, listTestCases } from "../../electron/services/testCaseService";

let db: SqlJsDatabase;

beforeEach(async () => {
  db = await openDatabase(":memory:");
});

describe("deleteTestCase", () => {
  it("deletes a test case that has no execution history", () => {
    const project = createProject(db, { name: "P", code: `P${Date.now()}`, projectDirectory: "C:/tmp/p" });
    const testCase = createTestCase(db, { projectId: project.id, title: "T1" });

    deleteTestCase(db, testCase.id);

    expect(getTestCase(db, testCase.id)).toBeNull();
  });

  it("deletes a test case that HAS execution history, keeping the history with test_case_id set to NULL", () => {
    // This is the exact scenario migration 002_test_case_delete.sql exists
    // for: the original schema had no ON DELETE action on
    // execution_tests.test_case_id, so this delete would throw a foreign
    // key constraint violation instead of succeeding.
    const project = createProject(db, { name: "P2", code: `P2${Date.now()}`, projectDirectory: "C:/tmp/p2" });
    const environment = createEnvironment(db, { projectId: project.id, name: "TST", baseUrl: "https://tst.example.com" });
    const testCase = createTestCase(db, { projectId: project.id, title: "T2" });

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO executions (id, project_id, environment_id, trigger_type, mode, status, started_at, finished_at, triggered_by_user_id)
       VALUES ('exec-1', ?, ?, 'single', 'headless', 'passed', ?, ?, NULL)`
    ).run(project.id, environment.id, now, now);
    db.prepare(
      `INSERT INTO execution_tests (id, execution_id, test_case_id, status, duration_ms, started_at, finished_at)
       VALUES ('et-1', 'exec-1', ?, 'passed', 1000, ?, ?)`
    ).run(testCase.id, now, now);

    expect(() => deleteTestCase(db, testCase.id)).not.toThrow();
    expect(getTestCase(db, testCase.id)).toBeNull();

    const executionTestRow = db.prepare("SELECT test_case_id FROM execution_tests WHERE id = 'et-1'").get() as
      | { test_case_id: string | null }
      | undefined;
    expect(executionTestRow).toBeDefined();
    expect(executionTestRow!.test_case_id).toBeNull();
  });

  it("renumbers the remaining test cases contiguously (no gap) after a delete", () => {
    const project = createProject(db, { name: "P3", code: `P3${Date.now()}`, projectDirectory: "C:/tmp/p3" });
    const t1 = createTestCase(db, { projectId: project.id, title: "First" });
    const t2 = createTestCase(db, { projectId: project.id, title: "Second" });
    const t3 = createTestCase(db, { projectId: project.id, title: "Third" });
    expect([t1.displayId, t2.displayId, t3.displayId]).toEqual(["TC-1", "TC-2", "TC-3"]);

    deleteTestCase(db, t2.id);

    const remaining = listTestCases(db, project.id).sort((a, b) => a.displayId.localeCompare(b.displayId, undefined, { numeric: true }));
    expect(remaining.map((t) => t.title)).toEqual(["First", "Third"]);
    expect(remaining.map((t) => t.displayId)).toEqual(["TC-1", "TC-2"]);

    // A newly created test case continues from the compacted count, not
    // from the pre-delete high-water mark (which would have produced TC-4).
    const t4 = createTestCase(db, { projectId: project.id, title: "Fourth" });
    expect(t4.displayId).toBe("TC-3");
  });
});
