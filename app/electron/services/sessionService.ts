import { v4 as uuidv4 } from "uuid";
import type { SqlJsDatabase } from "../db/sqlJsWrapper";

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const REMEMBER_ME_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  sessionId: string;
  userId: string;
  username: string;
  role: string;
  expiresAt: string;
}

export function createSession(
  db: SqlJsDatabase,
  userId: string,
  rememberMe: boolean
): { sessionId: string; expiresAt: string } {
  const now = new Date();
  const ttl = rememberMe ? REMEMBER_ME_TTL_MS : DEFAULT_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttl).toISOString();
  const sessionId = uuidv4();
  db.prepare(
    `INSERT INTO user_sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`
  ).run(sessionId, userId, now.toISOString(), expiresAt, now.toISOString());
  return { sessionId, expiresAt };
}

interface SessionRow {
  sessionId: string;
  expiresAt: string;
  userId: string;
  username: string;
  role: string;
}

/** The real auth boundary: every IPC handler (other than login) calls this. */
export function validateSession(
  db: SqlJsDatabase,
  sessionId: string | null | undefined
): SessionUser | null {
  if (!sessionId) return null;

  const row = db
    .prepare(
      `SELECT s.id as sessionId, s.expires_at as expiresAt, u.id as userId, u.username as username, u.role as role
       FROM user_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND u.is_active = 1`
    )
    .get(sessionId) as SessionRow | undefined;

  if (!row) return null;

  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.prepare("DELETE FROM user_sessions WHERE id = ?").run(sessionId);
    return null;
  }

  db.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    sessionId
  );

  return row;
}

export function destroySession(db: SqlJsDatabase, sessionId: string): void {
  db.prepare("DELETE FROM user_sessions WHERE id = ?").run(sessionId);
}
