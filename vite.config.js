import { defineConfig } from "vite";
import { coverageConfigDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import eslint from "vite-plugin-eslint";
import { execSync } from "node:child_process";
import process from "node:process";

// index.html shows VITE_FULL_VERSION_INFO, which CI sets; a local build that
// does not set it names the commit it was built from instead of showing the
// placeholder.
function versionInfo() {
  if (process.env.VITE_FULL_VERSION_INFO) {
    return process.env.VITE_FULL_VERSION_INFO;
  }

  try {
    const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain --untracked-files=no", { encoding: "utf8" }).trim() ? "-dirty" : "";
    return `htmlui ${commit}${dirty} built on ${new Date().toUTCString()}`;
  } catch {
    return `htmlui built on ${new Date().toUTCString()}`;
  }
}

process.env.VITE_FULL_VERSION_INFO = versionInfo();

export default defineConfig(() => {
  return {
    build: {
      outDir: "build",
      chunkSizeWarningLimit: 1000,
    },
    plugins: [react(), eslint()],
    test: {
      globals: true,
      environment: "jsdom",
      coverage: {
        exclude: ["**/build/**", ...coverageConfigDefaults.exclude],
      },
    },
    server: {
      port: 3000,
      host: "localhost",
      https: false,
      strictPort: true,
      open: true,
      proxy: {
        "/api": {
          target: "http://localhost:51515",
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
