import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: { "@": path.resolve(import.meta.dirname, "src") },
        },
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx", "src/test/**/*.dom.test.ts"],
          setupFiles: ["src/test/setup.dom.ts"],
          globals: true,
          // These mount the real feature tree in jsdom. The work itself takes
          // milliseconds, but standing up the environment on a cold or busy
          // machine (CI runners, a first `pnpm test` after install) can eat
          // several seconds — well past vitest's 5s default.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        resolve: {
          alias: { "@": path.resolve(import.meta.dirname, "src") },
        },
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/test/**/*.dom.test.ts"],
          globals: true,
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
    ],
  },
});
