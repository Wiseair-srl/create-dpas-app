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
        },
      },
    ],
  },
});
