// Native Fact/use result record. Schema 17 stores the graph directly in
// result.json; no assertion compatibility envelope is read or written.

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

export const FACT_USE_EVALUATION_ALGORITHM = "fact-use/v2" as const satisfies EvaluationAlgorithm;

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

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string.`);
}

function assertFinite(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be finite.`);
}

function assertUnit(value: unknown, path: string): asserts value is number {
  assertFinite(value, path);
  if (value < 0 || value > 1) throw new Error(`${path} must be in [0, 1].`);
}

function factUseTargetId(use: UnknownRecord): string | undefined {
  if (use.useKind === "verdict") {
    return isRecord(use.target) && typeof use.target.factId === "string" ? use.target.factId : undefined;
  }
  if (use.useKind !== "score" || !isRecord(use.input) || use.input.kind !== "fact") return undefined;
  return typeof use.input.factId === "string" ? use.input.factId : undefined;
}

function assertFactResult(value: unknown, path: string, factIds: Set<string>): asserts value is EvaluationFactResult {
  if (!isRecord(value)) throw new Error(`${path} must be an EvaluationFactResult.`);
  assertNonEmptyString(value.factId, `${path}.factId`);
  if (factIds.has(value.factId)) throw new Error(`${path}.factId duplicates ${JSON.stringify(value.factId)}.`);
  factIds.add(value.factId);
  assertNonEmptyString(value.name, `${path}.name`);
  if (value.factKind !== "boolean" && value.factKind !== "score") throw new Error(`${path}.factKind is invalid.`);
  if (!Array.isArray(value.dependencyFactIds) || !value.dependencyFactIds.every((id) => typeof id === "string")) {
    throw new Error(`${path}.dependencyFactIds must be a string array.`);
  }
  for (const field of ["expected", "received", "explanation", "evidence"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") throw new Error(`${path}.${field} must be a string.`);
  }
  const sourceOrder = value.sourceOrder;
  if (typeof sourceOrder !== "number" || !Number.isSafeInteger(sourceOrder) || sourceOrder < 0) {
    throw new Error(`${path}.sourceOrder is invalid.`);
  }
  switch (value.outcome) {
    case "passed":
    case "failed":
      if (value.factKind !== "boolean") throw new Error(`${path}.${value.outcome} requires a boolean Fact.`);
      return;
    case "scored":
      if (value.factKind !== "score") throw new Error(`${path}.scored requires a score Fact.`);
      assertUnit(value.normalizedScore, `${path}.normalizedScore`);
      return;
    case "unavailable":
      assertNonEmptyString(value.reason, `${path}.reason`);
      return;
    case "errored":
      if (!isRecord(value.error) || value.error.class !== "evaluator") throw new Error(`${path}.error must be an evaluator error.`);
      assertNonEmptyString(value.error.code, `${path}.error.code`);
      if (typeof value.error.message !== "string") throw new Error(`${path}.error.message must be a string.`);
      return;
    case "notReachedByControl":
    case "notReachedByError":
      assertNonEmptyString(value.reason, `${path}.reason`);
      return;
    default:
      throw new Error(`${path}.outcome is invalid.`);
  }
}

function assertFactUse(value: unknown, path: string, factIds: ReadonlySet<string>, keys: Set<string>): asserts value is FactUseResult {
  if (!isRecord(value)) throw new Error(`${path} must be a Fact use.`);
  const sourceOrder = value.sourceOrder;
  if (typeof sourceOrder !== "number" || !Number.isSafeInteger(sourceOrder) || sourceOrder < 0) {
    throw new Error(`${path}.sourceOrder is invalid.`);
  }
  if (value.key !== undefined) {
    assertNonEmptyString(value.key, `${path}.key`);
    if (keys.has(value.key)) throw new Error(`${path}.key duplicates ${JSON.stringify(value.key)}.`);
    keys.add(value.key);
  }
  const factId = factUseTargetId(value);
  if (factId !== undefined && !factIds.has(factId)) throw new Error(`${path} references unknown Fact ${JSON.stringify(factId)}.`);
  if (value.useKind === "verdict") {
    if (value.method !== "assert" && value.method !== "require" && value.method !== "assertIfCovered") {
      throw new Error(`${path}.method is invalid.`);
    }
    if (!isRecord(value.target) || (value.target.kind !== "boolean" && value.target.kind !== "score")) {
      throw new Error(`${path}.target is invalid.`);
    }
    if (value.target.kind === "score") assertUnit(value.target.atLeast, `${path}.target.atLeast`);
    if (!["passed", "failed", "unavailable", "notApplicable", "errored", "notReachedByControl", "notReachedByError"].includes(value.outcome as string)) {
      throw new Error(`${path}.outcome is invalid.`);
    }
    return;
  }
  if (value.useKind !== "score") throw new Error(`${path}.useKind is invalid.`);
  assertNonEmptyString(value.label, `${path}.label`);
  if (!["scored", "unavailable", "errored", "notReachedByControl", "notReachedByError"].includes(value.outcome as string)) {
    throw new Error(`${path}.outcome is invalid.`);
  }
  if (value.outcome === "scored") {
    assertFinite(value.earned, `${path}.earned`);
    if (value.earned < 0) throw new Error(`${path}.earned must be non-negative.`);
  }
}

function assertScoreResult(value: unknown, path: string): asserts value is ScoreFactAttemptOutcome {
  if (!isRecord(value)) throw new Error(`${path} must be a ScoreFactAttemptOutcome.`);
  if (!["scored", "invalid", "unavailable", "errored", "skipped"].includes(value.status as string)) {
    throw new Error(`${path}.status is invalid.`);
  }
  assertFinite(value.earnedScore, `${path}.earnedScore`);
  if (value.earnedScore < 0) throw new Error(`${path}.earnedScore must be non-negative.`);
  if (value.status === "scored") assertFinite(value.creditedScore, `${path}.creditedScore`);
}

/** Reject old or hybrid result objects. There is no partial compatibility reader. */
export function assertFactRecord(value: unknown, context = "Fact Record"): asserts value is FactRecordEnvelope {
  if (!isRecord(value)) throw new Error(`${context} must be an object.`);
  if (value.evaluationAlgorithm !== FACT_USE_EVALUATION_ALGORITHM) {
    throw new Error(`${context}.evaluationAlgorithm must be ${JSON.stringify(FACT_USE_EVALUATION_ALGORITHM)}.`);
  }
  if (value.evaluationKind !== "pass" && value.evaluationKind !== "score") throw new Error(`${context}.evaluationKind is invalid.`);
  if (!Array.isArray(value.factResults) || !Array.isArray(value.factUses)) {
    throw new Error(`${context} must contain factResults and factUses arrays.`);
  }
  for (const legacyField of ["assertions", "scoreEntries", "factTrace", "legacyJudgeAssertions"] as const) {
    if (legacyField in value) throw new Error(`${context} contains unsupported legacy field ${JSON.stringify(legacyField)}.`);
  }
  const facts = new Set<string>();
  for (const [index, fact] of value.factResults.entries()) assertFactResult(fact, `${context}.factResults[${index}]`, facts);
  const keys = new Set<string>();
  for (const [index, use] of value.factUses.entries()) assertFactUse(use, `${context}.factUses[${index}]`, facts, keys);
  if (value.evaluationKind === "score") {
    if (value.scoreResult === undefined) throw new Error(`${context}.scoreResult is required for score Eval.`);
    assertScoreResult(value.scoreResult, `${context}.scoreResult`);
  } else if (value.scoreResult !== undefined) {
    throw new Error(`${context}.scoreResult is only valid for score Eval.`);
  }
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
