// CI gate: the checked-in examples/generated-default must be exactly what
// the current CLI + template generate. Regenerates into a temp dir and
// diffs; any drift fails the build with the differing paths.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, "packages", "create-dpas-app", "dist", "index.js");
const committed = path.join(repoRoot, "examples", "generated-default");

execFileSync("pnpm", ["--filter", "create-dpas-app", "build"], {
  cwd: repoRoot,
  stdio: "inherit",
});

const scratch = mkdtempSync(path.join(tmpdir(), "dpas-drift-"));
execFileSync(
  process.execPath,
  [cli, "generated-default", "--yes", "--no-install", "--no-git"],
  { cwd: scratch, stdio: "pipe" },
);
const fresh = path.join(scratch, "generated-default");

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

const committedFiles = listFiles(committed);
const freshFiles = listFiles(fresh);
const drift = [];

for (const file of new Set([...committedFiles, ...freshFiles])) {
  const a = committedFiles.includes(file);
  const b = freshFiles.includes(file);
  if (!a) drift.push(`only in fresh generation: ${file}`);
  else if (!b) drift.push(`only in committed example: ${file}`);
  else {
    const left = readFileSync(path.join(committed, file), "utf8");
    const right = readFileSync(path.join(fresh, file), "utf8");
    if (left !== right) drift.push(`differs: ${file}`);
  }
}

rmSync(scratch, { recursive: true, force: true });

if (drift.length > 0) {
  console.error("Example drift detected — run `pnpm regen:example` and commit:\n");
  for (const line of drift) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`[check-example-drift] ${committedFiles.length} files match the generator output.`);
