import { Predicate } from "effect";
import type {
  AppendContentChunksInput,
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

export type RegistryCommand =
  | { readonly _tag: "teardown-put"; readonly id: string; readonly experimentId: string; readonly ownerPid: number; readonly ownerHost: string; readonly payload: Uint8Array }
  | { readonly _tag: "teardown-get"; readonly id: string }
  | { readonly _tag: "teardown-list" }
  | { readonly _tag: "teardown-claim"; readonly id: string }
  | { readonly _tag: "shared-list"; readonly key: string }
  | { readonly _tag: "shared-append"; readonly key: string; readonly expectedGeneration: number; readonly generation: number; readonly parentGeneration: number; readonly kind: "active" | "recovering" | "free"; readonly ownerToken: string; readonly ownerPid: number; readonly ownerHost: string; readonly ownerProcessIdentity: string; readonly heartbeatAt: string; readonly payload: Uint8Array }
  | { readonly _tag: "shared-heartbeat"; readonly key: string; readonly generation: number; readonly ownerToken: string; readonly heartbeatAt: string }
  | { readonly _tag: "keep-put"; readonly id: string; readonly provider: string; readonly sandboxId: string; readonly keptAt: string; readonly payload: Uint8Array }
  | { readonly _tag: "keep-get"; readonly id: string }
  | { readonly _tag: "keep-list" }
  | { readonly _tag: "keep-update"; readonly id: string; readonly payload: Uint8Array }
  | { readonly _tag: "keep-delete"; readonly id: string }
  | { readonly _tag: "keep-lease-get"; readonly id: string }
  | { readonly _tag: "keep-lease-acquire"; readonly id: string; readonly token: string; readonly holder: string; readonly operation: string; readonly acquiredAt: string; readonly ttlMs: number; readonly ownerPid: number; readonly ownerHost: string; readonly ownerProcessIdentity: string }
  | { readonly _tag: "keep-lease-release"; readonly id: string; readonly generation: number; readonly token: string; readonly ownerPid: number; readonly ownerHost: string; readonly ownerProcessIdentity: string };

export type CaseCoordinationCommand =
  | { readonly _tag: "case-read"; readonly caseId: string }
  | { readonly _tag: "case-acquire"; readonly caseId: string; readonly owner: import("./coordination-repository.ts").ProcessOwnerIdentity; readonly at: string; readonly deadlineEpochMs: number }
  | { readonly _tag: "case-heartbeat"; readonly caseId: string; readonly owner: import("./coordination-repository.ts").FencedOwner; readonly at: string; readonly deadlineEpochMs: number }
  | { readonly _tag: "case-release"; readonly caseId: string; readonly owner: import("./coordination-repository.ts").FencedOwner; readonly deadlineEpochMs: number }
  | { readonly _tag: "case-takeover"; readonly caseId: string; readonly deadOwner: import("./coordination-repository.ts").FencedOwner; readonly replacement: import("./coordination-repository.ts").ProcessOwnerIdentity; readonly at: string; readonly deadlineEpochMs: number };

export type InvocationCommand =
  | { readonly _tag: "invocation-create"; readonly input: import("./coordination-repository.ts").CreateInvocationInput }
  | { readonly _tag: "invocation-list" }
  | { readonly _tag: "invocation-update-projection"; readonly invocationId: string; readonly owner: import("./coordination-repository.ts").FencedOwner; readonly at: string; readonly projection: Uint8Array; readonly deadlineEpochMs: number }
  | { readonly _tag: "invocation-close"; readonly invocationId: string; readonly owner: import("./coordination-repository.ts").FencedOwner; readonly state: "completed" | "interrupted" | "failed"; readonly at: string; readonly projection: Uint8Array; readonly deadlineEpochMs: number };

export type RunCommand =
  | { readonly _tag: "run-cutoff" }
  | { readonly _tag: "run-create"; readonly input: import("../../run/storage/types.ts").CreateRunResourceInput }
  | { readonly _tag: "run-publish-attempt"; readonly input: import("../../run/storage/types.ts").PublishOriginAttemptInput }
  | { readonly _tag: "run-bind-reference"; readonly input: import("../../run/storage/types.ts").BindAttemptReferenceInput }
  | { readonly _tag: "run-close"; readonly input: import("../../run/storage/types.ts").CloseRunResourceInput }
  | { readonly _tag: "run-recover"; readonly input: import("../../run/storage/types.ts").RecoverRunResourceInput }
  | { readonly _tag: "run-delete"; readonly input: import("../../run/storage/types.ts").DeleteRunResourceInput }
  | { readonly _tag: "run-read"; readonly runId: string; readonly cutoff?: import("../../run/storage/types.ts").PublicationCutoff }
  | { readonly _tag: "run-list"; readonly input?: Parameters<typeof import("../../run/storage/sqlite.ts").listRunResourcesOnConnection>[1] }
  | { readonly _tag: "run-read-attempt"; readonly attemptId: string; readonly cutoff?: import("../../run/storage/types.ts").PublicationCutoff };

export type StorageWorkerRequest =
  | { readonly id: number; readonly operation: "initialize"; readonly databasePath: string; readonly busyTimeoutMs: number }
  | { readonly id: number; readonly operation: "persist-sealed-run"; readonly input: PersistSealedRunInput }
  | { readonly id: number; readonly operation: "begin-run"; readonly input: BeginRunInput }
  | { readonly id: number; readonly operation: "admit-attempt"; readonly input: AdmitAttemptInput }
  | { readonly id: number; readonly operation: "discard-attempt"; readonly input: DiscardAttemptInput }
  | { readonly id: number; readonly operation: "admit-attachment"; readonly input: AdmitAttachmentInput }
  | { readonly id: number; readonly operation: "admit-content"; readonly input: AdmitContentInput }
  | { readonly id: number; readonly operation: "finalize-run"; readonly input: StageRunCoreInput }
  | { readonly id: number; readonly operation: "stage-final-metadata"; readonly input: StageRunCoreInput }
  | { readonly id: number; readonly operation: "stage-publication-metadata"; readonly input: StageRunCoreInput }
  | { readonly id: number; readonly operation: "prepare-finalization"; readonly input: PrepareRunFinalizationInput }
  | { readonly id: number; readonly operation: "fence-finalization"; readonly input: FenceRunFinalizationInput }
  | { readonly id: number; readonly operation: "stage-attachment-references"; readonly input: StageAttachmentReferencesInput }
  | { readonly id: number; readonly operation: "stage-collection-items"; readonly input: StageCollectionItemsInput }
  | { readonly id: number; readonly operation: "stage-seal-entries"; readonly input: StageSealEntriesInput }
  | { readonly id: number; readonly operation: "append-content-chunks"; readonly input: AppendContentChunksInput }
  | { readonly id: number; readonly operation: "seal-run"; readonly input: SealRunInput }
  | { readonly id: number; readonly operation: "publish-run-seal"; readonly input: SealRunInput }
  | { readonly id: number; readonly operation: "read-sealed-run-summary"; readonly runId: string }
  | { readonly id: number; readonly operation: "list-sealed-run-summaries"; readonly afterRunId: string; readonly pageSize: number }
  | { readonly id: number; readonly operation: "read-collection-item-page"; readonly attachmentId: string; readonly afterOrdinal: number; readonly pageSize: number }
  | { readonly id: number; readonly operation: "read-sealed-run-document"; readonly runId: string }
  | { readonly id: number; readonly operation: "read-sealed-run-core"; readonly runId: string }
  | { readonly id: number; readonly operation: "read-content-chunk-page"; readonly contentId: string; readonly afterOrdinal: number; readonly pageSize: number }
  | { readonly id: number; readonly operation: "validate" }
  | { readonly id: number; readonly operation: "registry"; readonly deadlineEpochMs: number; readonly command: RegistryCommand }
  | { readonly id: number; readonly operation: "case-coordination"; readonly command: CaseCoordinationCommand }
  | { readonly id: number; readonly operation: "invocation"; readonly command: InvocationCommand }
  | { readonly id: number; readonly operation: "run"; readonly command: RunCommand }
  | { readonly id: number; readonly operation: "admission"; readonly command: AdmissionInput }
  | { readonly id: number; readonly operation: "close" };

export type StorageWorkerResult = SealedRunSummary | readonly SealedRunSummary[] | readonly Uint8Array[] | SealedRunDocument | SealedRunCore | RunFinalization | PreparedRunFinalization | StageSealEntriesResult | ContentChunkPage | CollectionItemPage | number | boolean | object | readonly object[] | undefined;

export type StorageWorkerResponse =
  | { readonly id: number; readonly state: "success"; readonly result: StorageWorkerResult }
  | { readonly id: number; readonly state: "failure"; readonly error: { readonly code: string; readonly operation: string; readonly message: string; readonly stack?: string; readonly details?: readonly object[] } };

export function isStorageWorkerResponse(value: unknown): value is StorageWorkerResponse {
  if (!Predicate.isObject(value)) return false;
  const id = Reflect.get(value, "id");
  const state = Reflect.get(value, "state");
  if (!Number.isSafeInteger(id)) return false;
  if (state === "success") {
    if (!Object.hasOwn(value, "result")) return false;
    const result = Reflect.get(value, "result");
    return result === undefined || Predicate.isBoolean(result) ||
      (Predicate.isNumber(result) && Number.isFinite(result)) || Array.isArray(result) || Predicate.isObject(result);
  }
  if (state !== "failure") return false;
  const error = Reflect.get(value, "error");
  if (!Predicate.isObject(error)) return false;
  const stack = Reflect.get(error, "stack");
  const details = Reflect.get(error, "details");
  return Predicate.isString(Reflect.get(error, "code")) &&
    Predicate.isString(Reflect.get(error, "operation")) &&
    Predicate.isString(Reflect.get(error, "message")) &&
    (stack === undefined || Predicate.isString(stack)) &&
    (details === undefined || (Array.isArray(details) && details.every(Predicate.isObject)));
}
