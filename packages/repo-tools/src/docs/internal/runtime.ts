import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { Effect, Schema, SchemaIssue } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

import { repositoryRoot } from "../../root.js";
import { DocsDecodeError, DocsFileError, DocsProcessError, errorMessage } from "./errors.js";

export const REPOSITORY_ROOT = repositoryRoot();

export function absolutePath(path: string): string {
  return join(REPOSITORY_ROOT, path);
}

export function decodeUnknown<A>(source: string, schema: Schema.ConstraintDecoder<A, never>, input: unknown) {
  return Schema.decodeUnknownEffect(schema, { errors: "all" })(input).pipe(
    Effect.mapError((error) => new DocsDecodeError({
      source,
      message: SchemaIssue.makeFormatterDefault()(error.issue),
    })),
  );
}

const readText = Effect.fn("docs.readText")(function*(path: string) {
  return yield* Effect.try({
    try: () => readFileSync(absolutePath(path), "utf8"),
    catch: (error) => new DocsFileError({ operation: "read", path, message: errorMessage(error) }),
  });
});

export const readJson = Effect.fn("docs.readJson")(function*<A>(
  path: string,
  schema: Schema.ConstraintDecoder<A, never>,
) {
  const source = yield* readText(path);
  const input = yield* Effect.try({
    try: () => JSON.parse(source) as unknown,
    catch: (error) => new DocsDecodeError({ source: path, message: errorMessage(error) }),
  });
  return yield* decodeUnknown(path, schema, input);
});

function removeIgnoringFailure(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Cleanup must not replace the primary typed failure.
  }
}

export const atomicWriteText = Effect.fn("docs.atomicWriteText")(function*(
  path: string,
  content: string,
  expected?: string,
) {
  const target = absolutePath(path);
  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  yield* Effect.acquireRelease(
    Effect.succeed(temporary),
    (file) => Effect.sync(() => removeIgnoringFailure(file)),
  );
  yield* Effect.try({
    try: () => {
      mkdirSync(dirname(target), { recursive: true });
      if (expected !== undefined && readFileSync(target, "utf8") !== expected) {
        throw new Error("file changed while the command was running; retry against the new file");
      }
      const descriptor = openSync(temporary, "wx");
      try {
        writeFileSync(descriptor, content);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      renameSync(temporary, target);
    },
    catch: (error) => new DocsFileError({ operation: "atomic write", path, message: errorMessage(error) }),
  });
}, Effect.scoped);

export function atomicWriteJson(path: string, value: unknown) {
  return atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export const withFileLock = Effect.fn("docs.withFileLock")(function*<A, E, R>(
  path: string,
  effect: Effect.Effect<A, E, R>,
) {
  const target = absolutePath(path);
  yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        mkdirSync(dirname(target), { recursive: true });
        return openSync(target, "wx");
      },
      catch: (error) => new DocsFileError({ operation: "acquire lock", path, message: errorMessage(error) }),
    }),
    (descriptor) => Effect.sync(() => {
      try {
        closeSync(descriptor);
      } finally {
        removeIgnoringFailure(target);
      }
    }),
  );
  return yield* effect;
}, Effect.scoped);

export const runCommand = Effect.fn("docs.runCommand")(function*(
  name: string,
  args: readonly string[],
  options: { readonly inherit?: boolean } = {},
): Effect.fn.Return<number, DocsProcessError, ChildProcessSpawner.ChildProcessSpawner> {
  const command = ChildProcess.make(name, args, {
    cwd: REPOSITORY_ROOT,
    ...(options.inherit === true ? { stdin: "inherit", stdout: "inherit", stderr: "inherit" } : {}),
  });
  return yield* command.pipe(
    Effect.flatMap((child) => child.exitCode),
    Effect.map(Number),
    Effect.mapError((error) => new DocsProcessError({
      command: [name, ...args].join(" "),
      message: errorMessage(error),
    })),
    Effect.scoped,
  );
});

export const runSuccessfulCommand = Effect.fn("docs.runSuccessfulCommand")(function*(
  name: string,
  args: readonly string[],
  options: { readonly inherit?: boolean } = {},
) {
  const exitCode = yield* runCommand(name, args, options);
  if (exitCode !== 0) {
    return yield* new DocsProcessError({
      command: [name, ...args].join(" "),
      exitCode,
      message: `command exited with status ${exitCode}`,
    });
  }
});

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function pathExists(path: string): boolean {
  return existsSync(absolutePath(path));
}
