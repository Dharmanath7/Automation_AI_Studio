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
