import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliArgumentError, parseCliArgs } from "./args.js";
import { detectPackageManager, runScript } from "./pm.js";
import {
  assertSafeTarget,
  generateProject,
  resolveTemplateDir,
  ScaffoldError,
  TEMPLATE_PLACEHOLDER,
} from "./scaffold.js";
import { directoryFor, validateProjectName } from "./validate.js";

const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cdpa-test-"));
  cleanups.push(dir);
  return dir;
}

describe("argument parsing", () => {
  it("parses the full flag surface", () => {
    const options = parseCliArgs([
      "my-app",
      "--yes",
      "--package-manager",
      "npm",
      "--model-provider",
      "anthropic",
      "--no-install",
      "--no-git",
      "--example",
      "default",
    ]);
    expect(options).toMatchObject({
      projectName: "my-app",
      yes: true,
      packageManager: "npm",
      modelProvider: "anthropic",
      install: false,
      git: false,
      example: "default",
    });
  });

  it("defaults toggles to undefined so prompts can ask", () => {
    const options = parseCliArgs(["my-app"]);
    expect(options.install).toBeUndefined();
    expect(options.git).toBeUndefined();
    expect(options.yes).toBe(false);
  });

  it("rejects unknown package managers and providers", () => {
    expect(() => parseCliArgs(["--package-manager", "maven"])).toThrow(CliArgumentError);
    expect(() => parseCliArgs(["--model-provider", "skynet"])).toThrow(CliArgumentError);
    expect(() => parseCliArgs(["a", "b"])).toThrow(CliArgumentError);
  });
});

describe("project name validation", () => {
  it("accepts kebab-case and scoped names", () => {
    expect(validateProjectName("my-agent-app").valid).toBe(true);
    expect(validateProjectName("@acme/ops-dashboard").valid).toBe(true);
    expect(directoryFor("@acme/ops-dashboard")).toBe("ops-dashboard");
  });

  it("rejects uppercase, leading dots, spaces and emptiness", () => {
    expect(validateProjectName("MyApp").valid).toBe(false);
    expect(validateProjectName(".hidden").valid).toBe(false);
    expect(validateProjectName("has space").valid).toBe(false);
    expect(validateProjectName("").valid).toBe(false);
  });
});

describe("package manager helpers", () => {
  it("detects the invoking package manager from the user agent", () => {
    expect(detectPackageManager("pnpm/10.15.0 npm/? node/v22")).toBe("pnpm");
    expect(detectPackageManager("yarn/4.0.0 npm/? node/v22")).toBe("yarn");
    expect(detectPackageManager("bun/1.2.0 npm/? node/v22")).toBe("bun");
    expect(detectPackageManager("npm/10.9.0 node/v22")).toBe("npm");
    expect(detectPackageManager(undefined)).toBe("pnpm");
  });

  it("prints the right run command per manager", () => {
    expect(runScript("npm", "dev")).toBe("npm run dev");
    expect(runScript("yarn", "dev")).toBe("yarn dev");
    expect(runScript("pnpm", "dev")).toBe("pnpm dev");
    expect(runScript("bun", "dev")).toBe("bun run dev");
  });
});

describe("generation", () => {
  const templateDir = resolveTemplateDir("default");

  it("resolves the shipped template and rejects unknown ones", () => {
    expect(existsSync(path.join(templateDir, "package.json"))).toBe(true);
    expect(() => resolveTemplateDir("nope")).toThrow(ScaffoldError);
  });

  it("generates a complete project with replaced tokens and a safe .env", () => {
    const root = tempDir();
    const target = path.join(root, "my-agent-app");
    generateProject({
      projectName: "my-agent-app",
      targetDir: target,
      templateDir,
      modelProvider: "anthropic",
      packageManager: "pnpm",
    });

    const pkg = JSON.parse(readFileSync(path.join(target, "package.json"), "utf8")) as {
      name: string;
    };
    expect(pkg.name).toBe("my-agent-app");
    expect(readFileSync(path.join(target, "package.json"), "utf8")).not.toContain(
      TEMPLATE_PLACEHOLDER,
    );
    expect(readFileSync(path.join(target, "README.md"), "utf8")).toContain("my-agent-app");

    // Env: provider selected, secrets never written.
    const env = readFileSync(path.join(target, ".env"), "utf8");
    // Choosing a provider UNCOMMENTS its key line — the app decides from which
    // key is set, so there is no separate switch to keep in agreement with it.
    expect(env).toMatch(/^ANTHROPIC_API_KEY=$/m);
    // Uncommented but EMPTY, and the provider not chosen stays commented: a
    // generated .env is a form to fill in, never a place a secret appears.
    expect(env).not.toMatch(/^ANTHROPIC_API_KEY=.+$/m);
    expect(env).toMatch(/^#\s*OPENROUTER_API_KEY=/m);
    expect(existsSync(path.join(target, ".env.example"))).toBe(true);

    // Structure: sources present, build artifacts and installs excluded.
    // One file per layer the architecture claims to have — a generated app
    // missing any of these is missing a plane, not a file.
    for (const expected of [
      ".gitignore",
      "capabilities/registry.ts",          // the domain plane
      "app/agent/host/protocol.ts",        // the host's wire contract
      "app/agent/surface/registry.ts",     // the presentation plane
      "app/agent/domain/manifest.ts",      // the exposure ceiling
      "server/index.ts",                   // the one process
      "server/mcp.ts",                     // the second adapter
      "app/agent/surface/contracts.ts",    // the declared exposure ceiling
      ".agent-surface/contract.json",      // …and the compiled artifact
      "e2e/copilot.spec.ts",
    ]) {
      expect(existsSync(path.join(target, expected)), expected).toBe(true);
    }
    for (const excluded of ["node_modules", "dist", "build", ".data", ".env.local"]) {
      expect(existsSync(path.join(target, excluded)), excluded).toBe(false);
    }
  });

  it("refuses to overwrite a non-empty destination", () => {
    const root = tempDir();
    const target = path.join(root, "busy");
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "keep.txt"), "important");
    expect(() => assertSafeTarget(target)).toThrow(/not empty/);
    expect(() =>
      generateProject({
        projectName: "busy",
        targetDir: target,
        templateDir,
        modelProvider: "none",
        packageManager: "pnpm",
      }),
    ).toThrow(ScaffoldError);
    // Nothing was touched.
    expect(readFileSync(path.join(target, "keep.txt"), "utf8")).toBe("important");
  });

  it("keeps demo mode as the default provider in .env", () => {
    const root = tempDir();
    const target = path.join(root, "demo-app");
    generateProject({
      projectName: "demo-app",
      targetDir: target,
      templateDir,
      modelProvider: "none",
      packageManager: "npm",
    });
    // "Decide later" leaves every key commented — a generated .env must never
    // arrive with a live key line the developer did not ask for.
    const env = readFileSync(path.join(target, ".env"), "utf8");
    expect(env).toMatch(/^#\s*ANTHROPIC_API_KEY=/m);
    expect(env).not.toMatch(/^ANTHROPIC_API_KEY=/m);
  });
});
