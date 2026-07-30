// Creates .env from .env.example on first install so the app starts with zero
// configuration. Never overwrites an existing .env and never writes secrets.
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const example = path.join(root, ".env.example");
const env = path.join(root, ".env");

if (existsSync(example) && !existsSync(env)) {
  copyFileSync(example, env);
  console.log("[dpas] created .env from .env.example (demo mode, no secrets)");
}
