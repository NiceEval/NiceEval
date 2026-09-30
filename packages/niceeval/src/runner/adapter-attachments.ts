import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { Data, Effect, Result, Schema } from "effect";

import type { AdapterAttachmentInput, AdapterAttachmentReceipt } from "../adapter-attachments.ts";
import { RecordExactParseOptions } from "../record/codec/core.ts";
import { ArtifactsLimits } from "../record/family/artifacts/schema.ts";
import { MediaTypeSchema, SafeTextSchema } from "../record/family/common.ts";
import type { EvalResult } from "./types.ts";

export const AdapterAttachmentLimits = Object.freeze({
  maximumArtifacts: ArtifactsLimits.maximumArtifacts,
  maximumContentBytes: 64 * 1024 * 1024,
  maximumStreamBytes: ArtifactsLimits.maximumContentBytes,
  maximumChunkBytes: 1024 * 1024,
  maximumActiveStreams: 4,
  maximumArchivedBytes: 2 * 1024 * 1024 * 1024,
  maximumTotalBytes: 256 * 1024 * 1024,
});

export class AdapterAttachmentError extends Data.TaggedError("AdapterAttachmentError")<{
  readonly code: "adapter-attachment-invalid" | "adapter-attachment-limit" | "adapter-attachment-closed" | "adapter-attachment-failed";
  readonly message: string;
}> {}

export type CapturedAdapterAttachment = AdapterAttachmentReceipt & (
  | { readonly bytes: Uint8Array; readonly filePath?: never }
  | { readonly filePath: string; readonly bytes?: never }
);

export interface AdapterAttachmentSnapshot {
  readonly artifacts: readonly CapturedAdapterAttachment[];
  readonly failure: AdapterAttachmentError | undefined;
  readonly dispose: () => Promise<void>;
}

const captures = new WeakMap<EvalResult, AdapterAttachmentSnapshot>();
export function retainAdapterAttachments(result: EvalResult, snapshot: AdapterAttachmentSnapshot): void {
  captures.set(result, snapshot);
}
export function adapterAttachmentsForResult(result: EvalResult): AdapterAttachmentSnapshot | undefined {
  return captures.get(result);
}

export function releaseAdapterAttachments(result: EvalResult): Promise<void> {
  const snapshot = captures.get(result);
  captures.delete(result);
  return snapshot?.dispose() ?? Promise.resolve();
}

export interface AdapterAttachmentCollector {
  readonly attach: (input: AdapterAttachmentInput) => Promise<AdapterAttachmentReceipt>;
  readonly markFailure: (cause: unknown) => AdapterAttachmentError;
  readonly failure: () => AdapterAttachmentError | undefined;
  readonly artifacts: () => readonly CapturedAdapterAttachment[];
  readonly close: () => void;
  readonly dispose: () => Promise<void>;
  readonly snapshot: () => AdapterAttachmentSnapshot;
}

const InputSchema = Schema.Struct({
  name: SafeTextSchema,
  mediaType: MediaTypeSchema,
  body: Schema.Union([Schema.String, Schema.Uint8Array, Schema.Struct({ stream: Schema.declare<(signal: AbortSignal) => AsyncIterable<Uint8Array>>(
    (value): value is (signal: AbortSignal) => AsyncIterable<Uint8Array> => typeof value === "function",
  ) })]),
  signal: Schema.optional(Schema.instanceOf(AbortSignal)),
});
const decodeInput = Schema.decodeUnknownResult(InputSchema, RecordExactParseOptions);

/** The Attempt owner closes this collector only when its cleanup window ends. */
export function createAdapterAttachmentCollector(stagingRoot: string): AdapterAttachmentCollector {
  const artifacts: CapturedAdapterAttachment[] = [];
  let totalBytes = 0;
  let archivedBytes = 0;
  let directory: Promise<string> | undefined;
  const pending = new Map<AbortController, Promise<AdapterAttachmentReceipt>>();
  const pendingItems = new Set<AbortController>();
  let closed = false;
  let firstFailure: AdapterAttachmentError | undefined;
  let sealed: AdapterAttachmentSnapshot | undefined;

  const markFailure = (cause: unknown): AdapterAttachmentError => {
    const error = cause instanceof AdapterAttachmentError ? cause : new AdapterAttachmentError({
      code: "adapter-attachment-failed",
      message: "Attachment capture failed.",
    });
    // A late caller cannot rewrite an already sealed collection or its outcome.
    if (!closed) firstFailure ??= error;
    return error;
  };

  const captureStream = (value: AdapterAttachmentInput & { readonly body: { readonly stream: (signal: AbortSignal) => AsyncIterable<Uint8Array> } }): Promise<AdapterAttachmentReceipt> => {
    const controller = new AbortController();
    pendingItems.add(controller);
    const signal = value.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, value.signal]);
    let reservedBytes = 0;
    const artifactId = `art_${randomBytes(10).toString("hex")}`;
    const operation = Effect.tryPromise({
      try: async () => {
        signal.throwIfAborted();
        const root = await (directory ??= mkdir(stagingRoot, { recursive: true, mode: 0o700 })
          .then(() => mkdtemp(join(stagingRoot, "attempt-"))));
        signal.throwIfAborted();
        const filePath = join(root, artifactId);
        const destination = await open(filePath, "wx", 0o600);
        let accepted = false;
        let iterator: AsyncIterator<Uint8Array> | undefined;
        let ended = false;
        try {
          signal.throwIfAborted();
          iterator = value.body.stream(signal)[Symbol.asyncIterator]();
          const hash = createHash("sha256");
          for (;;) {
            signal.throwIfAborted();
            // Use one removable listener per pull. Racing every pull against one
            // never-settled abort Promise retains all prior chunks until abort.
            const next = await new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
              const onAbort = () => reject(signal.reason);
              signal.addEventListener("abort", onAbort, { once: true });
              Promise.resolve().then(() => {
                signal.throwIfAborted();
                return iterator!.next();
              }).then(
                (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
                (cause: unknown) => { signal.removeEventListener("abort", onAbort); reject(cause); },
              );
            });
            signal.throwIfAborted();
            if (next.done) { ended = true; break; }
            if (!(next.value instanceof Uint8Array)) {
              throw new AdapterAttachmentError({ code: "adapter-attachment-invalid", message: "Attachment stream must yield Uint8Array chunks." });
            }
            const size = next.value.byteLength;
            if (size === 0) { await setImmediate(); continue; }
            const exceeded = size > AdapterAttachmentLimits.maximumChunkBytes
              ? "1 MiB chunk"
              : reservedBytes + size > AdapterAttachmentLimits.maximumStreamBytes
              ? "1 GiB stream"
              : archivedBytes + size > AdapterAttachmentLimits.maximumArchivedBytes
              ? "2 GiB Attempt"
              : undefined;
            if (exceeded !== undefined) {
              throw new AdapterAttachmentError({ code: "adapter-attachment-limit", message: `Attachment exceeds the ${exceeded} limit.` });
            }
            // One owned chunk at a time; no prefetch or retained chunk collection.
            const bytes = new Uint8Array(next.value);
            reservedBytes += size;
            archivedBytes += size;
            hash.update(bytes);
            let offset = 0;
            while (offset < bytes.byteLength) {
              signal.throwIfAborted();
              const { bytesWritten } = await destination.write(bytes, offset, bytes.byteLength - offset);
              if (bytesWritten === 0) throw new Error("Attachment write made no progress.");
              offset += bytesWritten;
            }
          }
          await destination.close();
          signal.throwIfAborted();
          if (closed) throw new AdapterAttachmentError({ code: "adapter-attachment-closed", message: "Attachment collection is closed." });
          const receipt = Object.freeze({ artifactId, name: value.name, mediaType: value.mediaType, byteLength: reservedBytes, sha256: hash.digest("hex") });
          pendingItems.delete(controller);
          artifacts.push(Object.freeze({ ...receipt, filePath }));
          accepted = true;
          return receipt;
        } finally {
          if (!ended) {
            controller.abort();
            // A non-cooperative producer must not hold our file or cleanup open.
            // Calling return requests release; the producer owns its external IO.
            try { void Promise.resolve(iterator?.return?.()).catch(() => undefined); } catch { /* preserve capture failure */ }
          }
          try { await destination.close(); }
          finally {
            if (!accepted) {
              archivedBytes -= reservedBytes;
              await rm(filePath, { force: true });
            }
          }
        }
      },
      catch: markFailure,
    });
    const promise = Effect.runPromise(Effect.result(operation)).then((result) => {
      if (Result.isFailure(result)) throw result.failure;
      return result.success;
    }).finally(() => { pending.delete(controller); pendingItems.delete(controller); });
    pending.set(controller, promise);
    void promise.catch(() => undefined);
    return promise;
  };

  const attach = (input: AdapterAttachmentInput): Promise<AdapterAttachmentReceipt> => {
    try {
      if (closed) throw new AdapterAttachmentError({ code: "adapter-attachment-closed", message: "Attachment collection is closed." });
      const decoded = decodeInput(input);
      if (Result.isFailure(decoded)) {
        throw new AdapterAttachmentError({ code: "adapter-attachment-invalid", message: "Attachment requires a valid name, mediaType, and bytes, text, or stream body." });
      }
      const value = decoded.success;
      value.signal?.throwIfAborted();
      if (artifacts.length + pendingItems.size >= AdapterAttachmentLimits.maximumArtifacts) {
        throw new AdapterAttachmentError({ code: "adapter-attachment-limit", message: "Attachment exceeds the 4000 item limit." });
      }
      if (typeof value.body === "object" && !(value.body instanceof Uint8Array)) {
        if (pending.size >= AdapterAttachmentLimits.maximumActiveStreams) {
          throw new AdapterAttachmentError({ code: "adapter-attachment-limit", message: "Attachment exceeds the 4 active stream limit." });
        }
        return captureStream({ ...value, body: value.body });
      }
      // Check the UTF-8 size before allocating an encoded copy of a large string.
      const byteLength = typeof value.body === "string" ? Buffer.byteLength(value.body, "utf8") : value.body.byteLength;
      if (byteLength > AdapterAttachmentLimits.maximumContentBytes ||
        totalBytes + byteLength > AdapterAttachmentLimits.maximumTotalBytes ||
        archivedBytes + byteLength > AdapterAttachmentLimits.maximumArchivedBytes ||
        artifacts.length >= AdapterAttachmentLimits.maximumArtifacts) {
        throw new AdapterAttachmentError({ code: "adapter-attachment-limit", message: "Attachment exceeds the 64 MiB item, 256 MiB Attempt, or 4000 item limit." });
      }
      // This must happen before returning the Promise; caller mutation cannot race acceptance.
      const bytes = typeof value.body === "string" ? new TextEncoder().encode(value.body) : new Uint8Array(value.body);
      const receipt = Object.freeze({
        artifactId: `art_${randomBytes(10).toString("hex")}`,
        name: value.name,
        mediaType: value.mediaType,
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      artifacts.push(Object.freeze({ ...receipt, bytes }));
      totalBytes += bytes.byteLength;
      archivedBytes += bytes.byteLength;
      return Promise.resolve(receipt);
    } catch (cause) {
      const rejection = Promise.reject<AdapterAttachmentReceipt>(markFailure(cause));
      // Ignoring an attach Promise still records a sticky failure without an unhandled rejection.
      void rejection.catch(() => undefined);
      return rejection;
    }
  };

  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => disposal ??= (async () => {
    closed = true;
    for (const controller of pending.keys()) controller.abort();
    await Promise.allSettled([...pending.values()]);
    if (directory !== undefined) {
      const root = await directory.catch(() => undefined);
      if (root !== undefined) await rm(root, { recursive: true, force: true });
    }
    artifacts.length = 0;
    sealed = undefined;
  })();

  return Object.freeze({
    attach,
    markFailure,
    failure: () => firstFailure,
    artifacts: () => Object.freeze([...artifacts]),
    close: () => {
      if (closed) return;
      if (pending.size > 0) {
        markFailure(new AdapterAttachmentError({ code: "adapter-attachment-closed", message: "Attachment collection closed during stream capture." }));
      }
      closed = true;
      for (const controller of pending.keys()) controller.abort();
      sealed = Object.freeze({ artifacts: Object.freeze([...artifacts]), failure: firstFailure, dispose });
    },
    dispose,
    snapshot: () => {
      if (sealed === undefined) throw new Error("Attachment collection must close before taking its snapshot.");
      return sealed;
    },
  });
}
