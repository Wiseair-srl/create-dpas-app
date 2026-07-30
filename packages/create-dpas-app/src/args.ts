import { parseArgs } from "node:util";
import { PACKAGE_MANAGERS, type PackageManager } from "./pm.js";

export type ModelProvider = "demo" | "anthropic" | "openai";

export interface CliOptions {
  projectName?: string;
  yes: boolean;
  packageManager?: PackageManager;
  modelProvider?: ModelProvider;
  install?: boolean;
  git?: boolean;
  example?: string;
  help: boolean;
  version: boolean;
}

export class CliArgumentError extends Error {}

export function parseCliArgs(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      yes: { type: "boolean", short: "y", default: false },
      "package-manager": { type: "string" },
      "model-provider": { type: "string" },
      install: { type: "boolean" },
      "no-install": { type: "boolean" },
      git: { type: "boolean" },
      "no-git": { type: "boolean" },
      example: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (positionals.length > 1) {
    throw new CliArgumentError(
      `Expected at most one project name, got: ${positionals.join(", ")}`,
    );
  }

  const pm = values["package-manager"];
  if (pm !== undefined && !PACKAGE_MANAGERS.includes(pm as PackageManager)) {
    throw new CliArgumentError(
      `Unknown package manager "${pm}". Use one of: ${PACKAGE_MANAGERS.join(", ")}.`,
    );
  }

  const provider = values["model-provider"];
  if (provider !== undefined && !["demo", "anthropic", "openai"].includes(provider)) {
    throw new CliArgumentError(
      `Unknown model provider "${provider}". Use one of: demo, anthropic, openai.`,
    );
  }

  const resolveToggle = (positive?: boolean, negative?: boolean): boolean | undefined => {
    if (negative) return false;
    return positive;
  };
  const install = resolveToggle(values.install, values["no-install"]);
  const git = resolveToggle(values.git, values["no-git"]);

  return {
    ...(positionals[0] !== undefined ? { projectName: positionals[0] } : {}),
    yes: values.yes ?? false,
    ...(pm !== undefined ? { packageManager: pm as PackageManager } : {}),
    ...(provider !== undefined ? { modelProvider: provider as ModelProvider } : {}),
    ...(install !== undefined ? { install } : {}),
    ...(git !== undefined ? { git } : {}),
    ...(values.example !== undefined ? { example: values.example } : {}),
    help: values.help ?? false,
    version: values.version ?? false,
  };
}

export const HELP_TEXT = `
create-dpas-app — scaffold a Dual-Plane Agent Stack application

Usage:
  pnpm create dpas-app [project-name] [options]
  npm  create dpas-app@latest [project-name] -- [options]

Options:
  -y, --yes                 Accept all defaults, no prompts
      --package-manager     pnpm | npm | yarn | bun
      --model-provider      demo | anthropic | openai  (demo needs no API key)
      --install             Install dependencies (default in prompts)
      --no-install          Skip dependency installation
      --git                 Initialize a git repository
      --no-git              Skip git initialization
      --example <name>      Template to use (available: default)
  -h, --help                Show this help
  -v, --version             Show the CLI version

The generated app runs a guided deterministic demo with ZERO configuration —
no API key, no database. Configure a model later via .env.
`.trimStart();
