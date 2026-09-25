import migration001 from "./001_init.sql?raw";
import migration002 from "./002_test_case_delete.sql?raw";
import migration003 from "./003_failure_step_description.sql?raw";

export interface Migration {
  id: string;
  sql: string;
}

/** Ordered list of migrations, applied once each and tracked in schema_migrations. */
export const migrations: Migration[] = [
  { id: "001_init", sql: migration001 },
  { id: "002_test_case_delete", sql: migration002 },
  { id: "003_failure_step_description", sql: migration003 },
];
