# Architecture — Automation AI Studio

## 1. Product summary

Automation AI Studio is a Windows desktop application that lets manual testers and
automation engineers create, record, generate, organize, execute, maintain, and
analyze browser automation tests without hand-writing framework code — while still
producing professional, maintainable, inspectable source code for engineers who want
to work in it directly.

The core architectural promise: **the UI never talks directly to a target automation
framework**. Every interaction — a recorded click, a manually built step, an
AI-generated step — is normalized into a **framework-neutral Test Model** first. Code
generator adapters turn that model into real source files (Page Objects, test files,
config) for a specific language/framework/runner combination. Execution adapters run
those generated projects and normalize their results back into a single reporting
schema, regardless of which stack produced them.

This indirection is what allows Automation AI Studio to eventually support Python,
Java, C#, and Robot Framework projects side by side without rewriting the UI, the
recorder, the test editor, or the reporting engine.

## 2. Technology stack

| Layer | Technology | Why |
|---|---|---|
| Desktop shell | Electron | Cross-window native app, full Node access for spawning processes (pytest, git, etc.), file system access for generated code |
| UI | React + TypeScript + Vite | Fast dev loop, typed UI, componentized editors (test editor, reporting dashboard) |
| Routing | react-router-dom (HashRouter, required for Electron `file://` packaging) | Protected routes, deep-linkable pages |
| Local database | better-sqlite3 (SQLite file) | Synchronous, embedded, zero-install, transactional; matches a single-user desktop app |
| Credential encryption | AES-256-GCM via Node `crypto`, key wrapped with Electron `safeStorage` when available | See `SECURITY.md` |
| Browser automation (recorder + Phase 1 execution target) | Playwright (Python, invoked as a subprocess) for generated tests; `playwright` npm package for the in-app recorder | Keeps "what the app automates" (Python/Playwright) decoupled from "what the app is built in" (Electron/TS) — see §4 |
| Code editor (Code View) | Monaco Editor | Same editor VS Code uses; syntax highlighting, read-first-class for generated Python |
| Testing (of the Studio itself) | Vitest (unit/component), Playwright Test (E2E against the Electron app) | See §9 |
| Packaging | electron-builder | Produces `AutomationAIStudio.exe` (NSIS installer) for Windows |

The language Automation AI Studio is built in (TypeScript/Electron) is intentionally
decoupled from the language of the automation code it generates (Python first, then
Java/C#/Robot). See §4.

## 3. Process architecture (Electron)

```
┌─────────────────────────────┐        IPC (contextBridge, typed channels)
│  Renderer process (React)   │ ───────────────────────────────┐
│  - Pages, editors, dashboard│                                 │
│  - No direct FS/DB/child    │                                 ▼
│    process access           │                    ┌───────────────────────────┐
└─────────────────────────────┘                    │   Main process (Node)     │
                                                     │  - SQLite (better-sqlite3)│
                                                     │  - Credential encryption  │
                                                     │  - Code generator adapters│
                                                     │  - Execution adapters     │
                                                     │  - Recorder controller    │
                                                     │    (drives Playwright)    │
                                                     │  - Git integration        │
                                                     │  - Runtime Manager checks │
                                                     └───────────────────────────┘
```

The renderer never touches the filesystem, database, or spawns processes directly.
`contextIsolation` is enabled and `nodeIntegration` is disabled in every
`BrowserWindow`; the `preload` script exposes a narrow, typed API
(`window.studio.*`) over `contextBridge`. This is a security boundary, not just a
convention — see `SECURITY.md` §2.

## 4. Why generated-code language ≠ app language

Automation AI Studio is an Electron/TypeScript app. The tests it generates are Python
today, and will be Java/C#/Robot later. These are independent axes:

- The **Code Generator Adapter** for a stack only needs to (a) turn the Test Model
  into that stack's idiomatic source text and (b) know that stack's on-disk project
  conventions (e.g. `pages/`, `tests/`, `pytest.ini` for Python; `src/test/java/...`,
  `pom.xml` for Java).
- The **Execution Adapter** for a stack only needs to (a) validate the runtime is
  installed, (b) build the correct shell command, (c) run it as a child process from
  the Electron main process, and (d) parse that stack's result output (JUnit XML,
  Pytest JSON report, Robot `output.xml`) into the normalized `ExecutionResult` shape.

Neither adapter needs to know anything about Electron, React, or TypeScript, and the
rest of the app (UI, DB, reporting) needs to know nothing about Python/Java/C# beyond
the adapter interfaces. See `AUTOMATION_ADAPTERS.md` and `EXECUTION_ENGINE.md`.

## 5. Core pipeline

```
Browser Interaction (recorder)  ─┐
Manual step builder              ├─► Recorded Action ─► Framework-Neutral Test Step
AI description (future)         ─┘                             │
                                                                 ▼
                                                   Framework-Neutral Test Model
                                                                 │
                                                                 ▼
                                              Automation Code Generator Adapter
                                                                 │
                                                                 ▼
                                                       Generated Source Code
                                                        (on disk, in the
                                                         project's directory)
                                                                 │
                                                                 ▼
                                                        Execution Adapter
                                                                 │
                                                                 ▼
                                                              Browser
                                                                 │
                                                                 ▼
                                                       Execution Results
                                                                 │
                                                                 ▼
                                                     Analytics / Reports (SQLite)
```

The Test Model (`TEST_MODEL.md`) is the only object the UI, recorder, and AI builder
ever write to. Generated code is always a *derived artifact* — regenerating it from
the model must be safe, which is why generated files carry an ownership marker (see
`SECURITY.md` §6 and Data Model `automation_mappings`).

## 6. Application layering (inside the Electron main process)

```
ipc/            thin handlers: validate IPC input, call a service, return a typed result
services/       business logic — projects, environments, credentials, test cases,
                execution orchestration, runtime checks, git
services/codegen/    Test Model types + CodeGeneratorAdapter interface + implementations
services/execution/  ExecutionAdapter interface + implementations
db/             schema, migrations, typed repository functions (no raw SQL outside db/)
```

Rule: React components never import from `services/` or `db/` — only from the
`window.studio` preload bridge. This keeps the security boundary real, not aspirational.

## 7. Desktop packaging

`electron-builder` targets a Windows NSIS installer producing `AutomationAIStudio.exe`.
The SQLite database and encrypted credential vault live under the user's
`app.getPath('userData')` directory (`%APPDATA%\Automation AI Studio`), never inside
the installed application directory, so they survive upgrades and are not modified by
the installer.

## 8. Major technical risks (identified at Phase 0)

1. **Native module ABI mismatch** — `better-sqlite3` ships prebuilt binaries per
   Node ABI; Electron uses its own ABI, so the module must be rebuilt for Electron's
   Node version (`electron-rebuild` / `@electron/rebuild`) after every Electron
   version bump. Mitigated by pinning versions and running the rebuild step as part of
   `npm install` (`postinstall`).
2. **In-app recorder complexity** — resolved for the core gesture set. The
   recorder (`electron/services/recorder/`) drives a real Chrome window via
   Playwright's `channel: "chrome"` (the system-installed browser, not a
   separate downloaded binary), injects a page script via
   `BrowserContext.addInitScript` that computes a locator client-side and
   reports each interaction through `exposeBinding`, and masks password-field
   values at the point of capture rather than after the fact. Verified against
   a real page over CDP: click/fill/navigate capture correctly, and a
   password field never has its value read out of the page. Richer gestures
   (drag/drop, uploads, new-tab handling) remain future work — see
   `ROADMAP.md`.
3. **Locator quality without a live DOM at generation time** — the model stores the
   full candidate locator set (role, name, testid, css) captured at record time so the
   generator can pick the best one and the Element Inspector can show alternatives,
   but a locator can still drift if the app under test changes. This is why locator
   healing (`ROADMAP.md` Phase 2/7) is *suggest, never silently apply*.
4. **Cross-runtime execution** — Python/Playwright/Pytest must be installed in the
   *target automation project's* environment (its own venv), not bundled with
   Automation AI Studio. The Runtime Manager (§44 of the product brief) exists
   specifically to detect and report this rather than fail silently.
5. **Credential security vs. usability** — encryption keys must survive app restarts
   without a master password prompt for MVP (single local ADMIN user), which pushes
   key material toward OS-backed storage (`safeStorage`) with a file-based fallback.
   Documented tradeoff in `SECURITY.md` §3.

## 9. Testing strategy

- **Unit tests (Vitest)**: services in isolation — password hashing/verification,
  credential encrypt/decrypt round-trip, Test Model validation, code generator output
  (golden-file comparison), execution result parsing.
- **Component tests (Vitest + Testing Library)**: React forms and the test editor's
  step list (add/edit/delete/reorder), guarded against regressions independent of
  Electron.
- **Integration tests**: IPC handlers against a real temporary SQLite file (not
  mocked), so schema/migration mistakes surface.
- **E2E tests**: Playwright Test driving the packaged/dev Electron app for the
  critical path in the product brief's "Definition of Done" scenario (login → create
  project → create environment → create test → generate code → run → view report →
  logout → relogin → data persists).

## 10. Phase 0 deliverables (this document set)

- `ARCHITECTURE.md` (this file)
- `DATA_MODEL.md` — SQLite schema, entities, relationships
- `TEST_MODEL.md` — the framework-neutral Test Model JSON schema and TS types
- `AUTOMATION_ADAPTERS.md` — Code Generator Adapter interface + Phase 1 Python/Playwright/Pytest implementation
- `EXECUTION_ENGINE.md` — Execution Adapter interface + Phase 1 Python implementation
- `SECURITY.md` — auth, encryption, secret handling, source ownership rules
- `ROADMAP.md` — phased delivery plan
