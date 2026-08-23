// Candidate output placement; command execution lives in injection.ts.

import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Data, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { buildCandidateTarball, readCandidateTarball, type CandidateTarball } from "./injection.ts";
import { assertContainedRegularFile, prepareContainedRegularFile } from "./durable-path.ts";

export class PackCandidateError extends Data.TaggedError("PackCandidateError")<{ readonly operation: "prepare-output" | "move" | "fingerprint"; readonly detail: string; }> {}

/** Creates exactly one requested .tgz; its temporary directory is scope-owned. */
export function packCandidate(repoRoot: string, out: string): Effect.Effect<CandidateTarball, PackCandidateError, import("./owned-process.ts").OwnedProcess | FileSystem.FileSystem> {
  return Effect.scoped(Effect.gen(function* () {
    const declared = resolve(out);
    if (!declared.endsWith(".tgz")) return yield* Effect.fail(new PackCandidateError({ operation: "prepare-output", detail: `pack --out must end with .tgz, got ${JSON.stringify(out)}` }));
    const root = dirname(declared);
    const output = yield* prepareContainedRegularFile(root, declared, "candidate pack output").pipe(Effect.mapError((error) => new PackCandidateError({ operation: "prepare-output", detail: error.detail })));
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: "niceeval-e2e-pack-" }).pipe(Effect.mapError((error) => new PackCandidateError({ operation: "prepare-output", detail: error.message })));
    const packed = yield* buildCandidateTarball(repoRoot, temporary, { quiet: true }).pipe(Effect.mapError((error) => new PackCandidateError({ operation: "prepare-output", detail: error.detail })));
    const generated = yield* fs.readDirectory(temporary).pipe(Effect.map((names) => names.filter((name) => name.endsWith(".tgz"))), Effect.mapError((error) => new PackCandidateError({ operation: "move", detail: error.message })));
    if (generated.length !== 1 || generated[0] === undefined) return yield* Effect.fail(new PackCandidateError({ operation: "move", detail: `expected exactly one generated candidate in ${temporary}` }));
    yield* fs.rename(join(temporary, generated[0]!), output).pipe(Effect.mapError((error) => new PackCandidateError({ operation: "move", detail: error.message })));
    yield* assertContainedRegularFile(root, declared, "candidate pack output").pipe(Effect.mapError((error) => new PackCandidateError({ operation: "fingerprint", detail: error.detail })));
    const candidate = yield* readCandidateTarball(output).pipe(Effect.mapError((error) => new PackCandidateError({ operation: "fingerprint", detail: error.detail })));
    return { ...candidate, name: packed.name, version: packed.version };
  }));
}
