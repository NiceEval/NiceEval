import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const COREPACK = process.platform === "win32" ? "corepack.cmd" : "corepack";

function fail(message) {
  process.stderr.write(`dev:link: ${message}\n`);
  process.exitCode = 1;
}

function runPnpm(args, { cwd = ROOT, version, quiet = false } = {}) {
  const command = version === undefined ? PNPM : COREPACK;
  const commandArgs = version === undefined ? args : [`pnpm@${version}`, ...args];
  const display = version === undefined ? "pnpm" : `pnpm@${version}`;
  process.stdout.write(`\n> ${display} ${args.join(" ")}\n`);
  const result = spawnSync(command, commandArgs, {
    cwd,
    env: process.env,
    stdio: quiet ? ["ignore", "ignore", "inherit"] : "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${display} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function declaresNiceeval(manifest) {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ].some((dependencies) => dependencies !== undefined && "niceeval" in dependencies);
}

function declaredPnpmVersion(manifest) {
  if (typeof manifest.packageManager === "string" && manifest.packageManager.startsWith("pnpm@")) {
    return manifest.packageManager.slice("pnpm@".length);
  }
  const engine = manifest.devEngines?.packageManager;
  if (engine?.name === "pnpm" && typeof engine.version === "string") return engine.version;
  return undefined;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function usage() {
  process.stdout.write(`Usage: pnpm dev:link -- <consumer-directory>\n\n`);
  process.stdout.write(`Rebuilds the current NiceEval checkout, generates INDEX.md, packs the publish\n`);
  process.stdout.write(`closure, links it into an installed pnpm consumer, and verifies the resolved\n`);
  process.stdout.write(`node_modules/niceeval realpath. pnpm persists the development link in the consumer\n`);
  process.stdout.write(`workspace override and lockfile; keep those machine-local changes uncommitted.\n`);
}

async function main() {
  const forwarded = process.argv.slice(2);
  const args = forwarded[0] === "--" ? forwarded.slice(1) : forwarded;
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    usage();
    return;
  }
  if (args.length !== 1) {
    usage();
    fail("expected exactly one consumer directory");
    return;
  }

  const requestedConsumer = resolve(process.cwd(), args[0]);
  if (!(await isDirectory(requestedConsumer))) {
    fail(`consumer directory does not exist: ${requestedConsumer}`);
    return;
  }

  const [sourceRoot, consumerRoot] = await Promise.all([
    realpath(ROOT),
    realpath(requestedConsumer),
  ]);
  if (sourceRoot === consumerRoot) {
    fail("consumer directory must be different from the NiceEval checkout");
    return;
  }

  let consumerManifest;
  try {
    consumerManifest = await readJson(join(consumerRoot, "package.json"));
  } catch (error) {
    fail(`cannot read consumer package.json: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!declaresNiceeval(consumerManifest)) {
    fail(`consumer ${consumerManifest.name ?? basename(consumerRoot)} does not declare niceeval`);
    return;
  }
  if (!(await isDirectory(join(consumerRoot, "node_modules")))) {
    fail(`consumer dependencies are not installed; run pnpm install in ${consumerRoot} first`);
    return;
  }

  const scratch = await mkdtemp(join(tmpdir(), "niceeval-dev-link-"));
  try {
    runPnpm(["run", "build:package"]);
    runPnpm(["run", "build:index"]);
    runPnpm(["--config.ignore-scripts=true", "pack", "--pack-destination", scratch], { quiet: true });

    const packageManifest = await readJson(join(ROOT, "package.json"));
    const tarball = join(scratch, `${packageManifest.name}-${packageManifest.version}.tgz`);
    const digest = await sha256(tarball);

    runPnpm(["link", sourceRoot], {
      cwd: consumerRoot,
      version: declaredPnpmVersion(consumerManifest),
    });

    const installedRoot = await realpath(join(consumerRoot, "node_modules", "niceeval"));
    if (installedRoot !== sourceRoot) {
      throw new Error(
        `link verification failed: ${join(consumerRoot, "node_modules", "niceeval")} resolves to ${installedRoot}, expected ${sourceRoot}`,
      );
    }

    process.stdout.write(`\ndev:link: linked ${consumerManifest.name ?? basename(consumerRoot)} -> ${sourceRoot}\n`);
    process.stdout.write(`dev:link: packed ${packageManifest.name}@${packageManifest.version} sha256=${digest}\n`);
    process.stdout.write("dev:link: pnpm persisted the link in the consumer workspace override and lockfile\n");
    process.stdout.write("dev:link: keep those machine-local path changes uncommitted\n");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

await main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
