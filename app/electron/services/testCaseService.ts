import { v4 as uuidv4 } from "uuid";
import type { SqlJsDatabase } from "../db/sqlJsWrapper";
import { validateTestModel, createEmptyTestModel, type TestModel } from "../shared/testModel";

export interface TestCase {
  id: string;
  displayId: string;
  projectId: string;
  title: string;
  description: string | null;
  preconditions: string | null;
  priority: "low" | "medium" | "high" | "critical";
  feature: string | null;
  module: string | null;
  requirementRef: string | null;
  automationStatus: "manual" | "planned" | "automated" | "needs_maintenance";
  testModel: TestModel;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface TestCaseRow {
  id: string;
  sequence: number;
  project_id: string;
  title: string;
  description: string | null;
  preconditions: string | null;
  priority: "low" | "medium" | "high" | "critical";
  feature: string | null;
  module: string | null;
  requirement_ref: string | null;
  automation_status: "manual" | "planned" | "automated" | "needs_maintenance";
  test_model_json: string;
  created_at: string;
  updated_at: string;
}

export class TestCaseValidationError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join(" "));
    this.issues = issues;
  }
}

function nextSequence(db: SqlJsDatabase, projectId: string): number {
  const row = db.prepare("SELECT next_value FROM test_case_sequence WHERE project_id = ?").get(projectId) as
    | { next_value: number }
    | undefined;
  const value = row?.next_value ?? 1;
  if (row) {
    db.prepare("UPDATE test_case_sequence SET next_value = ? WHERE project_id = ?").run(value + 1, projectId);
  } else {
    db.prepare("INSERT INTO test_case_sequence (project_id, next_value) VALUES (?, ?)").run(projectId, value + 1);
  }
  return value;
}

function tagsFor(db: SqlJsDatabase, testCaseId: string): string[] {
  const rows = db
    .prepare(
      `SELECT t.name FROM test_tags t JOIN test_case_tags ct ON ct.tag_id = t.id WHERE ct.test_case_id = ? ORDER BY t.name`
    )
    .all(testCaseId) as { name: string }[];
  return rows.map((r) => r.name);
}

function toTestCase(db: SqlJsDatabase, row: TestCaseRow): TestCase {
  return {
    id: row.id,
    displayId: `TC-${row.sequence}`,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    preconditions: row.preconditions,
    priority: row.priority,
    feature: row.feature,
    module: row.module,
    requirementRef: row.requirement_ref,
    automationStatus: row.automation_status,
    testModel: JSON.parse(row.test_model_json),
    tags: tagsFor(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function syncTags(db: SqlJsDatabase, testCaseId: string, tagNames: string[]): void {
  db.prepare("DELETE FROM test_case_tags WHERE test_case_id = ?").run(testCaseId);
  for (const rawName of tagNames) {
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    let tag = db.prepare("SELECT id FROM test_tags WHERE name = ?").get(name) as { id: string } | undefined;
    if (!tag) {
      const id = uuidv4();
      db.prepare("INSERT INTO test_tags (id, name) VALUES (?, ?)").run(id, name);
      tag = { id };
    }
    db.prepare("INSERT OR IGNORE INTO test_case_tags (test_case_id, tag_id) VALUES (?, ?)").run(testCaseId, tag.id);
  }
}

export interface CreateTestCaseInput {
  projectId: string;
  title: string;
  description?: string;
  preconditions?: string;
  priority?: "low" | "medium" | "high" | "critical";
  feature?: string;
  module?: string;
  requirementRef?: string;
  tags?: string[];
}

export function createTestCase(db: SqlJsDatabase, input: CreateTestCaseInput): TestCase {
  const title = input.title.trim();
  if (!title) throw new TestCaseValidationError(["Test title is required."]);

  const id = uuidv4();
  const sequence = nextSequence(db, input.projectId);
  const model = createEmptyTestModel({ testCaseId: id, projectId: input.projectId, name: title });
  model.tags = input.tags ?? [];
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO test_cases
      (id, sequence, project_id, title, description, preconditions, priority, feature, module, requirement_ref, automation_status, test_model_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)`
  ).run(
    id,
    sequence,
    input.projectId,
    title,
    input.description ?? null,
    input.preconditions ?? null,
    input.priority ?? "medium",
    input.feature ?? null,
    input.module ?? null,
    input.requirementRef ?? null,
    JSON.stringify(model),
    now,
    now
  );
  syncTags(db, id, model.tags);

  return toTestCase(db, db.prepare("SELECT * FROM test_cases WHERE id = ?").get(id) as TestCaseRow);
}

export function listTestCases(db: SqlJsDatabase, projectId: string): TestCase[] {
  const rows = db
    .prepare("SELECT * FROM test_cases WHERE project_id = ? ORDER BY sequence DESC")
    .all(projectId) as TestCaseRow[];
  return rows.map((r) => toTestCase(db, r));
}

export function getTestCase(db: SqlJsDatabase, id: string): TestCase | null {
  const row = db.prepare("SELECT * FROM test_cases WHERE id = ?").get(id) as TestCaseRow | undefined;
  return row ? toTestCase(db, row) : null;
}

/**
 * Deletes a test case. Tags, suite membership, and automation mappings
 * cascade with it; past execution history is kept for reporting but has its
 * test_case_id set to NULL (see migration 002_test_case_delete).
 */
export function deleteTestCase(db: SqlJsDatabase, id: string): void {
  db.prepare("DELETE FROM test_cases WHERE id = ?").run(id);
}

/** Saves an edited Test Model (validated, never silently "fixed" — docs/TEST_MODEL.md). */
export function saveTestModel(db: SqlJsDatabase, testCaseId: string, model: TestModel, knownBaseUrls: string[]): TestCase {
  const issues = validateTestModel(model, knownBaseUrls);
  if (issues.length > 0) {
    throw new TestCaseValidationError(issues.map((i) => i.message));
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE test_cases SET test_model_json = ?, title = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(model),
    model.name,
    now,
    testCaseId
  );
  syncTags(db, testCaseId, model.tags);
  return toTestCase(db, db.prepare("SELECT * FROM test_cases WHERE id = ?").get(testCaseId) as TestCaseRow);
}
