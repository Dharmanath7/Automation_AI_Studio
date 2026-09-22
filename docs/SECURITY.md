# Security

## 1. Authentication (Automation AI Studio login)

- Bootstrap account for MVP: `ADMIN` / `ADMIN`, seeded by a migration on first run
  **only if the `users` table is empty**. This is explicitly a local-MVP bootstrap
  credential, not a production default — the login screen and `README.md` both say
  so, and Settings will offer "Change Password" from Phase 1 onward (the account is
  not usable without at least the ability to change its password).
- Password hashing: **argon2id** (`argon2` npm package, native but with prebuilt
  binaries; memory cost tuned for a desktop app, not a server farm). Never MD5/SHA1/
  plain SHA256-without-salt, never plaintext.
- Username comparison is case-insensitive (compares against a generated
  `username_lower` column); password comparison is case-sensitive and happens only
  inside `argon2.verify`, never via string equality on a decrypted value (there is no
  decrypted value — hashing is one-way).
- No password, hash, or hash fragment is ever included in a log line, an error
  message returned to the renderer, or a thrown exception's message. The auth
  service catches verification errors and returns a generic
  `"Invalid username or password"` regardless of whether the username or the
  password was wrong (prevents username enumeration).
- Sessions: a `user_sessions` row is created on successful login with a random UUID
  token; the token is held in the renderer's memory (Zustand store) for the life of
  the window and sent on every IPC call needing auth. It is **not** persisted to
  `localStorage` in the renderer (renderer storage is a weaker boundary than the
  main-process-owned session table). "Remember Me" persists only a reference the
  main process can use to silently re-issue a session on next launch, stored via
  Electron `safeStorage`, not as the raw session token in a plaintext file.
- Session expiry: default 12 hours, 30 days with "Remember Me"; every IPC call
  extends `last_seen_at`; expired sessions are rejected server-side (main process),
  not just hidden client-side.
- All IPC handlers other than `auth:login` require a valid, unexpired session; the
  renderer's route guard (`ProtectedRoute`) is a UX convenience, not the actual
  security boundary — the main process is.

## 2. Process/IPC boundary

- Every `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, no `remote` module.
- `preload.ts` exposes a fixed, typed set of functions via `contextBridge` (e.g.
  `window.studio.auth.login(...)`, `window.studio.projects.list()`); it never
  exposes `ipcRenderer` itself, `require`, or raw Node globals.
- Every IPC handler validates its input shape (zod schemas in `ipc/`) before it
  reaches a service — a malformed or malicious renderer-side payload cannot reach
  `db/` or `child_process` argument construction unvalidated.

## 3. Credential Vault (application-under-test secrets)

These are **not** the Automation AI Studio login credentials — they are secrets for
the applications being tested (TST Admin, API Service Account, etc.), stored per
`DATA_MODEL.md`'s `credentials` table.

- Encryption: AES-256-GCM. Each secret value gets its own random 12-byte IV; the
  GCM auth tag is stored alongside the ciphertext so tampering is detected on
  decrypt, not silently accepted.
- Key management: a single vault data-encryption key (DEK) is generated on first
  run and wrapped (encrypted) using Electron's `safeStorage` API, which delegates to
  the OS credential store (DPAPI on Windows). The wrapped key is the only thing
  written to disk (`%APPDATA%\Automation AI Studio\vault.key`); the raw DEK exists
  only in main-process memory after unwrap. If `safeStorage.isEncryptionAvailable()`
  is false (rare on Windows, but possible in some locked-down environments), the app
  refuses to store new secrets and shows an explicit warning rather than silently
  falling back to a weaker scheme.
- Decrypted values live in memory only for the duration of: (a) rendering a masked
  field in the UI (never — the UI never receives a decrypted secret, only a
  `"••••••"` placeholder plus a "reveal" action gated by re-auth in a later phase),
  or (b) building the environment/credential payload for a test execution child
  process, zeroed out (`buffer.fill(0)`) after the child process exits.
- Never logged: the structured logger (`SECURITY.md` mirrors `docs/` cross-links —
  see also the product brief §48) has a redaction filter keyed on field names
  (`password`, `secret`, `token`, `apiKey`, ...) applied to every log call as a
  defense-in-depth measure, in addition to services simply not logging credential
  objects in the first place.
- Never in reports/screenshots: password-type fields recorded by the browser
  recorder are masked at the point of recording (see below), so the *value* recorded
  into the Test Model is a variable reference, not a literal — there is nothing
  secret to leak into a generated report. Screenshot masking of on-screen password
  fields (visual redaction) is a Phase 2 enhancement, tracked in `ROADMAP.md`.
- Never committed to git: `.gitignore` excludes the entire
  `%APPDATA%\Automation AI Studio` data directory is outside any project repo by
  construction (it's in the OS user profile, not `project_directory`); within a
  *generated automation project*, `.env` / `.env.*` are gitignored by the generator's
  own scaffolded `.gitignore` (`AUTOMATION_ADAPTERS.md`), and credentials are passed
  to the test run as process environment variables, never written into generated
  source files.

## 4. Password-field detection during recording

When the recorder's injected page script observes `type === "password"` on the
changed field, it does **not** read or send the field's value at all — see
`electron/services/recorder/pageScript.ts` and `recorderService.ts`. The main
process converts that event directly into
`{ kind: "variable", path: "credentials.default.password" }` in the Test Model,
with a note flagging it for the user to point at the right profile if the
project uses more than one. This is enforced client-side at the point of
capture, not by a later "don't save literal passwords" filter — the raw
keystroke value never leaves the recorded page's own JS realm, let alone
reaches the Studio's process or database. (Mapping to a *non-default*
credential profile by name is a manual edit in the review step today — see
`ROADMAP.md`.)

## 5. Input validation / command construction safety

- No shell string concatenation for child processes. `execution/PythonExecutionAdapter`
  uses `child_process.spawn(cmd, argsArray, { shell: false })` with an explicit
  argv array — arguments (file paths, marker expressions) are never interpolated
  into a shell string, which forecloses the classic command-injection path even
  though inputs here are locally-authored, not attacker-controlled network input.
- File system operations (project directory selection, generated file writes) are
  confined to paths under the project's configured `project_directory`; the
  generator refuses to write outside it (path traversal check via
  `path.resolve` + prefix comparison) even though this is a local desktop app trusted
  by its single user, because a stray `../../` in a test name should error, not
  write files somewhere surprising.
- Destructive actions (deleting a project, deleting a test case, overwriting a
  manually-modified generated file) always require an explicit confirm step in the
  UI; there is no "silent cleanup" path.

## 6. Source code ownership (generated vs. manual)

Every generated file recorded in `automation_mappings` carries `source_origin`
(`generated` | `imported` | `manually_modified`) and a `content_hash` taken at the
moment of generation. Before regenerating:

1. Read the file's current hash from disk.
2. If it matches `content_hash`, the file is unchanged since generation → safe to
   overwrite.
3. If it differs, the file was edited outside the Studio → present
   `Generated Version / Existing Version / View Diff / Merge / Overwrite / Cancel`
   (Monaco diff view) and require an explicit user choice. `Import Existing Project`
   (§10 of the product brief) always sets `source_origin = "imported"` and is never
   auto-overwritten by code generation.

## 7. Logging

Structured JSON logs (pino) to `%APPDATA%\Automation AI Studio\logs\`, rotated
daily, categorized by area (`auth`, `db`, `projects`, `recorder`, `browser`,
`codegen`, `execution`, `reporting`, `git`, `runtime`) matching product brief §48.
Redaction filter (see §3 above) runs on every log call regardless of category.

## 8. Future auth (documented now, not built in Phase 1)

The `users.role` column and session model are shaped so that multi-user RBAC
(Admin/QA Lead/Automation Engineer/Tester/Viewer), and eventually SSO (Entra ID) /
LDAP, are additive: new columns/tables (`roles`, `permissions`,
`sso_identities`), not a redesign of `user_sessions`. Not implemented in Phase 1.
