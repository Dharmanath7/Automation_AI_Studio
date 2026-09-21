import { describe, it, expect, beforeEach } from "vitest";
import type { SqlJsDatabase } from "../../electron/db/sqlJsWrapper";
import { openDatabase } from "../../electron/db/connection";
import { ensureBootstrapAdmin, login } from "../../electron/services/authService";
import { createSession, validateSession, destroySession } from "../../electron/services/sessionService";

let db: SqlJsDatabase;

beforeEach(async () => {
  db = await openDatabase(":memory:");
  await ensureBootstrapAdmin(db);
});

describe("authService", () => {
  it("seeds exactly one ADMIN user on first run", () => {
    const rows = db.prepare("SELECT username FROM users").all() as { username: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBe("ADMIN");
  });

  it("does not reseed if a user already exists", async () => {
    await ensureBootstrapAdmin(db);
    const rows = db.prepare("SELECT * FROM users").all();
    expect(rows).toHaveLength(1);
  });

  it("logs in with the correct ADMIN/ADMIN bootstrap credentials", async () => {
    const result = await login(db, "ADMIN", "ADMIN");
    expect(result.ok).toBe(true);
  });

  it("username comparison is case-insensitive", async () => {
    const result = await login(db, "admin", "ADMIN");
    expect(result.ok).toBe(true);
  });

  it("password comparison is case-sensitive", async () => {
    const result = await login(db, "ADMIN", "admin");
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown username with the same generic error as a wrong password", async () => {
    const wrongPassword = await login(db, "ADMIN", "wrong");
    const unknownUser = await login(db, "NOBODY", "whatever");
    expect(wrongPassword.ok).toBe(false);
    expect(unknownUser.ok).toBe(false);
    if (!wrongPassword.ok && !unknownUser.ok) {
      expect(wrongPassword.error).toBe(unknownUser.error);
    }
  });

  it("never stores the password in plaintext", () => {
    const row = db.prepare("SELECT password_hash FROM users WHERE username = 'ADMIN'").get() as { password_hash: string };
    expect(row.password_hash).not.toBe("ADMIN");
    expect(row.password_hash.startsWith("$argon2id$")).toBe(true);
  });
});

describe("sessionService", () => {
  it("creates a valid session that validateSession accepts", async () => {
    const loginResult = await login(db, "ADMIN", "ADMIN");
    if (!loginResult.ok) throw new Error("login failed");
    const session = createSession(db, loginResult.userId, false);
    const validated = validateSession(db, session.sessionId);
    expect(validated?.username).toBe("ADMIN");
  });

  it("rejects an unknown session id", () => {
    expect(validateSession(db, "not-a-real-session")).toBeNull();
  });

  it("rejects a session after logout", async () => {
    const loginResult = await login(db, "ADMIN", "ADMIN");
    if (!loginResult.ok) throw new Error("login failed");
    const session = createSession(db, loginResult.userId, false);
    destroySession(db, session.sessionId);
    expect(validateSession(db, session.sessionId)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const loginResult = await login(db, "ADMIN", "ADMIN");
    if (!loginResult.ok) throw new Error("login failed");
    const session = createSession(db, loginResult.userId, false);
    db.prepare("UPDATE user_sessions SET expires_at = ? WHERE id = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      session.sessionId
    );
    expect(validateSession(db, session.sessionId)).toBeNull();
  });
});
