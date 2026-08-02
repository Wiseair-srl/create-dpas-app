/**
 * Bundle the server for production. `tsx` transpiling the whole graph at boot
 * is fine in development and wasteful in a container; a prebuilt bundle boots
 * as plain Node.
 *
 * Every npm dependency stays EXTERNAL (loaded from node_modules natively) —
 * only this app's own TypeScript is bundled. The output sits at build/, one
 * level under the package root exactly as server/ does, so every relative
 * resolution in the server (`../dist`, `../.data`) keeps working.
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));

await build({
  entryPoints: [`${root}/server/index.ts`],
  outfile: `${root}/build/index.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: [...Object.keys(pkg.dependencies), "node:*"],
  sourcemap: true,
  logLevel: "info",
});
