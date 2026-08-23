import { Schema } from "effect";

import { TurnIdSchema } from "../source-receipt/codec.ts";
import {
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../../codec/identifiers.ts";
import {
  recordAttachmentIssue,
  type RecordAttachmentIssue,
} from "../../attachment/errors.ts";
import type { SourcesAttachment } from "../sources.ts";
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

const SourcePositionSchema = Schema.Struct({
  line: PositiveSafeIntegerSchema,
  column: PositiveSafeIntegerSchema,
});

const SourceFrameSchema = Schema.Struct({
  sourceItemId: SourceItemIdSchema,
  sha256: Sha256DigestSchema,
  start: SourcePositionSchema,
  end: SourcePositionSchema,
});

const DiagnosticBase = {
  segmentId: SourceSegmentIdSchema,
  diagnosticId: SafeIdentifierSchema,
  sequence: PositiveSafeIntegerSchema,
  turnId: Schema.NullOr(TurnIdSchema),
  kind: Schema.Literal("advisory", "execution-error"),
  code: SafeIdentifierSchema,
  summary: SafeTextSchema,
  causes: Schema.Array(
    Schema.Struct({ code: SafeIdentifierSchema, summary: SafeTextSchema }),
  ),
  redaction: Schema.Union(
    Schema.Struct({ state: Schema.Literal("none") }),
    Schema.Struct({
      state: Schema.Literal("applied"),
      replacements: PositiveSafeIntegerSchema,
    }),
  ),
  sourceFrame: Schema.NullOr(SourceFrameSchema),
} as const;

export const AttemptRunnerDiagnosticReceiptSchema = Schema.Struct({
  ...DiagnosticBase,
  phase: Schema.Literal(
    "attempt.setup",
    "sandbox.prepare",
    "agent.ensure",
    "eval.run",
    "agent.send",
    "sandbox.command",
    "assertion.evaluate",
    "verdict.fold",
    "attempt.teardown",
  ),
});

export const RunRunnerDiagnosticReceiptSchema = Schema.Struct({
  ...DiagnosticBase,
  phase: Schema.Literal(
    "run.setup",
    "run.discovery",
    "run.plan",
    "run.dispatch",
    "run.teardown",
  ),
});

function canonicalDiagnostics(input: {
  readonly collection: { readonly limitations: readonly {
    readonly stage?: string;
    readonly target: string;
  }[] };
  readonly segments: readonly {
    readonly segmentId: string;
    readonly sequence: number;
    readonly diagnosticId: string;
  }[];
}): boolean {
  return hasCanonicalSourceSegments(input.segments) &&
    new Set(input.segments.map((segment) => segment.diagnosticId)).size === input.segments.length &&
    input.collection.limitations.every((limitation) =>
      (limitation.stage === undefined || limitation.stage === "runner-diagnostic-sink" ||
        limitation.stage === "attempt-finalizer" || limitation.stage === "run-teardown") &&
      ["diagnostic", "diagnostic-cause", "payload-byte"].includes(limitation.target)
    );
}

export const AttemptRunnerDiagnosticsAttachmentSchema = Schema.Struct({
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(AttemptRunnerDiagnosticReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
}).pipe(Schema.filter(canonicalDiagnostics));

export const RunRunnerDiagnosticsAttachmentSchema = Schema.Struct({
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(RunRunnerDiagnosticReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
}).pipe(Schema.filter(canonicalDiagnostics));

export type AttemptRunnerDiagnosticsAttachment = Schema.Schema.Type<
  typeof AttemptRunnerDiagnosticsAttachmentSchema
>;
export type RunRunnerDiagnosticsAttachment = Schema.Schema.Type<
  typeof RunRunnerDiagnosticsAttachmentSchema
>;
export type RunnerDiagnosticsAttachment =
  | AttemptRunnerDiagnosticsAttachment
  | RunRunnerDiagnosticsAttachment;

export function runnerDiagnosticsSourceFrameIntegrityIssues(
  payload: RunnerDiagnosticsAttachment,
  sources: SourcesAttachment,
): readonly RecordAttachmentIssue[] {
  const sourceById = new Map(sources.items.map((item) => [item.sourceItemId, item] as const));
  return Object.freeze(payload.segments.flatMap((diagnostic, index) => {
    const frame = diagnostic.sourceFrame;
    if (frame === null) return [];
    const source = sourceById.get(frame.sourceItemId);
    if (source === undefined || source.sha256 !== frame.sha256) {
      return [recordAttachmentIssue(
        "record-attachment-materialized-invalid",
        ["segments", String(index), "sourceFrame"],
      )];
    }
    return [];
  }));
}
