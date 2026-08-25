/**
 * Proves the shipped artifact actually runs.
 *
 * The vsix is built with `--no-dependencies` and excludes node_modules, so any
 * dependency tsup leaves as a bare require works in development and then
 * crashes once installed. This packages for real, unpacks somewhere with no
 * node_modules anywhere above it, and runs the smoke test against that bundle.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(here, "..");

const workdir = await mkdtemp(path.join(tmpdir(), "codicil-vsix-"));
const vsix = path.join(workdir, "codicil.vsix");
const unpacked = path.join(workdir, "unpacked");

try {
  execFileSync(
    "npx",
    ["vsce", "package", "--no-dependencies", "--allow-missing-repository", "--out", vsix],
    { cwd: extensionRoot, stdio: "pipe" },
  );
  execFileSync("unzip", ["-q", vsix, "-d", unpacked], { stdio: "pipe" });

  const manifest = JSON.parse(
    await readFile(path.join(unpacked, "extension/package.json"), "utf8"),
  );
  const entry = path.join(unpacked, "extension", manifest.main);

  const source = await readFile(entry, "utf8");
  const required = new Set([...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]));
  const allowed = new Set([
    "vscode",
    "buffer",
    "child_process",
    "crypto",
    "fs",
    "fs/promises",
    "os",
    "path",
    "process",
    "stream",
    "url",
    "util",
  ]);
  const unbundled = [...required].filter(
    (name) => !allowed.has(name) && !name.startsWith("node:"),
  );
  assert.deepEqual(
    unbundled,
    [],
    `these are required at runtime but not bundled, so the installed extension will crash: ${unbundled.join(", ")}`,
  );

  execFileSync("node", [path.join(here, "smoke.mjs")], {
    cwd: extensionRoot,
    stdio: "inherit",
    env: { ...process.env, CODICIL_EXTENSION_BUNDLE: entry },
  });

  console.log("packaged vsix runs standalone");
} finally {
  await rm(workdir, { recursive: true, force: true });
}
