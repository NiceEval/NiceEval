// Native Fact/use result record. Schema 18 stores the graph directly in
// result.json; no assertion compatibility envelope is read or written.

import { Either, ParseResult, Schema } from "effect";
import type {
  EvaluationFactResult,
  ScoreFactAttemptOutcome,
  ScoreFactUseResult,
  VerdictFactUseResult,
} from "../assertions/types.ts";
import type { EvalResult, EvaluationAlgorithm } from "../runner/types.ts";
import type { Verdict } from "../shared/types.ts";
import {
  attemptTerminalOf as sharedAttemptTerminalOf,
  verdictForTerminal as sharedVerdictForTerminal,
} from "../shared/verdict.ts";

export const FACT_USE_EVALUATION_ALGORITHM = "fact-use/v3" as const satisfies EvaluationAlgorithm;

export type FactUseResult = VerdictFactUseResult | ScoreFactUseResult;
export type ScoreAttemptStatus = ScoreFactAttemptOutcome["status"];
export type AttemptTerminal = Verdict | ScoreAttemptStatus;

export interface FactRecordEnvelope {
  readonly evaluationAlgorithm: typeof FACT_USE_EVALUATION_ALGORITHM;
  readonly evaluationKind: "pass" | "score";
  readonly factResults: readonly EvaluationFactResult[];
  readonly factUses: readonly FactUseResult[];
  readonly scoreResult?: ScoreFactAttemptOutcome;
}

export type FactRecordResult = EvalResult & FactRecordEnvelope;

type UnknownRecord = globalThis.Record<string, unknown>;

const NonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1, {
  description: "a non-empty string",
}));
const FiniteNumberSchema = Schema.Number.pipe(Schema.finite());
const NonNegativeFiniteNumberSchema = FiniteNumberSchema.pipe(Schema.nonNegative());
const UnitIntervalSchema = FiniteNumberSchema.pipe(Schema.between(0, 1));
const NonNegativeSafeIntegerSchema = Schema.Number.pipe(Schema.filter(
  (value) => Number.isSafeInteger(value) && value >= 0,
  { description: "a non-negative safe integer" },
));
const EvaluatorErrorSchema = Schema.Struct({
  class: Schema.Literal("evaluator"),
  code: NonEmptyStringSchema,
  message: Schema.String,
});
const AttemptFactErrorSchema = Schema.Struct({
  class: Schema.Literal("agent", "execution", "author", "evaluator"),
  code: Schema.String,
  message: Schema.String,
});
const UnavailableAttemptIssueSchema = Schema.Struct({
  kind: Schema.Literal("unavailable"),
  reason: Schema.String,
  factId: Schema.optional(Schema.String),
  useSourceOrder: Schema.optional(Schema.Number),
});
const ErrorAttemptIssueSchema = Schema.Struct({
  kind: Schema.Literal("error"),
  error: AttemptFactErrorSchema,
  factId: Schema.optional(Schema.String),
  useSourceOrder: Schema.optional(Schema.Number),
});
const AttemptFactIssueSchema = Schema.Union(UnavailableAttemptIssueSchema, ErrorAttemptIssueSchema);

const FactResultBaseSchema = Schema.Struct({
  factId: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  dependencyFactIds: Schema.Array(Schema.String),
  sourceOrder: NonNegativeSafeIntegerSchema,
  expected: Schema.optional(Schema.String),
  received: Schema.optional(Schema.String),
  explanation: Schema.optional(Schema.String),
  evidence: Schema.optional(Schema.String),
});
const EvaluationFactResultSchema = Schema.Union(
  FactResultBaseSchema.pipe(Schema.extend(Schema.Struct({
    factKind: Schema.Literal("boolean"),
    outcome: Schema.Literal("passed", "failed"),
  }))),
  FactResultBaseSchema.pipe(Schema.extend(Schema.Struct({
    factKind: Schema.Literal("score"),
    outcome: Schema.Literal("scored"),
    normalizedScore: UnitIntervalSchema,
  }))),
  FactResultBaseSchema.pipe(Schema.extend(Schema.Struct({
    factKind: Schema.Literal("boolean", "score"),
    outcome: Schema.Literal("unavailable", "notReachedByControl", "notReachedByError"),
    reason: NonEmptyStringSchema,
  }))),
  FactResultBaseSchema.pipe(Schema.extend(Schema.Struct({
    factKind: Schema.Literal("boolean", "score"),
    outcome: Schema.Literal("errored"),
    error: EvaluatorErrorSchema,
  }))),
);

const VerdictUseBaseSchema = Schema.Struct({
  useKind: Schema.Literal("verdict"),
  method: Schema.Literal("check", "require", "checkIfCovered"),
  label: Schema.optional(Schema.String),
  sourceOrder: NonNegativeSafeIntegerSchema,
  key: Schema.optional(NonEmptyStringSchema),
  target: Schema.Union(
    Schema.Struct({ kind: Schema.Literal("boolean"), factId: NonEmptyStringSchema }),
    Schema.Struct({ kind: Schema.Literal("score"), factId: NonEmptyStringSchema, atLeast: UnitIntervalSchema }),
  ),
});
const VerdictFactUseSchema = Schema.Union(
  VerdictUseBaseSchema.pipe(Schema.extend(Schema.Struct({ outcome: Schema.Literal("passed", "failed") }))),
  VerdictUseBaseSchema.pipe(Schema.extend(Schema.Struct({
    outcome: Schema.Literal("unavailable", "notApplicable", "notReachedByControl", "notReachedByError"),
    reason: NonEmptyStringSchema,
  }))),
  VerdictUseBaseSchema.pipe(Schema.extend(Schema.Struct({
    outcome: Schema.Literal("errored"),
    error: EvaluatorErrorSchema,
  }))),
);
const ScoreUseBaseSchema = Schema.Struct({
  useKind: Schema.Literal("score"),
  label: NonEmptyStringSchema,
  sourceOrder: NonNegativeSafeIntegerSchema,
  key: Schema.optional(NonEmptyStringSchema),
  input: Schema.Struct({
    kind: Schema.Literal("fact"),
    factId: NonEmptyStringSchema,
    max: FiniteNumberSchema,
  }),
});
const ScoreFactUseSchema = Schema.Union(
  Schema.Struct({
    useKind: Schema.Literal("score"),
    label: NonEmptyStringSchema,
    sourceOrder: NonNegativeSafeIntegerSchema,
    key: Schema.optional(NonEmptyStringSchema),
    input: Schema.Struct({ kind: Schema.Literal("direct"), earned: FiniteNumberSchema }),
    outcome: Schema.Literal("scored"),
    earned: NonNegativeFiniteNumberSchema,
  }),
  ScoreUseBaseSchema.pipe(Schema.extend(Schema.Struct({
    outcome: Schema.Literal("scored"),
    earned: NonNegativeFiniteNumberSchema,
  }))),
  ScoreUseBaseSchema.pipe(Schema.extend(Schema.Struct({
    outcome: Schema.Literal("unavailable", "notReachedByControl", "notReachedByError"),
    reason: NonEmptyStringSchema,
  }))),
  ScoreUseBaseSchema.pipe(Schema.extend(Schema.Struct({
    outcome: Schema.Literal("errored"),
    error: EvaluatorErrorSchema,
  }))),
);
const FactUseResultSchema = Schema.Union(VerdictFactUseSchema, ScoreFactUseSchema);

const ScoreFactAttemptOutcomeSchema = Schema.Union(
  Schema.Struct({
    status: Schema.Literal("scored"),
    earnedScore: NonNegativeFiniteNumberSchema,
    creditedScore: FiniteNumberSchema,
  }),
  Schema.Struct({
    status: Schema.Literal("invalid"),
    earnedScore: NonNegativeFiniteNumberSchema,
    creditedScore: Schema.Literal(0),
    issues: Schema.Array(AttemptFactIssueSchema),
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    earnedScore: NonNegativeFiniteNumberSchema,
    creditedScore: Schema.Literal(null),
    issues: Schema.NonEmptyArray(UnavailableAttemptIssueSchema),
  }),
  Schema.Struct({
    status: Schema.Literal("errored"),
    earnedScore: NonNegativeFiniteNumberSchema,
    creditedScore: Schema.Literal(null),
    errors: Schema.NonEmptyArray(ErrorAttemptIssueSchema),
    issues: Schema.Array(UnavailableAttemptIssueSchema),
  }),
  Schema.Struct({
    status: Schema.Literal("skipped"),
    earnedScore: NonNegativeFiniteNumberSchema,
    creditedScore: Schema.Literal(null),
    reason: Schema.String,
  }),
);
const FactRecordEnvelopeSchema: Schema.Schema<FactRecordEnvelope> = Schema.Struct({
  evaluationAlgorithm: Schema.Literal(FACT_USE_EVALUATION_ALGORITHM),
  evaluationKind: Schema.Literal("pass", "score"),
  factResults: Schema.Array(EvaluationFactResultSchema),
  factUses: Schema.Array(FactUseResultSchema),
  scoreResult: Schema.optional(ScoreFactAttemptOutcomeSchema),
});

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaPath(context: string, path: ReadonlyArray<PropertyKey>): string {
  let formatted = context;
  for (const segment of path) {
    formatted += typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`;
  }
  return formatted;
}

function assertSchema<A>(value: unknown, schema: Schema.Schema<A>, context: string): asserts value is A {
  const decoded = Schema.decodeUnknownEither(schema)(value);
  if (Either.isRight(decoded)) return;
  const issue = ParseResult.ArrayFormatter.formatErrorSync(decoded.left)[0];
  if (issue === undefined) throw new Error(`${context} is invalid.`);
  throw new Error(`${schemaPath(context, issue.path)} ${issue.message}.`);
}

function assertFactGraphInvariants(value: FactRecordEnvelope, context: string): void {
  const facts = new Set<string>();
  for (const [index, fact] of value.factResults.entries()) {
    const path = `${context}.factResults[${index}]`;
    if (facts.has(fact.factId)) throw new Error(`${path}.factId duplicates ${JSON.stringify(fact.factId)}.`);
    facts.add(fact.factId);
  }
  const keys = new Set<string>();
  for (const [index, use] of value.factUses.entries()) {
    const path = `${context}.factUses[${index}]`;
    if (use.key !== undefined) {
      if (keys.has(use.key)) throw new Error(`${path}.key duplicates ${JSON.stringify(use.key)}.`);
      keys.add(use.key);
    }
    const factId = use.useKind === "verdict"
      ? use.target.factId
      : use.input.kind === "fact" ? use.input.factId : undefined;
    if (factId !== undefined && !facts.has(factId)) {
      throw new Error(`${path} references unknown Fact ${JSON.stringify(factId)}.`);
    }
    if (use.useKind === "verdict" && use.method === "checkIfCovered" && use.target.kind !== "boolean") {
      throw new Error(`${path}.method checkIfCovered requires a boolean usage evidence Fact.`);
    }
  }
  if (value.evaluationKind === "score") {
    if (value.scoreResult === undefined) throw new Error(`${context}.scoreResult is required for score Eval.`);
  } else if (value.scoreResult !== undefined) {
    throw new Error(`${context}.scoreResult is only valid for score Eval.`);
  }
}

/** Reject old or hybrid result objects. There is no partial compatibility reader. */
export function assertFactRecord(value: unknown, context = "Fact Record"): asserts value is FactRecordEnvelope {
  if (!isRecord(value)) throw new Error(`${context} must be an object.`);
  for (const legacyField of ["assertions", "scoreEntries", "factTrace", "legacyJudgeAssertions"] as const) {
    if (legacyField in value) throw new Error(`${context} contains unsupported legacy field ${JSON.stringify(legacyField)}.`);
  }
  assertSchema(value, FactRecordEnvelopeSchema, context);
  assertFactGraphInvariants(value, context);
}

export function factRecordOf(value: unknown): FactRecordEnvelope | undefined {
  if (!isRecord(value) || value.evaluationAlgorithm !== FACT_USE_EVALUATION_ALGORITHM) return undefined;
  assertFactRecord(value);
  return value;
}

export function materializeFactRecord(result: EvalResult): FactRecordResult {
  assertFactRecord(result, `Attempt ${JSON.stringify(result.id)}`);
  return result as FactRecordResult;
}

export function attemptTerminalOf(result: EvalResult | FactRecordResult): AttemptTerminal {
  return sharedAttemptTerminalOf({
    verdict: result.verdict,
    ...(result.evaluationKind === "score" && result.scoreResult !== undefined
      ? { evaluationKind: "score", scoreResult: result.scoreResult }
      : {}),
  });
}

export function verdictForTerminal(result: EvalResult | FactRecordResult): Verdict {
  return sharedVerdictForTerminal(attemptTerminalOf(result));
}

export function scoreOutcomeOf(result: EvalResult | FactRecordResult): ScoreFactAttemptOutcome | undefined {
  return result.evaluationKind === "score" ? result.scoreResult : undefined;
}
