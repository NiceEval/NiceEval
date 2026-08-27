import { ChildProcess, type ChildProcessSpawner } from "effect/unstable/process";
import { Effect, Stream } from "effect";

import { PreviewCommandError } from "./model.js";

export interface PreviewProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function decode(chunks: ReadonlyArray<Uint8Array>): string {
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export function runPreviewProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  environment?: Readonly<Record<string, string | undefined>>,
): Effect.Effect<PreviewProcessResult, PreviewCommandError, ChildProcessSpawner.ChildProcessSpawner> {
  const configured = ChildProcess.make(command, args, {
    cwd,
    ...(environment === undefined ? {} : { env: environment }),
  });
  return Effect.scoped(Effect.gen(function*() {
    const child = yield* configured;
    const [stdout, stderr, exitCode] = yield* Effect.all([
      Stream.runCollect(child.stdout),
      Stream.runCollect(child.stderr),
      child.exitCode,
    ], { concurrency: "unbounded" });
    return { stdout: decode(stdout), stderr: decode(stderr), exitCode: Number(exitCode) };
  })).pipe(Effect.mapError((error) => new PreviewCommandError({
    command,
    args,
    cwd,
    message: String(error),
  })));
}

export function requirePreviewSuccess(
  command: string,
  args: readonly string[],
  cwd: string,
  environment?: Readonly<Record<string, string | undefined>>,
) {
  return runPreviewProcess(command, args, cwd, environment).pipe(
    Effect.flatMap((result) => result.exitCode === 0
      ? Effect.succeed(result)
      : Effect.fail(new PreviewCommandError({
        command,
        args,
        cwd,
        exitCode: result.exitCode,
        message: result.stderr.trim() || result.stdout.trim() || "command failed",
      }))),
  );
}
