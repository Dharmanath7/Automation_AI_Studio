# Data Model — Automation AI Studio

SQLite (file-based, via `better-sqlite3`), stored at
`%APPDATA%\Automation AI Studio\studio.db`. Migrations are plain numbered `.sql`
files in `app/electron/db/migrations`, applied in order and tracked in a
`schema_migrations` table. IDs are UUID v4 text (`TEXT PRIMARY KEY`) except where
noted, so records created offline never collide and can later sync.

Timestamps are ISO-8601 UTC strings (`created_at`, `updated_at`) on every table.

## Phase 1 entities

### users
Local Automation AI Studio accounts (distinct from application-under-test credentials
in the Credential Vault).

| column | type | notes |
|---|---|---|
| id | TEXT PK | uuid |
| username | TEXT UNIQUE | stored/compared case-insensitively (`username_lower`) |
| username_lower | TEXT | generated, indexed |
| password_hash | TEXT | argon2id hash, never the raw password |
| role | TEXT | `admin` for MVP; column exists for Phase 6+ RBAC |
| is_active | INTEGER | 0/1 |
| created_at, updated_at | TEXT | |

### user_sessions
| column | type | notes |
|---|---|---|
| id | TEXT PK | uuid, used as the session token |
| user_id | TEXT FK→users.id | |
| created_at | TEXT | |
| expires_at | TEXT | session expiry; default 12h, "Remember Me" extends to 30d |
| last_seen_at | TEXT | updated on IPC activity, for idle-timeout in a later phase |

### projects
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| name | TEXT | e.g. "symplr Directory" |
| code | TEXT | short code, unique |
| description | TEXT NULL | |
| app_type | TEXT | `web` \| `api` \| `web_api` |
| project_directory | TEXT | absolute path where generated automation code lives |
| git_repository_url | TEXT NULL | |
| language | TEXT | `python` (Phase 1) |
| framework | TEXT | `playwright` (Phase 1) |
| test_runner | TEXT | `pytest` (Phase 1) |
| style | TEXT | `page_object_model` (Phase 1) |
| architecture | TEXT | free-form label, defaults to style |
| default_browser_id | TEXT FK→browser_configs.id NULL | |
| default_environment_id | TEXT FK→environments.id NULL | |
| created_at, updated_at | TEXT | |

### project_settings
Key/value overflow for project-level settings that don't need dedicated columns
(future stack-specific options), `UNIQUE(project_id, key)`.

### environments
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| project_id | TEXT FK→projects.id | |
| name | TEXT | e.g. `TST`, `STG`, `UAT` |
| base_url | TEXT | |
| api_url | TEXT NULL | |
| default_credential_profile_id | TEXT FK→credential_profiles.id NULL | |
| default_browser_id | TEXT FK→browser_configs.id NULL | |
| timeout_ms | INTEGER | default 30000 |
| custom_variables | TEXT | JSON object, e.g. `{"TENANT":"NYP"}` |
| created_at, updated_at | TEXT | |

`UNIQUE(project_id, name)`.

### credential_profiles
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| project_id | TEXT FK→projects.id | |
| name | TEXT | e.g. "TST Admin" |
| created_at, updated_at | TEXT | |

### credentials
Individual secret fields belonging to a profile. Values are **never** stored in
plaintext — see `SECURITY.md` §3.

| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| credential_profile_id | TEXT FK→credential_profiles.id | |
| key | TEXT | `username` \| `password` \| `api_token` \| `client_id` \| `client_secret` \| custom |
| value_ciphertext | BLOB | AES-256-GCM ciphertext |
| value_iv | BLOB | |
| value_auth_tag | BLOB | |
| is_secret | INTEGER | 1 for password/token/secret fields (masked everywhere); 0 for e.g. plain username if the user opts to store it unmasked — default 1 |
| created_at, updated_at | TEXT | |

`UNIQUE(credential_profile_id, key)`.

### test_cases
Test Case is deliberately separate from its automation implementation (§22 of the
product brief).

| column | type | notes |
|---|---|---|
| id | TEXT PK | human-friendly displayed as `TC-<n>` via a separate `sequence` INTEGER AUTOINCREMENT column |
| sequence | INTEGER AUTOINCREMENT | for `TC-1024` style display ids |
| project_id | TEXT FK→projects.id | |
| title | TEXT | |
| description | TEXT NULL | |
| preconditions | TEXT NULL | |
| priority | TEXT | `low` \| `medium` \| `high` \| `critical` |
| feature | TEXT NULL | |
| module | TEXT NULL | |
| requirement_ref | TEXT NULL | ticket/requirement id |
| automation_status | TEXT | `manual` \| `planned` \| `automated` \| `needs_maintenance` |
| test_model_json | TEXT | the framework-neutral Test Model for this test — see `TEST_MODEL.md` |
| created_at, updated_at | TEXT | |

### test_tags / test_case_tags
`test_tags(id, name UNIQUE)` seeded with `bvt, smoke, sanity, regression, critical,
end_to_end, negative, cross_browser`, user can add custom tags.
`test_case_tags(test_case_id, tag_id)` composite PK — many-to-many.

### test_suites / test_suite_cases
Named groupings beyond tags (a suite can be tag-derived or an explicit hand-picked
list); `test_suite_cases(test_suite_id, test_case_id, position)`.

### automation_mappings
Where the Test Case's generated implementation lives, and who owns each file.

| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| test_case_id | TEXT FK→test_cases.id | |
| language | TEXT | |
| framework | TEXT | |
| test_runner | TEXT | |
| generated_test_file | TEXT | path relative to `project.project_directory` |
| page_object_files | TEXT | JSON array of relative paths |
| test_data_files | TEXT | JSON array of relative paths |
| source_origin | TEXT | `generated` \| `imported` \| `manually_modified` — see `SECURITY.md` §6 |
| content_hash | TEXT | hash of the file content at last generation, to detect manual edits |
| last_execution_id | TEXT FK→executions.id NULL | |
| created_at, updated_at | TEXT | |

### reusable_flows
| id, project_id, name, description, steps_json (array of Test Steps), created_at, updated_at |

### executions
One run of one or more tests (a single test run, a suite run, a BVT run, ...).

| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| project_id | TEXT FK→projects.id | |
| environment_id | TEXT FK→environments.id | |
| browser_config_id | TEXT FK→browser_configs.id | |
| trigger_type | TEXT | `single` \| `suite` \| `bvt` \| `smoke` \| `sanity` \| `regression` \| `custom` |
| build_id | TEXT NULL | free-text build/version label |
| mode | TEXT | `headed` \| `headless` |
| status | TEXT | `running` \| `passed` \| `failed` \| `partially_failed` \| `errored` |
| started_at, finished_at | TEXT | |
| duration_ms | INTEGER NULL | |
| triggered_by_user_id | TEXT FK→users.id | |

### execution_tests
One test's result within an execution.

| id, execution_id, test_case_id, automation_mapping_id, status (`passed`\|`failed`\|`skipped`\|`errored`), duration_ms, error_message, failed_step_index NULL, failure_classification (`locator`\|`assertion`\|`application`\|`api`\|`auth`\|`test_data`\|`timeout`\|`environment`\|`browser`\|`unknown`\|NULL), failure_classification_confirmed (0/1, manual override flag), started_at, finished_at |

### execution_steps
Per-step timeline entry for a given `execution_tests` row — step index, step type,
status, duration_ms, screenshot artifact id (nullable).

### screenshots / artifacts
`artifacts(id, execution_test_id, kind [`screenshot`|`video`|`trace`|`console_log`|`network_log`], step_index NULL, file_path, created_at)`.
Files live under `%APPDATA%\Automation AI Studio\artifacts\<execution_id>\...`, never
inside the project's own repo, so they're never accidentally committed.

### browser_configs
`id, name, engine (`chromium`|`chrome`|`firefox`|`edge`|`webkit`), is_builtin`.
Seeded with Chrome/Chromium (Phase 1), Firefox/Edge/WebKit rows present but marked
`Coming Soon` in the UI until their execution adapters are wired up.

### framework_configs
Reference table describing the dependent-dropdown matrix from the product brief
(§6): `language, framework, test_runner, style, is_available`. Phase 1 seeds exactly
one `is_available=1` row: `python / playwright / pytest / page_object_model`. All
others are seeded but `is_available=0` so the UI can show them as "Coming Soon"
rather than inventing the list at runtime.

### test_data_profiles
Saved random-data generation presets per project (future: reusable data sets).

### git_configs
Per-project git settings (`remote_url`, `default_branch`) — read-only status/diff in
Phase 1 per `ROADMAP.md`; commit/push UI comes later.

### runtime_configs
Cache of the last Runtime Manager scan result per machine (`tool`, `detected_version`,
`status`, `checked_at`) so the Runtime Manager page doesn't re-shell-out on every
render.

## Relationships (Phase 1 subset)

```
users 1─* user_sessions

projects 1─* environments
projects 1─* credential_profiles 1─* credentials
projects 1─* test_cases
projects 1─* executions

test_cases 1─* automation_mappings   (normally exactly one active mapping per stack)
test_cases *─* test_tags              (via test_case_tags)
test_cases *─* test_suites            (via test_suite_cases)

executions 1─* execution_tests 1─* execution_steps
execution_tests 1─* artifacts

environments *─1 credential_profiles  (default_credential_profile_id)
environments *─1 browser_configs      (default_browser_id)
```

## Data ownership boundary

The Studio's SQLite database stores the Test Model, execution history, and
project/environment/credential metadata. It **never** stores generated source code —
that always lives on disk in the project's own `project_directory`, so it is normal,
diffable, git-trackable code, not something trapped inside the app's database.
