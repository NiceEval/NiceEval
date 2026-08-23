import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "@effect/platform";
import type * as CommandExecutor from "@effect/platform/CommandExecutor";
import type { PlatformError } from "@effect/platform/Error";
import { Effect, ParseResult, Schema } from "effect";

import { DocsDecodeError, DocsFileError, DocsProcessError, errorMessage } from "./errors.js";

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export function absolutePath(path: string): string {
  return join(REPOSITORY_ROOT, path);
}

export function decodeUnknown<A, I>(
  source: string,
  schema: Schema.Schema<A, I>,
  input: unknown,
): Effect.Effect<A, DocsDecodeError> {
  return Schema.decodeUnknown(schema, { errors: "all" })(input).pipe(
    Effect.mapError((error) => new DocsDecodeError({
      source,
      message: ParseResult.TreeFormatter.formatErrorSync(error),
    })),
  );
}

export function readText(path: string): Effect.Effect<string, DocsFileError> {
  return Effect.try({
    try: () => readFileSync(absolutePath(path), "utf8"),
    catch: (error) => new DocsFileError({ operation: "read", path, message: errorMessage(error) }),
  });
}

export function readJson<A, I>(
  path: string,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A, DocsDecodeError | DocsFileError> {
  return readText(path).pipe(
    Effect.flatMap((source) => Effect.try({
      try: () => JSON.parse(source) as unknown,
      catch: (error) => new DocsDecodeError({ source: path, message: errorMessage(error) }),
    })),
    Effect.flatMap((input) => decodeUnknown(path, schema, input)),
  );
}

function removeIgnoringFailure(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Cleanup must not replace the primary typed failure.
  }
}

export function atomicWriteText(
  path: string,
  content: string,
  expected?: string,
): Effect.Effect<void, DocsFileError> {
  const target = absolutePath(path);
  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  return Effect.scoped(Effect.gen(function*() {
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
  }));
}

export function atomicWriteJson(path: string, value: unknown): Effect.Effect<void, DocsFileError> {
  return atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function withFileLock<A, E, R>(
  path: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | DocsFileError, R> {
  const target = absolutePath(path);
  return Effect.scoped(Effect.gen(function*() {
    const handle = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          mkdirSync(dirname(target), { recursive: true });
          return openSync(target, "wx");
        },
        catch: (error) => new DocsFileError({ operation: "acquire lock", path, message: errorMessage(error) }),
      }),
      (fd) => Effect.sync(() => {
        try {
          closeSync(fd);
        } finally {
          removeIgnoringFailure(target);
        }
      }),
    );
    void handle;
    return yield* effect;
  }));
}

export function runCommand(
  name: string,
  args: readonly string[],
  options: { readonly inherit?: boolean } = {},
): Effect.Effect<number, DocsProcessError, CommandExecutor.CommandExecutor> {
  let command = Command.make(name, ...args).pipe(Command.workingDirectory(REPOSITORY_ROOT));
  if (options.inherit === true) {
    command = command.pipe(Command.stdin("inherit"), Command.stdout("inherit"), Command.stderr("inherit"));
  }
  return Command.exitCode(command).pipe(
    Effect.map(Number),
    Effect.mapError((error: PlatformError) => new DocsProcessError({
      command: [name, ...args].join(" "),
      message: error.message,
    })),
  );
}

export function runSuccessfulCommand(
  name: string,
  args: readonly string[],
  options: { readonly inherit?: boolean } = {},
): Effect.Effect<void, DocsProcessError, CommandExecutor.CommandExecutor> {
  return runCommand(name, args, options).pipe(
    Effect.flatMap((exitCode) => exitCode === 0
      ? Effect.void
      : Effect.fail(new DocsProcessError({
        command: [name, ...args].join(" "),
        exitCode,
        message: `command exited with status ${exitCode}`,
      }))),
  );
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function repositoryRelative(path: string): string | undefined {
  const resolved = resolve(path);
  const result = relative(REPOSITORY_ROOT, resolved).split(sep).join("/");
  return result === "" || result === ".." || result.startsWith("../") ? undefined : result;
}

export function pathExists(path: string): boolean {
  return existsSync(absolutePath(path));
}
