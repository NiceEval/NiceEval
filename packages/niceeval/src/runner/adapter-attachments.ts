import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { Data, Effect, Result, Schema, Semaphore } from "effect";

import type { AdapterAttachmentInput, AdapterAttachmentReceipt } from "../adapter-attachments.ts";
import { RecordExactParseOptions } from "../record/codec/core.ts";
import { MediaTypeSchema, SafeTextSchema } from "../record/family/common.ts";
import type { EvalResult } from "./types.ts";

const MAX_CHUNK_BYTES = 1024 * 1024;

export class AdapterAttachmentError extends Data.TaggedError("AdapterAttachmentError")<{
  readonly code:
    | "adapter-attachment-invalid"
    | "adapter-attachment-limit"
    | "adapter-attachment-closed"
    | "adapter-attachment-failed";
  readonly message: string;
}> {}

export type CapturedAdapterAttachment = AdapterAttachmentReceipt &
  ({ readonly bytes: Uint8Array; readonly filePath?: never } | { readonly filePath: string; readonly bytes?: never });

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
  body: Schema.Union([
    Schema.String,
    Schema.Uint8Array,
    Schema.Struct({
      stream: Schema.declare<(signal: AbortSignal) => AsyncIterable<Uint8Array>>(
        (value): value is (signal: AbortSignal) => AsyncIterable<Uint8Array> => typeof value === "function",
      ),
    }),
  ]),
  signal: Schema.optional(Schema.instanceOf(AbortSignal)),
});
const decodeInput = Schema.decodeUnknownResult(InputSchema, RecordExactParseOptions);

/** The Attempt owner closes this collector only when its cleanup window ends. */
export function createAdapterAttachmentCollector(stagingRoot: string): AdapterAttachmentCollector {
  const artifacts: CapturedAdapterAttachment[] = [];
  const streamSlots = Semaphore.makeUnsafe(4);
  let directory: Promise<string> | undefined;
  const pending = new Map<AbortController, Promise<AdapterAttachmentReceipt>>();
  const pendingItems = new Set<AbortController>();
  let closed = false;
  let firstFailure: AdapterAttachmentError | undefined;
  let sealed: AdapterAttachmentSnapshot | undefined;

  const markFailure = (cause: unknown): AdapterAttachmentError => {
    const error =
      cause instanceof AdapterAttachmentError
        ? cause
        : new AdapterAttachmentError({
            code: "adapter-attachment-failed",
            message: "Attachment capture failed.",
          });
    // A late caller cannot rewrite an already sealed collection or its outcome.
    if (!closed) firstFailure ??= error;
    return error;
  };

  const captureStream = (
    value: AdapterAttachmentInput & {
      readonly body: { readonly stream: (signal: AbortSignal) => AsyncIterable<Uint8Array> };
    },
  ): Promise<AdapterAttachmentReceipt> => {
    const controller = new AbortController();
    pendingItems.add(controller);
    const signal = value.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, value.signal]);
    let byteLength = 0;
    const artifactId = `art_${randomBytes(10).toString("hex")}`;
    const operation = Effect.tryPromise({
      try: async () => {
        signal.throwIfAborted();
        const root = await (directory ??= mkdir(stagingRoot, { recursive: true, mode: 0o700 }).then(() =>
          mkdtemp(join(stagingRoot, "attempt-")),
        ));
        signal.throwIfAborted();
        const filePath = join(root, artifactId);
        const destination = await open(filePath, "wx", 0o600);
        let accepted = false;
        let iterator: AsyncIterator<Uint8Array> | undefined;
        let ended = false;
        const producerController = new AbortController();
        try {
          signal.throwIfAborted();
          iterator = value.body.stream(AbortSignal.any([signal, producerController.signal]))[Symbol.asyncIterator]();
          const hash = createHash("sha256");
          for (;;) {
            signal.throwIfAborted();
            // Use one removable listener per pull. Racing every pull against one
            // never-settled abort Promise retains all prior chunks until abort.
            const next = await new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
              const onAbort = () => reject(signal.reason);
              signal.addEventListener("abort", onAbort, { once: true });
              Promise.resolve()
                .then(() => {
                  signal.throwIfAborted();
                  return iterator!.next();
                })
                .then(
                  (value) => {
                    signal.removeEventListener("abort", onAbort);
                    resolve(value);
                  },
                  (cause: unknown) => {
                    signal.removeEventListener("abort", onAbort);
                    reject(cause);
                  },
                );
            });
            signal.throwIfAborted();
            if (next.done) {
              ended = true;
              break;
            }
            if (!(next.value instanceof Uint8Array)) {
              throw new AdapterAttachmentError({
                code: "adapter-attachment-invalid",
                message: "Attachment stream must yield Uint8Array chunks.",
              });
            }
            const size = next.value.byteLength;
            if (size === 0) {
              await setImmediate();
              continue;
            }
            if (size > MAX_CHUNK_BYTES) {
              throw new AdapterAttachmentError({
                code: "adapter-attachment-limit",
                message: "Attachment exceeds the 1 MiB chunk limit.",
              });
            }
            // One owned chunk at a time; no prefetch or retained chunk collection.
            const bytes = new Uint8Array(next.value);
            byteLength += size;
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
          if (closed)
            throw new AdapterAttachmentError({
              code: "adapter-attachment-closed",
              message: "Attachment collection is closed.",
            });
          const receipt = {
            artifactId,
            name: value.name,
            mediaType: value.mediaType,
            byteLength,
            sha256: hash.digest("hex"),
          };
          pendingItems.delete(controller);
          artifacts.push({ ...receipt, filePath });
          accepted = true;
          return receipt;
        } finally {
          if (!ended) {
            producerController.abort();
            // A non-cooperative producer must not hold our file or cleanup open.
            // Calling return requests release; the producer owns its external IO.
            try {
              void Promise.resolve(iterator?.return?.()).catch(() => undefined);
            } catch {
              /* preserve capture failure */
            }
          }
          try {
            await destination.close();
          } finally {
            if (!accepted) await rm(filePath, { force: true });
          }
        }
      },
      catch: markFailure,
    });
    // Waiting is interruptible. An active stream releases its slot only after file cleanup.
    const capture = streamSlots.withPermit(Effect.uninterruptible(operation));
    const promise = Effect.runPromise(Effect.result(capture), { signal })
      .catch((cause: unknown) => {
        throw markFailure(signal.aborted ? signal.reason : cause);
      })
      .then((result) => {
        if (Result.isFailure(result)) throw result.failure;
        return result.success;
      })
      .finally(() => {
        pending.delete(controller);
        pendingItems.delete(controller);
      });
    pending.set(controller, promise);
    void promise.catch(() => undefined);
    return promise;
  };

  const attach = (input: AdapterAttachmentInput): Promise<AdapterAttachmentReceipt> => {
    try {
      if (closed)
        throw new AdapterAttachmentError({
          code: "adapter-attachment-closed",
          message: "Attachment collection is closed.",
        });
      const decoded = decodeInput(input);
      if (Result.isFailure(decoded)) {
        throw new AdapterAttachmentError({
          code: "adapter-attachment-invalid",
          message: "Attachment requires a valid name, mediaType, and bytes, text, or stream body.",
        });
      }
      const value = decoded.success;
      value.signal?.throwIfAborted();
      if (typeof value.body === "object" && !(value.body instanceof Uint8Array)) {
        return captureStream({
          name: value.name,
          mediaType: value.mediaType,
          ...(value.signal === undefined ? {} : { signal: value.signal }),
          body: value.body,
        });
      }
      // This must happen before returning the Promise; caller mutation cannot race acceptance.
      const bytes = typeof value.body === "string" ? new TextEncoder().encode(value.body) : new Uint8Array(value.body);
      const receipt = {
        artifactId: `art_${randomBytes(10).toString("hex")}`,
        name: value.name,
        mediaType: value.mediaType,
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      artifacts.push({ ...receipt, bytes });
      return Promise.resolve(receipt);
    } catch (cause) {
      const rejection = Promise.reject<AdapterAttachmentReceipt>(markFailure(cause));
      // Ignoring an attach Promise still records a sticky failure without an unhandled rejection.
      void rejection.catch(() => undefined);
      return rejection;
    }
  };

  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> =>
    (disposal ??= (async () => {
      closed = true;
      for (const controller of pendingItems) controller.abort();
      await Promise.allSettled([...pending.values()]);
      if (directory !== undefined) {
        const root = await directory.catch(() => undefined);
        if (root !== undefined) await rm(root, { recursive: true, force: true });
      }
      artifacts.length = 0;
      sealed = undefined;
    })());

  return {
    attach,
    markFailure,
    failure: () => firstFailure,
    artifacts: () => [...artifacts],
    close: () => {
      if (closed) return;
      if (pendingItems.size > 0) {
        markFailure(
          new AdapterAttachmentError({
            code: "adapter-attachment-closed",
            message: "Attachment collection closed during stream capture.",
          }),
        );
      }
      closed = true;
      for (const controller of pendingItems) controller.abort();
      sealed = { artifacts: [...artifacts], failure: firstFailure, dispose };
    },
    dispose,
    snapshot: () => {
      if (sealed === undefined) throw new Error("Attachment collection must close before taking its snapshot.");
      return sealed;
    },
  };
}
