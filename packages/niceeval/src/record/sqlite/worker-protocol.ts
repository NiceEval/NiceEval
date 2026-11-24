import { Option, Predicate, Schema } from "effect";
import { isSqliteRecordErrorCode, SqliteRecordError } from "./errors.ts";
import { RUN_STORAGE_ERROR_CODES, RunStorageError } from "../../run/storage/errors.ts";
import { isExternalCause, normalizeExternalCause } from "../../shared/external-cause.ts";
import type {
  StageContentBatchInput,
  AppendContentChunksInput,
  AppendRunSourcesInput,
  AdmitAttachmentInput,
  AdmitAttemptInput,
  AdmitContentInput,
  DiscardAttemptInput,
  BeginRunInput,
  ContentChunkPage,
  CollectionItemPage,
  FenceRunFinalizationInput,
  PersistSealedRunInput,
  PrepareRunFinalizationInput,
  PreparedRunFinalization,
  RunFinalization,
  SealedRunCore,
  SealedRunDocument,
  SealedRunSummary,
  SealRunInput,
  StageAttachmentReferencesInput,
  StageCollectionItemsInput,
  StageSealEntriesInput,
  StageSealEntriesResult,
  StageRunCoreInput,
} from "./types.ts";
import type { AdmissionInput } from "../../coordination/platform/node-record-admission-protocol.ts";
import type { StateLeaseAuthority, StateLeaseRegistryCommand } from "./state-lease-repository.ts";

export type RegistryCommand =
  | StateLeaseRegistryCommand
  | {
      readonly _tag: "teardown-put";
      readonly id: string;
      readonly experimentId: string;
      readonly ownerPid: number;
      readonly ownerHost: string;
      readonly payload: Uint8Array;
      readonly leaseSet?: StateLeaseAuthority | undefined;
    }
  | { readonly _tag: "teardown-get"; readonly id: string }
  | { readonly _tag: "teardown-list" }
  | { readonly _tag: "teardown-claim"; readonly id: string }
  | { readonly _tag: "shared-list"; readonly key: string }
  | {
      readonly _tag: "shared-heartbeat";
      readonly key: string;
      readonly generation: number;
      readonly ownerToken: string;
      readonly heartbeatAt: string;
    };

export type CaseCoordinationCommand =
  | { readonly _tag: "case-read"; readonly caseId: string }
  | {
      readonly _tag: "case-acquire";
      readonly caseId: string;
      readonly owner: import("./coordination-repository.ts").ProcessOwnerIdentity;
      readonly at: string;
      readonly deadlineEpochMs: number;
    }
  | {
      readonly _tag: "case-heartbeat";
      readonly caseId: string;
      readonly owner: import("./coordination-repository.ts").FencedOwner;
      readonly at: string;
      readonly deadlineEpochMs: number;
    }
  | {
      readonly _tag: "case-release";
      readonly caseId: string;
      readonly owner: import("./coordination-repository.ts").FencedOwner;
      readonly deadlineEpochMs: number;
    }
  | {
      readonly _tag: "case-takeover";
      readonly caseId: string;
      readonly deadOwner: import("./coordination-repository.ts").FencedOwner;
      readonly replacement: import("./coordination-repository.ts").ProcessOwnerIdentity;
      readonly at: string;
      readonly deadlineEpochMs: number;
    };

export type InvocationCommand =
  | { readonly _tag: "invocation-create"; readonly input: import("./coordination-repository.ts").CreateInvocationInput }
  | { readonly _tag: "invocation-list" }
  | {
      readonly _tag: "invocation-update-projection";
      readonly invocationId: string;
      readonly owner: import("./coordination-repository.ts").FencedOwner;
      readonly at: string;
      readonly projection: Uint8Array;
      readonly deadlineEpochMs: number;
    }
  | {
      readonly _tag: "invocation-close";
      readonly invocationId: string;
      readonly owner: import("./coordination-repository.ts").FencedOwner;
      readonly state: "completed" | "interrupted" | "failed";
      readonly at: string;
      readonly projection: Uint8Array;
      readonly deadlineEpochMs: number;
    };

export type RunCommand =
  | { readonly _tag: "run-import"; readonly path: string; readonly deadlineEpochMs: number }
  | {
      readonly _tag: "run-export";
      readonly runIds: readonly string[];
      readonly path: string;
      readonly deadlineEpochMs: number;
    }
  | { readonly _tag: "run-cutoff" }
  | { readonly _tag: "run-create"; readonly input: import("../../run/storage/types.ts").CreateRunResourceInput }
  | {
      readonly _tag: "run-publish-attempt";
      readonly input: import("../../run/storage/types.ts").PublishOriginAttemptInput;
    }
  | {
      readonly _tag: "run-bind-reference";
      readonly input: import("../../run/storage/types.ts").BindAttemptReferenceInput;
    }
  | { readonly _tag: "run-close"; readonly input: import("../../run/storage/types.ts").CloseRunResourceInput }
  | { readonly _tag: "run-recover"; readonly input: import("../../run/storage/types.ts").RecoverRunResourceInput }
  | { readonly _tag: "run-delete"; readonly input: import("../../run/storage/types.ts").DeleteRunResourceInput }
  | {
      readonly _tag: "run-read";
      readonly runId: string;
      readonly cutoff: import("../../run/storage/types.ts").PublicationCutoff | undefined;
    }
  | {
      readonly _tag: "run-list";
      readonly input: Parameters<typeof import("../../run/storage/sqlite.ts").listRunResourcesOnConnection>[1];
    }
  | {
      readonly _tag: "run-read-attempt";
      readonly attemptId: string;
      readonly cutoff: import("../../run/storage/types.ts").PublicationCutoff | undefined;
    };

export type StorageWorkerRequest =
  | {
      readonly id: number;
      readonly operation: "initialize";
      readonly databasePath: string;
      readonly busyTimeoutMs: number;
    }
  | { readonly id: number; readonly operation: "persist-sealed-run"; readonly input: PersistSealedRunInput }
  | { readonly id: number; readonly operation: "begin-run"; readonly input: BeginRunInput }
  | { readonly id: number; readonly operation: "admit-attempt"; readonly input: AdmitAttemptInput }
  | { readonly id: number; readonly operation: "discard-attempt"; readonly input: DiscardAttemptInput }
  | { readonly id: number; readonly operation: "append-run-sources"; readonly input: AppendRunSourcesInput }
  | { readonly id: number; readonly operation: "admit-attachment"; readonly input: AdmitAttachmentInput }
  | { readonly id: number; readonly operation: "stage-content-batch"; readonly input: StageContentBatchInput }
  | { readonly id: number; readonly operation: "admit-content"; readonly input: AdmitContentInput }
  | { readonly id: number; readonly operation: "finalize-run"; readonly input: StageRunCoreInput }
  | { readonly id: number; readonly operation: "stage-final-metadata"; readonly input: StageRunCoreInput }
  | { readonly id: number; readonly operation: "stage-publication-metadata"; readonly input: StageRunCoreInput }
  | { readonly id: number; readonly operation: "prepare-finalization"; readonly input: PrepareRunFinalizationInput }
  | { readonly id: number; readonly operation: "fence-finalization"; readonly input: FenceRunFinalizationInput }
  | {
      readonly id: number;
      readonly operation: "stage-attachment-references";
      readonly input: StageAttachmentReferencesInput;
    }
  | { readonly id: number; readonly operation: "stage-collection-items"; readonly input: StageCollectionItemsInput }
  | { readonly id: number; readonly operation: "stage-seal-entries"; readonly input: StageSealEntriesInput }
  | { readonly id: number; readonly operation: "append-content-chunks"; readonly input: AppendContentChunksInput }
  | { readonly id: number; readonly operation: "seal-run"; readonly input: SealRunInput }
  | { readonly id: number; readonly operation: "publish-run-seal"; readonly input: SealRunInput }
  | { readonly id: number; readonly operation: "read-sealed-run-summary"; readonly runId: string }
  | {
      readonly id: number;
      readonly operation: "list-sealed-run-summaries";
      readonly afterRunId: string;
      readonly pageSize: number;
    }
  | {
      readonly id: number;
      readonly operation: "read-collection-item-page";
      readonly attachmentId: string;
      readonly afterOrdinal: number;
      readonly pageSize: number;
    }
  | { readonly id: number; readonly operation: "read-sealed-run-document"; readonly runId: string }
  | { readonly id: number; readonly operation: "read-sealed-run-core"; readonly runId: string }
  | { readonly id: number; readonly operation: "read-record-core" }
  | {
      readonly id: number;
      readonly operation: "read-content-chunk-page";
      readonly contentId: string;
      readonly afterOrdinal: number;
      readonly pageSize: number;
    }
  | { readonly id: number; readonly operation: "validate" }
  | {
      readonly id: number;
      readonly operation: "registry";
      readonly deadlineEpochMs: number;
      readonly command: RegistryCommand;
    }
  | { readonly id: number; readonly operation: "case-coordination"; readonly command: CaseCoordinationCommand }
  | { readonly id: number; readonly operation: "invocation"; readonly command: InvocationCommand }
  | { readonly id: number; readonly operation: "run"; readonly command: RunCommand }
  | { readonly id: number; readonly operation: "admission"; readonly command: AdmissionInput }
  | { readonly id: number; readonly operation: "close" };

export type StorageWorkerResult =
  | SealedRunSummary
  | readonly SealedRunSummary[]
  | readonly Uint8Array[]
  | SealedRunDocument
  | SealedRunCore
  | RunFinalization
  | PreparedRunFinalization
  | StageSealEntriesResult
  | ContentChunkPage
  | CollectionItemPage
  | number
  | boolean
  | object
  | readonly object[]
  | undefined;

const WorkerFailureFields = {
  message: Schema.String,
  stack: Schema.UndefinedOr(Schema.String),
};

/** Cross-thread failures preserve the domain discriminant and every recovery fact. */
export const StorageWorkerFailureSchema = Schema.Union([
  Schema.Struct({
    ...WorkerFailureFields,
    _tag: Schema.Literal("SqliteRecordError"),
    code: Schema.declare(isSqliteRecordErrorCode),
    operation: Schema.String,
    cause: Schema.UndefinedOr(Schema.declare(isExternalCause)),
  }),
  Schema.Struct({
    ...WorkerFailureFields,
    _tag: Schema.Literal("RunStorageError"),
    code: Schema.Literals(RUN_STORAGE_ERROR_CODES),
    dependencies: Schema.Array(
      Schema.Struct({
        dependentRunId: Schema.String,
        dependentSlotId: Schema.String,
        attemptId: Schema.String,
        attemptLocator: Schema.String,
      }),
    ),
  }),
]);

export type StorageWorkerFailure = typeof StorageWorkerFailureSchema.Type;
const decodeWorkerFailure = Schema.decodeUnknownOption(StorageWorkerFailureSchema, { onExcessProperty: "error" });

export function isStorageWorkerFailure(value: unknown): value is StorageWorkerFailure {
  return Option.isSome(decodeWorkerFailure(value));
}

export function encodeStorageWorkerFailure(cause: unknown, operation: string): StorageWorkerFailure {
  if (cause instanceof RunStorageError) {
    return {
      _tag: cause._tag,
      code: cause.code,
      message: cause.message,
      stack: cause.stack,
      dependencies: cause.dependencies,
    };
  }
  if (cause instanceof SqliteRecordError) {
    return {
      _tag: cause._tag,
      code: cause.code,
      operation: cause.operation,
      message: cause.message,
      stack: cause.stack,
      cause: cause.cause === undefined ? undefined : normalizeExternalCause(cause.cause),
    };
  }
  const external = normalizeExternalCause(cause);
  return {
    _tag: "SqliteRecordError",
    code: "record-sqlite-error",
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    stack: cause instanceof Error ? cause.stack : undefined,
    cause: external,
  };
}

export function decodeStorageWorkerFailure(failure: StorageWorkerFailure): SqliteRecordError | RunStorageError {
  const error =
    failure._tag === "RunStorageError"
      ? new RunStorageError(failure.code, failure.message, failure.dependencies)
      : new SqliteRecordError(failure.code, failure.operation, failure.message, { cause: failure.cause });
  Object.defineProperty(error, "stack", { value: failure.stack, configurable: true, writable: true });
  return error;
}

export type StorageWorkerResponse =
  | { readonly id: number; readonly state: "success"; readonly result: StorageWorkerResult }
  | {
      readonly id: number;
      readonly state: "failure";
      readonly error: StorageWorkerFailure;
    };

export function isStorageWorkerResponse(value: unknown): value is StorageWorkerResponse {
  if (!Predicate.isObject(value)) return false;
  const id = Reflect.get(value, "id");
  const state = Reflect.get(value, "state");
  if (!Number.isSafeInteger(id)) return false;
  if (state === "success") {
    if (!Object.hasOwn(value, "result")) return false;
    const result = Reflect.get(value, "result");
    return (
      result === undefined ||
      Predicate.isBoolean(result) ||
      (Predicate.isNumber(result) && Number.isFinite(result)) ||
      Array.isArray(result) ||
      Predicate.isObject(result)
    );
  }
  if (state !== "failure") return false;
  return isStorageWorkerFailure(Reflect.get(value, "error"));
}
