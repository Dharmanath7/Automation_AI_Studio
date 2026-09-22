import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { app } from "electron";
import type { SqlJsDatabase } from "../../db/sqlJsWrapper";
import { PythonExecutionAdapter } from "./PythonExecutionAdapter";
import type { ExecutionEvent, ExecutionResult } from "./ExecutionAdapter";
import { getProject } from "../projectService";
import { getEnvironment } from "../environmentService";
import { getDecryptedCredentials, listCredentialProfiles } from "../credentialService";
import { getTestCase } from "../testCaseService";
import { getAutomationMapping } from "../codegen/generationService";

export type TriggerType = "single" | "suite" | "bvt" | "smoke" | "sanity" | "regression" | "custom";

export interface RunRequest {
  projectId: string;
  environmentId: string;
  testCaseIds: string[];
  triggerType: TriggerType;
  browser: "chromium" | "chrome" | "firefox" | "edge" | "webkit";
  mode: "headed" | "headless";
  buildId?: string;
  screenshotStrategy?: "failureOnly" | "everyStep" | "disabled";
  triggeredByUserId: string;
}

function artifactsDirFor(executionId: string): string {
  return path.join(app.getPath("userData"), "artifacts", executionId);
}

export async function runExecution(
  db: SqlJsDatabase,
  request: RunRequest,
  onEvent?: (e: ExecutionEvent) => void
): Promise<{ executionId: string; result: ExecutionResult }> {
  const project = getProject(db, request.projectId);
  if (!project) throw new Error("Project not found.");
  const environment = getEnvironment(db, request.environmentId);
  if (!environment) throw new Error("Environment not found.");

  const testCases = request.testCaseIds.map((id) => getTestCase(db, id)).filter((t): t is NonNullable<typeof t> => !!t);
  const filePaths: string[] = [];
  for (const tc of testCases) {
    const mapping = getAutomationMapping(db, tc.id);
    if (mapping) filePaths.push(mapping.generatedTestFile);
  }

  let credentials: Record<string, Record<string, string>> = {};
  if (environment.defaultCredentialProfileId) {
    const profiles = listCredentialProfiles(db, project.id);
    const profile = profiles.find((p) => p.id === environment.defaultCredentialProfileId);
    if (profile) {
      credentials = { default: getDecryptedCredentials(db, profile.id) };
    }
  }

  const executionId = uuidv4();
  const startedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO executions (id, project_id, environment_id, browser_config_id, trigger_type, build_id, mode, status, started_at, triggered_by_user_id)
     VALUES (?, ?, ?, NULL, ?, ?, ?, 'running', ?, ?)`
  ).run(executionId, project.id, environment.id, request.triggerType, request.buildId ?? null, request.mode, startedAt, request.triggeredByUserId);

  try {
    const result = await PythonExecutionAdapter.run(
      {
        projectDirectory: project.projectDirectory,
        testFilePaths: filePaths,
        env: {
          base_url: environment.baseUrl,
          api_url: environment.apiUrl ?? "",
          timeout_ms: String(environment.timeoutMs),
          ...environment.customVariables,
        },
        credentials,
        browser: request.browser,
        mode: request.mode,
        workers: 1,
        screenshotStrategy: request.screenshotStrategy ?? "failureOnly",
        videoEnabled: false,
        traceStrategy: "disabled",
        artifactsDir: artifactsDirFor(executionId),
      },
      (e) => onEvent?.(e)
    );

    persistResult(db, executionId, testCases, result);
    return { executionId, result };
  } finally {
    for (const key of Object.keys(credentials)) {
      for (const field of Object.keys(credentials[key])) {
        credentials[key][field] = "";
      }
    }
    credentials = {};
  }
}

function persistResult(
  db: SqlJsDatabase,
  executionId: string,
  testCases: { id: string; testModel: { name: string } }[],
  result: ExecutionResult
): void {
  const now = result.finishedAt;
  db.prepare(`UPDATE executions SET status = ?, finished_at = ?, duration_ms = ? WHERE id = ?`).run(
    result.status,
    now,
    result.durationMs,
    executionId
  );

  for (const testResult of result.tests) {
    const matchedTestCase = testCases.find((tc) => testResult.nodeId.includes(tc.testModel.name.toLowerCase().replace(/\s+/g, "_")));
    const executionTestId = uuidv4();
    db.prepare(
      `INSERT INTO execution_tests
        (id, execution_id, test_case_id, automation_mapping_id, status, duration_ms, error_message, failure_classification, started_at, finished_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
    ).run(
      executionTestId,
      executionId,
      matchedTestCase?.id ?? null,
      testResult.status,
      testResult.durationMs,
      testResult.errorMessage ?? null,
      testResult.failureClassification ?? null,
      result.startedAt,
      result.finishedAt
    );

    for (const artifact of testResult.artifacts) {
      db.prepare(
        `INSERT INTO artifacts (id, execution_test_id, kind, step_index, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(uuidv4(), executionTestId, artifact.kind, artifact.stepIndex ?? null, artifact.path, now);
    }

    if (matchedTestCase) {
      const mapping = getAutomationMapping(db, matchedTestCase.id);
      if (mapping) {
        db.prepare(`UPDATE automation_mappings SET last_execution_id = ? WHERE id = ?`).run(executionId, mapping.id);
      }
    }
  }
}

export interface ExecutionSummary {
  id: string;
  projectId: string;
  environmentId: string;
  triggerType: TriggerType;
  buildId: string | null;
  mode: "headed" | "headless";
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
}

export function listExecutions(db: SqlJsDatabase, projectId: string): ExecutionSummary[] {
  const rows = db
    .prepare(
      `SELECT e.*,
        (SELECT COUNT(*) FROM execution_tests et WHERE et.execution_id = e.id) as total,
        (SELECT COUNT(*) FROM execution_tests et WHERE et.execution_id = e.id AND et.status = 'passed') as passed,
        (SELECT COUNT(*) FROM execution_tests et WHERE et.execution_id = e.id AND et.status IN ('failed','errored')) as failed,
        (SELECT COUNT(*) FROM execution_tests et WHERE et.execution_id = e.id AND et.status = 'skipped') as skipped
       FROM executions e WHERE e.project_id = ? ORDER BY e.started_at DESC`
    )
    .all(projectId) as any[];
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    environmentId: r.environment_id,
    triggerType: r.trigger_type,
    buildId: r.build_id,
    mode: r.mode,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    totalTests: r.total,
    passed: r.passed,
    failed: r.failed,
    skipped: r.skipped,
  }));
}

export interface ExecutionDetail extends ExecutionSummary {
  tests: {
    id: string;
    testCaseId: string | null;
    status: string;
    durationMs: number;
    errorMessage: string | null;
    failureClassification: string | null;
    artifacts: { id: string; kind: string; filePath: string }[];
  }[];
}

export function getExecution(db: SqlJsDatabase, executionId: string): ExecutionDetail | null {
  const projectRow = db.prepare("SELECT project_id FROM executions WHERE id = ?").get(executionId) as
    | { project_id: string }
    | undefined;
  if (!projectRow) return null;
  const summaryRows = listExecutions(db, projectRow.project_id);
  const summary = summaryRows.find((s) => s.id === executionId);
  if (!summary) return null;

  const testRows = db.prepare("SELECT * FROM execution_tests WHERE execution_id = ?").all(executionId) as any[];
  const tests = testRows.map((t) => ({
    id: t.id,
    testCaseId: t.test_case_id,
    status: t.status,
    durationMs: t.duration_ms,
    errorMessage: t.error_message,
    failureClassification: t.failure_classification,
    artifacts: (db.prepare("SELECT id, kind, file_path FROM artifacts WHERE execution_test_id = ?").all(t.id) as any[]).map((a) => ({
      id: a.id,
      kind: a.kind,
      filePath: a.file_path,
    })),
  }));

  return { ...summary, tests };
}
