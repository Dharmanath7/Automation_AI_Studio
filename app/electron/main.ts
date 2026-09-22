import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, protocol, net } from "electron";
import { getDb, initializeDatabase } from "./db";
import { ensureBootstrapAdmin } from "./services/authService";
import { registerIpcHandlers } from "./ipc/registerIpc";
import { getLogger } from "./services/logger";

// Otherwise Electron derives the userData folder name from package.json's
// "name" field ("automation-ai-studio") instead of the product name used
// throughout docs/SECURITY.md and the README ("%APPDATA%\Automation AI Studio").
app.setName("Automation AI Studio");

const logger = getLogger("db");

// Custom read-only scheme so the renderer can display execution artifacts
// (failure screenshots) without granting it general filesystem access.
// Must be registered before app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: "aas-artifact", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// electron/main.ts is bundled to dist-electron/main.js; VITE_DEV_SERVER_URL is
// injected by vite-plugin-electron only in dev.
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Automation AI Studio",
    icon: path.join(__dirname, "../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  registerIpcHandlers(mainWindow);

  if (VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(VITE_DEV_SERVER_URL);
    // DevTools no longer auto-opens on every launch — set AAS_OPEN_DEVTOOLS=1
    // to get it back, or open it on demand with Ctrl+Shift+I / F12 (both
    // registered below).
    if (process.env.AAS_OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.webContents.on("before-input-event", (_event, input) => {
    const isToggleCombo = input.key === "F12" || ((input.control || input.meta) && input.shift && input.key.toUpperCase() === "I");
    if (isToggleCombo && input.type === "keyDown") {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await initializeDatabase();
  const db = getDb();
  await ensureBootstrapAdmin(db);

  const artifactsRoot = path.join(app.getPath("userData"), "artifacts");
  protocol.handle("aas-artifact", (request) => {
    // Looked up by artifact row id (a UUID — always URL-safe), not by
    // encoding the actual Windows file path into the URL: a raw path with a
    // drive letter and backslashes (C%3A%5CUsers%5C...) round-trips through
    // Chromium's URL parser unreliably for a "standard" custom scheme,
    // which is what made screenshots render broken.
    const artifactId = request.url.replace(/^aas-artifact:\/\//, "").replace(/\/+$/, "");
    const row = getDb().prepare("SELECT file_path FROM artifacts WHERE id = ?").get(artifactId) as
      | { file_path: string }
      | undefined;
    if (!row) return new Response("Not found", { status: 404 });
    const filePath = path.resolve(row.file_path);
    if (!filePath.startsWith(artifactsRoot)) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  logger.info("Automation AI Studio starting up");
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
