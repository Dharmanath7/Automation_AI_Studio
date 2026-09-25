/**
 * Chart color roles, taken from the dataviz skill's validated reference
 * palette (light mode only — this app has no dark mode). Status colors are
 * fixed and never reused as a generic series color; the sequential blue is
 * the default single hue for magnitude comparisons (bar charts).
 */
export const chartColors = {
  surface: "#fcfcfb",
  textPrimary: "#0b0b0b",
  textSecondary: "#52514e",
  textMuted: "#898781",
  gridline: "#e1e0d9",
  baseline: "#c3c2b7",

  sequentialBlue: "#2a78d6",

  status: {
    good: "#0ca30c",
    warning: "#fab219",
    serious: "#ec835a",
    critical: "#d03b3b",
    neutral: "#9a988f",
  },
} as const;

export const FAILURE_CLASSIFICATION_LABELS: Record<string, string> = {
  locator: "Locator",
  assertion: "Assertion",
  application: "Application",
  api: "API",
  auth: "Auth",
  test_data: "Test Data",
  timeout: "Timeout",
  environment: "Environment",
  browser: "Browser",
  unknown: "Unknown",
};

/** Plain-language "why" for each classification, shown alongside the step it failed on. */
export const FAILURE_CLASSIFICATION_EXPLANATIONS: Record<string, string> = {
  locator:
    "The element couldn't be found, or the locator matched more than one element on the page. The page layout may have changed, or this locator needs to be more specific.",
  assertion: "An expected condition wasn't true — the actual page content didn't match what the test expected.",
  timeout: "An action or page load took longer than the configured timeout. The page may be slow, or an expected element never appeared.",
  environment: "A network/connection problem (DNS failure, connection refused, ...) — check the environment's base URL and that the target site is reachable.",
  auth: "The login/authentication step failed — check the credentials linked to this environment in Environments & Credentials.",
  api: "An API call returned an error status.",
  browser: "A browser-level error occurred (e.g. the browser crashed, or a page/context was already closed).",
  test_data: "The test data used didn't satisfy a constraint on the system under test (e.g. a value the app rejected as invalid or a duplicate).",
  application: "The application under test behaved unexpectedly.",
  unknown: "The cause couldn't be automatically classified — see the full error below.",
};
