/** Package-manager awareness: detection, commands, and printed snippets. */

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export const PACKAGE_MANAGERS: PackageManager[] = ["pnpm", "npm", "yarn", "bun"];

/** Infer the invoking package manager from npm_config_user_agent. */
export function detectPackageManager(userAgent = process.env.npm_config_user_agent): PackageManager {
  if (!userAgent) return "pnpm";
  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  if (userAgent.startsWith("bun")) return "bun";
  if (userAgent.startsWith("npm")) return "npm";
  return "pnpm";
}

export function installCommand(pm: PackageManager): [command: string, args: string[]] {
  return [pm, ["install"]];
}

export function runScript(pm: PackageManager, script: string): string {
  switch (pm) {
    case "npm":
      return `npm run ${script}`;
    case "yarn":
      return `yarn ${script}`;
    case "bun":
      return `bun run ${script}`;
    default:
      return `pnpm ${script}`;
  }
}

export function execBinary(pm: PackageManager, binary: string): string {
  switch (pm) {
    case "npm":
      return `npx ${binary}`;
    case "yarn":
      return `yarn ${binary}`;
    case "bun":
      return `bunx ${binary}`;
    default:
      return `pnpm exec ${binary}`;
  }
}
