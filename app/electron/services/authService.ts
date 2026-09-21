import argon2 from "argon2";
import { v4 as uuidv4 } from "uuid";
import type { SqlJsDatabase } from "../db/sqlJsWrapper";

export type LoginResult =
  | { ok: true; userId: string; username: string; role: string }
  | { ok: false; error: string };

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Seeds the local ADMIN/ADMIN bootstrap account only if no users exist yet. */
export async function ensureBootstrapAdmin(db: SqlJsDatabase): Promise<void> {
  const row = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
  if (row.c > 0) return;

  const passwordHash = await hashPassword("ADMIN");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, is_active, created_at, updated_at)
     VALUES (?, 'ADMIN', ?, 'admin', 1, ?, ?)`
  ).run(uuidv4(), passwordHash, now, now);
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  is_active: number;
}

/**
 * Verifies credentials. Username comparison is case-insensitive; password
 * comparison is case-sensitive and happens only inside argon2.verify.
 * Always returns the same generic error for "no such user" and "wrong
 * password" to avoid username enumeration (docs/SECURITY.md §1).
 */
export async function login(
  db: SqlJsDatabase,
  username: string,
  password: string
): Promise<LoginResult> {
  const user = db
    .prepare(
      `SELECT id, username, password_hash, role, is_active FROM users WHERE username_lower = lower(?)`
    )
    .get(username) as UserRow | undefined;

  if (!user || !user.is_active) {
    await argon2.hash("timing-normalization-" + Math.random());
    return { ok: false, error: "Invalid username or password" };
  }

  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) {
    return { ok: false, error: "Invalid username or password" };
  }

  return { ok: true, userId: user.id, username: user.username, role: user.role };
}

export async function changePassword(
  db: SqlJsDatabase,
  userId: string,
  newPassword: string
): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(
    passwordHash,
    new Date().toISOString(),
    userId
  );
}
