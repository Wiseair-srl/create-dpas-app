import { defineConfig } from "vite";
import { agentSurface } from "@agent-surface/compiler";
export default defineConfig({
  plugins: [agentSurface()],
  server: {
    proxy: {
      "/backend": {
        target: "http://127.0.0.1:4311",
        rewrite: (path) => path.replace(/^\/backend/, ""),
      },
      "/agent": {
        target: "http://127.0.0.1:4312",
        rewrite: (path) => path.replace(/^\/agent/, ""),
      },
    },
  },
});
