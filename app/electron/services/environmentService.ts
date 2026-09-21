import { v4 as uuidv4 } from "uuid";
import type { SqlJsDatabase } from "../db/sqlJsWrapper";

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  baseUrl: string;
  apiUrl: string | null;
  defaultCredentialProfileId: string | null;
  defaultBrowserId: string | null;
  timeoutMs: number;
  customVariables: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEnvironmentInput {
  projectId: string;
  name: string;
  baseUrl: string;
  apiUrl?: string;
  defaultCredentialProfileId?: string;
  defaultBrowserId?: string;
  timeoutMs?: number;
  customVariables?: Record<string, string>;
}

interface EnvironmentRow {
  id: string;
  project_id: string;
  name: string;
  base_url: string;
  api_url: string | null;
  default_credential_profile_id: string | null;
  default_browser_id: string | null;
  timeout_ms: number;
  custom_variables: string;
  created_at: string;
  updated_at: string;
}

function toEnvironment(row: EnvironmentRow): Environment {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    baseUrl: row.base_url,
    apiUrl: row.api_url,
    defaultCredentialProfileId: row.default_credential_profile_id,
    defaultBrowserId: row.default_browser_id,
    timeoutMs: row.timeout_ms,
    customVariables: JSON.parse(row.custom_variables || "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class EnvironmentValidationError extends Error {}

export function createEnvironment(db: SqlJsDatabase, input: CreateEnvironmentInput): Environment {
  const name = input.name.trim();
  const baseUrl = input.baseUrl.trim();
  if (!name) throw new EnvironmentValidationError("Environment name is required.");
  if (!baseUrl) throw new EnvironmentValidationError("Base URL is required.");
  try {
    new URL(baseUrl);
  } catch {
    throw new EnvironmentValidationError(`"${baseUrl}" is not a valid URL.`);
  }

  const existing = db
    .prepare("SELECT id FROM environments WHERE project_id = ? AND name = ?")
    .get(input.projectId, name);
  if (existing) throw new EnvironmentValidationError(`Environment "${name}" already exists for this project.`);

  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO environments
      (id, project_id, name, base_url, api_url, default_credential_profile_id, default_browser_id, timeout_ms, custom_variables, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.projectId,
    name,
    baseUrl,
    input.apiUrl ?? null,
    input.defaultCredentialProfileId ?? null,
    input.defaultBrowserId ?? null,
    input.timeoutMs ?? 30000,
    JSON.stringify(input.customVariables ?? {}),
    now,
    now
  );

  return toEnvironment(db.prepare("SELECT * FROM environments WHERE id = ?").get(id) as EnvironmentRow);
}

export function listEnvironments(db: SqlJsDatabase, projectId: string): Environment[] {
  const rows = db
    .prepare("SELECT * FROM environments WHERE project_id = ? ORDER BY name ASC")
    .all(projectId) as EnvironmentRow[];
  return rows.map(toEnvironment);
}

export function getEnvironment(db: SqlJsDatabase, id: string): Environment | null {
  const row = db.prepare("SELECT * FROM environments WHERE id = ?").get(id) as EnvironmentRow | undefined;
  return row ? toEnvironment(row) : null;
}
