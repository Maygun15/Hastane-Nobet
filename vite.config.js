/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";

// Dağıtım kimliği: Render derleme ortamında RENDER_GIT_COMMIT, yerelde git. dist/version.json
// ve uygulama menüsündeki "Sürüm" satırı bunu kullanır (sunucunun /api/version'ı ile karşılaştırılır).
function buildCommit() {
  const c = process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || "";
  if (c) return c.slice(0, 12);
  try { return execFileSync("git", ["rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().slice(0, 12); } catch { return ""; }
}
const COMMIT = buildCommit();
function versionFile() {
  return {
    name: "version-json",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ commit: COMMIT || null, builtAt: new Date().toISOString(), apiBase: process.env.VITE_API_BASE || null }, null, 2),
      });
    },
  };
}

export default defineConfig({
  define: { __APP_COMMIT__: JSON.stringify(COMMIT) },
  plugins: [
    react({
      jsxRuntime: "automatic",
    }),
    versionFile(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react_vendor: ["react", "react-dom", "react-router-dom"],
          xlsx_vendor: ["xlsx"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
  },
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
    open: true,
    hmr: {
      protocol: "ws",
      host: "localhost",
      clientPort: 5174,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
