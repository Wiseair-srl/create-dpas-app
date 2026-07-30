// Regenerates examples/generated-default from the current template via the
// BUILT CLI — the checked-in example is always a real generator artifact.
import { execFileSync } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, "packages", "create-dpas-app", "dist", "index.js");
const examplesDir = path.join(repoRoot, "examples");
const target = path.join(examplesDir, "generated-default");

execFileSync("pnpm", ["--filter", "create-dpas-app", "build"], {
  cwd: repoRoot,
  stdio: "inherit",
});

rmSync(target, { recursive: true, force: true });
mkdirSync(examplesDir, { recursive: true });

execFileSync(
  process.execPath,
  [cli, "generated-default", "--yes", "--no-install", "--no-git"],
  { cwd: examplesDir, stdio: "inherit" },
);

console.log("\n[regen-example] examples/generated-default regenerated.");
