import type { Effect } from "effect";
import type {
  RecordAttachmentBlobs,
  RecordAttachmentPayloadSnapshot,
  RecordAttachmentWrite,
} from "../attachment/types.ts";
import type {
  AssertionsAttachment,
} from "../family/assertions.ts";
import type {
  ArtifactsAttachment,
} from "../family/artifacts.ts";
import type {
  FileChangesAttachment,
} from "../family/file-changes.ts";
import type {
  AttemptObservabilityAttachment,
  RunObservabilityAttachment,
} from "../family/observability.ts";
import type {
  SourcesAttachment,
} from "../family/sources.ts";
import type {
  SourceNavigationAttachment,
} from "../family/source-navigation.ts";
import type {
  AttemptDocument,
  MemberDocument,
  RecordSlotIdentity,
  RunDocument,
} from "../model/core.ts";
import type { RunContext } from "../model/run-context.ts";
import type {
  AttemptId,
  ExperimentId,
  RunId,
  SlotId,
  UtcMillis,
} from "../model/identifiers.ts";
import type { RecordRoot } from "../platform/root.ts";
import type { RecordBackupState } from "../platform/services.ts";
import type { RecordCoreRead, RecordWarning } from "../model/read-state.ts";
import type { NonEmptyRecordIssues } from "../errors/record-errors.ts";
import type {
  RecordMaintenanceError,
  RecordMaintenanceOpenError,
  RecordReaderOpenError,
  RecordReaderReadError,
} from "../reader/errors.ts";
import type { RecordWriteError } from "../writer/types.ts";

export const selectedRunRefBrand: unique symbol = Symbol(
  "@niceeval/record/SelectedRunRef",
);
export const selectedAttemptRefBrand: unique symbol = Symbol(
  "@niceeval/record/SelectedAttemptRef",
);
export const selectedOwnerRefBrand: unique symbol = Symbol(
  "@niceeval/record/SelectedOwnerRef",
);
export const runWriteSessionBrand: unique symbol = Symbol(
  "@niceeval/record/RunWriteSession",
);
export const attemptWriteSessionBrand: unique symbol = Symbol(
  "@niceeval/record/AttemptWriteSession",
);

/** Nominal ref issued only by one live RecordReadSession. */
export interface SelectedRunRef {
  readonly runId: RunId;
  readonly [selectedRunRefBrand]: () => void;
}

/** Nominal exact reference to one immutable origin Attempt. */
export interface SelectedAttemptRef {
  readonly originRunId: RunId;
  readonly attemptId: AttemptId;
  readonly [selectedAttemptRefBrand]: () => void;
}

/** Owner handle for a later lazy fixed-family read. */
export interface SelectedOwnerRef {
  readonly [selectedOwnerRefBrand]: () => void;
}

/**
 * The Host exposes the fixed-family states without importing maintenance.
 * A reachable older version is migration-required. Any other well-formed,
 * non-current version remains unsupported data; malformed envelopes and
 * closures are invalid, never a reader-wide failure.
 */
export type FixedFamilyRead<Payload> =
  | {
      readonly state: "migration-required";
      readonly family: string;
      readonly fromSchemaVersion: number;
      readonly toSchemaVersion: number;
      readonly command: "niceeval migrate";
    }
  | {
      readonly state: "available";
      /** Direct business fields from the current owner value definition. */
      readonly value: RecordAttachmentPayloadSnapshot<Payload>;
      /** Owner-local blob closure for refs found inside `value`. */
      readonly blobs: RecordAttachmentBlobs;
    }
  | { readonly state: "not-recorded" }
  | { readonly state: "unsupported"; readonly family: string; readonly schemaVersion: number }
  | { readonly state: "invalid"; readonly issues: NonEmptyRecordIssues };

/**
 * These aliases are deliberately owner- and method-specific. Runtime checks
 * additionally require the one installed static descriptor for each method,
 * so a caller cannot introduce another family through this boundary.
 */
export type SourcesWrite<E = never, R = never> = RecordAttachmentWrite<
  "run",
  E,
  R
>;
export type RunObservabilityWrite<E = never, R = never> = RecordAttachmentWrite<
  "run",
  E,
  R
>;
export type RunArtifactsWrite<E = never, R = never> = RecordAttachmentWrite<
  "run",
  E,
  R
>;
export type AssertionsWrite<E = never, R = never> = RecordAttachmentWrite<
  "attempt",
  E,
  R
>;
export type AttemptObservabilityWrite<E = never, R = never> = RecordAttachmentWrite<
  "attempt",
  E,
  R
>;
export type FileChangesWrite<E = never, R = never> = RecordAttachmentWrite<
  "attempt",
  E,
  R
>;
export type SourceNavigationWrite<E = never, R = never> = RecordAttachmentWrite<
  "attempt",
  E,
  R
>;
export type AttemptArtifactsWrite<E = never, R = never> = RecordAttachmentWrite<
  "attempt",
  E,
  R
>;

export type RecordSelectionProblem =
  | {
      readonly code: "incomplete-run";
      readonly runId: RunId;
    }
  | {
      readonly code: "record-core-invalid";
      readonly runId: RunId;
    }
  | {
      readonly code: "selection-run-missing";
      readonly runId: RunId;
    };

export interface RecordSelectionRequest {
  /** Omitted means every Run whose complete marker existed during this scan. */
  readonly runIds?: readonly RunId[];
}

/**
 * Closed Run facts verified by scanSelection. They retain the denominator
 * frame if a later member read becomes unavailable; they are not a durable
 * schema and contain no owner capability.
 */
export interface SelectedRunFacts {
  readonly run: SelectedRunRef;
  readonly experimentId: ExperimentId;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly RecordSlotIdentity[];
}

/** A closed candidate set with only selected minimal Core; never Attachment payloads. */
export interface RecordSelection {
  readonly runRefs: readonly SelectedRunRef[];
  readonly runFacts: readonly SelectedRunFacts[];
  readonly expectedSlots: readonly {
    readonly run: SelectedRunRef;
    /** Closed at scan time from the selected Run, not stored in RecordSlotIdentity. */
    readonly experimentId: ExperimentId;
    readonly slot: RecordSlotIdentity;
  }[];
  readonly problems: readonly RecordSelectionProblem[];
  readonly warnings: readonly RecordWarning[];
}

export interface ReadableRun {
  readonly ref: SelectedRunRef;
  readonly owner: SelectedOwnerRef;
  readonly document: RunDocument;
  readonly members: readonly {
    readonly document: MemberDocument;
    readonly attempt: SelectedAttemptRef | null;
  }[];
}

export interface ReadableAttempt {
  readonly ref: SelectedAttemptRef;
  readonly owner: SelectedOwnerRef;
  readonly document: AttemptDocument;
  /**
   * Verified while resolving the exact nominal Attempt reference. It is the
   * only origin Run Core projection Sample may use. In particular, a carried
   * or accepted member must retain this origin's execution facts rather than
   * substituting the selected target Run.
   */
  readonly origin: {
    readonly owner: SelectedOwnerRef;
    readonly runId: RunId;
    readonly experimentId: ExperimentId;
    readonly startedAt: UtcMillis;
    readonly context: RunContext;
  };
}

export interface RecordReadSession {
  readonly selectRuns: (
    request?: RecordSelectionRequest,
  ) => Effect.Effect<RecordSelection, RecordReaderReadError>;
  readonly readRun: (
    ref: SelectedRunRef,
  ) => Effect.Effect<RecordCoreRead<ReadableRun>, RecordReaderReadError>;
  readonly readAttempt: (
    ref: SelectedAttemptRef,
  ) => Effect.Effect<RecordCoreRead<ReadableAttempt>, RecordReaderReadError>;
  readonly readAssertions: (
    owner: SelectedOwnerRef,
  ) => Effect.Effect<FixedFamilyRead<AssertionsAttachment>, RecordReaderReadError>;
  readonly readAttemptObservability: (
    owner: SelectedOwnerRef,
  ) => Effect.Effect<
    FixedFamilyRead<AttemptObservabilityAttachment>,
    RecordReaderReadError
  >;
  readonly readFileChanges: (
    owner: SelectedOwnerRef,
  ) => Effect.Effect<FixedFamilyRead<FileChangesAttachment>, RecordReaderReadError>;
  readonly readSourceNavigation: (
    owner: SelectedOwnerRef,
  ) => Effect.Effect<FixedFamilyRead<SourceNavigationAttachment>, RecordReaderReadError>;
  readonly readAttemptArtifacts: (
    owner: SelectedOwnerRef,
  ) => Effect.Effect<FixedFamilyRead<ArtifactsAttachment>, RecordReaderReadError>;
  readonly readSources: (
    owner: SelectedOwnerRef,
  ) => Effect.Effect<FixedFamilyRead<SourcesAttachment>, RecordReaderReadError>;
  readonly readRunObservability: (
    owner: SelectedOwnerRef,
  ) => Effect.Effect<
    FixedFamilyRead<RunObservabilityAttachment>,
    RecordReaderReadError
  >;
  readonly readRunArtifacts: (
    owner: SelectedOwnerRef,
  ) => Effect.Effect<FixedFamilyRead<ArtifactsAttachment>, RecordReaderReadError>;
}

export interface CreateRunRequest {
  readonly root: RecordRoot;
  readonly experimentId: ExperimentId;
  /** Required historical interpretation facts, written once into `run.json`. */
  readonly context: RunContext;
  readonly startedAt: UtcMillis;
  readonly expectedSlots: readonly RecordSlotIdentity[];
}

export interface CreateReferenceRunRequest extends CreateRunRequest {}

export interface RunCompletion {
  readonly completedAt: UtcMillis;
}

export interface RecordSealReceipt {
  readonly runId: RunId;
  readonly state: "sealed";
}

export interface AttemptWriteSession {
  readonly attemptId: AttemptId;
  readonly slotId: SlotId;
  readonly [attemptWriteSessionBrand]: () => void;
  readonly complete: (
    outcome: AttemptDocument["outcome"],
  ) => Effect.Effect<void, RecordWriteError>;
  readonly writeAssertions: <E, R>(
    value: AssertionsWrite<E, R>,
  ) => Effect.Effect<void, RecordWriteError | E, R>;
  readonly writeAttemptObservability: <E, R>(
    value: AttemptObservabilityWrite<E, R>,
  ) => Effect.Effect<void, RecordWriteError | E, R>;
  readonly writeFileChanges: <E, R>(
    value: FileChangesWrite<E, R>,
  ) => Effect.Effect<void, RecordWriteError | E, R>;
  readonly writeSourceNavigation: <E, R>(
    value: SourceNavigationWrite<E, R>,
  ) => Effect.Effect<void, RecordWriteError | E, R>;
  readonly writeAttemptArtifacts: <E, R>(
    value: AttemptArtifactsWrite<E, R>,
  ) => Effect.Effect<void, RecordWriteError | E, R>;
}

/** One session owns exactly one freshly exclusive RunId directory. */
export interface RunWriteSession {
  readonly runId: RunId;
  readonly [runWriteSessionBrand]: () => void;
  readonly createAttempt: (input: {
    readonly slotId: SlotId;
  }) => Effect.Effect<AttemptWriteSession, RecordWriteError>;
  readonly referenceAttempt: (input: {
    readonly slotId: SlotId;
    readonly action: "carried" | "accepted";
    readonly attempt: SelectedAttemptRef;
  }) => Effect.Effect<void, RecordWriteError>;
  /**
   * Explicit adoption / rename: occupy one current target Slot with an already
   * selected origin Attempt. The target Slot identity may differ from the
   * origin Attempt. This is not a generic Attachment writer.
   */
  readonly recordAcceptedMembership: (input: {
    readonly slotId: SlotId;
    readonly attempt: SelectedAttemptRef;
  }) => Effect.Effect<void, RecordWriteError>;
  readonly recordTerminalMember: (input: {
    readonly slotId: SlotId;
    readonly action: "not-dispatched" | "interrupted";
  }) => Effect.Effect<void, RecordWriteError>;
  readonly writeSources: <E, R>(
    value: SourcesWrite<E, R>,
  ) => Effect.Effect<void, RecordWriteError | E, R>;
  readonly writeRunObservability: <E, R>(
    value: RunObservabilityWrite<E, R>,
  ) => Effect.Effect<void, RecordWriteError | E, R>;
  readonly writeRunArtifacts: <E, R>(
    value: RunArtifactsWrite<E, R>,
  ) => Effect.Effect<void, RecordWriteError | E, R>;
  readonly seal: (
    completion: RunCompletion,
  ) => Effect.Effect<RecordSealReceipt, RecordWriteError>;
}

/** A Run created solely from already-selected, sealed Attempts. */
export interface ReferenceRunWriteSession {
  readonly runId: RunId;
  readonly [runWriteSessionBrand]: () => void;
  readonly referenceAttempt: RunWriteSession["referenceAttempt"];
  readonly recordAcceptedMembership: RunWriteSession["recordAcceptedMembership"];
  readonly recordTerminalMember: RunWriteSession["recordTerminalMember"];
  readonly writeRunObservability: RunWriteSession["writeRunObservability"];
  readonly writeRunArtifacts: RunWriteSession["writeRunArtifacts"];
  readonly seal: RunWriteSession["seal"];
}

export type RecordFormatInspection =
  | { readonly state: "already-current"; readonly format: "niceeval.record" }
  | { readonly state: "migration-required"; readonly format: "niceeval.record" }
  | { readonly state: "unsupported-format"; readonly format: string };

export interface RecordAttachmentMigrationTarget {
  readonly family: string;
  readonly owner: "attempt" | "run";
  readonly runId: RunId;
  readonly attemptId?: AttemptId;
  readonly fromSchemaVersion: number;
  readonly toSchemaVersion: number;
}

export type RecordMigrationPlan =
  | {
      readonly state: "already-current";
      readonly format: "niceeval.record";
    }
  | {
      readonly state: "migration-required";
      readonly format: "niceeval.record";
      readonly backup: RecordBackupState;
      readonly root: {
        readonly fromSchemaVersion: number;
        readonly toSchemaVersion: number;
        readonly steps: readonly {
          readonly fromSchemaVersion: number;
          readonly toSchemaVersion: number;
        }[];
      } | null;
      readonly attachments: readonly RecordAttachmentMigrationTarget[];
    }
  | {
      readonly state: "unsupported-format";
      readonly format: string;
    };

export type RecordMigrationReceipt =
  | { readonly state: "already-current"; readonly format: "niceeval.record" }
  | {
      readonly state: "migrated";
      readonly format: "niceeval.record";
      readonly root: {
        readonly fromSchemaVersion: number;
        readonly toSchemaVersion: number;
        readonly steps: readonly {
          readonly fromSchemaVersion: number;
          readonly toSchemaVersion: number;
        }[];
      } | null;
      readonly attachments: readonly RecordAttachmentMigrationTarget[];
    };

export interface RecordMaintenanceSession {
  readonly inspect: () => Effect.Effect<RecordFormatInspection, RecordMaintenanceError>;
  readonly planMigrate: () => Effect.Effect<RecordMigrationPlan, RecordMaintenanceError>;
  readonly applyMigrate: (
    plan: RecordMigrationPlan,
  ) => Effect.Effect<RecordMigrationReceipt, RecordMaintenanceError>;
}

export interface RecordHostSDK {
  readonly current: {
    readonly openRead: (input: {
      readonly root: RecordRoot;
    }) => Effect.Effect<RecordReadSession, RecordReaderOpenError, import("effect").Scope.Scope | import("../platform/services.ts").RecordFileSystem | import("../../coordination/record-leases.ts").RecordCoordination>;
    readonly createRun: (
      request: CreateRunRequest,
    ) => Effect.Effect<RunWriteSession, RecordReaderOpenError | RecordWriteError, import("effect").Scope.Scope | import("../platform/services.ts").RecordFileSystem | import("../platform/services.ts").RecordEntropy | import("../../coordination/record-leases.ts").RecordCoordination>;
    readonly createReferenceRun: (
      request: CreateReferenceRunRequest,
    ) => Effect.Effect<ReferenceRunWriteSession, RecordReaderOpenError | RecordWriteError, import("effect").Scope.Scope | import("../platform/services.ts").RecordFileSystem | import("../platform/services.ts").RecordEntropy | import("../../coordination/record-leases.ts").RecordCoordination>;
  };
  readonly maintenance: {
    readonly open: (input: {
      readonly root: RecordRoot;
    }) => Effect.Effect<RecordMaintenanceSession, RecordMaintenanceOpenError, import("effect").Scope.Scope | import("../platform/services.ts").RecordFileSystem | import("../platform/services.ts").RecordGit | import("../../coordination/record-leases.ts").RecordCoordination>;
  };
}
