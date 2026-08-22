import type { RecordBlobRef } from "./blob-ref.ts";
import type { RecordAttachmentIssue } from "./errors.ts";

/** Static per-owner resource envelope for a fixed family closure. */
export interface RecordAttachmentBlobBudget {
  readonly maximumBlobs: number;
  readonly maximumBlobBytes: number;
  readonly maximumTotalBytes: number;
}

/** Bytes are exposed only to the sealed reader/writer materialization boundary. */
export interface RecordAttachmentMaterializedBlob {
  readonly ref: RecordBlobRef;
  readonly bytes: Uint8Array;
}

/** Family-owned relation checks over one exact materialized closure. */
export type RecordAttachmentMaterializedRefine<Payload> = (
  payload: Payload,
  blobs: readonly RecordAttachmentMaterializedBlob[],
) => readonly RecordAttachmentIssue[];

export type RecordAttachmentBlobRefs<Payload> = {
  bivarianceHack(payload: Payload): readonly RecordBlobRef[];
}["bivarianceHack"];
