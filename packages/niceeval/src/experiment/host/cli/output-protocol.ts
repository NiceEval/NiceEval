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
  setupPrefixes: Schema.Struct({
    total: NonNegativeIntegerSchema,
    hit: NonNegativeIntegerSchema,
    prepared: NonNegativeIntegerSchema,
    failed: NonNegativeIntegerSchema,
  }),
});

export const ExpTerminalEventSchema = Schema.Struct({
  type: Schema.Literal("receipt"),
  receipt: ExpInvocationReceiptSchema,
  summary: ExpTerminalSummarySchema,
});

export type ExpInvocationReceipt = Schema.Schema.Type<typeof ExpInvocationReceiptSchema>;
export type ExpTerminalSummary = Schema.Schema.Type<typeof ExpTerminalSummarySchema>;
export type ExpTerminalEvent = Schema.Schema.Type<typeof ExpTerminalEventSchema>;

/** Strictly decode the sole terminal envelope written by `niceeval exp --json`. */
export function decodeExpTerminalEvent(input: unknown): ExpTerminalEvent {
  return Schema.decodeUnknownSync(ExpTerminalEventSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
}
