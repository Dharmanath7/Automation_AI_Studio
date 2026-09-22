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
- [x] Execution history + reporting dashboard with real analytics: an
      execution-trend chart (pass/fail/skip stacked per run, oldest to
      newest), tests-by-suite and failure-reason breakdowns, and a
      pass/fail/skip status bar + human-readable (TC-<n> — title, not a raw
      UUID) test list on the execution detail view. See
      `src/components/charts/` — built against the dataviz skill's form/mark
      guidance (status colors for pass/fail/skip, one sequential hue for
      suite/failure magnitude, square-at-baseline stacked bars via an
      SVG clip-path, since a plain per-segment `rx` rounds every segment's
      corners including the ones that must stay square where they meet a
      neighbor or the baseline — caught by rendering it, not just review).
- [x] Deleting a test case renumbers the project's remaining test cases
      (TC-1, TC-2, ... with no gap) — execution history keeps working
      because it references test_case_id, not the display label.
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
      editing any other step. Also captures `newTab` when a click opens a new
      browser tab, generated as a `context.expect_page()`-wrapped click with
      `self.page` reassigned — see "Tab switching" in `EXECUTION_ENGINE.md`.
      `closeTab` and downloads are still not generated.
- [x] Smart waits: environment-configurable timeout wired into both Playwright
      action and `expect()` assertion waits (previously dead — the UI exposed
      a timeout field that generated code never used), plus explicit
      load-state waits after any step that might navigate. See
      "Smart waits" in `EXECUTION_ENGINE.md`.
- [x] Windows taskbar/window icon (`app/build/icon.png`, wired into both the
      dev `BrowserWindow` and the electron-builder Windows target)
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
