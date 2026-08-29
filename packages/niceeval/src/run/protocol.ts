import { Result, Schema } from "effect";

export const RUN_PROTOCOL = "niceeval.run/v1" as const;
export const EMPTY_PUBLICATION_CUTOFF_IDENTITY = "niceeval.empty-publication-cutoff/v1" as const;

const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0)),
);

export const RunStateSchema = Schema.Literals([
  "active",
  "completed",
  "interrupted",
  "failed",
]);

export const RUN_ABSENCE_REASONS = [
  "early-exit-satisfied",
  "budget-exhausted",
  "stopped-by-failure",
  "interrupted-before-publication",
  "dispatch-failed",
] as const;

export const RunAbsenceReasonSchema = Schema.Literals(RUN_ABSENCE_REASONS);

export const RunPendingPublicationSchema = Schema.Struct({ state: Schema.Literal("pending") });
export const RunPublishedPublicationSchema = Schema.Struct({
    state: Schema.Literal("published"),
    action: Schema.Literals(["executed", "carried", "accepted"]),
    attemptId: Schema.String,
    attemptLocator: Schema.String,
    originRunId: Schema.String,
    originSlotId: Schema.String,
  });
export const RunAbsentPublicationSchema = Schema.Struct({
    state: Schema.Literal("absent"),
    reason: RunAbsenceReasonSchema,
  });

export const RunSlotPublicationSchema = Schema.Union([
  RunPendingPublicationSchema,
  RunPublishedPublicationSchema,
  RunAbsentPublicationSchema,
]);

export const RunSlotSchema = Schema.Struct({
  slotId: Schema.String,
  evalId: Schema.String,
  attemptOrdinal: NonNegativeIntegerSchema,
  executionIdentityDigest: Schema.String,
  publication: RunSlotPublicationSchema,
});

const RunCoverageSchema = Schema.Struct({
  published: NonNegativeIntegerSchema,
  expected: NonNegativeIntegerSchema,
  missing: NonNegativeIntegerSchema,
});

export const RunSummarySchema = Schema.Struct({
  runId: Schema.String,
  invocationId: Schema.String,
  experimentId: Schema.String,
  state: RunStateSchema,
  startedAt: Schema.String,
  completedAt: Schema.optional(Schema.String),
  coverage: RunCoverageSchema,
});

export const RunDetailSchema = RunSummarySchema.pipe(Schema.fieldsAssign({
  slots: Schema.Array(RunSlotSchema),
}));

export const PublicationCutoffSchema = Schema.Struct({
  identity: Schema.String,
  revision: NonNegativeIntegerSchema,
});

export const RunListDocumentSchema = Schema.Struct({
  protocol: Schema.Literal(RUN_PROTOCOL),
  operation: Schema.Literal("run.list"),
  runs: Schema.Array(RunSummarySchema),
  continuation: Schema.optional(Schema.String),
});

export const RunGetDocumentSchema = Schema.Struct({
  protocol: Schema.Literal(RUN_PROTOCOL),
  operation: Schema.Literal("run.get"),
  run: RunDetailSchema,
});

export const RunDocumentSchema = Schema.Union([
  RunListDocumentSchema,
  RunGetDocumentSchema,
]);

export type RunState = Schema.Schema.Type<typeof RunStateSchema>;
export type RunAbsenceReason = Schema.Schema.Type<typeof RunAbsenceReasonSchema>;
export type RunSlotPublication = Schema.Schema.Type<typeof RunSlotPublicationSchema>;
export type RunSlot = Schema.Schema.Type<typeof RunSlotSchema>;
export type RunSummary = Schema.Schema.Type<typeof RunSummarySchema>;
export type RunDetail = Schema.Schema.Type<typeof RunDetailSchema>;
export type PublicationCutoff = Schema.Schema.Type<typeof PublicationCutoffSchema>;
export type RunListDocument = Schema.Schema.Type<typeof RunListDocumentSchema>;
export type RunGetDocument = Schema.Schema.Type<typeof RunGetDocumentSchema>;
export type RunDocument = Schema.Schema.Type<typeof RunDocumentSchema>;

export type RunProtocolDecodeResult<Value extends RunDocument = RunDocument> =
  | { readonly success: true; readonly value: Value }
  | { readonly success: false; readonly reason: string };

/** Strictly decode one public read-only `niceeval.run/v1` document. */
export function decodeRunDocument(input: unknown): RunProtocolDecodeResult {
  const decoded = Schema.decodeUnknownResult(RunDocumentSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
  return Result.isSuccess(decoded)
    ? { success: true, value: decoded.success }
    : { success: false, reason: String(decoded.failure) };
}
