// Workspace Testkit build, isolated directory injection and verification.
//
// Testkit is private harness code from the same checkout, not a release
// artifact. Every root invocation compiles an immutable package snapshot
// inside its own scratch tree and injects that absolute directory as a `file:`
// devDependency only into each isolated scenario copy. The shared checkout
// dist is never read, removed, or written. pnpm must materialize the snapshot
// in the copy's virtual store; a symlink back to it is rejected.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse } from "yaml";

import {
  createUnmanagedExecutionControl,
  isExecutionCancelled,
  E2EExecutionCancelledError,
  hasSuccessfulOwnedProcessResult,
  throwIfExecutionCancelled,
  type E2EExecutionControl,
} from "./owned-process.ts";

export interface TestkitPackage {
  /** Absolute immutable package snapshot inside this invocation's scratch tree. */
  path: string;
  /** Stable checkout-relative diagnostic; never used as package identity. */
  sourcePath: "packages/testkit";
  name: "@niceeval/testkit";
  version: string;
  /** Ordered path/content identity used to detect mutation by package managers or tests. */
  digest: string;
}

export interface TestkitBuildDependencies {
  /** Compiles Testkit source into the supplied staging package; returns exit code. */
  buildTestkit?: (sourceDir: string, stagingDir: string) => Promise<number>;
}

async function buildTestkitSource(
  sourceDir: string,
  stagingDir: string,
  control: E2EExecutionControl,
): Promise<number> {
  const builds = [
    ["pnpm", "exec", "tsc6", "-p", join(sourceDir, "tsconfig.esm.json"), "--outDir", join(stagingDir, "dist", "esm")],
    ["pnpm", "exec", "tsc6", "-p", join(sourceDir, "tsconfig.cjs.json"), "--outDir", join(stagingDir, "dist", "cjs")],
  ] as const;
  for (const command of builds) {
    const result = await control.supervisor.run(command, {
      cwd: sourceDir,
      env: process.env,
      output: "inherit",
      timeoutMs: 30 * 60_000,
      abortSignal: control.abortSignal,
    });
    if (result.cancelled || isExecutionCancelled(control)) {
      throw new E2EExecutionCancelledError("workspace Testkit snapshot build cancelled");
    }
    if (!hasSuccessfulOwnedProcessResult(result)) return 1;
  }
  return 0;
}

async function fingerprintDirectory(root: string): Promise<string> {
  const digest = createHash("sha256");
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error(`Testkit snapshot contains a symlink: ${path}`);
      if (stat.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!stat.isFile()) throw new Error(`Testkit snapshot contains a special file: ${path}`);
      const bytes = await readFile(path);
      digest.update(`${relative(root, path).split(sep).join("/")}\0${bytes.byteLength}\0`);
      digest.update(bytes);
      digest.update("\n");
    }
  };
  await walk(root);
  return digest.digest("hex");
}

/** Fail if an allegedly immutable invocation-local Testkit snapshot changed. */
export async function verifyTestkitSnapshot(testkit: TestkitPackage): Promise<void> {
  const actual = await fingerprintDirectory(testkit.path);
  if (actual !== testkit.digest) {
    throw new Error(
      `Testkit snapshot mutated: expected sha256:${testkit.digest}, got sha256:${actual} at ${testkit.path}`,
    );
  }
}

function packageEntries(pkg: Record<string, unknown>): string[] {
  const entries = [pkg.main, pkg.module, pkg.types];
  const collect = (value: unknown): void => {
    if (typeof value === "string") entries.push(value);
    else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const nested of Object.values(value)) collect(nested);
    }
  };
  collect(pkg.exports);
  return entries.filter((entry): entry is string => typeof entry === "string");
}

/** Build and validate one invocation-local private Testkit package snapshot. */
export async function buildTestkitPackage(
  repoRoot: string,
  scratchRoot: string,
  dependencies: TestkitBuildDependencies = {},
  execution: E2EExecutionControl | undefined = undefined,
): Promise<TestkitPackage> {
  const control = execution ?? createUnmanagedExecutionControl();
  throwIfExecutionCancelled(control);
  const pkgDir = resolve(repoRoot, "packages", "testkit");
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    throw new Error(`no packages/testkit/package.json under ${repoRoot} — cannot build the workspace Testkit`);
  }

  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as Record<string, unknown>;
  if (pkg.name !== "@niceeval/testkit") {
    throw new Error(
      `packages/testkit/package.json name must be "@niceeval/testkit", got ${JSON.stringify(pkg.name)}`,
    );
  }
  if (pkg.private !== true) {
    throw new Error("packages/testkit/package.json must remain private — Testkit is checkout-local harness code");
  }
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("packages/testkit/package.json must declare a non-empty version for diagnostics");
  }

  const snapshotRoot = resolve(scratchRoot, "testkit");
  const stagingDir = resolve(scratchRoot, `.testkit-staging-${randomUUID()}`);
  const snapshotDir = join(snapshotRoot, "package");
  await mkdir(stagingDir, { recursive: true });
  try {
    await Promise.all([
      copyFile(pkgJsonPath, join(stagingDir, "package.json")),
      copyFile(join(pkgDir, "README.md"), join(stagingDir, "README.md")),
    ]);
    throwIfExecutionCancelled(control);
    const buildCode = dependencies.buildTestkit === undefined
      ? await buildTestkitSource(pkgDir, stagingDir, control)
      : await dependencies.buildTestkit(pkgDir, stagingDir);
    throwIfExecutionCancelled(control);
    if (buildCode !== 0) {
      throw new Error(`Testkit snapshot build failed (exit ${buildCode}) from ${pkgDir}`);
    }
    await mkdir(join(stagingDir, "dist", "cjs"), { recursive: true });
    await writeFile(join(stagingDir, "dist", "cjs", "package.json"), '{"type":"commonjs"}\n', "utf8");

    for (const entry of packageEntries(pkg)) {
      if (!entry.startsWith("./") || !existsSync(resolve(stagingDir, entry))) {
        throw new Error(`Testkit snapshot did not produce package entry ${JSON.stringify(entry)}`);
      }
    }

    await mkdir(snapshotRoot, { recursive: true });
    await rename(stagingDir, snapshotDir);
    const digest = await fingerprintDirectory(snapshotDir);
    return {
      path: snapshotDir,
      sourcePath: "packages/testkit",
      name: "@niceeval/testkit",
      version: pkg.version as string,
      digest,
    };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

const PACKAGE_DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
const LOCK_DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
type LocalSpecifierScheme = "file" | "workspace";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localSpecifierScheme(value: unknown): LocalSpecifierScheme | undefined {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("file:")) return "file";
  if (value.startsWith("workspace:")) return "workspace";
  return undefined;
}

function collectLocalResolutionSchemes(value: unknown, schemes: Set<LocalSpecifierScheme>): void {
  const direct = localSpecifierScheme(value);
  if (direct !== undefined) {
    schemes.add(direct);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectLocalResolutionSchemes(item, schemes);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) collectLocalResolutionSchemes(item, schemes);
  }
}

/** Inspect only pnpm dependency specifiers and package resolutions. */
function pnpmLocalSpecifierSchemes(lockText: string): Set<LocalSpecifierScheme> {
  const schemes = new Set<LocalSpecifierScheme>();
  let lock: unknown;
  try {
    lock = parse(lockText);
  } catch {
    return schemes;
  }
  if (!isRecord(lock)) return schemes;

  const importers = lock.importers;
  if (isRecord(importers)) {
    for (const importer of Object.values(importers)) {
      if (!isRecord(importer)) continue;
      for (const field of LOCK_DEP_FIELDS) {
        const dependencies = importer[field];
        if (!isRecord(dependencies)) continue;
        for (const dependency of Object.values(dependencies)) {
          const direct = localSpecifierScheme(dependency);
          if (direct !== undefined) schemes.add(direct);
          if (!isRecord(dependency)) continue;
          for (const key of ["specifier", "version"]) {
            const scheme = localSpecifierScheme(dependency[key]);
            if (scheme !== undefined) schemes.add(scheme);
          }
        }
      }
    }
  }

  for (const section of [lock.packages, lock.snapshots]) {
    if (!isRecord(section)) continue;
    for (const [key, entry] of Object.entries(section)) {
      const keyScheme = key.match(/(?:^|@)(file|workspace):/)?.[1] as LocalSpecifierScheme | undefined;
      if (keyScheme !== undefined) schemes.add(keyScheme);
      if (isRecord(entry)) collectLocalResolutionSchemes(entry.resolution, schemes);
    }
  }
  return schemes;
}

/** Scenario sources stay portable; only the isolated copy receives Testkit. */
export function checkTestkitSourceClean(copyDir: string): string[] {
  const violations: string[] = [];
  const pkg = JSON.parse(readFileSync(join(copyDir, "package.json"), "utf8")) as Record<string, unknown>;
  for (const field of PACKAGE_DEP_FIELDS) {
    const deps = pkg[field];
    if (isRecord(deps) && Object.prototype.hasOwnProperty.call(deps, "@niceeval/testkit")) {
      violations.push(
        `source package.json declares "@niceeval/testkit" in ${field} — project.json targets.e2e metadata is the only true source of testkit intent`,
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
    const localSchemes = pnpmLocalSpecifierSchemes(lock);
    if (localSchemes.has("workspace")) {
      violations.push('checked-in pnpm-lock.yaml contains a "workspace:" reference — scenarios must not use workspace links');
    }
    if (localSchemes.has("file")) {
      violations.push(
        'checked-in pnpm-lock.yaml contains a "file:" specifier — local directories are only injected by the runner inside the isolated copy',
      );
    }
  }
  return violations;
}

const TESTKIT_IMPORT_PATTERN = /(?:(?:from|import|require)\s*\(?\s*|import\s+)(["'])@niceeval\/testkit\1/;
const SCAN_EXCLUDED = new Set(["node_modules", ".git", ".niceeval"]);
const SCAN_SOURCE_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".ts", ".cts", ".mts", ".tsx", ".jsx"]);

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
        if (TESTKIT_IMPORT_PATTERN.test(readFileSync(full, "utf8"))) matches.push(relative(copyDir, full));
      } catch {
        // Binary or unreadable file — not an import surface.
      }
    }
  };
  walk(copyDir);
  return matches.sort();
}

/** Inject an absolute checkout directory reference only into the isolated copy. */
export async function injectTestkitDirectory(copyDir: string, testkit: TestkitPackage): Promise<void> {
  const pkgPath = join(copyDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
  const devDeps = (pkg.devDependencies ??= {}) as Record<string, string>;
  devDeps["@niceeval/testkit"] = `file:${testkit.path}`;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function fileSpecifierPath(specifier: string, baseDir: string): string | undefined {
  if (!specifier.startsWith("file:")) return undefined;
  const value = specifier.slice("file:".length);
  return resolve(isAbsolute(value) ? value : join(baseDir, value));
}

export interface TestkitDirectoryResolution {
  key: string;
  directory: string;
}

/** Verify pnpm recorded one directory package and the injected importer spec. */
export function verifyTestkitDirectoryResolution(
  lockfileText: string,
  expectedDirectory: string,
  copyDir: string,
): { ok: true; resolution: TestkitDirectoryResolution } | { ok: false; reason: string } {
  let lock: unknown;
  try {
    lock = parse(lockfileText);
  } catch (error) {
    return { ok: false, reason: `pnpm-lock.yaml is invalid YAML: ${(error as Error).message}` };
  }
  if (!isRecord(lock)) return { ok: false, reason: "pnpm-lock.yaml root is not an object" };

  const expected = resolve(expectedDirectory);
  const importerMatches: Array<{ specifier: string; version?: string }> = [];
  if (isRecord(lock.importers)) {
    for (const importer of Object.values(lock.importers)) {
      if (!isRecord(importer)) continue;
      for (const field of LOCK_DEP_FIELDS) {
        const dependencies = importer[field];
        if (!isRecord(dependencies) || !("@niceeval/testkit" in dependencies)) continue;
        const dependency = dependencies["@niceeval/testkit"];
        if (typeof dependency === "string") {
          importerMatches.push({ specifier: dependency });
        } else if (isRecord(dependency) && typeof dependency.specifier === "string") {
          importerMatches.push({
            specifier: dependency.specifier,
            ...(typeof dependency.version === "string" ? { version: dependency.version } : {}),
          });
        }
      }
    }
  }
  if (importerMatches.length !== 1) {
    return {
      ok: false,
      reason: `found ${importerMatches.length} @niceeval/testkit importer declarations in pnpm-lock.yaml; expected exactly one`,
    };
  }
  const importerPath = fileSpecifierPath(importerMatches[0]!.specifier, copyDir);
  if (importerPath !== expected) {
    return {
      ok: false,
      reason: `@niceeval/testkit importer specifier ${JSON.stringify(importerMatches[0]!.specifier)} does not resolve to ${expected}`,
    };
  }

  const resolutions: TestkitDirectoryResolution[] = [];
  if (isRecord(lock.packages)) {
    for (const [key, value] of Object.entries(lock.packages)) {
      if (!key.startsWith("@niceeval/testkit@file:") || !isRecord(value) || !isRecord(value.resolution)) continue;
      const directory = value.resolution.directory;
      if (value.resolution.type === "directory" && typeof directory === "string") {
        resolutions.push({ key, directory });
      }
    }
  }
  if (resolutions.length !== 1) {
    return {
      ok: false,
      reason: `found ${resolutions.length} @niceeval/testkit directory resolutions in pnpm-lock.yaml; expected exactly one`,
    };
  }
  const recorded = resolve(isAbsolute(resolutions[0]!.directory) ? resolutions[0]!.directory : join(copyDir, resolutions[0]!.directory));
  if (recorded !== expected) {
    return {
      ok: false,
      reason: `@niceeval/testkit directory resolution ${JSON.stringify(resolutions[0]!.directory)} does not resolve to ${expected}`,
    };
  }
  return { ok: true, resolution: resolutions[0]! };
}

export function testkitInstallPath(copyDir: string): string {
  return join(copyDir, "node_modules", "@niceeval", "testkit");
}

function isWithin(parent: string, child: string): boolean {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  return childPath === parentPath || childPath.startsWith(`${parentPath}${sep}`);
}

/** Verify package identity and that pnpm materialized it in the isolated store. */
export function verifyInstalledTestkit(
  copyDir: string,
  testkit: TestkitPackage,
): { ok: true; installedPath: string; realPath: string } | { ok: false; reason: string } {
  const installedPath = testkitInstallPath(copyDir);
  const installedPkgJson = join(installedPath, "package.json");
  if (!existsSync(installedPkgJson)) {
    return { ok: false, reason: `installed testkit metadata missing at ${installedPkgJson}` };
  }
  let installed: { name?: unknown; version?: unknown };
  try {
    installed = JSON.parse(readFileSync(installedPkgJson, "utf8")) as { name?: unknown; version?: unknown };
  } catch (error) {
    return { ok: false, reason: `installed testkit package.json is unreadable: ${(error as Error).message}` };
  }
  if (installed.name !== testkit.name || installed.version !== testkit.version) {
    return {
      ok: false,
      reason: `installed testkit identity is ${JSON.stringify(installed.name)}@${JSON.stringify(installed.version)}, expected ${testkit.name}@${testkit.version}`,
    };
  }

  let realPath: string;
  try {
    realPath = realpathSync(installedPath);
  } catch (error) {
    return { ok: false, reason: `cannot resolve installed testkit path: ${(error as Error).message}` };
  }
  if (isWithin(testkit.path, realPath)) {
    return { ok: false, reason: `installed testkit resolves back to checkout source ${realPath}; expected an isolated pnpm materialization` };
  }
  const virtualStore = join(copyDir, "node_modules", ".pnpm");
  if (!isWithin(virtualStore, realPath)) {
    return { ok: false, reason: `installed testkit realpath ${realPath} is outside isolated virtual store ${virtualStore}` };
  }
  return { ok: true, installedPath, realPath };
}
