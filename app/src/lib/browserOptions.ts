/** Shared by RecorderPage, TestEditorPage's Run panel, and ExecutionPage. */
export const RECORDER_BROWSER_OPTIONS: { value: "chrome" | "edge" | "firefox" | "chromium"; label: string }[] = [
  { value: "chrome", label: "Chrome" },
  { value: "edge", label: "Microsoft Edge" },
  { value: "firefox", label: "Firefox" },
  { value: "chromium", label: "Chromium" },
];

export const EXECUTION_BROWSER_OPTIONS: { value: "chrome" | "edge" | "firefox" | "chromium"; label: string }[] = RECORDER_BROWSER_OPTIONS;
