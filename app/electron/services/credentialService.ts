import { v4 as uuidv4 } from "uuid";
import type { SqlJsDatabase } from "../db/sqlJsWrapper";
import { encryptWithKey, decryptWithKey } from "./crypto/aesGcm";
import { getVaultKey } from "./crypto/vaultKey";

export interface CredentialProfile {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Masked view for the renderer — never carries a decrypted value. */
export interface CredentialFieldSummary {
  key: string;
  isSecret: boolean;
  maskedValue: string;
  updatedAt: string;
}

interface ProfileRow {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface CredentialRow {
  key: string;
  value_ciphertext: Buffer;
  value_iv: Buffer;
  value_auth_tag: Buffer;
  is_secret: number;
  updated_at: string;
}

export class CredentialValidationError extends Error {}

export function createCredentialProfile(
  db: SqlJsDatabase,
  projectId: string,
  name: string
): CredentialProfile {
  const trimmed = name.trim();
  if (!trimmed) throw new CredentialValidationError("Credential profile name is required.");
  const existing = db
    .prepare("SELECT id FROM credential_profiles WHERE project_id = ? AND name = ?")
    .get(projectId, trimmed);
  if (existing) throw new CredentialValidationError(`Credential profile "${trimmed}" already exists.`);

  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO credential_profiles (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, projectId, trimmed, now, now);

  const row = db.prepare("SELECT * FROM credential_profiles WHERE id = ?").get(id) as ProfileRow;
  return { id: row.id, projectId: row.project_id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function listCredentialProfiles(db: SqlJsDatabase, projectId: string): CredentialProfile[] {
  const rows = db
    .prepare("SELECT * FROM credential_profiles WHERE project_id = ? ORDER BY name ASC")
    .all(projectId) as ProfileRow[];
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** Sets (creates or replaces) one field's encrypted value. Never returns the plaintext. */
export function setCredentialField(
  db: SqlJsDatabase,
  profileId: string,
  key: string,
  value: string,
  isSecret = true
): void {
  const trimmedKey = key.trim();
  if (!trimmedKey) throw new CredentialValidationError("Credential field key is required.");
  if (!value) throw new CredentialValidationError("Credential value cannot be empty.");

  const { ciphertext, iv, authTag } = encryptWithKey(value, getVaultKey());
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT id FROM credentials WHERE credential_profile_id = ? AND key = ?")
    .get(profileId, trimmedKey) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE credentials SET value_ciphertext = ?, value_iv = ?, value_auth_tag = ?, is_secret = ?, updated_at = ? WHERE id = ?`
    ).run(ciphertext, iv, authTag, isSecret ? 1 : 0, now, existing.id);
  } else {
    db.prepare(
      `INSERT INTO credentials (id, credential_profile_id, key, value_ciphertext, value_iv, value_auth_tag, is_secret, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(uuidv4(), profileId, trimmedKey, ciphertext, iv, authTag, isSecret ? 1 : 0, now, now);
  }
}

/** Masked list for display in the UI — values are never sent to the renderer. */
export function listCredentialFields(db: SqlJsDatabase, profileId: string): CredentialFieldSummary[] {
  const rows = db
    .prepare(
      "SELECT key, value_ciphertext, value_iv, value_auth_tag, is_secret, updated_at FROM credentials WHERE credential_profile_id = ? ORDER BY key ASC"
    )
    .all(profileId) as CredentialRow[];
  return rows.map((r) => ({
    key: r.key,
    isSecret: !!r.is_secret,
    maskedValue: r.is_secret ? "••••••••" : "(stored)",
    updatedAt: r.updated_at,
  }));
}

export function deleteCredentialProfile(db: SqlJsDatabase, profileId: string): void {
  db.prepare("DELETE FROM credential_profiles WHERE id = ?").run(profileId);
}

/**
 * Decrypts every field in a profile. Main-process-only; never call this in a
 * path whose result reaches the renderer (docs/SECURITY.md §3). Used solely by
 * the execution service to build a child process's environment.
 */
export function getDecryptedCredentials(db: SqlJsDatabase, profileId: string): Record<string, string> {
  const rows = db
    .prepare("SELECT key, value_ciphertext, value_iv, value_auth_tag FROM credentials WHERE credential_profile_id = ?")
    .all(profileId) as CredentialRow[];
  const key = getVaultKey();
  const result: Record<string, string> = {};
  for (const r of rows) {
    result[r.key] = decryptWithKey(
      { ciphertext: r.value_ciphertext, iv: r.value_iv, authTag: r.value_auth_tag },
      key
    );
  }
  return result;
}
