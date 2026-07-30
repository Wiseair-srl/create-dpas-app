// The generated-project smoke test (`pnpm test:scaffold`):
//   build the CLI → generate a fresh app in a temp dir → install standalone →
//   lint → typecheck → unit tests → production build → deterministic browser
//   tests. Proves the published artifact works, not just the repo checkout.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, "packages", "create-dpas-app", "dist", "index.js");
const keepDir = process.argv.includes("--keep");

const run = (label, command, args, cwd) => {
  console.log(`\n[scaffold-smoke] ${label}`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
};

run("building CLI", "pnpm", ["--filter", "create-dpas-app", "build"], repoRoot);

const scratch = mkdtempSync(path.join(tmpdir(), "dpas-smoke-"));
const app = path.join(scratch, "smoke-app");
console.log(`[scaffold-smoke] generating into ${app}`);

try {
  run(
    "generating project",
    process.execPath,
    [cli, "smoke-app", "--yes", "--no-install", "--no-git"],
    scratch,
  );
  run("installing dependencies", "pnpm", ["install"], app);
  run("lint", "pnpm", ["lint"], app);
  run("typecheck", "pnpm", ["typecheck"], app);
  run("unit tests", "pnpm", ["test"], app);
  run("production build", "pnpm", ["build"], app);
  run("browser install", "pnpm", ["exec", "playwright", "install", "--with-deps", "chromium"], app);
  run(
    "deterministic browser tests",
    "pnpm",
    ["exec", "playwright", "test", "--project=desktop"],
    app,
  );
  console.log("\n[scaffold-smoke] PASS — a freshly generated app installs, checks, builds and runs.");
} finally {
  if (keepDir) {
    console.log(`[scaffold-smoke] kept ${scratch} (--keep)`);
  } else {
    rmSync(scratch, { recursive: true, force: true });
  }
}
