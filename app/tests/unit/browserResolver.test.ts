import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveChromiumExecutable, resolveFirefoxExecutable } from "../../electron/services/recorder/browserResolver";

let tmpDir: string;
let originalLocalAppData: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aas-browser-resolver-"));
  originalLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = originalLocalAppData;
});

function makeFakeBrowser(cacheDir: string, dirName: string, relExePath: string) {
  const full = path.join(cacheDir, dirName, relExePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, "fake-binary");
}

describe("browserResolver", () => {
  it("returns undefined when no ms-playwright cache directory exists", () => {
    expect(resolveChromiumExecutable()).toBeUndefined();
  });

  it("finds a chromium install even at a revision the app doesn't pin itself", () => {
    const cacheDir = path.join(tmpDir, "ms-playwright");
    makeFakeBrowser(cacheDir, "chromium-1228", path.join("chrome-win64", "chrome.exe"));
    const found = resolveChromiumExecutable();
    expect(found).toBe(path.join(cacheDir, "chromium-1228", "chrome-win64", "chrome.exe"));
  });

  it("prefers the highest revision when multiple are installed", () => {
    const cacheDir = path.join(tmpDir, "ms-playwright");
    makeFakeBrowser(cacheDir, "chromium-1100", path.join("chrome-win64", "chrome.exe"));
    makeFakeBrowser(cacheDir, "chromium-1243", path.join("chrome-win64", "chrome.exe"));
    makeFakeBrowser(cacheDir, "chromium-1228", path.join("chrome-win64", "chrome.exe"));
    expect(resolveChromiumExecutable()).toContain("chromium-1243");
  });

  it("never mistakes chromium_headless_shell-* for a headed chromium install", () => {
    // Regression: chromium_headless_shell-1228 starts with "chromium" too,
    // but its executable can't drive a real (headed) recorder window —
    // must not be picked up by a naive startsWith("chromium") filter.
    const cacheDir = path.join(tmpDir, "ms-playwright");
    makeFakeBrowser(cacheDir, "chromium_headless_shell-1228", path.join("chrome-headless-shell-win64", "chrome-headless-shell.exe"));
    expect(resolveChromiumExecutable()).toBeUndefined();
  });

  it("finds a firefox install independently of chromium", () => {
    const cacheDir = path.join(tmpDir, "ms-playwright");
    makeFakeBrowser(cacheDir, "firefox-1532", path.join("firefox", "firefox.exe"));
    expect(resolveFirefoxExecutable()).toBe(path.join(cacheDir, "firefox-1532", "firefox", "firefox.exe"));
  });
});
