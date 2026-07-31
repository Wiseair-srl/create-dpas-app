// CI gate: the checked-in examples/generated-default must be exactly what
// the current CLI + template generate. Regenerates into a temp dir and
// diffs; any drift fails the build with the differing paths.
import { execFileSync, spawnSync } from "node:child_process";
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

// Pruned while walking rather than filtered after: these hold thousands of
// files in a working tree and none of them can ever be part of the example.
const PRUNE = new Set(["node_modules", ".next", ".git"]);

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (PRUNE.has(entry)) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

// .gitignore decides what the committed example is allowed to contain, so it
// is what both sides are measured against. The generator writes files that are
// deliberately ignored — `.env` above all, which it must write for the app to
// run and which must never be committed — and comparing those two sets raw
// reports a permanent, unfixable drift on every clean checkout. Asking git
// keeps this in step with .gitignore instead of restating it here.
function ignoredPaths(relPaths) {
  if (relPaths.length === 0) return new Set();
  const prefix = "examples/generated-default/";
  const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: repoRoot,
    input: relPaths.map((file) => prefix + file).join("\n"),
    encoding: "utf8",
  });
  // 0 = some paths ignored, 1 = none. Anything above that is a real failure,
  // and silently treating it as "nothing ignored" would resurrect the bug.
  if (result.status > 1) {
    throw new Error(`git check-ignore failed (${result.status}): ${result.stderr}`);
  }
  return new Set(
    result.stdout
      .split("\n")
      .filter(Boolean)
      .map((file) => file.slice(prefix.length)),
  );
}

const allFiles = [...new Set([...listFiles(committed), ...listFiles(fresh)])].sort();
const ignored = ignoredPaths(allFiles);
const tracked = allFiles.filter((file) => !ignored.has(file));

const committedFiles = new Set(listFiles(committed).filter((file) => !ignored.has(file)));
const freshFiles = new Set(listFiles(fresh).filter((file) => !ignored.has(file)));
const drift = [];

for (const file of tracked) {
  const a = committedFiles.has(file);
  const b = freshFiles.has(file);
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
console.log(
  `[check-example-drift] ${committedFiles.size} files match the generator output ` +
    `(${ignored.size} gitignored paths skipped).`,
);
