import { Schema } from "effect";

import {
  RecordAttachmentReference,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
} from "../../attachment/index.ts";
import { TurnIdSchema } from "../source-receipt/codec.ts";
import {
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../../codec/identifiers.ts";
import { sourcesRecordAttachment } from "../sources/definition.ts";
import {
  PositiveSafeIntegerSchema,
  SafeIdentifierSchema,
  SafeTextSchema,
} from "../common.ts";
import {
  SourceReceiptCollectionSchema,
  SourceSegmentIdSchema,
  hasCanonicalSourceSegments,
} from "../source-receipt/index.ts";
import {
  ATTEMPT_ACTIVITY_PHASES,
  RUN_ACTIVITY_PHASES,
} from "../protocol-values.ts";

const SourcePositionSchema = Schema.Struct({
  line: PositiveSafeIntegerSchema,
  column: PositiveSafeIntegerSchema,
});

export const RunnerDiagnosticSourceFrameSchema = Schema.Struct({
  sourceItemId: SourceItemIdSchema,
  sha256: Sha256DigestSchema,
  start: SourcePositionSchema,
  end: SourcePositionSchema,
});

export const RunnerDiagnosticSourceFrameReferenceSchema =
  RecordAttachmentReference.to(
    sourcesRecordAttachment,
    RunnerDiagnosticSourceFrameSchema,
  );

const DiagnosticBase = {
  segmentId: SourceSegmentIdSchema,
  diagnosticId: SafeIdentifierSchema,
  sequence: PositiveSafeIntegerSchema,
  turnId: Schema.NullOr(TurnIdSchema),
  kind: Schema.Literals(["advisory", "execution-error"]),
  code: SafeIdentifierSchema,
  summary: SafeTextSchema,
  causes: Schema.Array(
    Schema.Struct({ code: SafeIdentifierSchema, summary: SafeTextSchema }),
  ),
  redaction: Schema.Union([
    Schema.Struct({ state: Schema.Literal("none") }),
    Schema.Struct({
      state: Schema.Literal("applied"),
      replacements: PositiveSafeIntegerSchema,
    }),
  ]),
  sourceFrame: Schema.NullOr(RunnerDiagnosticSourceFrameReferenceSchema),
} as const;

export const AttemptRunnerDiagnosticReceiptSchema = Schema.Struct({
  ...DiagnosticBase,
  phase: Schema.Literals(ATTEMPT_ACTIVITY_PHASES),
});

export const RunRunnerDiagnosticReceiptSchema = Schema.Struct({
  ...DiagnosticBase,
  phase: Schema.Literals(RUN_ACTIVITY_PHASES),
});

function validateRunnerDiagnostics(input: {
  readonly collection: { readonly limitations: readonly {
    readonly stage?: string;
    readonly target: string;
  }[] };
  readonly segments: readonly {
    readonly segmentId: string;
    readonly sequence: number;
    readonly diagnosticId: string;
  }[];
}): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (!hasCanonicalSourceSegments(input.segments)) {
    issues.push(recordAttachmentIssue("record-attachment-schema-invalid", ["segments"]));
  }
  const diagnosticIds = new Set<string>();
  input.segments.forEach((segment, index) => {
    if (diagnosticIds.has(segment.diagnosticId)) {
      issues.push(recordAttachmentIssue(
        "record-attachment-schema-invalid",
        ["segments", String(index), "diagnosticId"],
      ));
    }
    diagnosticIds.add(segment.diagnosticId);
  });
  input.collection.limitations.forEach((limitation, index) => {
    if (
      (limitation.stage !== undefined &&
        limitation.stage !== "runner-diagnostic-sink" &&
        limitation.stage !== "attempt-finalizer" &&
        limitation.stage !== "run-teardown") ||
      !["diagnostic", "diagnostic-cause", "value-byte"].includes(limitation.target)
    ) {
      issues.push(recordAttachmentIssue(
        "record-attachment-schema-invalid",
        ["collection", "limitations", String(index)],
      ));
    }
  });
  return Object.freeze(issues);
}

export const AttemptRunnerDiagnosticsAttachmentSchema = Schema.Struct({
  collection: SourceReceiptCollectionSchema,
  segments: Schema.Array(AttemptRunnerDiagnosticReceiptSchema),
}).pipe(Schema.encodeKeys({ collection: "collection-data", segments: "segments-data" }));

export const RunRunnerDiagnosticsAttachmentSchema = Schema.Struct({
  collection: SourceReceiptCollectionSchema,
  segments: Schema.Array(RunRunnerDiagnosticReceiptSchema),
}).pipe(Schema.encodeKeys({ collection: "collection-data", segments: "segments-data" }));

export type AttemptRunnerDiagnosticsAttachment = Schema.Schema.Type<
  typeof AttemptRunnerDiagnosticsAttachmentSchema
>;
export type RunRunnerDiagnosticsAttachment = Schema.Schema.Type<
  typeof RunRunnerDiagnosticsAttachmentSchema
>;
export type RunnerDiagnosticsAttachment =
  | AttemptRunnerDiagnosticsAttachment
  | RunRunnerDiagnosticsAttachment;

function validateSourceFrames(
  payload: RunnerDiagnosticsAttachment,
): readonly RecordAttachmentIssue[] {
  return Object.freeze(payload.segments.flatMap((diagnostic, index) => {
    const frame = diagnostic.sourceFrame?.value;
    if (frame === undefined) return [];
    if (
      frame.start.line > frame.end.line ||
      frame.start.line === frame.end.line && frame.start.column > frame.end.column
    ) {
      return [recordAttachmentIssue(
        "record-attachment-schema-invalid",
        ["segments", String(index), "sourceFrame"],
      )];
    }
    return [];
  }));
}

export function validateAttemptRunnerDiagnosticsAttachment(
  value: AttemptRunnerDiagnosticsAttachment,
): readonly RecordAttachmentIssue[] {
  return Object.freeze([
    ...validateRunnerDiagnostics(value),
    ...validateSourceFrames(value),
  ]);
}

export function validateRunRunnerDiagnosticsAttachment(
  value: RunRunnerDiagnosticsAttachment,
): readonly RecordAttachmentIssue[] {
  return Object.freeze([
    ...validateRunnerDiagnostics(value),
    ...validateSourceFrames(value),
  ]);
}
