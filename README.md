# Automation AI Studio

An intelligent, end-to-end QA automation platform for Windows: a low-code
automation-testing IDE that lets manual testers and automation engineers create,
record, generate, organize, execute, maintain, and analyze browser automation tests —
while still producing professional, maintainable, inspectable source code.

> **Current phase: Phase 1 (MVP) — in progress.** See `docs/ROADMAP.md` for exactly
> what is implemented versus planned. Nothing in this README describes a feature
> that isn't real; anything not yet built is called out explicitly.

## Why it's different from "just a recorder"

Every action — recorded, manually built, or (later) AI-described — is normalized
into a **framework-neutral Test Model** before anything is generated. A
**Code Generator Adapter** turns that model into real source files for a specific
language/framework/runner. An **Execution Adapter** runs that project and normalizes
results back into one reporting schema. This is what lets the same test one day
target Python/Playwright/Pytest, Java/TestNG, C#/NUnit, or Robot Framework without
rewriting the recorder, editor, or reports. See `docs/ARCHITECTURE.md`.

## Technology stack

- **Desktop shell:** Electron
- **UI:** React + TypeScript + Vite
- **Local database:** SQLite (`better-sqlite3`)
- **Credential encryption:** AES-256-GCM, key wrapped via Electron `safeStorage`
- **First automation stack:** Python + Playwright + Pytest + Page Object Model
- **Code editor:** Monaco
- **Testing:** Vitest (unit/component), Playwright Test (E2E of the Studio itself)
- **Packaging:** electron-builder → `AutomationAIStudio.exe`

Automation AI Studio's own implementation language (TypeScript) is intentionally
decoupled from the language of the tests it generates (Python first). See
`docs/ARCHITECTURE.md` §4.

## Architecture

See `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/TEST_MODEL.md`,
`docs/AUTOMATION_ADAPTERS.md`, `docs/EXECUTION_ENGINE.md`, `docs/SECURITY.md`.

## Development setup

Prerequisites: Node.js 20+, npm, and — for running/generating the Python/Playwright
stack — Python 3.10+ with `pip`.

```bash
cd app
npm install
```

`npm install` also rebuilds `better-sqlite3` for Electron's Node ABI
(`postinstall` script — see `package.json`).

## How to run (development)

```bash
cd app
npm run dev
```

This starts the Vite dev server for the renderer and launches Electron pointed at
it, with hot reload for the UI and auto-restart for main-process changes.

## How to build the EXE

```bash
cd app
npm run build
npm run dist
```

Produces a Windows NSIS installer (`AutomationAIStudio.exe`) under `app/release/`.
(Packaging config exists in Phase 1; a fully signed, distributable build is a Phase 1
follow-up — see `docs/ROADMAP.md`.)

## Testing instructions

```bash
cd app
npm run test          # Vitest unit + component tests
npm run test:e2e      # Playwright Test, drives the built Electron app
```

## Supported automation stacks

| Language | Framework | Runner | Status |
|---|---|---|---|
| Python | Playwright | Pytest | **Available (Phase 1)** |
| Python | Selenium | Pytest / Behave | Coming Soon |
| Java | Playwright / Selenium | JUnit / TestNG / Cucumber | Coming Soon (Phase 3) |
| C# | Playwright / Selenium | NUnit / Reqnroll | Coming Soon (Phase 4) |
| Robot Framework | Browser lib / SeleniumLibrary | — | Coming Soon (Phase 5) |

## Default login (local MVP bootstrap — change before any shared/production use)

```
Username: ADMIN
Password: ADMIN
```

This is a local bootstrap account for the single-user MVP, seeded only when no users
exist yet. Passwords are hashed (argon2id) and never stored or logged in plaintext.
See `docs/SECURITY.md`.

## Security

See `docs/SECURITY.md` for authentication, the credential vault, IPC/process
sandboxing, and source-code-ownership rules for generated files.

## Repository

```
docs/      architecture & design documents
app/       Electron + React + TypeScript application (Phase 1)
```
