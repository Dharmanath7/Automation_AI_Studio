import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type { SqlJsDatabase } from "../../db/sqlJsWrapper";
import type { CodeGenerationResult, GeneratedFile } from "./adapters/CodeGeneratorAdapter";
import type { Project } from "../projectService";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/** Refuses to write outside the project's configured directory (docs/SECURITY.md §5). */
function resolveWithinProject(projectDirectory: string, relativePath: string): string {
  const base = path.resolve(projectDirectory);
  const resolved = path.resolve(base, relativePath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Refusing to write outside the project directory: "${relativePath}"`);
  }
  return resolved;
}

export interface FileConflict {
  relativePath: string;
  existingContent: string;
  generatedContent: string;
}

export interface WriteOutcome {
  written: string[];
  skippedUnchanged: string[];
  conflicts: FileConflict[];
  warnings: string[];
}

interface MappingRow {
  id: string;
  content_hash: string | null;
}

/**
 * Writes a generated test file + page objects to disk, honoring source
 * ownership: a file whose on-disk hash no longer matches the hash recorded
 * at last generation was edited outside the Studio, and is reported as a
 * conflict rather than overwritten, unless its path is in `forcePaths`
 * (the caller obtained explicit user confirmation — docs/SECURITY.md §6).
 * Support files (conftest.py, pytest.ini, ...) are create-once and never
 * overwritten once present.
 */
export function writeGeneratedCode(
  db: SqlJsDatabase,
  project: Project,
  testCaseId: string,
  result: CodeGenerationResult,
  opts: { forcePaths?: string[] } = {}
): WriteOutcome {
  const forcePaths = new Set(opts.forcePaths ?? []);
  const outcome: WriteOutcome = { written: [], skippedUnchanged: [], conflicts: [], warnings: result.warnings };

  const existingMapping = db
    .prepare(
      `SELECT id, content_hash FROM automation_mappings WHERE test_case_id = ? AND language = ? AND framework = ? AND test_runner = ?`
    )
    .get(testCaseId, "python", "playwright", "pytest") as MappingRow | undefined;
  const priorHashes: Record<string, string> = existingMapping?.content_hash
    ? JSON.parse(existingMapping.content_hash)
    : {};

  const filesToWrite: GeneratedFile[] = [result.testFile, ...result.pageObjectFiles];
  const newHashes: Record<string, string> = { ...priorHashes };

  for (const file of filesToWrite) {
    const absPath = resolveWithinProject(project.projectDirectory, file.relativePath);
    const newHash = sha256(file.content);

    if (fs.existsSync(absPath)) {
      const currentContent = fs.readFileSync(absPath, "utf8");
      const currentHash = sha256(currentContent);
      const knownPriorHash = priorHashes[file.relativePath];
      const editedOutsideStudio = knownPriorHash !== undefined && knownPriorHash !== currentHash;

      if (editedOutsideStudio && !forcePaths.has(file.relativePath)) {
        outcome.conflicts.push({
          relativePath: file.relativePath,
          existingContent: currentContent,
          generatedContent: file.content,
        });
        continue;
      }
      if (currentHash === newHash && !editedOutsideStudio) {
        outcome.skippedUnchanged.push(file.relativePath);
        newHashes[file.relativePath] = newHash;
        continue;
      }
    }

    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, file.content, "utf8");
    outcome.written.push(file.relativePath);
    newHashes[file.relativePath] = newHash;
  }

  for (const file of result.supportFiles) {
    const absPath = resolveWithinProject(project.projectDirectory, file.relativePath);
    if (fs.existsSync(absPath)) continue;
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, file.content, "utf8");
    outcome.written.push(file.relativePath);
  }

  if (outcome.conflicts.length === 0) {
    const now = new Date().toISOString();
    if (existingMapping) {
      db.prepare(
        `UPDATE automation_mappings
         SET generated_test_file = ?, page_object_files = ?, source_origin = 'generated', content_hash = ?, updated_at = ?
         WHERE id = ?`
      ).run(result.testFilePath, JSON.stringify(result.pageObjectPaths), JSON.stringify(newHashes), now, existingMapping.id);
    } else {
      db.prepare(
        `INSERT INTO automation_mappings
          (id, test_case_id, language, framework, test_runner, generated_test_file, page_object_files, test_data_files, source_origin, content_hash, created_at, updated_at)
         VALUES (?, ?, 'python', 'playwright', 'pytest', ?, ?, '[]', 'generated', ?, ?, ?)`
      ).run(uuidv4(), testCaseId, result.testFilePath, JSON.stringify(result.pageObjectPaths), JSON.stringify(newHashes), now, now);
    }
    db.prepare(`UPDATE test_cases SET automation_status = 'automated', updated_at = ? WHERE id = ?`).run(now, testCaseId);
  }

  return outcome;
}

export interface AutomationMapping {
  id: string;
  testCaseId: string;
  language: string;
  framework: string;
  testRunner: string;
  generatedTestFile: string;
  pageObjectFiles: string[];
  sourceOrigin: "generated" | "imported" | "manually_modified";
  lastExecutionId: string | null;
}

interface FullMappingRow {
  id: string;
  test_case_id: string;
  language: string;
  framework: string;
  test_runner: string;
  generated_test_file: string;
  page_object_files: string;
  source_origin: "generated" | "imported" | "manually_modified";
  last_execution_id: string | null;
}

export function getAutomationMapping(db: SqlJsDatabase, testCaseId: string): AutomationMapping | null {
  const row = db
    .prepare(`SELECT * FROM automation_mappings WHERE test_case_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .get(testCaseId) as FullMappingRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    testCaseId: row.test_case_id,
    language: row.language,
    framework: row.framework,
    testRunner: row.test_runner,
    generatedTestFile: row.generated_test_file,
    pageObjectFiles: JSON.parse(row.page_object_files || "[]"),
    sourceOrigin: row.source_origin,
    lastExecutionId: row.last_execution_id,
  };
}

export function readProjectFile(project: Project, relativePath: string): string {
  const absPath = resolveWithinProject(project.projectDirectory, relativePath);
  return fs.readFileSync(absPath, "utf8");
}
