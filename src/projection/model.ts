import type {
  AnalysisRun,
  AnalysisSample,
  CoreInvalidAnalysisSlot,
  ExcludedAnalysisSlot,
  IncludedAnalysisSlot,
  NotRecordedAnalysisSlot,
  RecordAttemptRef,
  RunId,
} from "../sample/index.ts";
import type { ProjectedRecordAttachmentResult } from "./attachment-result.ts";
import type { ProjectionCoverage } from "./coverage.ts";

export type ProjectionAccess =
  | "attempt-slot"
  | "attempt-origin-run"
  | "selected-run";

export interface AttemptAttachmentOwner {
  readonly kind: "attempt";
  readonly attempt: RecordAttemptRef;
}

export interface RunAttachmentOwner {
  readonly kind: "run";
  readonly runId: RunId;
}

export type ProjectedSlotEntry<Owner, Value> =
  | {
      readonly state: "excluded";
      readonly slot: ExcludedAnalysisSlot;
    }
  | {
      readonly state: "not-recorded";
      readonly slot: NotRecordedAnalysisSlot;
    }
  | {
      readonly state: "core-invalid";
      readonly slot: CoreInvalidAnalysisSlot;
    }
  | {
      readonly state: "attachment-result";
      readonly slot: IncludedAnalysisSlot;
      readonly owner: Owner;
      readonly attachment: ProjectedRecordAttachmentResult<Value>;
    };

export type AttemptSlotProjectedEntry<Value> = ProjectedSlotEntry<
  AttemptAttachmentOwner,
  Value
>;

export type AttemptOriginRunProjectedEntry<Value> = ProjectedSlotEntry<
  RunAttachmentOwner,
  Value
>;

export interface SelectedRunProjectedEntry<Value> {
  readonly state: "attachment-result";
  readonly run: AnalysisRun;
  readonly owner: RunAttachmentOwner;
  readonly attachment: ProjectedRecordAttachmentResult<Value>;
}

export type ProjectedEntry<Access extends ProjectionAccess, Value> =
  Access extends "attempt-slot"
    ? AttemptSlotProjectedEntry<Value>
    : Access extends "attempt-origin-run"
      ? AttemptOriginRunProjectedEntry<Value>
      : SelectedRunProjectedEntry<Value>;

/** A completed, self-contained projection never retains live reader capability. */
export interface ProjectedSample<Access extends ProjectionAccess, Value> {
  readonly sample: AnalysisSample;
  readonly access: Access;
  readonly entries: readonly ProjectedEntry<Access, Value>[];
  readonly coverage: ProjectionCoverage;
}

export interface ProjectionLimitError {
  readonly code: "projection-limit-exceeded";
  readonly limit: "logical-entries";
  readonly maximum: number;
  readonly observedAtLeast: number;
}
