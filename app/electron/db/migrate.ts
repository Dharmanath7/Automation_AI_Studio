import type { SqlJsDatabase } from "./sqlJsWrapper";
import { migrations } from "./migrations";

export function runMigrations(db: SqlJsDatabase): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
  );
  const appliedRows = db.prepare("SELECT id FROM schema_migrations").all() as unknown as { id: string }[];
  const applied = new Set(appliedRows.map((r) => r.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        migration.id,
        new Date().toISOString()
      );
    });
    apply();
  }
}
