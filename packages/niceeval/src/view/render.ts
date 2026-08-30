import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";

import { makeViewGeneration, newViewGenerationId, type ViewGeneration } from "./revision.ts";

export interface ViewBuildError {
  readonly code: "view-build-failed";
  readonly operation: "validate-app-assets" | "validate-record" | "hash-record";
  readonly reason: string;
}

const APP_ROOT = join(import.meta.dirname, "app-dist");

/**
 * Pins paths and identity only. Vite output remains ordinary files and the
 * The pinned Record remains one SQLite file; no HTML/JSON/View DTO is rendered.
 */
export function buildViewGeneration(input: {
  readonly recordPath: string;
  readonly sourceCutoffIdentity: string;
  readonly retire: () => Promise<void>;
}): Effect.Effect<ViewGeneration, ViewBuildError> {
  return Effect.gen(function* () {
    yield* regularFile(join(APP_ROOT, "index.html"), "validate-app-assets");
    const record = yield* regularFile(input.recordPath, "validate-record");
    const contentHash = yield* Effect.tryPromise({
      try: (signal) => hashFile(input.recordPath, signal),
      catch: (cause) => buildError("hash-record", cause),
    });
    return makeViewGeneration({
      generationId: newViewGenerationId(),
      sourceCutoffIdentity: input.sourceCutoffIdentity,
      contentHash,
      appRoot: APP_ROOT,
      recordPath: input.recordPath,
      recordByteLength: record.size,
      retire: input.retire,
    });
  });
}

function regularFile(
  path: string,
  operation: ViewBuildError["operation"],
): Effect.Effect<{ readonly size: number }, ViewBuildError> {
  return Effect.tryPromise({
    try: async () => {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 ||
        !Number.isSafeInteger(metadata.size)) {
        throw new Error(`${path} is not a non-empty regular file`);
      }
      return Object.freeze({ size: metadata.size });
    },
    catch: (cause) => buildError(operation, cause),
  });
}

function hashFile(path: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    const abort = (): void => { stream.destroy(new Error("Record hashing was interrupted")); };
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    stream.once("error", (cause) => { cleanup(); reject(cause); });
    stream.on("data", (chunk) => { hash.update(chunk); });
    stream.once("end", () => { cleanup(); resolve(hash.digest("hex")); });
    if (signal.aborted) abort();
  });
}

function buildError(operation: ViewBuildError["operation"], cause: unknown): ViewBuildError {
  return Object.freeze({
    code: "view-build-failed" as const,
    operation,
    reason: cause instanceof Error ? cause.message : String(cause),
  });
}
