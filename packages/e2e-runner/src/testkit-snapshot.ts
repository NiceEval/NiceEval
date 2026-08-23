// Checkout-local Testkit snapshots are built once per root scope and injected
// only into isolated copies.
import { createHash, randomUUID } from "node:crypto";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { FileSystem } from "@effect/platform";
import { Data, Effect, Scope } from "effect";
import { parse } from "yaml";
import { lstatPath } from "./durable-path.ts";
import { hasSuccessfulOwnedProcessResult, runOwnedProcess, type OwnedProcess } from "./owned-process.ts";

export class TestkitSnapshotError extends Data.TaggedError("TestkitSnapshotError")<{ readonly operation: "build" | "verify" | "inject"; readonly detail: string }> {}
export interface TestkitPackage { readonly path: string; readonly sourcePath: "packages/testkit"; readonly name: "@niceeval/testkit"; readonly version: string; readonly digest: string; }
export interface TestkitBuildDependencies { readonly buildTestkit?: (sourceDir: string, stagingDir: string) => Effect.Effect<number, TestkitSnapshotError, OwnedProcess | Scope.Scope>; }
const error = (operation: TestkitSnapshotError["operation"], cause: unknown) => new TestkitSnapshotError({ operation, detail: cause instanceof Error ? cause.message : String(cause) });
const fs = <A>(operation: TestkitSnapshotError["operation"], use: (service: FileSystem.FileSystem) => Effect.Effect<A, unknown>) => Effect.flatMap(FileSystem.FileSystem, use).pipe(Effect.mapError((cause) => error(operation, cause)));
const lstat = (operation: TestkitSnapshotError["operation"], path: string) => lstatPath(path).pipe(Effect.mapError((cause) => error(operation, cause)));
const fileText = (operation: TestkitSnapshotError["operation"], path: string) => fs(operation, (service) => service.readFileString(path));
const exists = (operation: TestkitSnapshotError["operation"], path: string) => fs(operation, (service) => service.exists(path));

const fingerprintDirectory = (root: string): Effect.Effect<string, TestkitSnapshotError, FileSystem.FileSystem> => Effect.gen(function* () {
  const hash = createHash("sha256");
  const walk = (directory: string): Effect.Effect<void, TestkitSnapshotError, FileSystem.FileSystem> => Effect.gen(function* () {
    const entries = yield* fs("verify", (service) => service.readDirectory(directory));
    for (const name of entries.sort((left, right) => left.localeCompare(right))) {
      const path = join(directory, name); const stat = yield* lstat("verify", path);
      if (stat.isSymbolicLink()) return yield* Effect.fail(new TestkitSnapshotError({ operation: "verify", detail: `Testkit snapshot contains a symlink: ${path}` }));
      if (stat.isDirectory()) { yield* walk(path); continue; }
      if (!stat.isFile()) return yield* Effect.fail(new TestkitSnapshotError({ operation: "verify", detail: `Testkit snapshot contains a special file: ${path}` }));
      const bytes = yield* fs("verify", (service) => service.readFile(path)); hash.update(`${relative(root, path).split(sep).join("/")}\0${bytes.byteLength}\0`); hash.update(bytes); hash.update("\n");
    }
  });
  yield* walk(root); return hash.digest("hex");
});
export const verifyTestkitSnapshot = (testkit: TestkitPackage): Effect.Effect<void, TestkitSnapshotError, FileSystem.FileSystem> => Effect.gen(function* () { const digest = yield* fingerprintDirectory(testkit.path); if (digest !== testkit.digest) return yield* Effect.fail(new TestkitSnapshotError({ operation: "verify", detail: `Testkit snapshot mutated: expected sha256:${testkit.digest}, got sha256:${digest} at ${testkit.path}` })); });
const packageEntries = (value: Record<string, unknown>): readonly string[] => { const found: string[] = []; const collect = (item: unknown): void => { if (typeof item === "string") found.push(item); else if (item !== null && typeof item === "object" && !Array.isArray(item)) for (const nested of Object.values(item)) collect(nested); }; collect(value.main); collect(value.module); collect(value.types); collect(value.exports); return found; };

export const buildTestkitPackage = (repoRoot: string, scratchRoot: string, dependencies: TestkitBuildDependencies = {}): Effect.Effect<TestkitPackage, TestkitSnapshotError, FileSystem.FileSystem | OwnedProcess | Scope.Scope> => Effect.gen(function* () {
  const source = resolve(repoRoot, "packages/testkit"); const packagePath = join(source, "package.json"); const text = yield* fileText("build", packagePath);
  let pkg: Record<string, unknown>; try { const value: unknown = JSON.parse(text); if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("package metadata is not an object"); pkg = value as Record<string, unknown>; } catch (cause) { return yield* Effect.fail(error("build", cause)); }
  if (pkg.name !== "@niceeval/testkit" || pkg.private !== true || typeof pkg.version !== "string" || pkg.version.length === 0) return yield* Effect.fail(new TestkitSnapshotError({ operation: "build", detail: "packages/testkit/package.json must describe private @niceeval/testkit with a version" }));
  const staging = resolve(scratchRoot, `.testkit-staging-${randomUUID()}`); const snapshot = join(scratchRoot, "testkit", "package");
  yield* fs("build", (service) => service.makeDirectory(staging, { recursive: true }));
  yield* fs("build", (service) => service.copyFile(packagePath, join(staging, "package.json")));
  yield* fs("build", (service) => service.copyFile(join(source, "README.md"), join(staging, "README.md")));
  const commands = [["pnpm", "exec", "tsc6", "-p", join(source, "tsconfig.esm.json"), "--outDir", join(staging, "dist", "esm")], ["pnpm", "exec", "tsc6", "-p", join(source, "tsconfig.cjs.json"), "--outDir", join(staging, "dist", "cjs")]] as const;
  const exit = dependencies.buildTestkit === undefined ? yield* Effect.forEach(commands, (command) => runOwnedProcess(command, { cwd: source, env: process.env, output: "inherit", timeoutMs: 30 * 60_000 }).pipe(Effect.mapError((cause) => error("build", cause)), Effect.map((result) => hasSuccessfulOwnedProcessResult(result) ? 0 : 1)), { concurrency: 2 }) : yield* dependencies.buildTestkit(source, staging);
  if (Array.isArray(exit) ? exit.some((code) => code !== 0) : exit !== 0) return yield* Effect.fail(new TestkitSnapshotError({ operation: "build", detail: `Testkit snapshot build failed from ${source}` }));
  yield* fs("build", (service) => service.makeDirectory(join(staging, "dist", "cjs"), { recursive: true })); yield* fs("build", (service) => service.writeFileString(join(staging, "dist", "cjs", "package.json"), '{"type":"commonjs"}\n'));
  for (const entry of packageEntries(pkg)) if (!entry.startsWith("./") || !(yield* exists("build", resolve(staging, entry)))) return yield* Effect.fail(new TestkitSnapshotError({ operation: "build", detail: `Testkit snapshot did not produce package entry ${JSON.stringify(entry)}` }));
  yield* fs("build", (service) => service.makeDirectory(dirname(snapshot), { recursive: true })); yield* fs("build", (service) => service.rename(staging, snapshot));
  return { path: snapshot, sourcePath: "packages/testkit", name: "@niceeval/testkit", version: pkg.version, digest: yield* fingerprintDirectory(snapshot) };
});
export const acquireTestkitPackage = (repoRoot: string, scratchRoot: string, dependencies: TestkitBuildDependencies = {}) => Effect.acquireRelease(buildTestkitPackage(repoRoot, scratchRoot, dependencies), (testkit) => fs("build", (service) => service.remove(resolve(testkit.path, ".."), { recursive: true })).pipe(Effect.catchAll(() => Effect.void)));

const localScheme = (value: unknown): "file" | "workspace" | undefined => typeof value === "string" && (value.startsWith("file:") || value.startsWith("workspace:")) ? value.startsWith("file:") ? "file" : "workspace" : undefined;
const localSchemes = (text: string): ReadonlySet<string> => { const found = new Set<string>(); let value: unknown; try { value = parse(text); } catch { return found; } const visit = (item: unknown): void => { const direct = localScheme(item); if (direct !== undefined) found.add(direct); if (Array.isArray(item)) item.forEach(visit); else if (item !== null && typeof item === "object") Object.values(item).forEach(visit); }; visit(value); return found; };
export const checkTestkitSourceClean = (copyDir: string): Effect.Effect<readonly string[], TestkitSnapshotError, FileSystem.FileSystem> => Effect.gen(function* () { const violations: string[] = []; let pkg: Record<string, unknown>; try { const decoded: unknown = JSON.parse(yield* fileText("verify", join(copyDir, "package.json"))); pkg = decoded as Record<string, unknown>; } catch (cause) { return yield* Effect.fail(error("verify", cause)); } for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) if (pkg[field] !== null && typeof pkg[field] === "object" && Object.hasOwn(pkg[field] as object, "@niceeval/testkit")) violations.push(`source package.json declares "@niceeval/testkit" in ${field}`); const lock = join(copyDir, "pnpm-lock.yaml"); if (yield* exists("verify", lock)) { const text = yield* fileText("verify", lock); const schemes = localSchemes(text); if (text.includes("@niceeval/testkit@")) violations.push("checked-in pnpm-lock.yaml contains an @niceeval/testkit resolution"); if (schemes.has("workspace")) violations.push('checked-in pnpm-lock.yaml contains a "workspace:" reference'); if (schemes.has("file")) violations.push('checked-in pnpm-lock.yaml contains a "file:" specifier'); } return violations; });
const sourceExtensions = new Set([".js", ".cjs", ".mjs", ".ts", ".cts", ".mts", ".tsx", ".jsx"]); const excluded = new Set(["node_modules", ".git", ".niceeval"]); const importPattern = /(?:(?:from|import|require)\s*\(?\s*|import\s+)(["'])@niceeval\/testkit\1/;
export const scanForTestkitImports = (copyDir: string): Effect.Effect<readonly string[], TestkitSnapshotError, FileSystem.FileSystem> => Effect.gen(function* () { const matches: string[] = []; const walk = (dir: string): Effect.Effect<void, TestkitSnapshotError, FileSystem.FileSystem> => Effect.gen(function* () { for (const name of yield* fs("verify", (service) => service.readDirectory(dir))) { if (excluded.has(name)) continue; const path = join(dir, name); const stat = yield* lstat("verify", path); if (stat.isDirectory()) { yield* walk(path); continue; } if (name !== "package.json" && name !== "pnpm-lock.yaml" && sourceExtensions.has(extname(name)) && importPattern.test(yield* fileText("verify", path))) matches.push(relative(copyDir, path)); } }); yield* walk(copyDir); return matches.sort(); });
export const injectTestkitDirectory = (copyDir: string, testkit: TestkitPackage): Effect.Effect<void, TestkitSnapshotError, FileSystem.FileSystem> => Effect.gen(function* () { const path = join(copyDir, "package.json"); let pkg: Record<string, unknown>; try { pkg = JSON.parse(yield* fileText("inject", path)) as Record<string, unknown>; } catch (cause) { return yield* Effect.fail(error("inject", cause)); } const deps = pkg.devDependencies !== null && typeof pkg.devDependencies === "object" ? pkg.devDependencies as Record<string, string> : {}; deps["@niceeval/testkit"] = `file:${testkit.path}`; pkg.devDependencies = deps; yield* fs("inject", (service) => service.writeFileString(path, `${JSON.stringify(pkg, null, 2)}\n`)); });
export interface TestkitDirectoryResolution { readonly key: string; readonly directory: string; }
export const verifyTestkitDirectoryResolution = (lockfileText: string, expectedDirectory: string, copyDir: string): { readonly ok: true; readonly resolution: TestkitDirectoryResolution } | { readonly ok: false; readonly reason: string } => {
  let lockfile: unknown;
  try { lockfile = parse(lockfileText); }
  catch (cause) { return { ok: false, reason: `could not parse installed pnpm-lock.yaml: ${cause instanceof Error ? cause.message : String(cause)}` }; }
  if (lockfile === null || typeof lockfile !== "object" || Array.isArray(lockfile)) return { ok: false, reason: "installed pnpm-lock.yaml is not an object" };
  const packages = (lockfile as Record<string, unknown>).packages;
  if (packages === null || typeof packages !== "object" || Array.isArray(packages)) return { ok: false, reason: "installed pnpm-lock.yaml has no packages map" };
  const candidates = Object.entries(packages).filter(([key]) => key.startsWith("@niceeval/testkit@file:"));
  if (candidates.length !== 1) return { ok: false, reason: `found ${candidates.length} @niceeval/testkit package resolutions; expected exactly one` };
  const [key, entry] = candidates[0]!;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return { ok: false, reason: "testkit package resolution is not an object" };
  const resolution = (entry as Record<string, unknown>).resolution;
  if (resolution === null || typeof resolution !== "object" || Array.isArray(resolution)) return { ok: false, reason: "testkit package resolution has no resolution object" };
  const declaredDirectory = (resolution as Record<string, unknown>).directory;
  if (typeof declaredDirectory !== "string" || declaredDirectory.length === 0) return { ok: false, reason: "testkit package resolution has no directory" };
  const directory = resolve(copyDir, declaredDirectory);
  return directory === resolve(expectedDirectory)
    ? { ok: true, resolution: { key, directory } }
    : { ok: false, reason: "testkit directory resolution does not match snapshot" };
};
export const testkitInstallPath = (copyDir: string): string => join(copyDir, "node_modules", "@niceeval", "testkit");
export const verifyInstalledTestkit = (copyDir: string, testkit: TestkitPackage): Effect.Effect<{ readonly ok: true; readonly installedPath: string; readonly realPath: string } | { readonly ok: false; readonly reason: string }, TestkitSnapshotError, FileSystem.FileSystem> => Effect.gen(function* () { const installedPath = testkitInstallPath(copyDir); const metadata = join(installedPath, "package.json"); if (!(yield* exists("verify", metadata))) return { ok: false, reason: `installed testkit metadata missing at ${metadata}` }; let value: { name?: unknown; version?: unknown }; try { value = JSON.parse(yield* fileText("verify", metadata)) as { name?: unknown; version?: unknown }; } catch (cause) { return { ok: false, reason: error("verify", cause).detail }; } if (value.name !== testkit.name || value.version !== testkit.version) return { ok: false, reason: "installed testkit identity differs from snapshot" }; const real = yield* fs("verify", (service) => service.realPath(installedPath)); const virtual = resolve(copyDir, "node_modules", ".pnpm"); if (!real.startsWith(`${virtual}${sep}`)) return { ok: false, reason: `installed testkit realpath ${real} is outside isolated virtual store ${virtual}` }; return { ok: true, installedPath, realPath: real }; });
