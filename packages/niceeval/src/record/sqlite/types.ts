export const RECORD_SQLITE_FORMAT = "niceeval.project-database/0.14";
export const RECORD_SQLITE_STORAGE_REVISION = 1;
export const RECORD_SQLITE_CHUNK_BYTES = 256 * 1024;
export const RECORD_SQLITE_MAX_PUBLISH_ROWS = 4_096;
export const RECORD_SQLITE_MAX_PUBLISH_BYTES = 8 * 1024 * 1024;
export const RECORD_SQLITE_MAX_ROW_BYTES = 1024 * 1024;
export const RECORD_SQLITE_MAX_PAGE_ROWS = 64;
export const RECORD_SQLITE_MAX_PAGE_BYTES = 4 * 1024 * 1024;
export const RECORD_SQLITE_MAX_VALIDATION_RUNS = 100_000;
export const RECORD_SQLITE_MAX_VALIDATION_ROWS = 2_000_000;
export const RECORD_SQLITE_VALIDATION_DEADLINE_MS = 30_000;

export type RunStatus = "open" | "sealing" | "sealed";
export type RecordOwnerKind = import("../model/core.ts").RecordAttachmentOwner;
export type SealEntryKind =
  | "record"
  | "run"
  | "slot"
  | "member"
  | "attempt"
  | "attachment"
  | "attachment-reference"
  | "collection-item"
  | "content"
  | "content-chunk";

export interface PersistedSlot {
  readonly slotId: string;
  readonly ordinal: number;
  readonly coreBytes: Uint8Array;
  readonly coreDigest: string;
}

export interface PersistedAttempt {
  readonly attemptId: string;
  /** Canonical, persisted 60-bit locator projection. It is intentionally non-unique. */
  readonly attemptLocator: string;
  readonly coreBytes: Uint8Array;
  readonly coreDigest: string;
  readonly publicationIdentity?: {
    readonly originRunId: string;
    readonly attemptId: string;
    readonly revision: number;
  };
}

export interface PersistedMember {
  readonly slotId: string;
  readonly originRunId?: string;
  readonly attemptId?: string;
  readonly action: "executed" | "carried" | "accepted" | "not-dispatched" | "interrupted";
  readonly coreBytes: Uint8Array;
  readonly coreDigest: string;
  readonly publicationIdentity?: {
    readonly originRunId: string;
    readonly attemptId: string;
    readonly revision: number;
  };
}

export interface PersistedAttachmentReference {
  readonly ordinal: number;
  readonly owner: RecordOwnerKind;
  readonly family: string;
  readonly canonicalBytes: Uint8Array;
  readonly referenceDigest: string;
}

export interface PersistedCollectionItem {
  readonly ordinal: number;
  readonly logicalIdentity: string;
  readonly canonicalBytes: Uint8Array;
  readonly canonicalDigest: string;
}

export interface PersistedContentChunk {
  readonly ordinal: number;
  readonly bytes: Uint8Array;
  readonly chunkDigest: string;
}

export interface PersistedContent {
  readonly contentId: string;
  readonly logicalHandle: string;
  readonly byteLength: number;
  readonly digest: string;
  readonly chunks: readonly PersistedContentChunk[];
}

export interface PersistedAttachment {
  readonly attachmentId: string;
  readonly ownerKind: RecordOwnerKind;
  readonly ownerRunId: string;
  readonly ownerAttemptId?: string;
  readonly family: string;
  readonly familyRevision: number;
  readonly logicalIdentity: string;
  readonly canonicalBytes: Uint8Array;
  readonly canonicalDigest: string;
  readonly logicalInventoryBytes: Uint8Array;
  readonly inventoryDigest: string;
  readonly references: readonly PersistedAttachmentReference[];
  readonly collectionItems: readonly PersistedCollectionItem[];
  readonly contents: readonly PersistedContent[];
}

/** Frozen physical input accepted by the Record Host's finalizer. */
export interface PersistSealedRunInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly startedAt: string;
  /** Canonical root RecordDocument bytes (`format` and `recordId`). */
  readonly recordCoreBytes: Uint8Array;
  readonly recordCoreDigest: string;
  /** Canonical RunDocument bytes only; never an aggregate Record envelope. */
  readonly runCoreBytes: Uint8Array;
  readonly runCoreDigest: string;
  readonly expectedLogicalSealIdentity?: string;
  readonly slots: readonly PersistedSlot[];
  readonly attempts: readonly PersistedAttempt[];
  readonly members: readonly PersistedMember[];
  readonly attachments: readonly PersistedAttachment[];
  readonly deadlineEpochMs: number;
}

export interface SealEntry {
  readonly kind: SealEntryKind;
  readonly logicalIdentity: string;
  readonly digest: string;
}

export interface SealedRunSummary {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly startedAt: string;
  readonly logicalSealIdentity: string;
  readonly slotCount: number;
  readonly memberCount: number;
  readonly attemptCount: number;
  readonly attachmentCount: number;
  readonly contentCount: number;
  readonly contentByteLength: number;
  readonly sealEntryCount: number;
}

export interface SealedRunCutoff {
  /** Hash of the ordered (RunId, logical Seal identity) pairs in the pinned generation. */
  readonly identity: string;
  readonly runCount: number;
}

export interface SealedRunSummaryPage {
  readonly cutoff: SealedRunCutoff;
  readonly afterRunId: string;
  readonly summaries: readonly SealedRunSummary[];
  readonly nextAfterRunId: string | null;
}

export interface AttemptLocatorCandidateRun {
  readonly locator: string;
  readonly originRunId: string;
  readonly attemptId: string;
  readonly relation: "origin" | "target";
  readonly runId: string;
}

export interface AttemptLocatorCandidates {
  readonly locator: string;
  /** True when the non-unique locator names more than one exact Attempt identity. */
  readonly ambiguous: boolean;
  readonly candidates: readonly AttemptLocatorCandidateRun[];
}

export interface ContentChunkPage {
  readonly contentId: string;
  readonly afterOrdinal: number;
  readonly chunks: readonly PersistedContentChunk[];
  readonly nextOrdinal: number | null;
}

export interface CollectionItemPage {
  readonly attachmentId: string;
  readonly afterOrdinal: number;
  readonly items: readonly PersistedCollectionItem[];
  readonly nextOrdinal: number | null;
}

export interface AppendContentChunksInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly contentId: string;
  readonly chunks: readonly PersistedContentChunk[];
  readonly deadlineEpochMs: number;
}

export interface StageRunCoreInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly startedAt: string;
  readonly recordCoreBytes: Uint8Array;
  readonly recordCoreDigest: string;
  readonly runCoreBytes: Uint8Array;
  readonly runCoreDigest: string;
  readonly slots: readonly PersistedSlot[];
  readonly attempts: readonly PersistedAttempt[];
  readonly members: readonly PersistedMember[];
  readonly attachments: readonly FinalizedAttachmentClosure[];
  readonly deadlineEpochMs: number;
}

export type FinalizeRunInput = StageRunCoreInput;

export interface BeginRunInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly startedAt: string;
  readonly deadlineEpochMs: number;
}

export interface AdmitAttemptInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly attemptId: string;
  readonly attemptLocator: string;
  readonly deadlineEpochMs: number;
}

export interface DiscardAttemptInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly attemptId: string;
  readonly deadlineEpochMs: number;
}

export interface AdmitAttachmentInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly attachmentId: string;
  readonly ownerKind: RecordOwnerKind;
  readonly ownerRunId: string;
  readonly ownerAttemptId?: string;
  readonly family: string;
  readonly familyRevision: number;
  readonly deadlineEpochMs: number;
}

export interface AdmitContentInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly attachmentId: string;
  readonly contentId: string;
  readonly logicalHandle: string;
  readonly deadlineEpochMs: number;
}

export interface FinalizedAttachmentMetadata {
  readonly attachmentId: string;
  readonly logicalIdentity: string;
  readonly canonicalBytes: Uint8Array;
  readonly canonicalDigest: string;
  readonly logicalInventoryBytes: Uint8Array;
  readonly inventoryDigest: string;
  readonly contents: readonly PersistedContentMetadata[];
}

export interface FinalizedAttachmentClosure extends FinalizedAttachmentMetadata {
  readonly ownerKind: RecordOwnerKind;
  readonly ownerRunId: string;
  readonly ownerAttemptId?: string;
  readonly family: string;
  readonly familyRevision: number;
}

export interface RunFinalization {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly logicalSealIdentity: string;
  readonly sealEntryCount: number;
}

export interface PreparedRunFinalization extends RunFinalization {
  readonly mutationSequence: number;
}

export interface PrepareRunFinalizationInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly deadlineEpochMs: number;
}

export interface FenceRunFinalizationInput extends PrepareRunFinalizationInput {
  readonly mutationSequence: number;
  readonly expectedLogicalSealIdentity: string;
  readonly expectedSealEntryCount: number;
}

export interface StageAttachmentInput {
  readonly runId: string;
  readonly attachment: Omit<PersistedAttachment, "references" | "collectionItems" | "contents"> & {
    readonly contents: readonly PersistedContentMetadata[];
  };
  readonly deadlineEpochMs: number;
}

export interface StageAttachmentReferencesInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly attachmentId: string;
  readonly references: readonly PersistedAttachmentReference[];
  readonly deadlineEpochMs: number;
}

export interface StageCollectionItemsInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly attachmentId: string;
  readonly items: readonly PersistedCollectionItem[];
  readonly deadlineEpochMs: number;
}

export interface SealRunInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly expectedLogicalSealIdentity: string;
  readonly deadlineEpochMs: number;
}

export interface StageSealEntriesInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly expectedLogicalSealIdentity: string;
  readonly startOrdinal: number;
  readonly maximumRows: number;
  readonly deadlineEpochMs: number;
}

export interface StageSealEntriesResult {
  readonly nextOrdinal: number | null;
  readonly stagedCount: number;
}

/** Internal receipt for the storage worker's private generation primitive. */

export interface PersistedContentMetadata {
  readonly contentId: string;
  readonly logicalHandle: string;
  readonly byteLength: number;
  readonly digest: string;
  readonly chunkCount: number;
}

export interface SealedAttachmentDocument {
  readonly attachmentId: string;
  readonly ownerKind: RecordOwnerKind;
  readonly ownerRunId: string;
  readonly ownerAttemptId?: string;
  readonly family: string;
  readonly familyRevision: number;
  readonly logicalIdentity: string;
  readonly canonicalBytes: Uint8Array;
  readonly canonicalDigest: string;
  readonly logicalInventoryBytes: Uint8Array;
  readonly inventoryDigest: string;
  readonly references: readonly PersistedAttachmentReference[];
  readonly collectionItems: readonly PersistedCollectionItem[];
  readonly contents: readonly PersistedContentMetadata[];
}

export interface SealedAttachmentMetadata extends Omit<SealedAttachmentDocument, "collectionItems"> {
  readonly collectionItemCount: number;
  readonly collectionItemByteLength: number;
}

export interface SealedRunCore {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly startedAt: string;
  readonly logicalSealIdentity: string;
  readonly publicationManaged?: boolean;
  readonly recordCoreBytes: Uint8Array;
  readonly recordCoreDigest: string;
  readonly runCoreBytes: Uint8Array;
  readonly runCoreDigest: string;
  readonly slots: readonly PersistedSlot[];
  readonly attempts: readonly PersistedAttempt[];
  readonly members: readonly PersistedMember[];
  readonly attachments: readonly SealedAttachmentMetadata[];
}

/** One immutable Record read owns publication visibility, closure, and its derived overview. */
export interface PublishedSealedRun {
  readonly core: SealedRunCore;
  readonly summary: SealedRunSummary;
}

export interface SealedRunDocument {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly startedAt: string;
  readonly logicalSealIdentity: string;
  readonly recordCoreBytes: Uint8Array;
  readonly recordCoreDigest: string;
  readonly runCoreBytes: Uint8Array;
  readonly runCoreDigest: string;
  readonly slots: readonly PersistedSlot[];
  readonly attempts: readonly PersistedAttempt[];
  readonly members: readonly PersistedMember[];
  readonly attachments: readonly SealedAttachmentDocument[];
}
