-- Automation AI Studio — initial schema (Phase 1)
-- See docs/DATA_MODEL.md for the authoritative description of every table.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  username_lower TEXT GENERATED ALWAYS AS (lower(username)) STORED,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_users_username_lower ON users(username_lower);

CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);

CREATE TABLE browser_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  engine TEXT NOT NULL CHECK (engine IN ('chromium','chrome','firefox','edge','webkit')),
  is_builtin INTEGER NOT NULL DEFAULT 1,
  is_available INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE framework_configs (
  id TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  framework TEXT NOT NULL,
  test_runner TEXT NOT NULL,
  style TEXT NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 0,
  UNIQUE(language, framework, test_runner, style)
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  app_type TEXT NOT NULL DEFAULT 'web' CHECK (app_type IN ('web','api','web_api')),
  project_directory TEXT NOT NULL,
  git_repository_url TEXT,
  language TEXT NOT NULL DEFAULT 'python',
  framework TEXT NOT NULL DEFAULT 'playwright',
  test_runner TEXT NOT NULL DEFAULT 'pytest',
  style TEXT NOT NULL DEFAULT 'page_object_model',
  architecture TEXT,
  default_browser_id TEXT REFERENCES browser_configs(id),
  default_environment_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_settings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  UNIQUE(project_id, key)
);

CREATE TABLE environments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_url TEXT,
  default_credential_profile_id TEXT,
  default_browser_id TEXT REFERENCES browser_configs(id),
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  custom_variables TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE credential_profiles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  credential_profile_id TEXT NOT NULL REFERENCES credential_profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_ciphertext BLOB NOT NULL,
  value_iv BLOB NOT NULL,
  value_auth_tag BLOB NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(credential_profile_id, key)
);

CREATE TABLE test_cases (
  id TEXT PRIMARY KEY,
  sequence INTEGER,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  preconditions TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  feature TEXT,
  module TEXT,
  requirement_ref TEXT,
  automation_status TEXT NOT NULL DEFAULT 'planned' CHECK (automation_status IN ('manual','planned','automated','needs_maintenance')),
  test_model_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_test_cases_project ON test_cases(project_id);

CREATE TABLE test_case_sequence (
  project_id TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE test_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE test_case_tags (
  test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES test_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (test_case_id, tag_id)
);

CREATE TABLE test_suites (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE test_suite_cases (
  test_suite_id TEXT NOT NULL REFERENCES test_suites(id) ON DELETE CASCADE,
  test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (test_suite_id, test_case_id)
);

CREATE TABLE automation_mappings (
  id TEXT PRIMARY KEY,
  test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  framework TEXT NOT NULL,
  test_runner TEXT NOT NULL,
  generated_test_file TEXT NOT NULL,
  page_object_files TEXT NOT NULL DEFAULT '[]',
  test_data_files TEXT NOT NULL DEFAULT '[]',
  source_origin TEXT NOT NULL DEFAULT 'generated' CHECK (source_origin IN ('generated','imported','manually_modified')),
  content_hash TEXT,
  last_execution_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_automation_mappings_test_case ON automation_mappings(test_case_id);

CREATE TABLE reusable_flows (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  steps_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id TEXT NOT NULL REFERENCES environments(id),
  browser_config_id TEXT REFERENCES browser_configs(id),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('single','suite','bvt','smoke','sanity','regression','custom')),
  build_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('headed','headless')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','passed','failed','partially_failed','errored')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  triggered_by_user_id TEXT REFERENCES users(id)
);
CREATE INDEX idx_executions_project ON executions(project_id);

CREATE TABLE execution_tests (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  test_case_id TEXT REFERENCES test_cases(id),
  automation_mapping_id TEXT REFERENCES automation_mappings(id),
  status TEXT NOT NULL CHECK (status IN ('passed','failed','skipped','errored')),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  failed_step_index INTEGER,
  failure_classification TEXT CHECK (failure_classification IN ('locator','assertion','application','api','auth','test_data','timeout','environment','browser','unknown')),
  failure_classification_confirmed INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);
CREATE INDEX idx_execution_tests_execution ON execution_tests(execution_id);

CREATE TABLE execution_steps (
  id TEXT PRIMARY KEY,
  execution_test_id TEXT NOT NULL REFERENCES execution_tests(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  step_id TEXT,
  step_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed','failed','skipped')),
  duration_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_execution_steps_execution_test ON execution_steps(execution_test_id);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  execution_test_id TEXT NOT NULL REFERENCES execution_tests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('screenshot','video','trace','console_log','network_log')),
  step_index INTEGER,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_artifacts_execution_test ON artifacts(execution_test_id);

CREATE TABLE test_data_profiles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE git_configs (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  remote_url TEXT,
  default_branch TEXT NOT NULL DEFAULT 'main'
);

CREATE TABLE runtime_configs (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  detected_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('installed','missing','error')),
  details TEXT,
  checked_at TEXT NOT NULL
);

-- Seed data --------------------------------------------------------------

INSERT INTO browser_configs (id, name, engine, is_builtin, is_available) VALUES
  ('browser-chrome', 'Chrome', 'chrome', 1, 1),
  ('browser-chromium', 'Chromium', 'chromium', 1, 1),
  ('browser-firefox', 'Firefox', 'firefox', 1, 0),
  ('browser-edge', 'Microsoft Edge', 'edge', 1, 0),
  ('browser-webkit', 'WebKit', 'webkit', 1, 0);

INSERT INTO framework_configs (id, language, framework, test_runner, style, is_available) VALUES
  ('fw-py-pw-pytest-pom', 'python', 'playwright', 'pytest', 'page_object_model', 1),
  ('fw-py-se-pytest-pom', 'python', 'selenium', 'pytest', 'page_object_model', 0),
  ('fw-py-se-behave-bdd', 'python', 'selenium', 'behave', 'bdd', 0),
  ('fw-py-pw-pytestbdd-bdd', 'python', 'playwright', 'pytest-bdd', 'bdd', 0),
  ('fw-java-pw-junit-pom', 'java', 'playwright', 'junit', 'page_object_model', 0),
  ('fw-java-pw-testng-pom', 'java', 'playwright', 'testng', 'page_object_model', 0),
  ('fw-java-se-junit-pom', 'java', 'selenium', 'junit', 'page_object_model', 0),
  ('fw-java-se-testng-pom', 'java', 'selenium', 'testng', 'page_object_model', 0),
  ('fw-java-se-cucumber-bdd', 'java', 'selenium', 'cucumber', 'bdd', 0),
  ('fw-csharp-pw-nunit-pom', 'csharp', 'playwright', 'nunit', 'page_object_model', 0),
  ('fw-csharp-se-nunit-pom', 'csharp', 'selenium', 'nunit', 'page_object_model', 0),
  ('fw-csharp-se-reqnroll-bdd', 'csharp', 'selenium', 'reqnroll', 'bdd', 0),
  ('fw-robot-browser', 'robot', 'robot-browser', 'robot', 'keyword_driven', 0),
  ('fw-robot-selenium', 'robot', 'robot-seleniumlibrary', 'robot', 'keyword_driven', 0);

INSERT INTO test_tags (id, name) VALUES
  ('tag-bvt', 'bvt'), ('tag-smoke', 'smoke'), ('tag-sanity', 'sanity'),
  ('tag-regression', 'regression'), ('tag-critical', 'critical'),
  ('tag-e2e', 'end_to_end'), ('tag-negative', 'negative'),
  ('tag-cross-browser', 'cross_browser');
