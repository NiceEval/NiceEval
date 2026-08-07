// Testkit auto-pack, injection and receipt support (T3.3).
//
// Contract: docs/engineering/testing/testkit.md「构建与采用门禁」 and
// docs/engineering/testing/e2e/execution.md「Testkit 构建与注入」.
//
// - The local default entry clean-builds and packs the current workspace
//   Testkit exactly once per invocation; explicit `run --testkit` never
//   repacks (CI / exact replay only).
// - The tarball is renamed to the content-addressed
//   `niceeval-testkit-<sha256>.tgz` and materialized under the durable
//   artifact root; receipts reference it by relative path and claim exact
//   replay only while the tgz is retained.
// - Injection only ever happens inside the isolated copy: the verified tgz
//   is copied into the copy with its content-addressed name and declared as a
//   `file:` devDependency. Scenario source package.json/lockfiles never
//   contain Testkit — the runner fails before test when they do, when a
//   declared harness.testkit repo gets no tgz, or when an undeclared repo
//   imports @niceeval/testkit.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import type { DiscoveredRepo } from "./discovery.ts";
import {
  readTestkitTarball,
  runInherited,
  type TestkitTarball,
} from "./injection.ts";

/** Content-addressed file name: the tarball identity is its own bytes. */
export function testkitTarballFileName(sha256: string): string {
  return `niceeval-testkit-${sha256}.tgz`;
}

async function buildTestkitSource(pkgDir: string): Promise<number> {
  return runInherited("pnpm", ["build"], pkgDir, false);
}

async function packTestkitSource(pkgDir: string, destDir: string): Promise<number> {
  return runInherited("pnpm", ["pack", "--pack-destination", destDir], pkgDir, false);
}

export interface TestkitBuildDependencies {
  /** Runs the Testkit clean build inside packages/testkit; returns exit code. */
  buildTestkit?: (pkgDir: string) => Promise<number>;
  /** Packs the Testkit into destDir; returns exit code. */
  packTestkit?: (pkgDir: string, destDir: string) => Promise<number>;
}

/**
 * Clean-build and pack the current workspace Testkit exactly once, then
 * rename the one resulting tarball to its content-addressed
 * `niceeval-testkit-<sha256>.tgz` name. The dist/ directory is deleted
 * before the build so incremental leftovers are never packed. Identity
 * (@niceeval/testkit) and both digests are verified from the tarball bytes
 * themselves, never from what pnpm prints.
 */
export async function buildTestkitTarball(
  repoRoot: string,
  destDir: string,
  dependencies: TestkitBuildDependencies = {},
): Promise<TestkitTarball> {
  const pkgDir = join(repoRoot, "packages", "testkit");
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    throw new Error(`no packages/testkit/package.json under ${repoRoot} — cannot build the Testkit tarball`);
  }
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { name?: unknown };
  if (pkg.name !== "@niceeval/testkit") {
    throw new Error(
      `packages/testkit/package.json name must be "@niceeval/testkit", got ${JSON.stringify(pkg.name)}`,
    );
  }

  // Clean build: dist/ must be deleted before rebuilding so that stale
  // incremental output can never be packed.
  await rm(join(pkgDir, "dist"), { recursive: true, force: true });

  const build = dependencies.buildTestkit ?? buildTestkitSource;
  const pack = dependencies.packTestkit ?? packTestkitSource;

  const buildCode = await build(pkgDir);
  if (buildCode !== 0) {
    throw new Error(`Testkit clean build failed (exit ${buildCode}) in ${pkgDir}`);
  }

  mkdirSync(destDir, { recursive: true });
  const packCode = await pack(pkgDir, destDir);
  if (packCode !== 0) {
    throw new Error(`Testkit pack failed (exit ${packCode}) into ${destDir}`);
  }

  const tgzFiles = readdirSync(destDir).filter((name) => name.endsWith(".tgz"));
  if (tgzFiles.length !== 1) {
    throw new Error(
      `expected exactly one .tgz in ${destDir} after packing the Testkit, found ${tgzFiles.length}: ${JSON.stringify(tgzFiles)}`,
    );
  }

  const packedPath = join(destDir, tgzFiles[0]!);
  const verified = await readTestkitTarball(packedPath);
  const contentAddressed = join(destDir, testkitTarballFileName(verified.sha256));
  if (contentAddressed !== packedPath) {
    await rename(packedPath, contentAddressed);
  }
  return { ...verified, path: contentAddressed };
}

/**
 * Materialize the verified Testkit tarball under the durable artifact root
 * using its content-addressed name, and re-verify the durable copy's digest.
 * Idempotent: an existing file with the same sha256 is reused as-is. This is
 * the byte identity every receipt and exact-replay claim references.
 */
export async function materializeTestkitArtifact(
  artifactRoot: string,
  testkit: TestkitTarball,
): Promise<TestkitTarball> {
  const dir = join(artifactRoot, "testkit");
  await mkdir(dir, { recursive: true });
  const target = join(dir, testkitTarballFileName(testkit.sha256));

  let current: Buffer | undefined;
  try {
    current = readFileSync(target);
  } catch {
    current = undefined;
  }
  if (current === undefined || createHash("sha256").update(current).digest("hex") !== testkit.sha256) {
    await copyFile(testkit.path, target);
  }

  const durable = await readTestkitTarball(target);
  if (durable.sha256 !== testkit.sha256) {
    throw new Error(
      `durable testkit artifact at ${target} has sha256 ${durable.sha256}, expected ${testkit.sha256}`,
    );
  }
  return durable;
}

/**
 * Fail-fast guard: repos that declare `harness.testkit: true` must receive a
 * tgz. The local default entry builds one automatically; CI must pass
 * `--testkit <exact-tgz>`. Running such a repo without its Testkit would be
 * "declared but not injected" — the repo would silently run with whatever the
 * registry happens to resolve, which is exactly what the contract forbids.
 */
export function ensureTestkitForHarnessConsumers(
  repos: readonly DiscoveredRepo[],
  testkit: TestkitTarball | undefined,
): string[] {
  if (testkit !== undefined) return [];
  const consumers = repos
    .filter((repo) => repo.manifest.harness?.testkit === true)
    .map((repo) => repo.manifest.id);
  if (consumers.length === 0) return [];
  return [
    `repo(s) ${consumers.join(", ")} declare harness.testkit: true but no testkit tarball is available — the local default command builds it automatically; CI must pass --testkit <exact-tgz>`,
  ];
}

const PACKAGE_DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

/**
 * Scenario source cleanliness (docs/engineering/testing/testkit.md「构建与
 * 采用门禁」6 and scenario-repos.md): the copied scenario's package.json and
 * checked-in lockfile must not contain @niceeval/testkit, `workspace:`
 * references or `file:` specifiers. `file:` is only ever added by the runner
 * inside the isolated copy, pointing at the verified content-addressed tgz.
 * Returns human-readable violations; an empty list means the source is clean.
 */
export function checkTestkitSourceClean(copyDir: string): string[] {
  const violations: string[] = [];

  const pkg = JSON.parse(readFileSync(join(copyDir, "package.json"), "utf8")) as Record<string, unknown>;
  for (const field of PACKAGE_DEP_FIELDS) {
    const deps = pkg[field];
    if (
      deps !== undefined &&
      typeof deps === "object" &&
      deps !== null &&
      Object.prototype.hasOwnProperty.call(deps, "@niceeval/testkit")
    ) {
      violations.push(
        `source package.json declares "@niceeval/testkit" in ${field} — e2e.json harness.testkit is the only true source of testkit intent`,
      );
    }
  }

  const lockPath = join(copyDir, "pnpm-lock.yaml");
  if (existsSync(lockPath)) {
    const lock = readFileSync(lockPath, "utf8");
    if (lock.includes("@niceeval/testkit@")) {
      violations.push(
        'checked-in pnpm-lock.yaml contains an "@niceeval/testkit" resolution — scenario lockfiles must not declare testkit',
      );
    }
    if (lock.includes("workspace:")) {
      violations.push(
        'checked-in pnpm-lock.yaml contains a "workspace:" reference — scenarios must not use workspace links',
      );
    }
    if (lock.includes("file:")) {
      violations.push(
        'checked-in pnpm-lock.yaml contains a "file:" specifier — file: tarballs are only added by the runner inside the isolated copy',
      );
    }
  }

  return violations;
}

const TESTKIT_IMPORT_PATTERN = /(?:(?:from|import|require)\s*\(?\s*|import\s+)(["'])@niceeval\/testkit\1/;
const SCAN_EXCLUDED = new Set(["node_modules", ".git", ".niceeval"]);
const SCAN_SOURCE_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".ts", ".cts", ".mts", ".tsx", ".jsx"]);

/**
 * Find scenario files that import @niceeval/testkit without the manifest
 * declaring `harness.testkit: true`. package.json and pnpm-lock.yaml have
 * their own dedicated checks and are skipped here. Only actual import-shaped
 * references match, so documentation prose cannot false-positive.
 */
export function scanForTestkitImports(copyDir: string): string[] {
  const matches: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SCAN_EXCLUDED.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name === "package.json" || entry.name === "pnpm-lock.yaml") continue;
      if (!SCAN_SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
      try {
        const text = readFileSync(full, "utf8");
        if (TESTKIT_IMPORT_PATTERN.test(text)) matches.push(relative(copyDir, full));
      } catch {
        // Binary or unreadable file — not an import surface.
      }
    }
  };
  walk(copyDir);
  return matches.sort();
}

/**
 * Inject the verified content-addressed Testkit tgz into the isolated copy
 * only: copy the tgz in, then add it as a `file:` devDependency. Never writes
 * the source repo. Source cleanliness was already established in prepare.
 */
export async function injectTestkitTarball(copyDir: string, testkit: TestkitTarball): Promise<void> {
  const fileName = testkitTarballFileName(testkit.sha256);
  await copyFile(testkit.path, join(copyDir, fileName));

  const pkgPath = join(copyDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
  const devDeps = (pkg.devDependencies ??= {}) as Record<string, string>;
  devDeps["@niceeval/testkit"] = `file:./${fileName}`;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

/** The installed package path inside an isolated copy, for verification. */
export function testkitInstallPath(copyDir: string): string {
  return join(copyDir, "node_modules", "@niceeval", "testkit");
}
