/**
 * Private bridge for the still-in-progress Record reader/writer integration.
 * It deliberately uses the real platform Root and FileSystem tag; it does not
 * introduce another platform service, path model, backup store, or compat
 * reader. Once the reader/writer exposes these operations directly, this file
 * can collapse into that implementation without changing the public plan API.
 */

import type { Effect } from "effect";
import type {
  RecordAttachmentFamily,
  RecordAttachmentMigrationEdge,
  RecordAttachmentMigrationResolution,
  RecordAttachmentValue,
  RecordAttachmentWrite,
} from "../attachment/types.ts";
import type {
  RecordAttachmentClosureInvalid,
  RecordAttachmentPayloadInvalid,
} from "../attachment/errors.ts";
import type { RecordCodecError } from "../errors/record-errors.ts";
import type { RecordAttachmentOwner } from "../model/core.ts";
import type {
  RecordAttachmentName,
  RecordAttachmentSchemaId,
  RecordFormatId,
} from "../model/identifiers.ts";
import type { RecordFileSystemError } from "../platform/errors.ts";
import type { RecordRoot } from "../platform/root.ts";
import type { RecordFileSystem, RecordPortablePath } from "../platform/services.ts";

/** A validated Attachment location; its directory remains root-relative. */
export interface RecordMigrationAttachmentSource {
  readonly directory: RecordPortablePath;
  readonly owner: RecordAttachmentOwner;
  readonly name: RecordAttachmentName;
  readonly schemaId: RecordAttachmentSchemaId;
}

/**
 * `fingerprint` is an adapter-owned source identity used only for stale-plan
 * revalidation. It is neither portable data nor a migration history record.
 */
export interface RecordMigrationSource<CoreValue> {
  readonly root: RecordRoot;
  readonly fingerprint: string;
  readonly core: {
    readonly format: RecordFormatId;
    readonly value: CoreValue;
  };
  readonly attachments: readonly RecordMigrationAttachmentSource[];
}

export type RecordMigrationStorageError =
  | RecordFileSystemError
  | RecordCodecError
  | RecordAttachmentPayloadInvalid
  | RecordAttachmentClosureInvalid;

/**
 * A current-layout adapter can decline a declared edge before sentinel
 * creation when the installed storage cannot materialize its historical
 * definition without inventing data. The generic seam remains available to a
 * future layout adapter that does have that exact historic decoder.
 */
export type RecordMigrationAttachmentReadiness =
  | { readonly state: "ready" }
  | { readonly state: "migration-unavailable"; readonly reason: string };

/**
 * The adapter owns exact source decode, closure materialization, owner/path
 * preservation and target file layout. Migration owns only ordering: every
 * target byte is synced before root `record.json`, which is written last.
 */
export interface RecordMigrationStorage<CoreValue> {
  readonly inspectSource: (input: {
    readonly root: RecordRoot;
    readonly attachments: import("../attachment/types.ts").RecordAttachmentRegistry;
  }) => Effect.Effect<
    RecordMigrationSource<CoreValue>,
    RecordMigrationStorageError,
    RecordFileSystem
  >;

  readonly isSourceCurrent: (
    source: RecordMigrationSource<CoreValue>,
  ) => Effect.Effect<boolean, RecordMigrationStorageError, RecordFileSystem>;

  /**
   * Optional because package-private synthetic adapters can already supply a
   * fully materialized historical value through `readAttachment`. Real layout
   * adapters use this preflight to refuse a path they cannot safely realize.
   */
  readonly preflightAttachmentMigration?: (input: {
    readonly source: RecordMigrationAttachmentSource;
    readonly family: RecordAttachmentFamily<RecordAttachmentOwner, unknown>;
    readonly resolution: Extract<
      RecordAttachmentMigrationResolution,
      { readonly state: "migration-required" }
    >;
  }) => Effect.Effect<
    RecordMigrationAttachmentReadiness,
    RecordMigrationStorageError,
    RecordFileSystem
  >;

  /** Writes/syncs converted Core documents, excluding root `record.json`. */
  readonly stageCore: (input: {
    readonly source: RecordMigrationSource<CoreValue>;
    readonly value: CoreValue;
  }) => Effect.Effect<void, RecordMigrationStorageError, RecordFileSystem>;

  /** Materializes a complete source value through the owning Attachment family. */
  readonly readAttachment: (input: {
    readonly source: RecordMigrationAttachmentSource;
    readonly family: RecordAttachmentFamily<RecordAttachmentOwner, unknown>;
  }) => Effect.Effect<
    RecordAttachmentValue<unknown>,
    RecordMigrationStorageError,
    RecordFileSystem
  >;

  /**
   * Delegates an opaque converter edge back to the Attachment runtime. Its
   * explicit failure is normalized by orchestration; defects/interruption pass
   * through unchanged.
   */
  readonly convertAttachment: (input: {
    readonly edge: RecordAttachmentMigrationEdge<RecordAttachmentOwner>;
    readonly source: RecordAttachmentValue<unknown>;
  }) => Effect.Effect<
    RecordAttachmentWrite<RecordAttachmentOwner, unknown, never>,
    unknown
  >;

  /** Writes/syncs the target closure and hydrates it for a following adjacent step. */
  readonly persistAttachment: (input: {
    readonly source: RecordMigrationAttachmentSource;
    /** Final Core lets the adapter preserve target owner/directory semantics. */
    readonly targetCore: CoreValue;
    readonly edge: RecordAttachmentMigrationEdge<RecordAttachmentOwner>;
    readonly write: RecordAttachmentWrite<RecordAttachmentOwner, unknown, never>;
  }) => Effect.Effect<
    RecordAttachmentValue<unknown>,
    RecordMigrationStorageError,
    RecordFileSystem
  >;

  /** Keeps exact old bytes for current, unavailable, and unknown Attachments. */
  readonly preserveAttachment: (input: {
    readonly source: RecordMigrationAttachmentSource;
    /** Unknown and unavailable bytes follow the converted Core's target layout. */
    readonly targetCore: CoreValue;
  }) => Effect.Effect<void, RecordMigrationStorageError, RecordFileSystem>;

  /** Writes/syncs the target root `record.json` after all other portable bytes. */
  readonly writeRecordDocumentLast: (input: {
    readonly source: RecordMigrationSource<CoreValue>;
    readonly value: CoreValue;
  }) => Effect.Effect<void, RecordMigrationStorageError, RecordFileSystem>;
}
