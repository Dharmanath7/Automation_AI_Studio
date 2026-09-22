-- Lets a Test Case be deleted even after it has been executed. The original
-- execution_tests.test_case_id / automation_mapping_id foreign keys had no
-- ON DELETE action, which SQLite defaults to NO ACTION — deleting a test
-- case with execution history would fail with a constraint violation.
-- Execution history is kept (for reporting/audit) with these columns set to
-- NULL rather than the row being deleted.

PRAGMA foreign_keys = OFF;

CREATE TABLE execution_tests_new (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  test_case_id TEXT REFERENCES test_cases(id) ON DELETE SET NULL,
  automation_mapping_id TEXT REFERENCES automation_mappings(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('passed','failed','skipped','errored')),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  failed_step_index INTEGER,
  failure_classification TEXT CHECK (failure_classification IN ('locator','assertion','application','api','auth','test_data','timeout','environment','browser','unknown')),
  failure_classification_confirmed INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);

INSERT INTO execution_tests_new
  (id, execution_id, test_case_id, automation_mapping_id, status, duration_ms, error_message, failed_step_index, failure_classification, failure_classification_confirmed, started_at, finished_at)
SELECT
  id, execution_id, test_case_id, automation_mapping_id, status, duration_ms, error_message, failed_step_index, failure_classification, failure_classification_confirmed, started_at, finished_at
FROM execution_tests;

DROP TABLE execution_tests;
ALTER TABLE execution_tests_new RENAME TO execution_tests;
CREATE INDEX idx_execution_tests_execution ON execution_tests(execution_id);

PRAGMA foreign_keys = ON;
