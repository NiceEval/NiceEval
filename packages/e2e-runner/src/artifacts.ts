// Durable artifact collection. Selection is pure; every filesystem operation
// remains in the caller's Effect environment.
import { basename, join, relative, resolve, sep } from "node:path";
import * as FileSystem from "effect/FileSystem";
import { Data, Effect } from "effect";
import { assertContainedRegularFile, assertRealDirectory, copyIntoContainedFile, ensureContainedRealDirectory, lstatOptional, lstatPath } from "./durable-path.ts";
import { artifactPatternError, isCanonicalRelativePath } from "./manifest.ts";

export class ArtifactCollectionError extends Data.TaggedError("ArtifactCollectionError")<{ readonly detail: string }> {}
const wrap = <A, E extends { readonly detail: string }>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) => effect.pipe(Effect.mapError((error) => new ArtifactCollectionError({ detail: error.detail })));
const contained = (root: string, target: string, label: string, allowRoot = false): string => { const base = resolve(root); const value = resolve(target); if (!((allowRoot && base === value) || value.startsWith(`${base}${sep}`))) throw new ArtifactCollectionError({ detail: `${label} escapes its containment root: ${target}` }); return value; };
const glob = (pattern: string): RegExp => new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);

export const repoArtifactDir = (artifactRoot: string, repoId: string): string => { if (!isCanonicalRelativePath(repoId)) throw new ArtifactCollectionError({ detail: `repo id is not a canonical contained artifact path: ${JSON.stringify(repoId)}` }); return contained(artifactRoot, join(artifactRoot, repoId), "repo artifact directory"); };
export const repoReceiptPath = (artifactRoot: string, repoId: string): string => join(repoArtifactDir(artifactRoot, repoId), "receipt.json");
export interface CollectResult { readonly collected: readonly string[]; readonly warnings: readonly string[]; }

const copyFile = (source: string, destinationRoot: string, destination: string): Effect.Effect<void, ArtifactCollectionError, FileSystem.FileSystem> => Effect.gen(function* () {
  const stat = yield* wrap(lstatPath(source));
  if (!stat.isFile() || stat.isSymbolicLink()) return yield* Effect.fail(new ArtifactCollectionError({ detail: `artifact source must be a regular non-symlink file: ${source}` }));
  const path = yield* wrap(copyIntoContainedFile(destinationRoot, source, destination, "artifact destination"));
  yield* wrap(assertContainedRegularFile(destinationRoot, path, "artifact destination"));
});
const copyTree = (sourceRoot: string, source: string, destinationRoot: string, destination: string): Effect.Effect<void, ArtifactCollectionError, FileSystem.FileSystem> => Effect.gen(function* () {
  const sourcePath = contained(sourceRoot, source, "artifact source", true); const stat = yield* wrap(lstatPath(sourcePath));
  if (!stat.isDirectory() || stat.isSymbolicLink()) return yield* Effect.fail(new ArtifactCollectionError({ detail: `artifact directory source must be a real directory: ${sourcePath}` }));
  const destinationPath = yield* wrap(ensureContainedRealDirectory(destinationRoot, destination, "artifact destination"));
  const entries = yield* Effect.flatMap(FileSystem.FileSystem, (service) => service.readDirectory(sourcePath)).pipe(Effect.mapError((cause) => new ArtifactCollectionError({ detail: String(cause) })));
  yield* Effect.forEach(entries.sort((left, right) => left.localeCompare(right)), (name) => Effect.gen(function* () {
    const childSource = contained(sourceRoot, join(sourcePath, name), "artifact source"); const childDestination = contained(destinationRoot, join(destinationPath, name), "artifact destination"); const child = yield* wrap(lstatPath(childSource));
    if (child.isSymbolicLink()) return yield* Effect.fail(new ArtifactCollectionError({ detail: `artifact source symlink is not allowed: ${childSource}` }));
    if (child.isDirectory()) return yield* copyTree(sourceRoot, childSource, destinationRoot, childDestination);
    if (child.isFile()) return yield* copyFile(childSource, destinationRoot, childDestination);
    return yield* Effect.fail(new ArtifactCollectionError({ detail: `artifact source special file is not allowed: ${childSource}` }));
  }), { discard: true });
});

export const collectArtifacts = (copyDir: string, destDir: string, patterns: readonly string[]): Effect.Effect<CollectResult, ArtifactCollectionError, FileSystem.FileSystem> => Effect.gen(function* () {
  const collected: string[] = []; const copyRoot = resolve(copyDir); const destination = resolve(destDir);
  yield* wrap(assertRealDirectory(copyRoot, "isolated artifact copy root")); yield* wrap(ensureContainedRealDirectory(destination, destination, "artifact destination"));
  for (const pattern of patterns) {
    const problem = artifactPatternError(pattern); if (problem !== undefined) return yield* Effect.fail(new ArtifactCollectionError({ detail: `unsafe artifact pattern ${JSON.stringify(pattern)}: ${problem}` }));
    if (pattern.endsWith("/**")) { const name = pattern.slice(0, -3); const source = contained(copyRoot, join(copyRoot, name), "artifact source"); if ((yield* wrap(lstatOptional(source))) !== undefined) { yield* copyTree(copyRoot, source, destination, contained(destination, join(destination, name), "artifact destination")); collected.push(name); } continue; }
    const matcher = glob(pattern); const entries = yield* Effect.flatMap(FileSystem.FileSystem, (service) => service.readDirectory(copyRoot)).pipe(Effect.mapError((cause) => new ArtifactCollectionError({ detail: String(cause) })));
    yield* Effect.forEach(entries.filter((entry) => matcher.test(entry)), (entry) => copyFile(contained(copyRoot, join(copyRoot, entry), "artifact source"), destination, contained(destination, join(destination, entry), "artifact destination")).pipe(Effect.tap(() => Effect.sync(() => { collected.push(entry); }))), { discard: true });
  }
  return { collected, warnings: [] };
});
export const describeCollected = (destDir: string, path: string): string => relative(destDir, join(destDir, path)) || path;
export const isDiagnosticNiceevalPattern = (pattern: string): boolean => { const base = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern; return base === ".niceeval" || basename(base) === ".niceeval"; };
