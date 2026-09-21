import { v4 as uuidv4 } from "uuid";
import fs from "node:fs";
import type { SqlJsDatabase } from "../db/sqlJsWrapper";

export interface Project {
  id: string;
  name: string;
  code: string;
  description: string | null;
  appType: "web" | "api" | "web_api";
  projectDirectory: string;
  gitRepositoryUrl: string | null;
  language: string;
  framework: string;
  testRunner: string;
  style: string;
  architecture: string | null;
  defaultBrowserId: string | null;
  defaultEnvironmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  code: string;
  description?: string;
  appType?: "web" | "api" | "web_api";
  projectDirectory: string;
  gitRepositoryUrl?: string;
  language?: string;
  framework?: string;
  testRunner?: string;
  style?: string;
  defaultBrowserId?: string;
}

interface ProjectRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  app_type: "web" | "api" | "web_api";
  project_directory: string;
  git_repository_url: string | null;
  language: string;
  framework: string;
  test_runner: string;
  style: string;
  architecture: string | null;
  default_browser_id: string | null;
  default_environment_id: string | null;
  created_at: string;
  updated_at: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    appType: row.app_type,
    projectDirectory: row.project_directory,
    gitRepositoryUrl: row.git_repository_url,
    language: row.language,
    framework: row.framework,
    testRunner: row.test_runner,
    style: row.style,
    architecture: row.architecture,
    defaultBrowserId: row.default_browser_id,
    defaultEnvironmentId: row.default_environment_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ProjectValidationError extends Error {}

export function createProject(db: SqlJsDatabase, input: CreateProjectInput): Project {
  const name = input.name.trim();
  const code = input.code.trim();
  const projectDirectory = input.projectDirectory.trim();

  if (!name) throw new ProjectValidationError("Project name is required.");
  if (!code) throw new ProjectValidationError("Project code is required.");
  if (!projectDirectory) throw new ProjectValidationError("Project directory is required.");

  const existing = db.prepare("SELECT id FROM projects WHERE code = ?").get(code);
  if (existing) throw new ProjectValidationError(`Project code "${code}" is already in use.`);

  if (!fs.existsSync(projectDirectory)) {
    fs.mkdirSync(projectDirectory, { recursive: true });
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects
      (id, name, code, description, app_type, project_directory, git_repository_url,
       language, framework, test_runner, style, architecture, default_browser_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    code,
    input.description ?? null,
    input.appType ?? "web",
    projectDirectory,
    input.gitRepositoryUrl ?? null,
    input.language ?? "python",
    input.framework ?? "playwright",
    input.testRunner ?? "pytest",
    input.style ?? "page_object_model",
    input.style ?? "page_object_model",
    input.defaultBrowserId ?? "browser-chrome",
    now,
    now
  );
  db.prepare("INSERT INTO test_case_sequence (project_id, next_value) VALUES (?, 1)").run(id);

  return toProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow);
}

export function listProjects(db: SqlJsDatabase): Project[] {
  const rows = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[];
  return rows.map(toProject);
}

export function getProject(db: SqlJsDatabase, id: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return row ? toProject(row) : null;
}

export function setDefaultEnvironment(db: SqlJsDatabase, projectId: string, environmentId: string): void {
  db.prepare("UPDATE projects SET default_environment_id = ?, updated_at = ? WHERE id = ?").run(
    environmentId,
    new Date().toISOString(),
    projectId
  );
}
