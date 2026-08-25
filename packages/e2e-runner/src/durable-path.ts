// Durable path operations. Lexical containment is pure; filesystem work is
// service-owned. lstat is deliberately a tiny callback leaf because the
// platform FileSystem stat operation follows links and cannot prove this
// security boundary.
import { lstat, type Stats } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";

export class DurablePathError extends Data.TaggedError("DurablePathError")<{
  readonly operation: string;
  readonly detail: string;
}> {}

const detail = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
const failure = (operation: string, cause: unknown) => new DurablePathError({ operation, detail: detail(cause) });
const fs = <A>(operation: string, use: (service: FileSystem.FileSystem) => Effect.Effect<A, unknown>) =>
  Effect.flatMap(FileSystem.FileSystem, use).pipe(Effect.mapError((cause) => failure(operation, cause)));

/** Callback-only lstat leaf: do not replace with stat, which follows links. */
export const lstatPath = (path: string): Effect.Effect<Stats, DurablePathError> =>
  Effect.async((resume) => { lstat(path, (error, stat) => resume(error === null ? Effect.succeed(stat) : Effect.fail(failure("lstat", error)))); });
export const lstatOptional = (path: string): Effect.Effect<Stats | undefined, DurablePathError> =>
  lstatPath(path).pipe(Effect.catchAll((error) => /ENOENT/.test(error.detail) ? Effect.succeed(undefined) : Effect.fail(error)));

const containedTail = (value: string): boolean => value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
const partsOf = (root: string, target: string, label: string, allowRoot = false): readonly string[] => {
  const tail = relative(resolve(root), resolve(target));
  if (tail === "") { if (allowRoot) return []; throw new DurablePathError({ operation: "validate", detail: `${label} must be below its durable root: ${target}` }); }
  if (!containedTail(tail)) throw new DurablePathError({ operation: "validate", detail: `${label} escapes its durable root: ${target}` });
  const parts = tail.split(sep);
  if (parts.some((part) => part === "" || part === "." || part === "..")) throw new DurablePathError({ operation: "validate", detail: `${label} has an invalid durable path segment: ${target}` });
  return parts;
};
export const containedDurablePath = (root: string, target: string, label: string, allowRoot = false): string => { partsOf(root, target, label, allowRoot); return resolve(target); };
const realDirectory = (stat: Stats, path: string, label: string): Effect.Effect<void, DurablePathError> => stat.isDirectory() && !stat.isSymbolicLink() ? Effect.void : Effect.fail(new DurablePathError({ operation: "validate", detail: `${label} must be a real directory, not a symlink or special file: ${path}` }));

const existingRoot = (declaredRoot: string, label: string): Effect.Effect<string, DurablePathError, FileSystem.FileSystem> => Effect.gen(function* () {
  const declared = resolve(declaredRoot); const before = yield* lstatOptional(declared);
  if (before === undefined) return yield* Effect.fail(new DurablePathError({ operation: "resolve-root", detail: `${label} directory is missing: ${declared}` }));
  yield* realDirectory(before, declared, label);
  const physical = yield* fs("realpath", (service) => service.realPath(declared)); const after = yield* lstatPath(physical);
  yield* realDirectory(after, physical, label);
  if (before.dev !== after.dev || before.ino !== after.ino) return yield* Effect.fail(new DurablePathError({ operation: "resolve-root", detail: `${label} changed while resolving its physical durable root: ${declared}` }));
  return physical;
});
const ensureRoot = (declaredRoot: string, label: string): Effect.Effect<string, DurablePathError, FileSystem.FileSystem> => Effect.gen(function* () {
  const absolute = resolve(declaredRoot); if ((yield* lstatOptional(absolute)) === undefined) yield* fs("mkdir", (service) => service.makeDirectory(absolute, { recursive: true }));
  return yield* existingRoot(absolute, label);
});
const walk = (physicalRoot: string, parts: readonly string[], create: boolean, label: string): Effect.Effect<string, DurablePathError, FileSystem.FileSystem> => Effect.gen(function* () {
  let current = physicalRoot;
  for (const part of parts) {
    yield* realDirectory(yield* lstatPath(current), current, label); const next = join(current, part); const before = yield* lstatOptional(next);
    // Sibling repo runs can discover the same missing domain directory at the
    // same time. Recursive mkdir makes that creation idempotent; the lstat
    // below still enforces that the resulting segment is a real directory.
    if (before === undefined && create) yield* fs("mkdir", (service) => service.makeDirectory(next, { recursive: true }));
    const after = yield* lstatOptional(next); if (after === undefined) return yield* Effect.fail(new DurablePathError({ operation: "walk", detail: `${label} directory is missing: ${next}` }));
    yield* realDirectory(after, next, label); current = next;
  }
  return current;
});
const anchored = (root: string, target: string, label: string, allowRoot: boolean, create: boolean): Effect.Effect<{ readonly physicalRoot: string; readonly parts: readonly string[] }, DurablePathError, FileSystem.FileSystem> => Effect.map(create ? ensureRoot(root, `${label} root`) : existingRoot(root, `${label} root`), (physicalRoot) => ({ physicalRoot, parts: partsOf(root, target, label, allowRoot) }));
export const ensureRealDirectory = (path: string, label: string) => ensureRoot(path, label);
export const assertRealDirectory = (path: string, label: string) => existingRoot(path, label);
export const ensureContainedRealDirectory = (root: string, target: string, label: string) => Effect.flatMap(anchored(root, target, label, true, true), ({ physicalRoot, parts }) => walk(physicalRoot, parts, true, label));
export const assertContainedRealDirectory = (root: string, target: string, label: string) => Effect.flatMap(anchored(root, target, label, true, false), ({ physicalRoot, parts }) => walk(physicalRoot, parts, false, label));
const file = (root: string, target: string, label: string, create: boolean): Effect.Effect<string, DurablePathError, FileSystem.FileSystem> => Effect.gen(function* () {
  const value = yield* anchored(root, target, label, false, create); const name = value.parts.at(-1);
  if (name === undefined) return yield* Effect.fail(new DurablePathError({ operation: "file", detail: `${label} must name a file below its durable root` }));
  return join(yield* walk(value.physicalRoot, value.parts.slice(0, -1), create, `${label} parent`), name);
});
export const prepareContainedRegularFile = (root: string, target: string, label: string) => Effect.gen(function* () { const path = yield* file(root, target, label, true); const stat = yield* lstatOptional(path); if (stat !== undefined && (!stat.isFile() || stat.isSymbolicLink())) return yield* Effect.fail(new DurablePathError({ operation: "prepare-file", detail: `${label} target is not a regular non-symlink file: ${path}` })); return path; });
export const assertContainedRegularFile = (root: string, target: string, label: string) => Effect.gen(function* () { const path = yield* file(root, target, label, false); const stat = yield* lstatOptional(path); if (stat === undefined || !stat.isFile() || stat.isSymbolicLink()) return yield* Effect.fail(new DurablePathError({ operation: "assert-file", detail: `${label} must be an existing regular non-symlink file: ${path}` })); return path; });
export const writeContainedUtf8File = (root: string, target: string, contents: string, label: string) => Effect.gen(function* () { const path = yield* prepareContainedRegularFile(root, target, label); yield* fs("write-file", (service) => service.writeFileString(path, contents)); return yield* assertContainedRegularFile(root, target, label); });
export const copyIntoContainedFile = (root: string, source: string, target: string, label: string) => Effect.gen(function* () { const path = yield* prepareContainedRegularFile(root, target, label); yield* fs("copy-file", (service) => service.copyFile(source, path)); return yield* assertContainedRegularFile(root, target, label); });
