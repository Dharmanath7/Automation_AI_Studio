import { chromium, firefox, type Browser, type BrowserContext, type Page } from "playwright";
import { screen } from "electron";
import { v4 as uuidv4 } from "uuid";
import type { TestStep, LocatorCandidate, LocatorQuality, LocatorStrategy } from "../../shared/testModel";
import { RECORDER_INIT_SCRIPT } from "./pageScript";
import { getLogger } from "../logger";
import { resolveChromiumExecutable, resolveFirefoxExecutable } from "./browserResolver";

const logger = getLogger("recorder");

export type RecorderBrowser = "chrome" | "chromium" | "firefox" | "edge";

export type RecorderEvent =
  | { type: "step"; step: TestStep }
  | { type: "closed" }
  | { type: "error"; message: string }
  // Sent when "Stop Recording" is clicked in the companion toolbar window
  // rather than in the main Studio window — the main window isn't otherwise
  // aware that happened, so this tells its Record Browser page to run
  // exactly the same stop flow as if its own Stop button had been clicked.
  | { type: "externalStopRequested" };

interface RecordedAction {
  kind: "click" | "dblclick" | "select" | "check" | "uncheck" | "fill" | "hover";
  locator: LocatorCandidate;
  value?: string;
  isPassword?: boolean;
  isRandom?: boolean;
}

interface RecordingSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  steps: TestStep[];
  onEvent: (e: RecorderEvent) => void;
  /** The page/tab most recently interacted with (any recorded action, or a
   *  newly opened tab) — the best available proxy for "what the person
   *  recording is currently looking at," since Playwright has no concept of
   *  OS-level window/tab focus. Used to target "Insert Random Value" from
   *  the companion toolbar at the right page. */
  activePage: Page;
}

const sessions = new Map<string, RecordingSession>();

function isLocatorQuality(v: string): v is LocatorQuality {
  return ["excellent", "good", "fair", "fragile", "avoid"].includes(v);
}
function isLocatorStrategy(v: string): v is LocatorStrategy {
  return ["role", "testId", "label", "placeholder", "text", "css", "xpath"].includes(v);
}

function sanitizeLocator(raw: LocatorCandidate): LocatorCandidate {
  return {
    strategy: isLocatorStrategy(raw.strategy) ? raw.strategy : "css",
    value: String(raw.value ?? "").slice(0, 500),
    roleName: raw.roleName ? String(raw.roleName).slice(0, 200) : undefined,
    quality: isLocatorQuality(raw.quality) ? raw.quality : "fragile",
  };
}

function toTestStep(action: RecordedAction): TestStep | null {
  const id = uuidv4();
  const target = { preferred: sanitizeLocator(action.locator), alternatives: [] };

  switch (action.kind) {
    case "click":
      return { id, type: "click", target, enabled: true };
    case "dblclick":
      return { id, type: "doubleClick", target, enabled: true };
    case "hover":
      return { id, type: "hover", target, enabled: true };
    case "check":
      return { id, type: "check", target, enabled: true };
    case "uncheck":
      return { id, type: "uncheck", target, enabled: true };
    case "select":
      return { id, type: "select", target, value: { kind: "literal", value: action.value ?? "" }, enabled: true };
    case "fill":
      // A password field's value is never captured — see pageScript.ts and
      // docs/SECURITY.md §4. It's stored as a Credential Vault reference
      // from the moment it's recorded, never as a literal in the buffer.
      if (action.isPassword) {
        return {
          id,
          type: "fill",
          target,
          value: { kind: "variable", path: "credentials.default.password" },
          enabled: true,
          note: "Password field — value not recorded; references the Credential Vault instead.",
        };
      }
      // Inserted via the recorder toolbar's "Insert Random Value" instead
      // of typed by hand — record it as a random-value fill (the generator
      // regenerates a fresh value on every future run) rather than baking
      // in the one preview value that happened to be shown while recording.
      if (action.isRandom) {
        return { id, type: "fill", target, value: { kind: "random", generator: "randomString", seedOnce: false }, enabled: true };
      }
      return { id, type: "fill", target, value: { kind: "literal", value: action.value ?? "" }, enabled: true };
    default:
      return null;
  }
}

export interface StartRecordingOptions {
  baseUrl: string;
  browser: RecorderBrowser;
  onEvent: (e: RecorderEvent) => void;
}

/** The primary display's usable area, for launching the recorder maximized instead of at Playwright's small default size. */
function primaryWorkArea(): { width: number; height: number } {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return { width, height };
}

async function launchBrowser(opts: StartRecordingOptions): Promise<Browser> {
  const debugPort = process.env.AAS_RECORDER_DEBUG_PORT;
  const { width, height } = primaryWorkArea();
  const debugArgs = debugPort ? [`--remote-debugging-port=${debugPort}`] : [];

  if (opts.browser === "firefox") {
    const executablePath = resolveFirefoxExecutable();
    if (!executablePath) {
      throw new Error(
        "Firefox isn't installed for the Studio's recorder. Run 'npx playwright install firefox' in app/, or pick Chrome/Edge instead."
      );
    }
    // Firefox has no "start maximized" flag; approximate it by sizing the
    // window to the screen's usable area up front.
    return firefox.launch({
      headless: false,
      executablePath,
      args: [...debugArgs, `-width`, String(width), `-height`, String(height)],
    });
  }

  // Chrome / Edge use the system-installed browser via Playwright's
  // "channel" mechanism — no separate download, and the most reliable path
  // since it's exactly the browser already on this machine.
  if (opts.browser === "chrome" || opts.browser === "edge") {
    const channel = opts.browser === "chrome" ? "chrome" : "msedge";
    try {
      return await chromium.launch({
        channel,
        headless: false,
        args: ["--start-maximized", ...debugArgs],
      });
    } catch (err) {
      throw new Error(
        opts.browser === "chrome"
          ? `Failed to launch Chrome: ${err instanceof Error ? err.message : String(err)}`
          : `Failed to launch Microsoft Edge: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Plain "chromium" — Playwright's own bundled build. Prefer whatever
  // revision is actually installed (see browserResolver.ts) over only
  // trusting the exact pin, which is what made this report "not installed"
  // even when a perfectly usable Chromium was already on disk.
  const executablePath = resolveChromiumExecutable();
  try {
    return await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      headless: false,
      args: ["--start-maximized", ...debugArgs],
    });
  } catch (err) {
    throw new Error(
      `Chromium isn't installed for the Studio's recorder (${err instanceof Error ? err.message : String(err)}). ` +
        `Run 'npx playwright install chromium' in app/, or pick Chrome/Edge instead — those use the browser already on this machine.`
    );
  }
}

export async function startRecording(opts: StartRecordingOptions): Promise<string> {
  const browser = await launchBrowser(opts);

  // viewport: null makes the page fill whatever size the OS window actually
  // is (maximized) instead of Playwright emulating a fixed small viewport
  // inside a maximized chrome — without this, "--start-maximized" only
  // maximizes the window frame while the page content still renders at
  // Playwright's 1280x720 default.
  const context = await browser.newContext({ viewport: null });
  const sessionId = uuidv4();
  const steps: TestStep[] = [];
  // Assigned its real value once the first page exists, just below —
  // exposeBinding's callback only ever actually runs later, once the user
  // interacts with that page, by which point this closure variable has
  // already been reassigned to the real session object.
  let session: RecordingSession;

  function pushStep(step: TestStep) {
    steps.push(step);
    opts.onEvent({ type: "step", step });
  }

  await context.exposeBinding("__aasRecordEvent", async (source, action: RecordedAction) => {
    session.activePage = source.page;
    const step = toTestStep(action);
    if (step) pushStep(step);
  });
  await context.addInitScript(RECORDER_INIT_SCRIPT);
  // Same reasoning as the generated conftest.py's page fixture: an
  // unhandled dialog (most commonly a "leave site?" beforeunload prompt)
  // blocks the page it appeared on indefinitely, which during recording
  // means the recorded browser looks frozen and "Stop Recording" can't
  // close it until the dialog is dealt with by hand.
  context.on("dialog", (dialog) => void dialog.accept());

  // Tracks top-level navigation on one page as "navigate" steps. `skipFirst`
  // is used for a newly opened tab: its first "navigation" is just the
  // browser following the link that opened it (already implied by the
  // newTab step + the generated context.expect_page() wrapper around the
  // triggering click — see PlaywrightPythonPytestGenerator.ts), not a
  // separate action to record.
  function attachNavigationTracking(target: Page, skipFirst: boolean) {
    let lastUrl: string | null = null;
    let firstSkipped = !skipFirst;
    target.on("framenavigated", (frame) => {
      if (frame !== target.mainFrame()) return;
      const url = frame.url();
      if (url === "about:blank" || url === lastUrl) return;
      lastUrl = url;
      if (!firstSkipped) {
        firstSkipped = true;
        return;
      }
      pushStep({ id: uuidv4(), type: "navigate", value: { kind: "literal", value: url }, enabled: true });
    });
  }

  const page = await context.newPage();
  session = { id: sessionId, browser, context, steps, onEvent: opts.onEvent, activePage: page };
  sessions.set(sessionId, session);
  attachNavigationTracking(page, false);

  // A click/tap that opens a link in a new tab (target="_blank", ctrl-click,
  // window.open, ...) creates a new Page on the context. Record it as a
  // "newTab" step — the code generator absorbs it into the click
  // immediately before it — and keep tracking navigation on the new tab too,
  // since it's now where the user's subsequent actions will happen. It also
  // becomes the active page immediately, matching a real browser: opening a
  // new tab switches focus to it.
  context.on("page", (newPage) => {
    session.activePage = newPage;
    pushStep({ id: uuidv4(), type: "newTab", enabled: true });
    attachNavigationTracking(newPage, true);
  });

  browser.on("disconnected", () => {
    if (sessions.has(sessionId)) {
      sessions.delete(sessionId);
      opts.onEvent({ type: "closed" });
    }
  });

  logger.info({ sessionId, browser: opts.browser }, "recording started");

  try {
    await page.goto(opts.baseUrl, { waitUntil: "domcontentloaded" });
  } catch (err) {
    logger.warn({ sessionId, err: String(err) }, "initial navigation failed; recording continues");
  }

  // The goto above is captured as a literal-URL navigate step by the
  // framenavigated listener; replace it with {{base_url}} so the recorded
  // test never hardcodes the environment (docs/TEST_MODEL.md rule #2).
  if (steps.length > 0 && steps[0].type === "navigate") {
    steps[0].value = { kind: "variable", path: "base_url" };
  }

  return sessionId;
}

export async function stopRecording(sessionId: string): Promise<TestStep[]> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Recording session not found — it may have already been stopped or the browser window was closed.");
  sessions.delete(sessionId);
  const steps = session.steps;
  await session.browser.close().catch(() => {});
  logger.info({ sessionId, stepCount: steps.length }, "recording stopped");
  return steps;
}

export function isRecording(sessionId: string): boolean {
  return sessions.has(sessionId);
}

/**
 * Fills the currently-focused field on the recording's active page/tab with
 * a random preview value and records it as a random-value fill step — the
 * companion toolbar window's "Insert Random Value" button, for when there's
 * no on-the-fly random-value generator otherwise available while recording.
 * Returns false (with a reason) if there's no focused, fillable field to
 * target, so the toolbar can show that instead of silently doing nothing.
 */
export async function insertRandomValue(sessionId: string): Promise<{ ok: boolean; reason?: string }> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, reason: "Recording session not found — it may have already been stopped." };
  // A string, not a TS closure: this runs in the recorded page's browser
  // context, which has no relation to this file's own (Node/no-DOM-lib)
  // type-checking environment.
  const result = (await session.activePage.evaluate(
    "window.__aasInsertRandomValue ? window.__aasInsertRandomValue() : { ok: false, reason: 'Recorder script not ready on this page yet.' }"
  )) as { ok: boolean; reason?: string };
  return result;
}
