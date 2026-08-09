// Workspace Testkit build, isolated directory injection and verification.
//
// Testkit is private harness code from the same checkout, not a release
// artifact. The runner clean-builds packages/testkit once per invocation and
// injects its absolute directory as a `file:` devDependency only into each
// isolated scenario copy. pnpm must materialize that directory in the copy's
// virtual store; a symlink back to the checkout is rejected.

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse } from "yaml";

import {
  createUnmanagedExecutionControl,
  isExecutionCancelled,
  E2EExecutionCancelledError,
  hasConfirmedOwnedGroupCleanup,
  throwIfExecutionCancelled,
  type E2EExecutionControl,
} from "./owned-process.ts";

export interface TestkitPackage {
  /** Absolute packages/testkit directory in the current checkout. */
  path: string;
  /** Stable checkout-relative diagnostic; never used as package identity. */
  sourcePath: "packages/testkit";
  name: "@niceeval/testkit";
  version: string;
}

export interface TestkitBuildDependencies {
  /** Runs the Testkit clean build inside packages/testkit; returns exit code. */
  buildTestkit?: (pkgDir: string) => Promise<number>;
}

async function buildTestkitSource(pkgDir: string, control: E2EExecutionControl): Promise<number> {
  const result = await control.supervisor.run(["pnpm", "build"], {
    cwd: pkgDir,
    env: process.env,
    output: "inherit",
    timeoutMs: 30 * 60_000,
    abortSignal: control.abortSignal,
  });
  if (result.cancelled || isExecutionCancelled(control)) {
    throw new E2EExecutionCancelledError("workspace Testkit build cancelled");
  }
  return result.exitCode === 0 && hasConfirmedOwnedGroupCleanup(result) ? 0 : 1;
}

/** Clean-build and validate the private workspace Testkit once. */
export async function buildTestkitPackage(
  repoRoot: string,
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

  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
    name?: unknown;
    version?: unknown;
    private?: unknown;
    main?: unknown;
    module?: unknown;
    types?: unknown;
  };
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

  throwIfExecutionCancelled(control);
  await rm(join(pkgDir, "dist"), { recursive: true, force: true });
  const buildCode = dependencies.buildTestkit === undefined
    ? await buildTestkitSource(pkgDir, control)
    : await dependencies.buildTestkit(pkgDir);
  throwIfExecutionCancelled(control);
  if (buildCode !== 0) {
    throw new Error(`Testkit clean build failed (exit ${buildCode}) in ${pkgDir}`);
  }

  for (const field of ["main", "module", "types"] as const) {
    const entry = pkg[field];
    if (typeof entry !== "string" || !existsSync(resolve(pkgDir, entry))) {
      throw new Error(`Testkit clean build did not produce package.json ${field} entry ${JSON.stringify(entry)}`);
    }
  }

  return {
    path: pkgDir,
    sourcePath: "packages/testkit",
    name: "@niceeval/testkit",
    version: pkg.version,
  };
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
