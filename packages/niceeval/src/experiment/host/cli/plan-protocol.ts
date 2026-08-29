import { Schema } from "effect";

const attachmentRead = <S extends Schema.ConstraintDecoder<unknown>>(value: S) => Schema.Union([
  Schema.Struct({ state: Schema.Literal("available"), value }),
  Schema.Struct({ state: Schema.Literal("not-recorded") }),
  Schema.Struct({ state: Schema.Literal("migration-required"), family: Schema.String, fromRevision: Schema.Number, toRevision: Schema.Number, command: Schema.Literal("niceeval migrate") }),
  Schema.Struct({ state: Schema.Literal("unsupported"), family: Schema.String, revision: Schema.Number }),
  Schema.Struct({ state: Schema.Literal("invalid"), issues: Schema.Array(Schema.Unknown) }),
]);

const TargetSchema = Schema.Struct({ runId: Schema.String, slotId: Schema.String, experimentId: Schema.String, evalId: Schema.String, attempt: Schema.Number });
const SourceSchema = Schema.Struct({
  attemptId: Schema.String,
  locator: Schema.String,
  origin: Schema.Struct({ runId: Schema.String, slotId: Schema.String }),
  sourceBarrier: Schema.Struct({ runId: Schema.String, startedAt: Schema.Number }),
  evaluationKind: Schema.Literals(["eval", "score"]),
});
const ScoreSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("not-applicable") }),
  Schema.Struct({ state: Schema.Literal("applicable"), attachment: attachmentRead(Schema.Unknown) }),
]);
const ExecutionErrorsSchema = attachmentRead(Schema.Array(Schema.Struct({
  kind: Schema.Literal("execution-error"), code: Schema.String, phase: Schema.String, summary: Schema.String,
  causes: Schema.Array(Schema.Struct({ code: Schema.String, summary: Schema.String })),
})));
const ReadbackSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("reused"), target: TargetSchema, source: SourceSchema, verdict: Schema.Literals(["passed", "failed"]), score: ScoreSchema, executionErrors: ExecutionErrorsSchema }),
  Schema.Struct({
    state: Schema.Literal("prior"), target: TargetSchema, source: SourceSchema,
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
  format: Schema.Literal("niceeval.current-reuse-plan/v1"),
  schemaVersion: Schema.Literal(1),
  total: Schema.Number,
  evals: Schema.Number,
  configs: Schema.Number,
  attempts: Schema.Number,
  reused: Schema.Number,
  matrix: Schema.Array(Schema.Struct({
    experimentId: Schema.String,
    evalId: Schema.String,
    evalGroupId: Schema.optional(Schema.String),
    evalGroupIndex: Schema.optional(Schema.Number),
    slots: Schema.Array(Schema.Struct({
      runId: Schema.String,
      slotId: Schema.String,
      experimentId: Schema.String,
      evalId: Schema.String,
      attempt: Schema.Number,
      state: Schema.Literals(["reused", "gap"]),
      comparisons: Schema.Array(Schema.Unknown),
      reason: Schema.optional(Schema.String),
      scope: Schema.optional(Schema.String),
    })),
    readbacks: Schema.Array(ReadbackSchema),
    locked: Schema.optional(Schema.Literal(true)),
  })),
  plugins: Schema.Array(Schema.Unknown),
});

export type ExpPlanDocument = Schema.Schema.Type<typeof ExpPlanDocumentSchema>;

/** Strictly decode the single document written by `niceeval exp --dry --json`. */
export function decodeExpPlanDocument(input: unknown): ExpPlanDocument {
  return Schema.decodeUnknownSync(ExpPlanDocumentSchema, { errors: "all", onExcessProperty: "error" })(input);
}
