import { Schema } from "effect";

import {
  Sha256DigestSchema,
  SourceFileItemIdSchema,
} from "../../../sources/codec.ts";
import {
  AttemptDiagnosticsReferencesSchema,
  AttemptReferenceTargetSchema,
  CollectionSchema,
  DiagnosticIdSchema,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  RunDiagnosticsReferencesSchema,
  RunReferenceTargetSchema,
  SafeIdentifierSchema,
  boundedSafeTextSchema,
} from "../../../record/family/source-receipt/codec.ts";
import {
  MAX_DIAGNOSTIC_CAUSES,
  MAX_DIAGNOSTIC_CAUSE_SUMMARY_BYTES,
  MAX_DIAGNOSTIC_CONTEXT_ITEMS,
  MAX_DIAGNOSTIC_SUMMARY_BYTES,
  MAX_DIAGNOSTICS_ATTACHMENT_BYTES,
  MAX_DIAGNOSTICS,
} from "../../../record/family/source-receipt/limits.ts";
import type {
  AttemptDiagnosticsReferences,
  RunDiagnosticsReferences,
} from "../../../record/family/source-receipt/model.ts";
import {
  isAllowedCollection,
  isStrictlyOrderedById,
  payloadFits,
} from "./common.ts";

export const AttemptDiagnosticPhaseSchema = Schema.Literal(
  "attempt.setup",
  "sandbox.prepare",
  "agent.ensure",
  "eval.run",
  "agent.send",
  "sandbox.command",
  "assertion.evaluate",
  "verdict.fold",
  "attempt.teardown",
  "collection",
);

export const RunDiagnosticPhaseSchema = Schema.Literal(
  "run.setup",
  "run.discovery",
  "run.plan",
  "run.dispatch",
  "run.teardown",
  "collection",
);

export const SourcePositionSchema = Schema.Struct({
  line: PositiveSafeIntegerSchema,
  column: PositiveSafeIntegerSchema,
});

export const SourceFrameSchema = Schema.Struct({
  sourceItemId: SourceFileItemIdSchema,
  sha256: Sha256DigestSchema,
  start: SourcePositionSchema,
  end: SourcePositionSchema,
});

const SafeDiagnosticCauseSchema = Schema.Struct({
  code: SafeIdentifierSchema,
  summary: boundedSafeTextSchema(MAX_DIAGNOSTIC_CAUSE_SUMMARY_BYTES),
});

const DiagnosticRedactionSchema = Schema.Union(
  Schema.Struct({ state: Schema.Literal("none") }),
  Schema.Struct({
    state: Schema.Literal("applied"),
    summaryReplacements: NonNegativeSafeIntegerSchema,
    causeReplacements: NonNegativeSafeIntegerSchema,
    contextReplacements: NonNegativeSafeIntegerSchema,
  }),
);

const DiagnosticLimitContextSchema = Schema.Struct({
  kind: Schema.Literal("limit"),
  limit: Schema.Literal(
    "conversation-items",
    "commands",
    "usage-observations",
    "timing-intervals",
    "diagnostics",
    "command-stream-bytes",
  ),
  maximum: NonNegativeSafeIntegerSchema,
  observedAtLeast: NonNegativeSafeIntegerSchema,
});

const DiagnosticProviderContextSchema = Schema.Struct({
  kind: Schema.Literal("provider"),
  provider: SafeIdentifierSchema,
});

/**
 * The entity context is a single target rather than an array. Schema's generic
 * ref-array constructors cannot express the exclusion while preserving the
 * direct triple, so these declarations keep the exact input check local.
 */
const AttemptDiagnosticEntityContextSchema = Schema.Struct({
  kind: Schema.Literal("entity"),
  target: AttemptReferenceTargetSchema.pipe(
    Schema.filter((target): target is AttemptDiagnosticsReferences =>
      target.kind !== "diagnostic",
    ),
  ),
});

const RunDiagnosticEntityContextSchema = Schema.Struct({
  kind: Schema.Literal("entity"),
  target: RunReferenceTargetSchema.pipe(
    Schema.filter((target): target is RunDiagnosticsReferences =>
      target.kind !== "diagnostic",
    ),
  ),
});

const AttemptDiagnosticContextExactSchema = Schema.Union(
  AttemptDiagnosticEntityContextSchema,
  DiagnosticLimitContextSchema,
  DiagnosticProviderContextSchema,
);

const RunDiagnosticContextExactSchema = Schema.Union(
  RunDiagnosticEntityContextSchema,
  DiagnosticLimitContextSchema,
  DiagnosticProviderContextSchema,
);

export const AttemptDiagnosticSchema = Schema.Struct({
  diagnosticId: DiagnosticIdSchema,
  kind: Schema.Literal("advisory", "execution-error"),
  code: SafeIdentifierSchema,
  phase: AttemptDiagnosticPhaseSchema,
  summary: boundedSafeTextSchema(MAX_DIAGNOSTIC_SUMMARY_BYTES),
  causes: Schema.Array(SafeDiagnosticCauseSchema),
  context: Schema.Array(AttemptDiagnosticContextExactSchema),
  redaction: DiagnosticRedactionSchema,
  sourceFrame: Schema.NullOr(SourceFrameSchema),
  refs: AttemptDiagnosticsReferencesSchema,
});

export const RunDiagnosticSchema = Schema.Struct({
  diagnosticId: DiagnosticIdSchema,
  kind: Schema.Literal("advisory", "execution-error"),
  code: SafeIdentifierSchema,
  phase: RunDiagnosticPhaseSchema,
  summary: boundedSafeTextSchema(MAX_DIAGNOSTIC_SUMMARY_BYTES),
  causes: Schema.Array(SafeDiagnosticCauseSchema),
  context: Schema.Array(RunDiagnosticContextExactSchema),
  redaction: DiagnosticRedactionSchema,
  sourceFrame: Schema.NullOr(SourceFrameSchema),
  refs: RunDiagnosticsReferencesSchema,
});

export type SourcePosition = Schema.Schema.Type<typeof SourcePositionSchema>;
export type SourceFrame = Schema.Schema.Type<typeof SourceFrameSchema>;
export type SafeDiagnosticCause = Schema.Schema.Type<typeof SafeDiagnosticCauseSchema>;
export type DiagnosticRedaction = Schema.Schema.Type<typeof DiagnosticRedactionSchema>;
export type AttemptDiagnostic = Schema.Schema.Type<typeof AttemptDiagnosticSchema>;
export type RunDiagnostic = Schema.Schema.Type<typeof RunDiagnosticSchema>;

function sourcePositionBeforeOrEqual(
  left: SourcePosition,
  right: SourcePosition,
): boolean {
  return left.line < right.line || (left.line === right.line && left.column <= right.column);
}

function hasValidDiagnosticShape(
  diagnostic: {
    readonly causes: readonly SafeDiagnosticCause[];
    readonly context: readonly unknown[];
    readonly redaction: DiagnosticRedaction;
    readonly sourceFrame: SourceFrame | null;
  },
): boolean {
  if (
    diagnostic.causes.length > MAX_DIAGNOSTIC_CAUSES ||
    diagnostic.context.length > MAX_DIAGNOSTIC_CONTEXT_ITEMS
  ) {
    return false;
  }
  if (
    diagnostic.redaction.state === "applied" &&
    diagnostic.redaction.summaryReplacements === 0 &&
    diagnostic.redaction.causeReplacements === 0 &&
    diagnostic.redaction.contextReplacements === 0
  ) {
    return false;
  }
  return (
    diagnostic.sourceFrame === null ||
    sourcePositionBeforeOrEqual(diagnostic.sourceFrame.start, diagnostic.sourceFrame.end)
  );
}

const AttemptDiagnosticsAttachmentStructuralSchema = Schema.Struct({
  collection: CollectionSchema,
  diagnostics: Schema.Array(AttemptDiagnosticSchema),
});

function isCanonicalAttemptDiagnosticsAttachment(
  value: Schema.Schema.Type<typeof AttemptDiagnosticsAttachmentStructuralSchema>,
): boolean {
  return (
    value.diagnostics.length <= MAX_DIAGNOSTICS &&
    payloadFits(value, MAX_DIAGNOSTICS_ATTACHMENT_BYTES) &&
    isAllowedCollection(value.collection, ["diagnostic"]) &&
    isStrictlyOrderedById(value.diagnostics, (diagnostic) => diagnostic.diagnosticId) &&
    value.diagnostics.every(hasValidDiagnosticShape)
  );
}

export const AttemptDiagnosticsAttachmentSchema =
  AttemptDiagnosticsAttachmentStructuralSchema.pipe(
    Schema.filter(isCanonicalAttemptDiagnosticsAttachment, {
      identifier: "ObservabilityAttemptDiagnosticsAttachment",
      description: "a canonical, bounded attempt diagnostics attachment",
    }),
  );

export type AttemptDiagnosticsAttachment = Schema.Schema.Type<
  typeof AttemptDiagnosticsAttachmentSchema
>;

const RunDiagnosticsAttachmentStructuralSchema = Schema.Struct({
  collection: CollectionSchema,
  diagnostics: Schema.Array(RunDiagnosticSchema),
});

function isCanonicalRunDiagnosticsAttachment(
  value: Schema.Schema.Type<typeof RunDiagnosticsAttachmentStructuralSchema>,
): boolean {
  return (
    value.diagnostics.length <= MAX_DIAGNOSTICS &&
    payloadFits(value, MAX_DIAGNOSTICS_ATTACHMENT_BYTES) &&
    isAllowedCollection(value.collection, ["diagnostic"]) &&
    isStrictlyOrderedById(value.diagnostics, (diagnostic) => diagnostic.diagnosticId) &&
    value.diagnostics.every(hasValidDiagnosticShape)
  );
}

export const RunDiagnosticsAttachmentSchema = RunDiagnosticsAttachmentStructuralSchema.pipe(
  Schema.filter(isCanonicalRunDiagnosticsAttachment, {
    identifier: "ObservabilityRunDiagnosticsAttachment",
    description: "a canonical, bounded run diagnostics attachment",
  }),
);

export type RunDiagnosticsAttachment = Schema.Schema.Type<
  typeof RunDiagnosticsAttachmentSchema
>;
