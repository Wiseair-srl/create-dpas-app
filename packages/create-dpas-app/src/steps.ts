import { spawnSync } from "node:child_process";
import { installCommand, type PackageManager } from "./pm.js";

/** Post-generation steps: dependency install and git init. Never use a shell. */

export class StepError extends Error {}

export function installDependencies(targetDir: string, pm: PackageManager): void {
  const [command, args] = installCommand(pm);
  const result = spawnSync(command, args, {
    cwd: targetDir,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: undefined as unknown as string },
  });
  if (result.error) {
    throw new StepError(
      `Could not run ${command} install (${(result.error as NodeJS.ErrnoException).code ?? "error"}). ` +
        `Is ${command} installed?`,
    );
  }
  if (result.status !== 0) {
    throw new StepError(`${command} install exited with code ${result.status}.`);
  }
}

export function initGit(targetDir: string): void {
  const run = (args: string[]) =>
    spawnSync("git", args, { cwd: targetDir, stdio: "pipe", encoding: "utf8" });

  const init = run(["init", "-b", "main"]);
  if (init.error || init.status !== 0) {
    throw new StepError("git init failed — is git installed?");
  }
  run(["add", "-A"]);
  const commit = run([
    "-c",
    "user.name=create-dpas-app",
    "-c",
    "user.email=create-dpas-app@localhost",
    "commit",
    "-m",
    "Initial commit from create-dpas-app",
    "--no-gpg-sign",
  ]);
  if (commit.status !== 0) {
    // A failed initial commit (e.g. odd git config) should not fail the
    // scaffold; the repo is initialized and the user can commit themselves.
    return;
  }
}
