import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * The Studio's own `playwright` npm package pins a specific browser
 * revision, separate from whatever a project's Python `playwright` package
 * has downloaded — even though both conventionally share the same
 * `%LOCALAPPDATA%\ms-playwright` cache directory. If the Node package's
 * exact pinned revision was never downloaded (e.g. this machine's network
 * path let a plain `curl` through but stalled Node's own downloader) while
 * an older-but-compatible revision already exists there (most commonly
 * because Python's `playwright install` succeeded earlier), the recorder
 * would report "Chromium isn't installed" even though a perfectly usable
 * Chromium build is sitting right there. This scans for and reuses any
 * installed revision instead of only trusting the one exact pin.
 */

function msPlaywrightCacheDir(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "ms-playwright");
}

function findInstalledExecutable(enginePrefix: string, exeRelativeCandidates: string[]): string | undefined {
  const cacheDir = msPlaywrightCacheDir();
  if (!fs.existsSync(cacheDir)) return undefined;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(cacheDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const candidates = entries
    .filter((e) => e.isDirectory() && e.name.startsWith(`${enginePrefix}-`))
    .map((e) => e.name)
    .sort((a, b) => {
      const revOf = (name: string) => parseInt(name.split("-").pop() ?? "0", 10) || 0;
      return revOf(b) - revOf(a); // newest revision first
    });

  for (const dirName of candidates) {
    for (const rel of exeRelativeCandidates) {
      const full = path.join(cacheDir, dirName, rel);
      if (fs.existsSync(full)) return full;
    }
  }
  return undefined;
}

export function resolveChromiumExecutable(): string | undefined {
  return findInstalledExecutable("chromium", [path.join("chrome-win64", "chrome.exe"), path.join("chrome-win", "chrome.exe")]);
}

export function resolveFirefoxExecutable(): string | undefined {
  return findInstalledExecutable("firefox", [path.join("firefox", "firefox.exe")]);
}
