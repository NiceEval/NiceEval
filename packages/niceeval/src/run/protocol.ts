import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

export const EMPTY_PUBLICATION_CUTOFF_IDENTITY = "niceeval.empty-publication-cutoff" as const;

const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0)),
);

export const RunStateSchema = Schema.Literals(["active", "recovering", "completed", "interrupted", "failed"]);

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

/** Observe a live Run owner; unknown observations explain why recovery cannot be authorized. */
export const RunOwnerObservationSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["alive", "gone"]), observedAt: Schema.String }),
  Schema.Struct({
    state: Schema.Literal("unknown"),
    reason: Schema.Literals(["other-host", "identity-not-recorded", "portable-record", "probe-failed"]),
    observedAt: Schema.String,
  }),
]);

export const RunSummarySchema = Schema.Struct({
  runId: Schema.String,
  invocationId: Schema.String,
  experimentId: Schema.String,
  state: RunStateSchema,
  startedAt: Schema.String,
  completedAt: Schema.optional(Schema.String),
  coverage: RunCoverageSchema,
  /** Present only for active or recovering Runs; never use this observation as mutation authority. */
  owner: Schema.optional(RunOwnerObservationSchema),
});

export const RunDetailSchema = RunSummarySchema.pipe(
  Schema.fieldsAssign({
    slots: Schema.Array(RunSlotSchema),
  }),
);

export const PublicationCutoffSchema = Schema.Struct({
  identity: Schema.String,
  revision: NonNegativeIntegerSchema,
});

export const RunListDocumentSchema = Schema.Struct({
  operation: Schema.Literal("run.list"),
  runs: Schema.Array(RunSummarySchema),
  /** Count matching Runs excluded by the requested limit at the same cutoff. */
  omitted: NonNegativeIntegerSchema,
  continuation: Schema.optional(Schema.String),
});

export const RunGetDocumentSchema = Schema.Struct({
  operation: Schema.Literal("run.get"),
  run: RunDetailSchema,
});

export const RunImportDocumentSchema = Schema.Struct({
  operation: Schema.Literal("run.import"),
  outcome: Schema.Literals(["imported", "already-present"]),
  imported: Schema.Array(Schema.String),
  alreadyPresent: Schema.Array(Schema.String),
});
export const RunExportDocumentSchema = Schema.Struct({
  operation: Schema.Literal("run.export"),
  outcome: Schema.Literal("exported"),
  runIds: Schema.Array(Schema.String),
});

/** Decode the independent outcomes returned by `run recover --orphaned --yes --json`. */
export const RunRecoverOrphanedDocumentSchema = Schema.Struct({
  operation: Schema.Literal("run.recover-orphaned"),
  items: Schema.Array(
    Schema.Struct({
      runId: Schema.String,
      outcome: Schema.Literals(["recovered", "skipped", "failed"]),
      reason: Schema.optional(Schema.String),
    }),
  ),
});

export const RunDocumentSchema = Schema.Union([
  RunImportDocumentSchema,
  RunExportDocumentSchema,
  RunListDocumentSchema,
  RunGetDocumentSchema,
  RunRecoverOrphanedDocumentSchema,
]);

/** Describes Run publication lifecycle rather than evaluation quality; a completed Run can contain failed Attempts. */
export type RunState = Schema.Schema.Type<typeof RunStateSchema>;
/** Explains why a terminal Run has no published Attempt for one planned slot; absence is not a failed or lost Attempt. */
export type RunAbsenceReason = Schema.Schema.Type<typeof RunAbsenceReasonSchema>;
/** Distinguishes pending, published and terminally absent slots; a published reference preserves the Attempt's original Run identity. */
export type RunSlotPublication = Schema.Schema.Type<typeof RunSlotPublicationSchema>;
/** Identifies a frozen planned Attempt slot with a zero-based ordinal; its publication field determines whether an Attempt is available. */
export type RunSlot = Schema.Schema.Type<typeof RunSlotSchema>;
/** Summarizes Run identity, lifecycle and expected versus published coverage; missing members are not automatically failed evaluations. */
export type RunSummary = Schema.Schema.Type<typeof RunSummarySchema>;
/** Describes a Run and its frozen planned slots with publication state; expected membership may exceed published membership. */
export type RunDetail = Schema.Schema.Type<typeof RunDetailSchema>;
/** Pins a Record identity and publication revision for consistent reads; it is not a wall-clock timestamp. */
export type PublicationCutoff = Schema.Schema.Type<typeof PublicationCutoffSchema>;
/** Carries a page of Run summaries and optional continuation; Run creation makes an active Run discoverable before Attempts finish. */
export type RunListDocument = Schema.Schema.Type<typeof RunListDocumentSchema>;
/** Read the owner state and observation time attached to a nonterminal Run. */
export type RunOwnerObservation = Schema.Schema.Type<typeof RunOwnerObservationSchema>;
/** Inspect each recovered, skipped, or failed Run after an orphan recovery request. */
export type RunRecoverOrphanedDocument = Schema.Schema.Type<typeof RunRecoverOrphanedDocumentSchema>;
/** Carries exact Run detail in the machine protocol; it is a readonly value rather than a live lifecycle handle. */
export type RunGetDocument = Schema.Schema.Type<typeof RunGetDocumentSchema>;
/** A Run machine document; inspect operation before consuming operation-specific data. */
export type RunDocument = Schema.Schema.Type<typeof RunDocumentSchema>;

/** Returns a validated Run document or rejection reason; successful protocol decoding does not imply successful evaluation quality. */
export type RunProtocolDecodeResult<Value extends RunDocument = RunDocument> =
  | { readonly success: true; readonly value: Value }
  | { readonly success: false; readonly reason: string };

/** Strictly decode one public Run machine document. */
export function decodeRunDocument(input: unknown): RunProtocolDecodeResult {
  const decoded = Schema.decodeUnknownResult(RunDocumentSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
  return Result.isSuccess(decoded)
    ? { success: true, value: decoded.success }
    : { success: false, reason: String(decoded.failure) };
}
