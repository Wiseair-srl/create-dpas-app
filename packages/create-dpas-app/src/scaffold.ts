import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelProvider } from "./args.js";

/**
 * Filesystem scaffolding. Everything is materialized in a temp directory
 * first and moved into place only when complete — a failed run never leaves
 * a half-generated project behind.
 */

export const TEMPLATE_PLACEHOLDER = "dpas-template-default";

export class ScaffoldError extends Error {}

const COPY_EXCLUDES = new Set([
  "node_modules",
  ".next",
  ".data",
  "test-results",
  "playwright-report",
  "coverage",
  ".env",
  "next-env.d.ts",
  "tsconfig.tsbuildinfo",
]);

/** Locate a template directory shipped with this package (or the repo, in dev). */
export function resolveTemplateDir(example: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Published layout: <pkg>/dist/../template/<example> == <pkg>/template/<example>
    path.resolve(here, "..", "template", example),
    // Monorepo layout: <repo>/templates/<example>
    path.resolve(here, "..", "..", "..", "templates", example),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  throw new ScaffoldError(
    `Template "${example}" not found. Available templates: default.`,
  );
}

export interface GenerateOptions {
  projectName: string;
  targetDir: string;
  templateDir: string;
  modelProvider: ModelProvider;
  packageManager: string;
}

export function assertSafeTarget(targetDir: string) {
  if (!existsSync(targetDir)) return;
  const entries = readdirSync(targetDir).filter(
    (entry) => ![".git", ".DS_Store"].includes(entry),
  );
  if (entries.length > 0) {
    throw new ScaffoldError(
      `Destination "${targetDir}" already exists and is not empty. ` +
        "Choose another name or remove it first — nothing was overwritten.",
    );
  }
}

export function generateProject(options: GenerateOptions): void {
  const { projectName, targetDir, templateDir, modelProvider } = options;
  assertSafeTarget(targetDir);

  const staging = mkdtempSync(path.join(tmpdir(), "create-dpas-app-"));
  const stagedApp = path.join(staging, "app");
  try {
    cpSync(templateDir, stagedApp, {
      recursive: true,
      filter: (source) => {
        const base = path.basename(source);
        return !COPY_EXCLUDES.has(base);
      },
    });

    // npm strips .gitignore from published packages; the packaged template
    // ships it as "gitignore" and we restore the dot here. In-repo templates
    // still carry the real file — handle both.
    const bareGitignore = path.join(stagedApp, "gitignore");
    if (existsSync(bareGitignore) && !existsSync(path.join(stagedApp, ".gitignore"))) {
      renameSync(bareGitignore, path.join(stagedApp, ".gitignore"));
    }

    replaceTokens(path.join(stagedApp, "package.json"), projectName);
    replaceTokens(path.join(stagedApp, "README.md"), projectName);
    writeEnvFiles(stagedApp, modelProvider);

    mkdirSync(path.dirname(targetDir), { recursive: true });
    // Move into place; fall back to copy across devices/volumes.
    try {
      renameSync(stagedApp, targetDir);
    } catch {
      cpSync(stagedApp, targetDir, { recursive: true });
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function replaceTokens(file: string, projectName: string) {
  if (!existsSync(file)) return;
  const contents = readFileSync(file, "utf8");
  writeFileSync(file, contents.replaceAll(TEMPLATE_PLACEHOLDER, projectName));
}

/**
 * .env.example is the committed reference. The generated .env selects the
 * chosen provider but NEVER contains a secret — keys stay commented with a
 * pointer to where they go.
 */
function writeEnvFiles(appDir: string, modelProvider: ModelProvider) {
  const examplePath = path.join(appDir, ".env.example");
  if (!existsSync(examplePath)) {
    throw new ScaffoldError("Template is missing .env.example — refusing to continue.");
  }
  const example = readFileSync(examplePath, "utf8");
  const env = example.replace(/^MODEL_PROVIDER=.*$/m, `MODEL_PROVIDER=${modelProvider}`);
  writeFileSync(path.join(appDir, ".env"), env);
}
