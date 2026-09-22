import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import renderer from "vite-plugin-electron-renderer";
import path from "node:path";

// vite-plugin-electron-renderer shims Node builtins (fs, crypto, child_process, ...)
// for use inside the renderer bundle. It must NOT run under Vitest, where those
// same builtins are imported directly by main-process code and tests running in
// plain Node — the shim rewrites them to renderer-only stubs that throw.
const isVitest = !!process.env.VITEST;

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["sql.js", "argon2", "pino", "pino/file", "playwright"],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, "electron/preload.ts"),
        vite: {
          build: {
            outDir: "dist-electron",
          },
        },
      },
      renderer: isVitest ? undefined : {},
    }),
    ...(isVitest ? [] : [renderer()]),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "electron/shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-electron/**", "**/tests/e2e/**"],
  },
});
