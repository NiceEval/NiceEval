import { Schema } from "effect";

const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0)),
);

const NonNegativeNumberSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isFinite(value) && value >= 0)),
);

export const ExpInvocationReceiptSchema = Schema.Struct({
  invocationId: Schema.String,
  createdRunIds: Schema.Array(Schema.String),
  publicationCutoff: Schema.String,
  startedAt: Schema.String,
  completedAt: Schema.optional(Schema.String),
  completion: Schema.Literals(["completed", "interrupted", "failed"]),
});

export const ExpTerminalSummarySchema = Schema.Struct({
  startedAt: Schema.String,
  completedAt: Schema.String,
  passed: NonNegativeIntegerSchema,
  failed: NonNegativeIntegerSchema,
  skipped: NonNegativeIntegerSchema,
  errored: NonNegativeIntegerSchema,
  durationMs: NonNegativeNumberSchema,
  inputTokens: Schema.optional(NonNegativeIntegerSchema),
  outputTokens: Schema.optional(NonNegativeIntegerSchema),
  estimatedCostUSD: Schema.optional(NonNegativeNumberSchema),
  beforeCaches: Schema.Struct({
    total: NonNegativeIntegerSchema,
    hit: NonNegativeIntegerSchema,
    prepared: NonNegativeIntegerSchema,
    degraded: NonNegativeIntegerSchema,
    failed: NonNegativeIntegerSchema,
  }),
});

export const ExpTerminalEventSchema = Schema.Struct({
  type: Schema.Literal("receipt"),
  receipt: ExpInvocationReceiptSchema,
  summary: ExpTerminalSummarySchema,
});

/** Bounded, transient snapshot; it does not assert Attempt publication. */
export const ExpProgressEventSchema = Schema.Struct({
  event: Schema.Literal("progress"),
  elapsedMs: NonNegativeNumberSchema,
  total: NonNegativeIntegerSchema,
  reused: NonNegativeIntegerSchema,
  running: NonNegativeIntegerSchema,
  elsewhere: NonNegativeIntegerSchema,
  queued: NonNegativeIntegerSchema,
  passed: NonNegativeIntegerSchema,
  failed: NonNegativeIntegerSchema,
  errored: NonNegativeIntegerSchema,
  skipped: NonNegativeIntegerSchema,
  active: Schema.Array(Schema.Struct({
    experimentId: Schema.optional(Schema.String),
    evalId: Schema.String,
    attempt: NonNegativeIntegerSchema,
    phase: Schema.String,
    elapsedMs: NonNegativeNumberSchema,
  })).check(Schema.makeFilter((value) => value.length <= 64)),
  activeOmitted: NonNegativeIntegerSchema,
});
/** A versioned exp stream event decoded by the package-owned decoder; do not reinterpret its Schema with a different Effect runtime. */
export type ExpProgressEvent = Schema.Schema.Type<typeof ExpProgressEventSchema>;

/** Strictly decodes one exp progress event and rejects unknown properties. Use this decoder at the package boundary instead of rebuilding its Schema in another runtime. */
export function decodeExpProgressEvent(input: unknown): ExpProgressEvent {
  return Schema.decodeUnknownSync(ExpProgressEventSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
}

/** One Run-owned failure observed before any affected Attempt is dispatched. */
export const ExpDiagnosticEventSchema = Schema.Struct({
  event: Schema.Literal("diagnostic"),
  code: Schema.String,
  level: Schema.Literal("error"),
  message: Schema.String,
  experimentId: Schema.String,
  phase: Schema.optional(Schema.String),
});
/** Carries one structured diagnostic in the exp JSON stream; diagnostics are distinct from terminal completion and invocation receipts. */
export type ExpDiagnosticEvent = Schema.Schema.Type<typeof ExpDiagnosticEventSchema>;

/** Lists the Runs created by one Invocation and its publication cutoff; a completed Invocation does not imply all Attempts passed. */
export type ExpInvocationReceipt = Schema.Schema.Type<typeof ExpInvocationReceiptSchema>;
/** Summarizes the terminal exp outcome; absent usage or cost fields must not be inferred to be zero. */
export type ExpTerminalSummary = Schema.Schema.Type<typeof ExpTerminalSummarySchema>;
/** Closes the exp event stream with completion information; use the receipt to locate published Runs rather than relying on progress messages. */
export type ExpTerminalEvent = Schema.Schema.Type<typeof ExpTerminalEventSchema>;

/** Strictly decode the sole terminal envelope written by `niceeval exp --json`. */
export function decodeExpTerminalEvent(input: unknown): ExpTerminalEvent {
  return Schema.decodeUnknownSync(ExpTerminalEventSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
}
