import migration001 from "./001_init.sql?raw";

export interface Migration {
  id: string;
  sql: string;
}

/** Ordered list of migrations, applied once each and tracked in schema_migrations. */
export const migrations: Migration[] = [{ id: "001_init", sql: migration001 }];
