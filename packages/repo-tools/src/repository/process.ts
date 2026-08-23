import { Command as PlatformCommand, CommandExecutor } from "@effect/platform";
import { Chunk, Effect, Stream } from "effect";

import { RepositoryCommandError } from "./model.js";

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function decode(chunks: Chunk.Chunk<Uint8Array>): string {
  return Buffer.concat(Chunk.toReadonlyArray(chunks).map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  accept: readonly number[] = [0],
): Effect.Effect<ProcessResult, RepositoryCommandError, CommandExecutor.CommandExecutor> {
  const configured = PlatformCommand.make(command, ...args).pipe(
    PlatformCommand.workingDirectory(cwd),
  );
  return Effect.scoped(Effect.gen(function*() {
    const child = yield* PlatformCommand.start(configured);
    const [stdout, stderr, exitCode] = yield* Effect.all([
      Stream.runCollect(child.stdout),
      Stream.runCollect(child.stderr),
      child.exitCode,
    ], { concurrency: "unbounded" });
    return { stdout: decode(stdout), stderr: decode(stderr), exitCode: Number(exitCode) };
  })).pipe(
    Effect.mapError((error) => new RepositoryCommandError({
      command,
      args,
      cwd,
      message: String(error),
    })),
    Effect.flatMap((result) => accept.includes(result.exitCode)
      ? Effect.succeed(result)
      : Effect.fail(new RepositoryCommandError({
        command,
        args,
        cwd,
        exitCode: result.exitCode,
        message: result.stderr.trim() || result.stdout.trim() || "command failed",
      }))),
  );
}
