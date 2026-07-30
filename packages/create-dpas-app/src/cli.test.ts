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
    expect(env).toContain("MODEL_PROVIDER=anthropic");
    expect(env).toMatch(/#\s*ANTHROPIC_API_KEY=/);
    expect(existsSync(path.join(target, ".env.example"))).toBe(true);

    // Structure: sources present, build artifacts and installs excluded.
    for (const expected of [
      ".gitignore",
      "src/agent/host/protocol.ts",
      "src/server/orpc/procedures.ts",
      "src/app/(app)/dashboard/page.tsx",
      "e2e/guided-demo.spec.ts",
    ]) {
      expect(existsSync(path.join(target, expected)), expected).toBe(true);
    }
    for (const excluded of ["node_modules", ".next", ".data", ".env.local"]) {
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
        modelProvider: "demo",
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
      modelProvider: "demo",
      packageManager: "npm",
    });
    expect(readFileSync(path.join(target, ".env"), "utf8")).toContain("MODEL_PROVIDER=demo");
  });
});
