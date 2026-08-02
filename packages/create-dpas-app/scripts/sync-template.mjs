// Copies the repo template into the package for publishing, excluding build
// output, and renames .gitignore → gitignore (npm strips dotfiles named
// .gitignore from packages; the CLI restores the name at scaffold time).
import { cpSync, existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(path.dirname(pkgRoot));
const source = path.join(repoRoot, "templates", "default");
const target = path.join(pkgRoot, "template", "default");

const EXCLUDES = new Set([
  "node_modules",
  "dist",
  "build",
  ".data",
  // the e2e suite's scratch store — present whenever someone ran `pnpm test:e2e`
  // in the template, and shipping it hands every scaffold prior demo threads
  ".data-e2e",
  "test-results",
  "playwright-report",
  "coverage",
  ".env",

  "tsconfig.tsbuildinfo",
]);

rmSync(path.join(pkgRoot, "template"), { recursive: true, force: true });
cpSync(source, target, {
  recursive: true,
  filter: (src) => !EXCLUDES.has(path.basename(src)),
});

const dotGitignore = path.join(target, ".gitignore");
if (existsSync(dotGitignore)) {
  renameSync(dotGitignore, path.join(target, "gitignore"));
}

console.log(`[create-dpas-app] template synced to ${path.relative(repoRoot, target)}`);
