import { createHash, randomBytes } from "node:crypto";
import { Data, Result, Schema } from "effect";

import type { AdapterAttachmentInput, AdapterAttachmentReceipt } from "../adapter-attachments.ts";
import { RecordExactParseOptions } from "../record/codec/core.ts";
import { ArtifactsLimits } from "../record/family/artifacts/schema.ts";
import { MediaTypeSchema, SafeTextSchema } from "../record/family/common.ts";
import type { EvalResult } from "./types.ts";

export const AdapterAttachmentLimits = Object.freeze({
  maximumArtifacts: ArtifactsLimits.maximumArtifacts,
  maximumContentBytes: ArtifactsLimits.maximumContentBytes,
  maximumTotalBytes: 256 * 1024 * 1024,
});

export class AdapterAttachmentError extends Data.TaggedError("AdapterAttachmentError")<{
  readonly code: "adapter-attachment-invalid" | "adapter-attachment-limit" | "adapter-attachment-closed" | "adapter-attachment-failed";
  readonly message: string;
}> {}

export interface CapturedAdapterAttachment extends AdapterAttachmentReceipt {
  readonly bytes: Uint8Array;
}

export interface AdapterAttachmentSnapshot {
  readonly artifacts: readonly CapturedAdapterAttachment[];
  readonly failure: AdapterAttachmentError | undefined;
}

const captures = new WeakMap<EvalResult, AdapterAttachmentSnapshot>();
export function retainAdapterAttachments(result: EvalResult, snapshot: AdapterAttachmentSnapshot): void {
  captures.set(result, snapshot);
}
export function adapterAttachmentsForResult(result: EvalResult): AdapterAttachmentSnapshot | undefined {
  return captures.get(result);
}

export interface AdapterAttachmentCollector {
  readonly attach: (input: AdapterAttachmentInput) => Promise<AdapterAttachmentReceipt>;
  readonly markFailure: (cause: unknown) => AdapterAttachmentError;
  readonly failure: () => AdapterAttachmentError | undefined;
  readonly artifacts: () => readonly CapturedAdapterAttachment[];
  readonly close: () => void;
  readonly snapshot: () => AdapterAttachmentSnapshot;
}

const InputSchema = Schema.Struct({
  name: SafeTextSchema,
  mediaType: MediaTypeSchema,
  body: Schema.Union([Schema.String, Schema.Uint8Array]),
});
const decodeInput = Schema.decodeUnknownResult(InputSchema, RecordExactParseOptions);

/** The Attempt owner closes this collector only when its cleanup window ends. */
export function createAdapterAttachmentCollector(): AdapterAttachmentCollector {
  const artifacts: CapturedAdapterAttachment[] = [];
  let totalBytes = 0;
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

  const attach = (input: AdapterAttachmentInput): Promise<AdapterAttachmentReceipt> => {
    try {
      if (closed) throw new AdapterAttachmentError({ code: "adapter-attachment-closed", message: "Attachment collection is closed." });
      const decoded = decodeInput(input);
      if (Result.isFailure(decoded)) {
        throw new AdapterAttachmentError({ code: "adapter-attachment-invalid", message: "Attachment requires a valid name, mediaType, and string or Uint8Array body." });
      }
      const value = decoded.success;
      // Check the UTF-8 size before allocating an encoded copy of a large string.
      const byteLength = typeof value.body === "string" ? Buffer.byteLength(value.body, "utf8") : value.body.byteLength;
      if (byteLength > AdapterAttachmentLimits.maximumContentBytes ||
        totalBytes + byteLength > AdapterAttachmentLimits.maximumTotalBytes ||
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
      return Promise.resolve(receipt);
    } catch (cause) {
      const rejection = Promise.reject<AdapterAttachmentReceipt>(markFailure(cause));
      // Ignoring an attach Promise still records a sticky failure without an unhandled rejection.
      void rejection.catch(() => undefined);
      return rejection;
    }
  };

  return Object.freeze({
    attach,
    markFailure,
    failure: () => firstFailure,
    artifacts: () => Object.freeze([...artifacts]),
    close: () => {
      if (closed) return;
      closed = true;
      sealed = Object.freeze({ artifacts: Object.freeze([...artifacts]), failure: firstFailure });
    },
    snapshot: () => {
      if (sealed === undefined) throw new Error("Attachment collection must close before taking its snapshot.");
      return sealed;
    },
  });
}
