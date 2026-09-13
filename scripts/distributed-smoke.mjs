import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(join(tmpdir(), "dpas-distributed-smoke-"));
const packageManager = process.env.npm_execpath;
const pnpm = packageManager ? [process.execPath, packageManager] : ["pnpm"];
const services = [];
let logs = "";
let passed = false;

function run(command, args, cwd) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0 ? resolveCommand() : reject(new Error(`${command} failed (${code ?? signal})`)),
    );
  });
}
const packageCommand = (args, cwd = root) => run(pnpm[0], [...pnpm.slice(1), ...args], cwd);

async function healthy(port) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }))
      .ok;
  } catch {
    return false;
  }
}
async function start(file, port, cwd) {
  if (await healthy(port))
    throw new Error(`Port ${port} already hosts a service; stop it before this test.`);
  const child = spawn(process.execPath, [file], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  services.push(child);
  child.stdout.on("data", (chunk) => {
    logs = (logs + chunk).slice(-30_000);
  });
  child.stderr.on("data", (chunk) => {
    logs = (logs + chunk).slice(-30_000);
  });
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null)
      throw new Error(`${file} exited before readiness (${child.exitCode}).`);
    if (await healthy(port)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`${file} did not become healthy.`);
}

try {
  await packageCommand(["--filter", "create-dpas-app", "pack", "--pack-destination", temporary]);
  const tarball = (await readdir(temporary)).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("CLI tarball missing.");
  await run("tar", ["-xzf", join(temporary, tarball), "-C", temporary], root);
  const fixture = join(temporary, "reference");
  await cp(join(temporary, "package/reference/distributed"), fixture, { recursive: true });
  const manifestPath = join(fixture, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // Only the temporary consumer uses a tarball. Shipped manifests use published ranges.
  manifest.dependencies["create-dpas-app"] = `file:${join(temporary, tarball)}`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await packageCommand(["install", "--no-frozen-lockfile"], fixture);
  await start("backend.mjs", 4311, fixture);
  await start("host.mjs", 4312, fixture);
  await run(process.execPath, ["smoke.mjs"], fixture);
  passed = true;
} catch (error) {
  if (logs) process.stderr.write(logs);
  throw error;
} finally {
  await Promise.all(
    services.map(
      (child) =>
        new Promise((resolveStop) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolveStop();
          const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolveStop();
          });
          child.kill("SIGTERM");
        }),
    ),
  );
  if (passed) await rm(temporary, { recursive: true, force: true });
  else process.stderr.write(`Distributed smoke fixture retained: ${temporary}\n`);
}
