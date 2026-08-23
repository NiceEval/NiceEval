import type {
  AttemptId,
  CanonicalRunRelativePath,
  RecordBlobKey,
  RecordId,
  RunId,
  Sha256Digest,
  SourceSegmentId,
} from "./identifiers.ts";

export const SEAL_MANIFEST_FORMAT = "niceeval.seal-manifest" as const;
export const PUBLISH_RECOVERY_FORMAT = "niceeval.publish-recovery" as const;

/** The complete closed family catalog understood by the source-first format. */
export const FIXED_RECORD_FAMILIES = Object.freeze([
  "niceeval.assertions",
  "niceeval.agent-turns",
  "niceeval.turn-contexts",
  "niceeval.sandbox-commands",
  "niceeval.runner-activities",
  "niceeval.runner-diagnostics",
  "niceeval.file-changes",
  "niceeval.sources",
  "niceeval.artifacts",
] as const);

export type FixedRecordFamily = (typeof FIXED_RECORD_FAMILIES)[number];

/** The only durable Observability sources in the source-first format. */
export const OBSERVABILITY_SOURCE_FAMILIES = Object.freeze([
  "niceeval.agent-turns",
  "niceeval.turn-contexts",
  "niceeval.sandbox-commands",
  "niceeval.runner-activities",
  "niceeval.runner-diagnostics",
] as const);

export type ObservabilitySourceFamily =
  (typeof OBSERVABILITY_SOURCE_FAMILIES)[number];

export interface RecordByteIdentity {
  readonly byteLength: number;
  readonly sha256: Sha256Digest;
}

export type SealManifestEntryKind =
  | "core"
  | "attachment-envelope"
  | "payload"
  | "blob";

/** One portable file in the sealed Run, excluding the manifest and `complete`. */
export interface SealManifestEntry extends RecordByteIdentity {
  readonly kind: SealManifestEntryKind;
  readonly path: CanonicalRunRelativePath;
  readonly owner: "run" | AttemptId;
  readonly family: FixedRecordFamily | null;
}

export type SourceReceiptManifestOwner =
  | { readonly kind: "run" }
  | { readonly kind: "attempt"; readonly attemptId: AttemptId };

export interface SourceReceiptSegmentIdentity {
  readonly sequence: number;
  readonly segmentId: SourceSegmentId;
}

export interface SourceReceiptBlobIdentity extends RecordByteIdentity {
  readonly key: RecordBlobKey;
}

/** Source-local identity and closure proof mirrored from one source payload. */
export interface SourceReceiptManifestEntry {
  readonly owner: SourceReceiptManifestOwner;
  readonly family: ObservabilitySourceFamily;
  readonly schemaVersion: number;
  readonly payload: RecordByteIdentity;
  readonly segments: readonly SourceReceiptSegmentIdentity[];
  readonly blobs: readonly SourceReceiptBlobIdentity[];
}

/** Canonical publication proof for one immutable Run directory. */
export interface SealManifestDocument {
  readonly format: typeof SEAL_MANIFEST_FORMAT;
  readonly runId: RunId;
  readonly entries: readonly SealManifestEntry[];
  readonly sources: readonly SourceReceiptManifestEntry[];
}

/**
 * Local, non-portable recovery state. Host paths are stored only in the
 * Git-excluded sidecar and are re-derived and compared before any retry.
 */
export interface RecordPublishRecoveryDocument {
  readonly format: typeof PUBLISH_RECOVERY_FORMAT;
  readonly version: 1;
  readonly recordId: RecordId;
  readonly runId: RunId;
  readonly stagingPath: string;
  readonly destinationPath: string;
  readonly sealManifestSha256: Sha256Digest;
  readonly inventory: readonly SealManifestEntry[];
}
