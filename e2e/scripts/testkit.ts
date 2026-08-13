// Workspace Testkit snapshot build + isolated directory injection + verification.
//
// Testkit is private harness code from the same checkout, not a release
// artifact. When a selected repo declares `harness.testkit` in its e2e.json,
// the runner compiles a package snapshot inside its own scratch tree (never
// the shared packages/testkit/dist) and injects that absolute directory as a
// `file:` devDependency only into the isolated copy. After `pnpm install`,
// the runner independently verifies the installed package's identity and the
// path pnpm actually resolved — a registry copy, a leftover baseline or a
// fallback to the checkout source all fail the run.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface TestkitPackage {
  /** Absolute immutable package snapshot inside this invocation's scratch tree. */
  path: string;
  name: "@niceeval/testkit";
  version: string;
}

function runInherited(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

/**
 * Clean-build the workspace Testkit into a scratch snapshot package
 * (package.json + README + dist/esm + dist/cjs). The shared
 * packages/testkit/dist is never read, written or removed.
 */
export async function buildTestkitPackage(
  repoRoot: string,
  scratchRoot: string,
): Promise<TestkitPackage> {
  const pkgDir = resolve(repoRoot, "packages", "testkit");
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    throw new Error(`no packages/testkit/package.json under ${repoRoot} — cannot build the workspace Testkit`);
  }

  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as Record<string, unknown>;
  if (pkg.name !== "@niceeval/testkit") {
    throw new Error(`packages/testkit/package.json name must be "@niceeval/testkit", got ${JSON.stringify(pkg.name)}`);
  }
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("packages/testkit/package.json must declare a non-empty version");
  }

  const stagingDir = join(scratchRoot, "testkit-staging");
  const snapshotDir = join(scratchRoot, "testkit-snapshot");
  await rm(stagingDir, { recursive: true, force: true });
  await rm(snapshotDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  try {
    await copyFile(pkgJsonPath, join(stagingDir, "package.json"));
    await copyFile(join(pkgDir, "README.md"), join(stagingDir, "README.md"));

    const builds = [
      { tsconfig: "tsconfig.esm.json", outDir: join(stagingDir, "dist", "esm") },
      { tsconfig: "tsconfig.cjs.json", outDir: join(stagingDir, "dist", "cjs") },
    ] as const;
    for (const build of builds) {
      const code = await runInherited(
        "pnpm",
        ["exec", "tsc6", "-p", join(pkgDir, build.tsconfig), "--outDir", build.outDir],
        pkgDir,
      );
      if (code !== 0) {
        throw new Error(`Testkit snapshot build failed (exit ${code}) for ${build.tsconfig}`);
      }
    }

    // The cjs emit needs its own package.json to declare the module kind.
    await mkdir(join(stagingDir, "dist", "cjs"), { recursive: true });
    await writeFile(join(stagingDir, "dist", "cjs", "package.json"), '{"type":"commonjs"}\n', "utf8");

    await rename(stagingDir, snapshotDir);
    return { path: snapshotDir, name: "@niceeval/testkit", version: pkg.version as string };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

/** Inject the absolute snapshot directory reference only into the isolated copy. */
export async function injectTestkitDirectory(copyDir: string, testkit: TestkitPackage): Promise<void> {
  const pkgPath = join(copyDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
  const devDeps = (pkg.devDependencies ??= {}) as Record<string, string>;
  devDeps["@niceeval/testkit"] = `file:${testkit.path}`;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function isWithin(parent: string, child: string): boolean {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  return childPath === parentPath || childPath.startsWith(`${parentPath}${sep}`);
}

export type TestkitVerdict =
  | { ok: true; installedPath: string; realPath: string }
  | { ok: false; reason: string };

/**
 * Verify the isolated copy actually installed our scratch snapshot:
 * the installed package metadata must carry Testkit's identity, the
 * resolution pnpm recorded in its lockfile must point back at the snapshot
 * directory, and the installed path must not resolve to anything outside
 * the snapshot or the isolated virtual store (in particular never to the
 * checkout's own packages/testkit).
 */
export function verifyInstalledTestkit(copyDir: string, testkit: TestkitPackage): TestkitVerdict {
  const installedPath = join(copyDir, "node_modules", "@niceeval", "testkit");
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
  const expected = resolve(testkit.path);
  const virtualStore = join(copyDir, "node_modules", ".pnpm");
  if (!isWithin(expected, realPath) && !isWithin(virtualStore, realPath)) {
    return {
      ok: false,
      reason: `installed testkit realpath ${realPath} is neither the injected snapshot (${expected}) nor inside the isolated virtual store (${virtualStore})`,
    };
  }

  // pnpm must have recorded exactly one directory resolution for our specifier.
  let lockText: string;
  try {
    lockText = readFileSync(join(copyDir, "pnpm-lock.yaml"), "utf8");
  } catch (error) {
    return { ok: false, reason: `could not read isolated copy's pnpm-lock.yaml: ${(error as Error).message}` };
  }
  const entryRe = /@niceeval\/testkit@file:([^\n]*):\n {4}resolution:\s*\{[^\n}]*directory:\s*([^\n},]+)[^\n}]*type:\s*directory[^\n}]*\}/g;
  const matches = [...lockText.matchAll(entryRe)];
  if (matches.length !== 1) {
    return {
      ok: false,
      reason: `found ${matches.length} @niceeval/testkit file: directory resolutions in pnpm-lock.yaml — expected exactly one`,
    };
  }
  const recorded = (matches[0]?.[2] ?? "").trim().replace(/^"|"$/g, "");
  const recordedPath = resolve(isAbsolute(recorded) ? recorded : join(copyDir, recorded));
  if (recordedPath !== expected) {
    return {
      ok: false,
      reason: `@niceeval/testkit lockfile resolution directory ${JSON.stringify(recorded)} does not resolve to the injected snapshot ${expected}`,
    };
  }

  return { ok: true, installedPath, realPath };
}
