import type {
  AttemptId,
  CanonicalRunRelativePath,
  RecordId,
  RunId,
  Sha256Digest,
} from "./identifiers.ts";
import { NICE_EVAL_FAMILIES } from "../family/catalog.ts";

export const SEAL_MANIFEST_FORMAT = "niceeval.seal-manifest" as const;
export const PUBLISH_RECOVERY_FORMAT = "niceeval.publish-recovery" as const;

/** Compatibility alias derived from the official branded definition catalog. */
export const FIXED_RECORD_FAMILIES = NICE_EVAL_FAMILIES;

export type FixedRecordFamily = (typeof FIXED_RECORD_FAMILIES)[number];

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
  /** Any family identity accepted by the generic Attachment SPI. */
  readonly family: string | null;
}

/** Canonical publication proof for one immutable Run directory. */
export interface SealManifestDocument {
  readonly format: typeof SEAL_MANIFEST_FORMAT;
  readonly runId: RunId;
  readonly entries: readonly SealManifestEntry[];
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
