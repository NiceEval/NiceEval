import { ChildProcess, type ChildProcessSpawner } from "effect/unstable/process";
import { Effect, Stream } from "effect";

import { ExamplesGitError, ExamplesProcessError } from "./model.js";

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function decode(chunks: ReadonlyArray<Uint8Array>): string {
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
  ).toString("utf8");
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly input?: string;
    readonly environment?: Readonly<Record<string, string>>;
  },
): Effect.Effect<ProcessResult, ExamplesProcessError, ChildProcessSpawner.ChildProcessSpawner> {
  const configured = ChildProcess.make(command, args, {
    cwd: options.cwd,
    ...(options.input === undefined ? {} : { stdin: Stream.fromIterable([new TextEncoder().encode(options.input)]) }),
    ...(options.environment === undefined ? {} : { env: options.environment }),
  });

  return Effect.scoped(Effect.gen(function*() {
    const child = yield* configured;
    const [stdout, stderr, exitCode] = yield* Effect.all([
      Stream.runCollect(child.stdout),
      Stream.runCollect(child.stderr),
      child.exitCode,
    ], { concurrency: "unbounded" });
    return {
      stdout: decode(stdout),
      stderr: decode(stderr),
      exitCode: Number(exitCode),
    };
  })).pipe(
    Effect.mapError((error) => new ExamplesProcessError({
      command,
      args: [command, ...args],
      message: String(error),
    })),
  );
}

export function git(
  root: string,
  args: readonly string[],
  options: {
    readonly input?: string;
    readonly accept?: readonly number[];
    readonly environment?: Readonly<Record<string, string>>;
  } = {},
): Effect.Effect<ProcessResult, ExamplesGitError, ChildProcessSpawner.ChildProcessSpawner> {
  return runProcess("git", args, {
    cwd: root,
    ...(options.input === undefined ? {} : { input: options.input }),
    ...(options.environment === undefined ? {} : { environment: options.environment }),
  }).pipe(
    Effect.mapError((error) => new ExamplesGitError({ args, message: error.message })),
    Effect.flatMap((result) => (options.accept ?? [0]).includes(result.exitCode)
      ? Effect.succeed(result)
      : Effect.fail(new ExamplesGitError({
        args,
        exitCode: result.exitCode,
        message: result.stderr.trim() || result.stdout.trim() || "git command failed",
      }))),
  );
}
