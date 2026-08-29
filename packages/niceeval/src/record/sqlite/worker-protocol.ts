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
  | { readonly id: number; readonly operation: "close" };

export type StorageWorkerResult = SealedRunSummary | readonly SealedRunSummary[] | readonly Uint8Array[] | SealedRunDocument | SealedRunCore | RunFinalization | PreparedRunFinalization | StageSealEntriesResult | ContentChunkPage | CollectionItemPage | number | undefined;

export type StorageWorkerResponse =
  | { readonly id: number; readonly state: "success"; readonly result: StorageWorkerResult }
  | { readonly id: number; readonly state: "failure"; readonly error: { readonly code: string; readonly operation: string; readonly message: string; readonly stack?: string } };

export function isStorageWorkerResponse(value: unknown): value is StorageWorkerResponse {
  if (typeof value !== "object" || value === null) return false;
  const id = Reflect.get(value, "id");
  const state = Reflect.get(value, "state");
  return Number.isSafeInteger(id) && (state === "success" || state === "failure");
}
