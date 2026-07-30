#!/usr/bin/env node
import * as p from "@clack/prompts";
import path from "node:path";
import { createRequire } from "node:module";
import { CliArgumentError, HELP_TEXT, parseCliArgs, type CliOptions, type ModelProvider } from "./args.js";
import { detectPackageManager, PACKAGE_MANAGERS, runScript, type PackageManager } from "./pm.js";
import { assertSafeTarget, generateProject, resolveTemplateDir, ScaffoldError } from "./scaffold.js";
import { initGit, installDependencies, StepError } from "./steps.js";
import { directoryFor, validateProjectName } from "./validate.js";

/**
 * The interactive entry point. One excellent golden path: name → package
 * manager → model mode → install → git. Every prompt is skippable with
 * flags; --yes accepts every default for CI and scripts.
 */

const require = createRequire(import.meta.url);

function version(): string {
  return (require("../package.json") as { version: string }).version;
}

function cancelled(): never {
  p.cancel("Cancelled — nothing was created.");
  process.exit(130);
}

function bail(message: string, code = 1): never {
  p.log.error(message);
  p.outro("Nothing was created.");
  process.exit(code);
}

async function main() {
  let options: CliOptions;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliArgumentError) {
      console.error(`\n${error.message}\n`);
      console.error(HELP_TEXT);
      process.exit(2);
    }
    throw error;
  }

  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }
  if (options.version) {
    console.log(version());
    return;
  }

  const example = options.example ?? "default";
  let templateDir: string;
  try {
    templateDir = resolveTemplateDir(example);
  } catch (error) {
    if (error instanceof ScaffoldError) bail(error.message, 2);
    throw error;
  }

  p.intro(`create-dpas-app ${version()}`);
  p.log.message(
    "Scaffolding a Dual-Plane Agent Stack app: Agent Surface (view plane), " +
      "oRPC Agent (domain plane), an application-owned Agent Host, Mastra, and assistant-ui.",
  );

  // --- project name ---------------------------------------------------------
  let projectName = options.projectName;
  if (projectName === undefined) {
    if (options.yes) {
      projectName = "my-dpas-app";
    } else {
      const answer = await p.text({
        message: "Project name",
        placeholder: "my-dpas-app",
        defaultValue: "my-dpas-app",
        validate: (value) => {
          const candidate = value && value.length > 0 ? value : "my-dpas-app";
          const check = validateProjectName(candidate);
          return check.valid ? undefined : (check.problems[0] ?? "invalid name");
        },
      });
      if (p.isCancel(answer)) cancelled();
      projectName = answer && answer.length > 0 ? answer : "my-dpas-app";
    }
  }
  const nameCheck = validateProjectName(projectName);
  if (!nameCheck.valid) {
    bail(`Invalid project name "${projectName}": ${nameCheck.problems.join("; ")}`, 2);
  }

  const targetDir = path.resolve(process.cwd(), directoryFor(projectName));
  try {
    assertSafeTarget(targetDir);
  } catch (error) {
    if (error instanceof ScaffoldError) bail(error.message, 2);
    throw error;
  }

  // --- package manager ------------------------------------------------------
  const detectedPm = detectPackageManager();
  let packageManager: PackageManager = options.packageManager ?? detectedPm;
  if (options.packageManager === undefined && !options.yes) {
    const answer = await p.select({
      message: "Package manager",
      initialValue: detectedPm,
      options: PACKAGE_MANAGERS.map((pm) => ({
        value: pm,
        label: pm,
        ...(pm === detectedPm ? { hint: "detected" } : {}),
      })),
    });
    if (p.isCancel(answer)) cancelled();
    packageManager = answer;
  }

  // --- model mode -----------------------------------------------------------
  let modelProvider: ModelProvider = options.modelProvider ?? "demo";
  if (options.modelProvider === undefined && !options.yes) {
    const answer = await p.select({
      message: "Model mode",
      initialValue: "demo" as ModelProvider,
      options: [
        {
          value: "demo" as ModelProvider,
          label: "Guided demo only",
          hint: "no API key needed — configure a model later in .env",
        },
        { value: "anthropic" as ModelProvider, label: "Anthropic (Claude)", hint: "needs ANTHROPIC_API_KEY" },
        { value: "openai" as ModelProvider, label: "OpenAI (GPT)", hint: "needs OPENAI_API_KEY" },
      ],
    });
    if (p.isCancel(answer)) cancelled();
    modelProvider = answer;
  }

  // --- install / git --------------------------------------------------------
  let install = options.install ?? true;
  if (options.install === undefined && !options.yes) {
    const answer = await p.confirm({ message: "Install dependencies?", initialValue: true });
    if (p.isCancel(answer)) cancelled();
    install = answer;
  }

  let git = options.git ?? true;
  if (options.git === undefined && !options.yes) {
    const answer = await p.confirm({ message: "Initialize a git repository?", initialValue: true });
    if (p.isCancel(answer)) cancelled();
    git = answer;
  }

  // --- generate -------------------------------------------------------------
  const spinner = p.spinner();
  spinner.start(`Creating ${projectName}`);
  try {
    generateProject({
      projectName,
      targetDir,
      templateDir,
      modelProvider,
      packageManager,
    });
    spinner.stop(`Created ${path.relative(process.cwd(), targetDir) || "."}`);
  } catch (error) {
    spinner.stop("Generation failed");
    if (error instanceof ScaffoldError) bail(error.message, 2);
    throw error;
  }

  if (install) {
    p.log.step(`Installing dependencies with ${packageManager} — this can take a few minutes`);
    try {
      installDependencies(targetDir, packageManager);
      p.log.success("Dependencies installed");
    } catch (error) {
      if (error instanceof StepError) {
        p.log.warn(`${error.message} You can install later with: ${packageManager} install`);
        install = false;
      } else {
        throw error;
      }
    }
  }

  if (git) {
    try {
      initGit(targetDir);
      p.log.success("Initialized git repository");
    } catch (error) {
      if (error instanceof StepError) {
        p.log.warn(`${error.message} You can run git init yourself.`);
      } else {
        throw error;
      }
    }
  }

  // --- next steps -----------------------------------------------------------
  const cd = path.relative(process.cwd(), targetDir) || ".";
  const lines = [
    `cd ${cd}`,
    ...(install ? [] : [`${packageManager} install`]),
    runScript(packageManager, "dev"),
  ];
  p.note(lines.join("\n"), "Next steps");
  p.log.message(
    modelProvider === "demo"
      ? "Then open http://localhost:3000 and press “Run guided demo” — the full\n" +
          "agent pipeline runs deterministically, no model or API key involved."
      : `Then add your ${modelProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} to .env and open http://localhost:3000.\n` +
          "“Run guided demo” always works — even before the key is set.",
  );
  p.outro("The architecture tour lives at /architecture and in docs/.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
