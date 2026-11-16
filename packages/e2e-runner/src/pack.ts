// Candidate output placement; cached build/pack execution lives in candidate-cache.ts.

import { dirname, resolve } from "node:path";
import { Data, Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import { readCandidateTarball, type CandidateTarball } from "./injection.ts";
import { prepareCandidate } from "./candidate-cache.ts";
import { assertContainedRegularFile, prepareContainedRegularFile } from "./durable-path.ts";

export class PackCandidateError extends Data.TaggedError("PackCandidateError")<{
  readonly operation: "prepare-output" | "move" | "fingerprint";
  readonly detail: string;
}> {}

/** Copies the cached candidate bytes to exactly one requested .tgz. */
export function packCandidate(
  repoRoot: string,
  out: string,
): Effect.Effect<
  CandidateTarball,
  PackCandidateError,
  import("./owned-process.ts").OwnedProcess | FileSystem.FileSystem
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const declared = resolve(out);
      if (!declared.endsWith(".tgz"))
        return yield* Effect.fail(
          new PackCandidateError({
            operation: "prepare-output",
            detail: `pack --out must end with .tgz, got ${JSON.stringify(out)}`,
          }),
        );
      const root = dirname(declared);
      const output = yield* prepareContainedRegularFile(root, declared, "candidate pack output").pipe(
        Effect.mapError((error) => new PackCandidateError({ operation: "prepare-output", detail: error.detail })),
      );
      const fs = yield* FileSystem.FileSystem;
      const packed = yield* prepareCandidate(repoRoot, "tarball", { quiet: true }).pipe(
        Effect.mapError((error) => new PackCandidateError({ operation: "prepare-output", detail: error.detail })),
      );
      yield* fs
        .copyFile(packed.path, output)
        .pipe(Effect.mapError((error) => new PackCandidateError({ operation: "move", detail: error.message })));
      yield* assertContainedRegularFile(root, declared, "candidate pack output").pipe(
        Effect.mapError((error) => new PackCandidateError({ operation: "fingerprint", detail: error.detail })),
      );
      const candidate = yield* readCandidateTarball(output).pipe(
        Effect.mapError((error) => new PackCandidateError({ operation: "fingerprint", detail: error.detail })),
      );
      return { ...candidate, name: packed.name, version: packed.version };
    }),
  );
}
