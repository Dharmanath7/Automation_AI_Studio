# Roadmap

Phases mirror the product brief. Each phase is a complete, working vertical slice —
not a partial UI wired to fake data.

## Phase 0 — Foundation (this commit set)
- [x] Inspect repository state
- [x] `docs/ARCHITECTURE.md`, `DATA_MODEL.md`, `TEST_MODEL.md`,
      `AUTOMATION_ADAPTERS.md`, `EXECUTION_ENGINE.md`, `SECURITY.md`, `ROADMAP.md`
- [x] Project structure, DB schema + migrations, adapter interfaces defined

## Phase 1 — Working MVP (in progress)
- [x] Electron + React + TS + Vite shell, protected routing
- [x] SQLite schema/migrations
- [x] Local auth: ADMIN/ADMIN bootstrap, argon2id hashing, sessions, logout
- [x] Project create/select
- [x] Environment create/select per project
- [x] Credential Vault (AES-256-GCM, safeStorage-wrapped key)
- [x] Framework-neutral Test Model + validation
- [x] Visual test editor (manual step builder): steps, assertions, random data,
      suite tags (BVT/Smoke/Sanity/Regression)
- [x] `PlaywrightPythonPytestGenerator`: real Page Object + Pytest file generation
- [x] `PythonExecutionAdapter`: spawns pytest, parses JSON report, captures
      failure screenshots
- [x] Execution history + basic reporting dashboard, failure detail view
- [x] Browser recorder: launches a real Chrome window (via Playwright, `channel:
      "chrome"` — no separate browser download required), captures click/
      doubleClick/fill/select/check/uncheck/navigate live via an injected page
      script + `exposeBinding`, computes a best-effort locator per interaction
      (testId > aria-label/label > placeholder > role+text > css), and masks
      password fields at the point of capture — their value is never read out of
      the page, only stored as a `credentials.default.password` reference. See
      `electron/services/recorder/`. Captured steps land in the same visual
      editor (`src/components/StepEditor.tsx`) used for manual test building, so
      marking any recorded field as random/boundary data is the same UI as
      editing any other step.
- [ ] Windows `.exe` packaging via electron-builder (config present; full signed
      build deferred)

Definition of Done for Phase 1 is the 35-step scenario in the original brief;
every step is now real and runnable end-to-end, including live recording.

## Phase 2
Reusable flows UI, advanced reports, automation coverage %, trace viewer, video
artifacts, console/network log capture, cross-browser execution, parallel execution,
environment comparison view, flaky test analytics, live browser recorder (full
delivery).

## Phase 3 — Java
`Playwright+JUnit`, `Playwright+TestNG`, `Selenium+JUnit`, `Selenium+TestNG`,
`Selenium+Cucumber`. New `CodeGeneratorAdapter` + `ExecutionAdapter` implementations
only — no changes to the Test Model, DB schema, or UI beyond the dependent dropdowns
already modeled in `framework_configs`.

## Phase 4 — C#
`Playwright+NUnit`, `Selenium+NUnit`, `Selenium+Reqnroll`.

## Phase 5 — Robot Framework
`Robot Browser`, `Robot SeleniumLibrary`.

## Phase 6 — CI/CD
Git commit/push UI, Azure DevOps, GitHub Actions, Jenkins integration, CI-triggered
BVT workflows.

## Phase 7 — AI features
Natural Language Test Builder, AI Test Coverage Assistant, Locator Suggestions,
AI-assisted failure analysis (always a suggestion, never a definitive verdict — see
`SECURITY.md`/product brief §36), Test Review Assistant.

## Phase 8 — Experimental
Screenshot Lab (explicitly labeled Experimental), screenshot+DOM-assisted test
generation, visual regression testing.

## Explicit non-goals for Phase 1
- Multi-user accounts, RBAC, SSO/LDAP (design is future-proofed in `SECURITY.md` §8,
  not built)
- Any browser other than Chrome/Chromium
- Cross-browser or multi-environment parallel comparison views
- Locator healing (auto-suggest only ships once a healing candidate source exists;
  not in Phase 1)
- Any code generator/execution adapter other than
  `PlaywrightPythonPytestGenerator` / `PythonExecutionAdapter`
