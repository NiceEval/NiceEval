import type { Effect, Schema, Stream } from "effect";
import type {
  RecordAttachmentCatalog,
  RecordAttachmentDefinition,
} from "../attachment/index.ts";
import type {
  RecordContentHandle,
  RecordTextContentHandle,
} from "../attachment/content.ts";
import type {
  AttachedContentError,
  AttachedContentRequirements,
  RecordAttachmentSessionBuilder,
} from "../writer/current-attachment.ts";
import type {
  AttemptDocument,
  MemberDocument,
  RecordAttachmentOwner,
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
import type { RecordCoreRead, RecordWarning } from "../model/read-state.ts";
import type { NonEmptyRecordIssues } from "../errors/record-errors.ts";
import type {
  RecordMaintenanceError,
  RecordMaintenanceOpenError,
  RecordCompletenessError,
  RecordReaderOpenError,
  RecordReaderReadError,
} from "../reader/errors.ts";
import type { RecordWriteError } from "../writer/types.ts";
import type { RecordFileSystemError } from "../platform/errors.ts";
import type {
  AnyRecordDefinition,
  AttemptRecordAppendCommand,
  AttemptRecordAppendReceipt,
  AttemptRecordCollectionLimitation,
  AttemptRecordCollectionDefinition,
  RecordDefinitionValue,
  RecordWriteCommand,
} from "../authoring.ts";

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

type AnyDefinition<Owner extends RecordAttachmentOwner = RecordAttachmentOwner> =
  RecordAttachmentDefinition<Owner, string, Schema.Schema.AnyNoContext>;
type DefinitionValue<Definition extends AnyDefinition> =
  Schema.Schema.Type<Definition["schema"]>;

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

/** Owner handle for a later catalog-authorized Attachment read. */
export interface SelectedOwnerRef<out Owner extends "run" | "attempt" = "run" | "attempt"> {
  readonly [selectedOwnerRefBrand]: () => void;
  /** Nominal type witness only; the actual owner identity stays Host-private. */
  readonly __owner?: () => Owner;
}

/**
 * The Host exposes current Attachment states without importing maintenance.
 * A reachable older revision is migration-required. Any other well-formed,
 * non-current revision remains unsupported data; malformed envelopes and
 * closures are invalid, never a reader-wide failure.
 */
export interface RecordAttachmentContentReader {
  /** Exact persisted byte length without loading Content bytes. */
  readonly byteLength: (
    handle: RecordContentHandle,
  ) => Effect.Effect<number, RecordReaderReadError>;
  readonly bytes: (
    handle: RecordContentHandle,
  ) => Effect.Effect<Uint8Array, RecordReaderReadError>;
  readonly text: (
    handle: RecordTextContentHandle,
  ) => Effect.Effect<string, RecordReaderReadError>;
  readonly stream: (
    handle: RecordContentHandle,
  ) => Stream.Stream<Uint8Array, RecordReaderReadError>;
}

export type RecordAttachmentRead<Payload> =
  | {
      readonly state: "migration-required";
      readonly family: string;
      readonly fromRevision: number;
      readonly toRevision: number;
      readonly command: "niceeval migrate";
    }
  | {
      readonly state: "available";
      /** Direct business fields from the current owner value definition. */
      readonly value: Payload;
      /** Scope-owned logical content consumption; it exposes no path or pointer. */
      readonly content: RecordAttachmentContentReader;
    }
  | { readonly state: "not-recorded" }
  | { readonly state: "unsupported"; readonly family: string; readonly revision: number }
  | { readonly state: "invalid"; readonly issues: NonEmptyRecordIssues };

type AttemptRecordCollectionRead<Payload> =
  | Exclude<RecordAttachmentRead<Payload>, { readonly state: "available" }>
  | { readonly state: "available"; readonly value: Payload };

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
  readonly owner: SelectedOwnerRef<"run">;
  readonly document: RunDocument;
  readonly members: readonly {
    readonly document: MemberDocument;
    readonly attempt: SelectedAttemptRef | null;
  }[];
}

export interface ReadableAttempt {
  readonly ref: SelectedAttemptRef;
  readonly owner: SelectedOwnerRef<"attempt">;
  readonly document: AttemptDocument;
  /**
   * Verified while resolving the exact nominal Attempt reference. It is the
   * only origin Run Core projection Sample may use. In particular, a carried
   * or accepted member must retain this origin's execution facts rather than
   * substituting the selected target Run.
   */
  readonly origin: {
    readonly owner: SelectedOwnerRef<"run">;
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
  readonly read: {
    <
      Definition extends AttemptRecordCollectionDefinition<
        string,
        Schema.Schema.AnyNoContext
      >,
    >(
      owner: SelectedOwnerRef<"attempt">,
      definition: Definition,
    ): Effect.Effect<
      AttemptRecordCollectionRead<Schema.Schema.Type<Definition["schema"]>>,
      RecordReaderReadError
    >;
    <
      Owner extends "run" | "attempt",
      Definition extends AnyRecordDefinition<Owner>,
    >(
      owner: SelectedOwnerRef<Owner>,
      definition: Definition,
    ): Effect.Effect<
      RecordAttachmentRead<RecordDefinitionValue<Definition>>,
      RecordReaderReadError
    >;
    <
    Owner extends "run" | "attempt",
    Definition extends AnyDefinition<Owner>,
    >(
      owner: SelectedOwnerRef<Owner>,
      definition: Definition,
    ): Effect.Effect<
      RecordAttachmentRead<DefinitionValue<Definition>>,
      RecordReaderReadError
    >;
  };
  readonly openCollection: <
    Definition extends AttemptRecordCollectionDefinition<
      string,
      Schema.Schema.AnyNoContext
    >,
  >(
    owner: SelectedOwnerRef<"attempt">,
    definition: Definition,
  ) => Effect.Effect<
    | Exclude<
        AttemptRecordCollectionRead<Schema.Schema.Type<Definition["schema"]>>,
        { readonly state: "available" }
      >
    | {
        readonly state: "available";
        readonly collection: Schema.Schema.Type<Definition["schema"]>["collection"];
        readonly logicalIdentity: string;
        readonly logicalSealIdentity: string;
        readonly count: number;
        readonly digest: string;
        readonly items: Stream.Stream<Schema.Schema.Type<Definition["item"]>, RecordReaderReadError>;
      },
    RecordReaderReadError
  >;
  readonly requireComplete: (
    selection: RecordSelection,
  ) => Effect.Effect<RecordCompleteView, RecordCompletenessError>;
}

/** Complete only for this session's frozen selection and immutable catalog. */
export interface RecordCompleteView {
  readonly selection: RecordSelection;
  readonly attachments: RecordAttachmentCatalog;
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
  readonly attach: OwnerAttachmentWriter<"attempt">;
  readonly record: AttemptRecordWriter;
  readonly records: AttemptRecordsWriter;
}

export interface OwnerRecordsWriter<Owner extends "run" | "attempt"> {
  readonly write: {
    <Definition extends AnyRecordDefinition<Owner>>(
      definition: Definition,
      value: RecordDefinitionValue<Definition> |
        ((build: RecordAttachmentSessionBuilder) => RecordDefinitionValue<Definition>),
    ): Effect.Effect<
      void,
      RecordWriteError | AttachedContentError<RecordDefinitionValue<Definition>>,
      AttachedContentRequirements<RecordDefinitionValue<Definition>>
    >;
    <Definition extends AnyDefinition<Owner>, Value extends DefinitionValue<Definition>>(
      definition: Definition,
      value: Value | ((build: RecordAttachmentSessionBuilder) => Value),
    ): Effect.Effect<
      void,
      RecordWriteError | AttachedContentError<Value>,
      AttachedContentRequirements<Value>
    >;
  };
}

export interface AttemptRecordsWriter extends OwnerRecordsWriter<"attempt"> {
  readonly append: <Definition extends AttemptRecordCollectionDefinition<string, Schema.Schema.AnyNoContext>>(
    definition: Definition,
    item: Schema.Schema.Type<Definition["item"]>,
  ) => Effect.Effect<AttemptRecordAppendReceipt, RecordWriteError>;
  readonly appendAll: <Definition extends AttemptRecordCollectionDefinition<string, Schema.Schema.AnyNoContext>, Error, Requirements>(
    definition: Definition,
    items: Stream.Stream<Schema.Schema.Type<Definition["item"]>, Error, Requirements>,
  ) => Effect.Effect<void, RecordWriteError | Error, Requirements>;
  readonly close: <Definition extends AttemptRecordCollectionDefinition<string, Schema.Schema.AnyNoContext>>(
    definition: Definition,
    completion:
      | { readonly state: "complete" }
      | {
          readonly state: "partial";
          readonly limitations: readonly [
            AttemptRecordCollectionLimitation,
            ...AttemptRecordCollectionLimitation[],
          ];
        },
  ) => Effect.Effect<void, RecordWriteError>;
}

export interface OwnerRecordWriter<Owner extends "run" | "attempt"> {
  readonly write: <Value, Error, Requirements>(
    command: RecordWriteCommand<Owner, Value, Error, Requirements>,
  ) => Effect.Effect<void, RecordWriteError | Error, Requirements>;
}

export interface AttemptRecordWriter extends OwnerRecordWriter<"attempt"> {
  readonly start: (
    definition: AttemptRecordCollectionDefinition<string, Schema.Schema.AnyNoContext>,
  ) => Effect.Effect<void, RecordWriteError>;
  readonly append: <Item>(
    command: AttemptRecordAppendCommand<Item>,
  ) => Effect.Effect<AttemptRecordAppendReceipt, RecordWriteError>;
}

export interface OwnerAttachmentWriter<Owner extends "run" | "attempt"> {
  <Definition extends AnyDefinition<Owner>, Value extends DefinitionValue<Definition>>(
    definition: Definition,
    value: Value | ((build: RecordAttachmentSessionBuilder) => Value),
  ): Effect.Effect<
    void,
    RecordWriteError | AttachedContentError<Value>,
    AttachedContentRequirements<Value>
  >;
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
  readonly attach: OwnerAttachmentWriter<"run">;
  readonly record: OwnerRecordWriter<"run">;
  readonly records: OwnerRecordsWriter<"run">;
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
  readonly attach: RunWriteSession["attach"];
  readonly record: RunWriteSession["record"];
  readonly records: RunWriteSession["records"];
  readonly seal: RunWriteSession["seal"];
}

export type RecordFormatInspection =
  | { readonly state: "already-current"; readonly format: "niceeval.record.attachments" }
  | { readonly state: "migration-required"; readonly format: "niceeval.record.attachments" }
  | { readonly state: "unsupported-format"; readonly format: string };

export interface RecordAttachmentMigrationTarget {
  readonly family: string;
  readonly owner: "attempt" | "run";
  readonly runId: RunId;
  readonly attemptId?: AttemptId;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly retention: {
    readonly retainedFacts: readonly string[];
    readonly droppedFacts: readonly string[];
    readonly rerunRecommendation: string | null;
  };
}

export type RecordMigrationPlan =
  | {
      readonly state: "already-current";
      readonly format: "niceeval.record.attachments";
    }
  | {
      readonly state: "migration-required";
      readonly format: "niceeval.record.attachments";
      readonly sourceFormat: "niceeval.record.attachments" | "niceeval.record.source-receipts";
      readonly attachments: readonly RecordAttachmentMigrationTarget[];
      readonly pendingSeals: readonly RunId[];
      readonly resumedSteps: number;
    }
  | {
      readonly state: "unsupported-format";
      readonly format: string;
    };

export type RecordMigrationReceipt =
  | { readonly state: "already-current"; readonly format: "niceeval.record.attachments" }
  | {
      readonly state: "migrated";
      readonly format: "niceeval.record.attachments";
      readonly attachments: readonly RecordAttachmentMigrationTarget[];
      readonly committed: number;
      readonly skipped: number;
      readonly failed: number;
      readonly rebuiltSeals: readonly RunId[];
    };

/** Closed, presentation-neutral plan for explicit incomplete-Run cleanup. */
export type RecordCleanOperationPlan =
  | {
      readonly _tag: "RecordCleanAlreadyClean";
    }
  | {
      readonly _tag: "RecordCleanConfirmationRequired";
      readonly runIds: readonly RunId[];
    };

export interface RecordCleanOperationReceipt {
  readonly _tag: "RecordCleanApplied";
  readonly deleted: readonly RunId[];
  readonly skipped: readonly RunId[];
}

/**
 * A migration plan is safe to carry outside the maintenance Scope. The ready
 * branch remains nominally backed by the exact source-byte plan held by this
 * Host process; callers cannot manufacture an applicable plan from JSON.
 */
export type RecordMigrateOperationPlan =
  | {
      readonly _tag: "RecordMigrationAlreadyCurrent";
      readonly format: "niceeval.record.attachments";
    }
  | {
      readonly _tag: "RecordMigrationUnsupported";
      readonly format: string;
    }
  | RecordMigrateReadyPlan;

export interface RecordMigrateReadyPlan {
  readonly _tag: "RecordMigrationReady";
  readonly format: "niceeval.record.attachments";
  readonly sourceFormat: "niceeval.record.attachments" | "niceeval.record.source-receipts";
  readonly attachments: readonly RecordAttachmentMigrationTarget[];
  readonly pendingSeals: readonly RunId[];
  readonly resumedSteps: number;
}

export type RecordMigrateOperationReceipt =
  | {
      readonly _tag: "RecordMigrationAlreadyCurrent";
      readonly format: "niceeval.record.attachments";
    }
  | {
      readonly _tag: "RecordMigrationApplied";
      readonly format: "niceeval.record.attachments";
      readonly attachments: readonly RecordAttachmentMigrationTarget[];
      readonly committed: number;
      readonly skipped: number;
      readonly failed: number;
      readonly rebuiltSeals: readonly RunId[];
    };

/** Exhaustive failure vocabulary consumed by Record-owned CLI presentation. */
export type RecordMaintenanceOperationFailure =
  | {
      readonly _tag: "RecordMaintenanceBusy";
      readonly code: "record-maintenance-busy";
    }
  | {
      readonly _tag: "RecordMigrationPlanStale";
      readonly code: "record-migration-plan-stale";
    }
  | {
      readonly _tag: "RecordMigrationInvalid";
      readonly code: "record-migration-invalid";
      readonly family: string;
    }
  | {
      readonly _tag: "RecordFormatUnsupported";
      readonly code: "record-format-unsupported";
    }
  | {
      readonly _tag: "RecordMigrationRequired";
      readonly code: "record-migration-required";
    }
  | {
      readonly _tag: "RecordMaintenanceOperationFailed";
      readonly code: string;
    };

export interface RecordMaintenanceSession {
  readonly inspect: () => Effect.Effect<RecordFormatInspection, RecordMaintenanceError>;
  readonly planMigrate: () => Effect.Effect<RecordMigrationPlan, RecordMaintenanceError>;
  readonly applyMigrate: (
    plan: RecordMigrationPlan,
  ) => Effect.Effect<RecordMigrationReceipt, RecordMaintenanceError>;
}

export interface RecordHostSDK {
  readonly openRead: RecordHostSDK["current"]["openRead"];
  readonly createRun: (
    request: CreateRunRequest | { readonly root: RecordRoot; readonly core: Omit<CreateRunRequest, "root"> },
  ) => ReturnType<RecordHostSDK["current"]["createRun"]>;
  readonly createReferenceRun: (
    request: CreateReferenceRunRequest | { readonly root: RecordRoot; readonly core: Omit<CreateReferenceRunRequest, "root"> },
  ) => ReturnType<RecordHostSDK["current"]["createReferenceRun"]>;
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
    readonly planClean: (input: {
      readonly root: RecordRoot;
    }) => Effect.Effect<
      RecordCleanOperationPlan,
      RecordMaintenanceOperationFailure,
      import("../platform/services.ts").RecordFileSystem
        | import("../../coordination/record-leases.ts").RecordCoordination
    >;
    readonly applyClean: (input: {
      readonly root: RecordRoot;
      readonly plan: Extract<RecordCleanOperationPlan, { readonly _tag: "RecordCleanConfirmationRequired" }>;
    }) => Effect.Effect<
      RecordCleanOperationReceipt,
      RecordMaintenanceOperationFailure,
      import("../platform/services.ts").RecordFileSystem
        | import("../../coordination/record-leases.ts").RecordCoordination
    >;
    readonly planMigrate: (input: {
      readonly root: RecordRoot;
    }) => Effect.Effect<
      RecordMigrateOperationPlan,
      RecordMaintenanceOperationFailure,
      import("../platform/services.ts").RecordFileSystem
        | import("../../coordination/record-leases.ts").RecordCoordination
    >;
    readonly applyMigrate: (input: {
      readonly root: RecordRoot;
      readonly plan: RecordMigrateReadyPlan;
    }) => Effect.Effect<
      RecordMigrateOperationReceipt,
      RecordMaintenanceOperationFailure,
      import("../platform/services.ts").RecordFileSystem
        | import("../../coordination/record-leases.ts").RecordCoordination
    >;
    readonly open: (input: {
      readonly root: RecordRoot;
    }) => Effect.Effect<RecordMaintenanceSession, RecordMaintenanceOpenError, import("effect").Scope.Scope | import("../platform/services.ts").RecordFileSystem | import("../../coordination/record-leases.ts").RecordCoordination>;
  };
}
