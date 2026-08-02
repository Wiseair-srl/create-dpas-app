import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { agentSurface } from "@agent-surface/compiler";

/**
 * Two processes in development, one in production.
 *
 * `pnpm dev` runs Vite for the SPA and `tsx watch server/index.ts` for the
 * Hono server, with everything the app actually calls proxied across. In
 * production the server serves `dist/` itself, so the same URLs work with no
 * proxy at all — which is why the client only ever uses relative paths.
 */
const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3001);
const SERVER = `http://localhost:${SERVER_PORT}`;

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL("./app", import.meta.url)) },
    // One instance of each of these or nothing works: two Reacts break hooks,
    // two routers break context.
    dedupe: ["react", "react-dom", "react-router", "react-router-dom"],
  },
  // The compiler goes FIRST: it reads authored TypeScript to extract the
  // capability contracts, and needs the source before JSX/Fast Refresh
  // rewrites it. It also serves `virtual:agent-surface-contract`, the
  // authority the registry is constructed with — without the plugin the app
  // has no proof of what it may expose, and the registry refuses everything.
  plugins: [agentSurface(), react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? process.env.PORT ?? 3000),
    proxy: Object.fromEntries(
      ["/api", "/rpc", "/agent", "/mcp"].map((path) => [
        path,
        { target: SERVER, changeOrigin: false },
      ]),
    ),
  },
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    projects: [
      {
        // Surface contract tests mount real feature components, so they need a
        // DOM and the agent-surface matchers.
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["app/**/*.test.tsx"],
          setupFiles: ["app/test/setup.dom.ts"],
          testTimeout: 30_000,
          // This app imports the router under BOTH specifiers — `react-router`
          // and `react-router-dom`. In the browser they collapse into one
          // optimizer chunk, so there is one Router context. Under Vitest they
          // do not: one half is inlined and the other externalized, the same
          // module is evaluated twice, and any screen built on the router
          // crashes with "useLocation() may be used only in the context of a
          // <Router>" — a failure that exists nowhere but the test runner.
          // v7's `react-router-dom` re-exports `react-router`, so collapsing
          // them here is the browser's behavior, not a stub.
          alias: { "react-router-dom": "react-router" },
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["{app,server,capabilities}/**/*.test.ts"],
        },
      },
    ],
  },
});
