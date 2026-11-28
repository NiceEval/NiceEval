import { Schema } from "effect";

export const EXP_FORMAT = "niceeval.exp";
export const EXP_VERSION = 1;
export const ExperimentOutputFields = { experimentId: Schema.String, displayName: Schema.String };

const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0)),
);

const NonNegativeNumberSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isFinite(value) && value >= 0)),
);

/** Provider-native access and cleanup for a retained Attempt scene. */
export const ExpKeptEventSchema = Schema.Struct({
  event: Schema.Literal("kept"),
  ...ExperimentOutputFields,
  locator: Schema.String,
  evalId: Schema.String,
  attempt: NonNegativeIntegerSchema,
  verdict: Schema.Literals(["passed", "failed", "errored"]),
  provider: Schema.String,
  sandboxId: Schema.String,
  nativeCommand: Schema.String,
  cleanCommand: Schema.String,
  // JSON event keys are observable; providers without an expiry omit this key.
  expiresAt: Schema.optionalKey(Schema.String),
});

/** Reports one retained Sandbox with the provider-native commands to enter and destroy it; NiceEval keeps no registry for it. */
export type ExpKeptEvent = Schema.Schema.Type<typeof ExpKeptEventSchema>;

/** Strictly decode one `kept` event written by `niceeval exp --json`; extra keys are rejected. */
export function decodeExpKeptEvent(input: unknown): ExpKeptEvent {
  return Schema.decodeUnknownSync(ExpKeptEventSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
}

/** The initial execution scale emitted by `niceeval exp --json`. */
export const ExpStartEventSchema = Schema.Struct({
  event: Schema.Literal("start"),
  format: Schema.Literal(EXP_FORMAT),
  schemaVersion: Schema.Literal(EXP_VERSION),
  experiments: Schema.Array(Schema.Struct(ExperimentOutputFields)),
  total: NonNegativeIntegerSchema,
  configs: NonNegativeIntegerSchema,
  concurrency: NonNegativeIntegerSchema,
  experimentConcurrency: Schema.optional(Schema.Record(Schema.String, NonNegativeIntegerSchema)),
  reused: NonNegativeIntegerSchema,
});

/** Carries the planned execution scale before progress or terminal events. */
export type ExpStartEvent = Schema.Schema.Type<typeof ExpStartEventSchema>;

/** Strictly decode the initial exp stream event using the candidate's Schema runtime. */
export function decodeExpStartEvent(input: unknown): ExpStartEvent {
  return Schema.decodeUnknownSync(ExpStartEventSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
}

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

/** Invocation-local preparation observation; it never carries command inputs. */
export const ExpPrepareObservationSchema = Schema.Struct({
  event: Schema.Literal("prepare"),
  node: NonNegativeIntegerSchema,
  pairings: Schema.Array(Schema.Struct({ experimentId: Schema.String, evalId: Schema.String })),
  pairingsOmitted: NonNegativeIntegerSchema,
  action: Schema.Struct({ index: NonNegativeIntegerSchema, total: NonNegativeIntegerSchema, id: Schema.String }),
  phase: Schema.Literals(["lookup", "waiting", "staging", "action", "publish", "settled"]),
  elapsedMs: NonNegativeNumberSchema,
  outcome: Schema.optionalKey(Schema.Literals(["hit", "published", "continued", "degraded", "failed"])),
  reason: Schema.optionalKey(Schema.String),
});
export type ExpPrepareObservation = Schema.Schema.Type<typeof ExpPrepareObservationSchema>;
export const ExpPrepareEventSchema = ExpPrepareObservationSchema.pipe(
  Schema.fieldsAssign({ pairings: Schema.Array(Schema.Struct({ ...ExperimentOutputFields, evalId: Schema.String })) }),
);
/** One `exp --json` line for a pre-dispatch before-cache preparation node: start, phase change or settlement. */
export type ExpPrepareEvent = Schema.Schema.Type<typeof ExpPrepareEventSchema>;
/** Strictly decodes one `prepare` NDJSON event from `exp --json`; throws when the shape does not match. */
export function decodeExpPrepareEvent(input: unknown): ExpPrepareEvent {
  return Schema.decodeUnknownSync(ExpPrepareEventSchema, { errors: "all", onExcessProperty: "error" })(input);
}

/** An Attempt's transient phase or Adapter detail emitted during `exp --json`. */
export const ExpActivityEventSchema = Schema.Struct({
  event: Schema.Literal("activity"),
  ...ExperimentOutputFields,
  evalId: Schema.String,
  attempt: NonNegativeIntegerSchema,
  phase: Schema.String,
  detail: Schema.optional(Schema.String),
});
/** Transient Attempt activity with the Experiment ID and display name from the invocation plan. */
export type ExpActivityEvent = Schema.Schema.Type<typeof ExpActivityEventSchema>;

/** Strictly decodes an `activity` event emitted by `niceeval exp --json`. */
export function decodeExpActivityEvent(input: unknown): ExpActivityEvent {
  return Schema.decodeUnknownSync(ExpActivityEventSchema, { errors: "all", onExcessProperty: "error" })(input);
}

/** Transient Invocation counts at a heartbeat. */
export const ExpProgressEventSchema = Schema.Struct({
  event: Schema.Literal("progress"),
  elapsedMs: NonNegativeNumberSchema,
  total: NonNegativeIntegerSchema,
  reused: NonNegativeIntegerSchema,
  running: NonNegativeIntegerSchema,
  preparing: NonNegativeIntegerSchema,
  elsewhere: NonNegativeIntegerSchema,
  queued: NonNegativeIntegerSchema,
  passed: NonNegativeIntegerSchema,
  failed: NonNegativeIntegerSchema,
  errored: NonNegativeIntegerSchema,
  skipped: NonNegativeIntegerSchema,
});
/** An exp stream event decoded by the package-owned decoder; do not reinterpret its Schema with a different Effect runtime. */
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
  ...ExperimentOutputFields,
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
