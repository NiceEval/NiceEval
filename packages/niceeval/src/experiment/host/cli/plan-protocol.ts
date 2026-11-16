import { IdentityExplanationSchema } from "../../../runner/manifest.ts";
import { Schema } from "effect";

/** Shared strict comparison shape for every dry-plan projection. */
export const ExecutionComparisonSchema = Schema.Struct({
  attachment: Schema.Literals(["core", "niceeval.assertions", "niceeval.runner-activities"]),
  recordedClaim: Schema.Literals(["execution-identity", "attempt-outcome", "assertion-verdict", "execution-duration"]),
  sourceState: Schema.Literals(["available", "unavailable", "unsupported", "invalid"]),
  result: Schema.Literals(["match", "mismatch", "ineligible", "not-comparable"]),
  reason: Schema.String,
  explanation: Schema.optionalKey(IdentityExplanationSchema),
}).check(
  Schema.makeFilter(
    (comparison) =>
      comparison.recordedClaim !== "execution-identity" ||
      comparison.result !== "mismatch" ||
      comparison.explanation !== undefined,
  ),
);

const attachmentRead = <S extends Schema.ConstraintDecoder<unknown>>(value: S) =>
  Schema.Union([
    Schema.Struct({ state: Schema.Literal("available"), value }),
    Schema.Struct({ state: Schema.Literal("not-recorded") }),
    Schema.Struct({ state: Schema.Literal("unsupported"), family: Schema.String, revision: Schema.Number }),
    Schema.Struct({ state: Schema.Literal("invalid"), issues: Schema.Array(Schema.Unknown) }),
  ]);

const TargetSchema = Schema.Struct({
  runId: Schema.String,
  slotId: Schema.String,
  experimentId: Schema.String,
  evalId: Schema.String,
  executionIdentityDigest: Schema.optional(Schema.String),
  attempt: Schema.Number,
});
const SourceSchema = Schema.Struct({
  attemptId: Schema.String,
  locator: Schema.String,
  origin: Schema.Struct({ runId: Schema.String, slotId: Schema.String }),
  sourceBarrier: Schema.Struct({ runId: Schema.String, startedAt: Schema.Number }),
  evaluationKind: Schema.Literals(["pass", "score"]),
});
const ScoreSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("not-applicable") }),
  Schema.Struct({ state: Schema.Literal("applicable"), attachment: attachmentRead(Schema.Unknown) }),
]);
const ExecutionErrorsSchema = attachmentRead(
  Schema.Array(
    Schema.Struct({
      kind: Schema.Literal("execution-error"),
      code: Schema.String,
      phase: Schema.String,
      summary: Schema.String,
      causes: Schema.Array(Schema.Struct({ code: Schema.String, summary: Schema.String })),
    }),
  ),
);
const ReadbackSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("reused"),
    target: TargetSchema,
    source: SourceSchema,
    verdict: Schema.Literals(["passed", "failed"]),
    score: ScoreSchema,
    executionErrors: ExecutionErrorsSchema,
  }),
  Schema.Struct({
    state: Schema.Literal("prior"),
    target: TargetSchema,
    source: SourceSchema,
    verdict: attachmentRead(Schema.Literals(["passed", "failed", "errored", "skipped"])),
    score: ScoreSchema,
    executionErrors: ExecutionErrorsSchema,
    sourceFiles: Schema.Union([
      attachmentRead(Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String }))),
      Schema.Struct({ state: Schema.Literal("origin-run-missing") }),
      Schema.Struct({ state: Schema.Literal("origin-run-invalid"), issues: Schema.Array(Schema.Unknown) }),
      Schema.Struct({ state: Schema.Literal("projection-invalid") }),
    ]),
  }),
]);

/** The complete machine document emitted by `niceeval exp --dry --json`. */
export const ExpPlanDocumentSchema = Schema.Struct({
  total: Schema.Number,
  evals: Schema.Number,
  configs: Schema.Number,
  attempts: Schema.Number,
  reused: Schema.Number,
  matrix: Schema.Array(
    Schema.Struct({
      experimentId: Schema.String,
      evalId: Schema.String,
      evalGroupId: Schema.optional(Schema.String),
      evalGroupIndex: Schema.optional(Schema.Number),
      slots: Schema.Array(
        Schema.Struct({
          runId: Schema.String,
          slotId: Schema.String,
          experimentId: Schema.String,
          evalId: Schema.String,
          executionIdentityDigest: Schema.String,
          attempt: Schema.Number,
          evalGroupId: Schema.optional(Schema.String),
          evalGroupIndex: Schema.optional(Schema.Number),
          state: Schema.Literals(["reused", "gap"]),
          comparisons: Schema.Array(ExecutionComparisonSchema),
          issues: Schema.optional(
            Schema.Array(
              Schema.Struct({
                code: Schema.Literal("dynamic-module-unresolved"),
                path: Schema.Array(Schema.String),
                file: Schema.String,
                line: Schema.Number,
                column: Schema.Number,
              }),
            ),
          ),
          reason: Schema.optional(Schema.String),
          scope: Schema.optional(Schema.String),
        }),
      ),
      readbacks: Schema.Array(ReadbackSchema),
      locked: Schema.optional(Schema.Literal(true)),
    }),
  ),
  plugins: Schema.Array(Schema.Unknown),
});

/** Describes an exp invocation plan for machine consumers; reading a plan does not execute it or publish Attempt results. */
export type ExpPlanDocument = Schema.Schema.Type<typeof ExpPlanDocumentSchema>;

/** Strictly decode the single document written by `niceeval exp --dry --json`. */
export function decodeExpPlanDocument(input: unknown): ExpPlanDocument {
  return Schema.decodeUnknownSync(ExpPlanDocumentSchema, { errors: "all", onExcessProperty: "error" })(input);
}

/** Strict decoder for comparisons printed by accept preflight diagnostics. */
export function decodeExecutionComparisons(input: unknown) {
  return Schema.decodeUnknownSync(Schema.Array(ExecutionComparisonSchema), {
    errors: "all",
    onExcessProperty: "error",
  })(input);
}
