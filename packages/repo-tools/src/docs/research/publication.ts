import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { Effect } from "effect";

import { ResearchConflictError, ResearchFileError, ResearchPathError, researchErrorMessage } from "./errors.js";

export interface NewPublication {
  readonly target: string;
  readonly digest: string;
}

function removeIgnoringFailure(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // A cleanup failure must not hide the write failure that triggered it.
  }
}

function ensureContained(root: string, target: string, displayPath: string): void {
  const relation = relative(root, target);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || relation.startsWith("../")) {
    throw new ResearchPathError({
      path: displayPath,
      message: "Research targets must stay below the configured repository root.",
    });
  }
}

function ensureNoSymlinkAncestor(root: string, target: string, displayPath: string): void {
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) {
    throw new ResearchPathError({ path: displayPath, message: "The configured repository root must not be a symbolic link." });
  }
  let current = root;
  const parts = relative(root, dirname(target)).split(sep).filter(Boolean);
  for (const part of parts) {
    current = resolve(current, part);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new ResearchPathError({ path: displayPath, message: "Research targets cannot traverse a symbolic link." });
    }
  }
}

function resolveTarget(root: string, relativeTarget: string): string {
  const target = resolve(root, relativeTarget);
  ensureContained(root, target, relativeTarget);
  ensureNoSymlinkAncestor(root, target, relativeTarget);
  return target;
}

function writeNewFile(path: string, content: string): void {
  const descriptor = openSync(path, "wx");
  try {
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function newStagePath(target: string): string {
  return resolve(dirname(target), `.${basename(target)}.research-stage-${randomUUID()}`);
}

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Publish one never-before-existing file through a Scope-owned sibling stage. */
export function publishNewFile(
  root: string,
  relativeTarget: string,
  content: string,
  dryRun: boolean,
): Effect.Effect<NewPublication, ResearchConflictError | ResearchFileError | ResearchPathError> {
  const digest = sha256(content);
  if (dryRun) return Effect.suspend(() => {
    const target = resolveTarget(root, relativeTarget);
    if (existsSync(target)) {
      return Effect.fail(new ResearchConflictError({ path: relativeTarget, message: "Target already exists; choose a new research path." }));
    }
    return Effect.succeed({ target: relativeTarget, digest });
  });

  return Effect.scoped(Effect.gen(function*() {
    const target = yield* Effect.try({
      try: () => resolveTarget(root, relativeTarget),
      catch: (error) => error instanceof ResearchPathError
        ? error
        : new ResearchFileError({ operation: "resolve publication target", path: relativeTarget, message: researchErrorMessage(error) }),
    });
    if (existsSync(target)) {
      return yield* Effect.fail(new ResearchConflictError({ path: relativeTarget, message: "Target already exists; choose a new research path." }));
    }
    const stage = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          mkdirSync(dirname(target), { recursive: true });
          const path = newStagePath(target);
          writeNewFile(path, content);
          return path;
        },
        catch: (error) => new ResearchFileError({ operation: "stage file", path: relativeTarget, message: researchErrorMessage(error) }),
      }),
      (path) => Effect.sync(() => removeIgnoringFailure(path)),
    );
    yield* Effect.try({
      try: () => {
        if (existsSync(target)) throw new Error("target appeared while publication was staged; retry");
        renameSync(stage, target);
        syncDirectory(dirname(target));
      },
      catch: (error) => new ResearchFileError({ operation: "publish file", path: relativeTarget, message: researchErrorMessage(error) }),
    });
    return { target: relativeTarget, digest };
  }));
}

/** Publish a newly-created package directory in one atomic rename. */
export function publishNewDirectory(
  root: string,
  relativeTarget: string,
  files: readonly { readonly path: string; readonly content: string }[],
  dryRun: boolean,
): Effect.Effect<NewPublication, ResearchConflictError | ResearchFileError | ResearchPathError> {
  const digest = sha256(files.map((file) => `${file.path}\0${file.content}`).join("\0"));
  if (dryRun) return Effect.suspend(() => {
    const target = resolveTarget(root, relativeTarget);
    if (existsSync(target)) {
      return Effect.fail(new ResearchConflictError({ path: relativeTarget, message: "Target already exists; choose a new research path." }));
    }
    return Effect.succeed({ target: relativeTarget, digest });
  });

  return Effect.scoped(Effect.gen(function*() {
    const target = yield* Effect.try({
      try: () => resolveTarget(root, relativeTarget),
      catch: (error) => error instanceof ResearchPathError
        ? error
        : new ResearchFileError({ operation: "resolve publication target", path: relativeTarget, message: researchErrorMessage(error) }),
    });
    if (existsSync(target)) {
      return yield* Effect.fail(new ResearchConflictError({ path: relativeTarget, message: "Target already exists; choose a new research path." }));
    }
    const stage = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          mkdirSync(dirname(target), { recursive: true });
          const path = newStagePath(target);
          mkdirSync(path);
          for (const file of files) {
            const destination = resolve(path, file.path);
            ensureContained(path, destination, `${relativeTarget}/${file.path}`);
            mkdirSync(dirname(destination), { recursive: true });
            writeNewFile(destination, file.content);
          }
          syncDirectory(path);
          return path;
        },
        catch: (error) => new ResearchFileError({ operation: "stage package", path: relativeTarget, message: researchErrorMessage(error) }),
      }),
      (path) => Effect.sync(() => removeIgnoringFailure(path)),
    );
    yield* Effect.try({
      try: () => {
        if (existsSync(target)) throw new Error("target appeared while publication was staged; retry");
        renameSync(stage, target);
        syncDirectory(dirname(target));
      },
      catch: (error) => new ResearchFileError({ operation: "publish package", path: relativeTarget, message: researchErrorMessage(error) }),
    });
    return { target: relativeTarget, digest };
  }));
}

export function readResearchFile(
  root: string,
  relativeTarget: string,
): Effect.Effect<string, ResearchFileError | ResearchPathError> {
  return Effect.try({
    try: () => {
      const target = resolveTarget(root, relativeTarget);
      if (lstatSync(target).isSymbolicLink()) {
        throw new ResearchPathError({ path: relativeTarget, message: "Research files cannot be symbolic links." });
      }
      return readFileSync(target, "utf8");
    },
    catch: (error) => error instanceof ResearchPathError
      ? error
      : new ResearchFileError({ operation: "read", path: relativeTarget, message: researchErrorMessage(error) }),
  });
}
