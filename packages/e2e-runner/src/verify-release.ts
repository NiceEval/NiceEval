// Local release consistency verification. The CLI layer owns parsing, output
// and the process runtime; this module is an Effect-native composition unit.

import * as FileSystem from "@effect/platform/FileSystem";
import { Data, Effect, Either } from "effect";
import { lstat as nodeLstat, type Stats } from "node:fs";
import { join, resolve } from "node:path";
import * as tar from "tar-stream";
import { gunzipSync } from "node:zlib";

import { decodeExternal, decodeOwned, PlanDocumentSchema, ReleaseReceiptProjectionSchema, TarPackageMetadataSchema, type ReleaseReceiptProjection } from "./contracts.ts";
import { readCandidateTarball, type CandidateTarball } from "./injection.ts";
import { assertContainedRegularFile, assertRealDirectory } from "./durable-path.ts";

export interface VerifyReleaseOptions {
  readonly planPath: string;
  readonly candidatePath: string;
  readonly receiptRoot: string;
  readonly tag: string;
}

export class VerifyReleaseOperationError extends Data.TaggedError("VerifyReleaseOperationError")<{
  readonly operation: "plan" | "candidate" | "receipts" | "tarball";
  readonly detail: string;
}> {}

export interface ReleaseVerification {
  readonly ok: true;
  readonly planRepoIds: readonly string[];
  readonly receiptRepoIds: readonly string[];
  readonly candidate: { readonly name: string; readonly version: string; readonly sha256: string; readonly integrity: string };
  readonly tag: string;
}

const operationError = (operation: VerifyReleaseOperationError["operation"], cause: unknown): VerifyReleaseOperationError =>
  new VerifyReleaseOperationError({ operation, detail: cause instanceof Error ? cause.message : String(cause) });

/** Receipt traversal must classify filesystem entries without following links. */
const lstatReceiptEntry = (path: string): Effect.Effect<Stats, VerifyReleaseOperationError> =>
  Effect.async((resume) => {
    nodeLstat(path, (cause, stat) => {
      resume(cause === null
        ? Effect.succeed(stat)
        : Effect.fail(operationError("receipts", cause)));
    });
  });

const decoded = <A>(
  result: Either.Either<A, unknown>,
  operation: VerifyReleaseOperationError["operation"],
  source: string,
): Effect.Effect<A, VerifyReleaseOperationError> =>
  Either.isRight(result)
    ? Effect.succeed(result.right)
    : Effect.fail(operationError(operation, `${source} has an invalid document: ${String(result.left)}`));

const readJson = (
  path: string,
  operation: VerifyReleaseOperationError["operation"],
): Effect.Effect<unknown, VerifyReleaseOperationError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const text = yield* fileSystem.readFileString(path).pipe(Effect.mapError((cause) => operationError(operation, cause)));
    return yield* Effect.try({
      try: () => JSON.parse(text),
      catch: (cause) => operationError(operation, `could not parse ${path}: ${cause instanceof Error ? cause.message : String(cause)}`),
    });
  });

/** Current plans are owned documents; there is deliberately no schema-version compatibility path. */
const readPlan = (path: string): Effect.Effect<readonly { readonly repoIds: readonly string[] }[], VerifyReleaseOperationError, FileSystem.FileSystem> =>
  readJson(path, "plan").pipe(
    Effect.flatMap((raw) => decoded(decodeOwned(PlanDocumentSchema, "ReleasePlan")(raw), "plan", `release plan ${path}`)),
    Effect.flatMap((plan) => {
      if (plan.mode !== "full" && plan.mode !== "fail-open-full") {
        return Effect.fail(operationError("plan", "release plan must have full or fail-open-full mode"));
      }
      return plan.cells.length === 0
        ? Effect.fail(operationError("plan", "release plan must contain a non-empty cells array"))
        : Effect.succeed(plan.cells);
    }),
  );

const findReceiptFiles = (root: string): Effect.Effect<readonly string[], VerifyReleaseOperationError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const walk = (directory: string): Effect.Effect<readonly string[], VerifyReleaseOperationError, FileSystem.FileSystem> => Effect.gen(function* () {
      const directoryStat = yield* lstatReceiptEntry(directory);
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        return yield* Effect.fail(operationError("receipts", `release receipt directory must be a real directory: ${directory}`));
      }
      yield* assertRealDirectory(directory, "release receipt directory").pipe(Effect.mapError((cause) => operationError("receipts", cause)));
      const names = yield* fileSystem.readDirectory(directory).pipe(Effect.mapError((cause) => operationError("receipts", cause)));
      const nested = yield* Effect.forEach(names, (name) => Effect.gen(function* () {
        const path = join(directory, name);
        const stat = yield* lstatReceiptEntry(path);
        if (stat.isSymbolicLink()) return yield* Effect.fail(operationError("receipts", `release receipt tree rejects symlink: ${path}`));
        if (stat.isDirectory()) return yield* walk(path);
        if (!stat.isFile()) return yield* Effect.fail(operationError("receipts", `release receipt tree rejects special file: ${path}`));
        return name === "receipt.json" ? [path] : [];
      }), { concurrency: 1 });
      return nested.flat();
    });
    const rootStat = yield* lstatReceiptEntry(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      return yield* Effect.fail(operationError("receipts", `release receipt root must be a real directory: ${root}`));
    }
    yield* assertRealDirectory(root, "release receipt root").pipe(Effect.mapError((cause) => operationError("receipts", cause)));
    const files = yield* walk(root);
    return [...files].sort((left, right) => left.localeCompare(right));
  });

/** `tar-stream` is an event boundary; interruption unregisters all listeners and destroys the extractor. */
const extractPackageJson = (contents: Uint8Array): Effect.Effect<Buffer, VerifyReleaseOperationError> =>
  Effect.scoped(Effect.acquireRelease(
    Effect.sync(() => tar.extract()),
    (extractor) => Effect.sync(() => extractor.destroy()),
  ).pipe(Effect.flatMap((extractor) => Effect.async<Buffer, VerifyReleaseOperationError>((resume) => {
    const matches: Buffer[] = [];
    const streamCleanups: Array<() => void> = [];
    let settled = false;
    const cleanup = () => {
      for (const remove of streamCleanups.splice(0)) remove();
      extractor.off("entry", onEntry);
      extractor.off("error", onError);
      extractor.off("finish", onFinish);
      extractor.destroy();
    };
    const settle = (result: Effect.Effect<Buffer, VerifyReleaseOperationError>) => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(result);
    };
    const onError = (cause: unknown) => settle(Effect.fail(operationError("tarball", cause)));
    const onFinish = () => {
      if (matches.length !== 1 || matches[0] === undefined) {
        settle(Effect.fail(operationError("tarball", `candidate tarball must contain exactly one package/package.json, found ${matches.length}`)));
        return;
      }
      settle(Effect.succeed(matches[0]));
    };
    const onEntry = (header: tar.Headers, stream: NodeJS.ReadableStream, next: (error?: Error | null) => void) => {
      if (header.type !== "file" || header.name !== "package/package.json") {
        const onEnd = () => next();
        const onStreamError = (cause: unknown) => settle(Effect.fail(operationError("tarball", cause)));
        const remove = () => {
          stream.off("end", onEnd);
          stream.off("error", onStreamError);
        };
        streamCleanups.push(remove);
        stream.resume();
        stream.once("end", onEnd);
        stream.once("error", onStreamError);
        return;
      }
      const chunks: Buffer[] = [];
      const onData = (chunk: Buffer) => chunks.push(chunk);
      const onStreamError = (cause: unknown) => settle(Effect.fail(operationError("tarball", cause)));
      const onEnd = () => {
        stream.off("data", onData);
        stream.off("error", onStreamError);
        streamCleanups.splice(streamCleanups.indexOf(remove), 1);
        matches.push(Buffer.concat(chunks));
        next();
      };
      const remove = () => {
        stream.off("data", onData);
        stream.off("error", onStreamError);
        stream.off("end", onEnd);
      };
      streamCleanups.push(remove);
      stream.on("data", onData);
      stream.once("error", onStreamError);
      stream.once("end", onEnd);
    };
    extractor.on("entry", onEntry);
    extractor.once("error", onError);
    extractor.once("finish", onFinish);
    extractor.end(Buffer.from(contents));
    return Effect.sync(cleanup);
  }))));

const packagedMetadata = (candidatePath: string): Effect.Effect<{ readonly name: string; readonly version: string }, VerifyReleaseOperationError, FileSystem.FileSystem> =>
  Effect.scoped(Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const compressed = yield* fileSystem.readFile(candidatePath).pipe(Effect.mapError((cause) => operationError("tarball", cause)));
    const contents = yield* Effect.try({
      try: () => gunzipSync(compressed),
      catch: (cause) => operationError("tarball", `could not decompress candidate tarball ${candidatePath}: ${cause instanceof Error ? cause.message : String(cause)}`),
    });
    const packageJson = yield* extractPackageJson(contents);
    const raw = yield* Effect.try({
      try: () => JSON.parse(packageJson.toString("utf8")),
      catch: (cause) => operationError("tarball", `candidate package/package.json is invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`),
    });
    return yield* decoded(decodeExternal(TarPackageMetadataSchema, "TarPackageMetadata")(raw), "tarball", "candidate package/package.json");
  }));

const verifyCandidate = (
  receiptPath: string,
  receiptRoot: string,
  receipt: ReleaseReceiptProjection,
  candidate: CandidateTarball,
): Effect.Effect<void, VerifyReleaseOperationError, FileSystem.FileSystem> => Effect.gen(function* () {
  const identity = receipt.candidate;
  if (identity === undefined || identity.sha256 !== candidate.sha256 || identity.integrity !== candidate.integrity) {
    return yield* Effect.fail(operationError("receipts", `receipt ${receiptPath} candidate digest does not match the supplied tarball`));
  }
  if (identity.exactReplay !== true || identity.artifactPath === undefined) {
    return yield* Effect.fail(operationError("receipts", `receipt ${receiptPath} does not retain an exact candidate tarball artifact`));
  }
  const retainedPath = yield* assertContainedRegularFile(receiptRoot, resolve(receiptRoot, identity.artifactPath), `receipt ${receiptPath} candidate artifactPath`).pipe(Effect.mapError((cause) => operationError("receipts", cause)));
  const retained = yield* readCandidateTarball(retainedPath).pipe(Effect.mapError((cause) => operationError("candidate", cause)));
  if (retained.sha256 !== candidate.sha256 || retained.integrity !== candidate.integrity) {
    return yield* Effect.fail(operationError("receipts", `receipt ${receiptPath} retained candidate tarball digest does not match the supplied tarball`));
  }
});

/** Verifies plan, receipts and candidate bytes without release side effects. */
export const verifyRelease = (options: VerifyReleaseOptions): Effect.Effect<ReleaseVerification, VerifyReleaseOperationError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const plan = yield* readPlan(options.planPath);
    const expectedIds = new Set(plan.flatMap((entry) => entry.repoIds));
    const receiptRoot = yield* assertRealDirectory(options.receiptRoot, "release receipt root").pipe(Effect.mapError((cause) => operationError("receipts", cause)));
    const candidate = yield* readCandidateTarball(options.candidatePath).pipe(Effect.mapError((cause) => operationError("candidate", cause)));
    const metadata = yield* packagedMetadata(options.candidatePath);
    if (metadata.name !== "niceeval") return yield* Effect.fail(operationError("tarball", `candidate package name must be "niceeval", got ${JSON.stringify(metadata.name)}`));
    if (options.tag !== `v${metadata.version}`) return yield* Effect.fail(operationError("tarball", `tag ${JSON.stringify(options.tag)} must exactly equal v${metadata.version} for candidate ${metadata.name}`));
    const files = yield* findReceiptFiles(receiptRoot);
    if (files.length === 0) return yield* Effect.fail(operationError("receipts", `no receipt.json files found under ${receiptRoot}`));
    const byId = new Map<string, string>();
    for (const file of files) {
      yield* assertContainedRegularFile(receiptRoot, file, "release receipt").pipe(Effect.mapError((cause) => operationError("receipts", cause)));
      const raw = yield* readJson(file, "receipts");
      const receipt = yield* decoded(decodeExternal(ReleaseReceiptProjectionSchema, "ReleaseReceiptProjection")(raw), "receipts", `receipt ${file}`);
      if (receipt.repoId === undefined) return yield* Effect.fail(operationError("receipts", `receipt ${file} has no non-empty repoId`));
      const previous = byId.get(receipt.repoId);
      if (previous !== undefined) return yield* Effect.fail(operationError("receipts", `duplicate receipt repoId ${JSON.stringify(receipt.repoId)} in ${previous} and ${file}`));
      byId.set(receipt.repoId, file);
      if (receipt.category !== "pass") return yield* Effect.fail(operationError("receipts", `receipt ${file} for ${receipt.repoId} is ${JSON.stringify(receipt.category)}, not "pass"`));
      yield* verifyCandidate(file, receiptRoot, receipt, candidate);
    }
    const actualIds = new Set(byId.keys());
    const missing = [...expectedIds].filter((id) => !actualIds.has(id)).sort();
    const extra = [...actualIds].filter((id) => !expectedIds.has(id)).sort();
    if (missing.length > 0 || extra.length > 0) return yield* Effect.fail(operationError("receipts", `receipt repo IDs must exactly match the plan; missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`));
    return { ok: true, planRepoIds: [...expectedIds].sort(), receiptRepoIds: [...actualIds].sort(), candidate: { name: metadata.name, version: metadata.version, sha256: candidate.sha256, integrity: candidate.integrity }, tag: options.tag };
  });
