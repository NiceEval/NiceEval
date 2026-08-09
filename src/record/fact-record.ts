// Fact/use Record envelope.  The runner intentionally keeps `factTrace` and
// `scoreResult` non-enumerable until the Record writer owns serialization; this
// module is the one bridge between that live shape and schema 16 result.json.

import type {
  EvaluationFactResult,
  LegacyJudgeAssertionResult,
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

/** The schema-16 evaluation algorithm persisted on every Fact/use attempt. */
export const FACT_USE_EVALUATION_ALGORITHM = "fact-use/v1" as const satisfies EvaluationAlgorithm;

export type FactUseResult = VerdictFactUseResult | ScoreFactUseResult;
export type ScoreAttemptStatus = ScoreFactAttemptOutcome["status"];
export type AttemptTerminal = Verdict | ScoreAttemptStatus;

/**
 * The deliberately separate persisted trace. `factResults`, rather than
 * `facts`, avoids colliding with the pre-existing runtime-observation field
 * `EvalResult.facts`.
 */
export interface FactRecordEnvelope {
  readonly evaluationAlgorithm: typeof FACT_USE_EVALUATION_ALGORITHM;
  readonly evaluationKind: "pass" | "score";
  readonly factResults: readonly EvaluationFactResult[];
  readonly factUses: readonly FactUseResult[];
  readonly legacyJudgeAssertions: readonly LegacyJudgeAssertionResult[];
  /** Present exactly for score attempts; its terminal state owns score meaning. */
  readonly scoreResult?: ScoreFactAttemptOutcome;
}

/**
 * Schema-16 `result.json` shape after snapshot defaults are applied. The old
 * generic assertion arrays are intentionally absent: legacy Judge data lives
 * only in `legacyJudgeAssertions` and ordinary Fact data is never inferred
 * from their old fields.
 */
export type FactRecordResult = Omit<
  EvalResult,
  "assertions" | "factTrace" | "scoreEntries" | "scoreResult" | "evaluationAlgorithm" | "evaluationKind"
> & FactRecordEnvelope;

type UnknownRecord = globalThis.Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function factUseTargetId(use: UnknownRecord): string | undefined {
  if (use.useKind === "verdict") {
    return isRecord(use.target) && typeof use.target.factId === "string" ? use.target.factId : undefined;
  }
  if (use.useKind !== "score") return undefined;
  if (!isRecord(use.input) || use.input.kind !== "fact") return undefined;
  return typeof use.input.factId === "string" ? use.input.factId : undefined;
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string.`);
}

function assertNonNegativeFinite(value: unknown, path: string): asserts value is number {
  assertFiniteNumber(value, path);
  if (value < 0) throw new Error(`${path} must be non-negative.`);
}

function assertUnitScore(value: unknown, path: string): asserts value is number {
  assertNonNegativeFinite(value, path);
  if (value > 1) throw new Error(`${path} must be in [0, 1].`);
}

function assertOptionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "string") throw new Error(`${path} must be a string when present.`);
}

/**
 * The discriminated result objects are persisted JSON, not merely internal
 * TypeScript values.  Reject fields from another variant instead of letting a
 * malformed record smuggle them into a renderer that happens to use `in` for
 * narrowing.
 */
function assertAbsent(value: UnknownRecord, path: string, fields: readonly string[]): void {
  for (const field of fields) {
    if (value[field] !== undefined) throw new Error(`${path}.${field} is not valid for this variant.`);
  }
}

function assertFactUseKey(value: unknown, path: string): void {
  assertNonEmptyString(value, path);
  if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/.test(value)) {
    throw new Error(`${path} must match [a-z0-9][a-z0-9._/-]{0,127}.`);
  }
}

function assertSourceLoc(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} must be a SourceLoc.`);
  assertNonEmptyString(value.file, `${path}.file`);
  if (!Number.isSafeInteger(value.line) || (value.line as number) < 1) {
    throw new Error(`${path}.line must be a positive safe integer.`);
  }
  if (value.column !== undefined && (!Number.isSafeInteger(value.column) || (value.column as number) < 1)) {
    throw new Error(`${path}.column must be a positive safe integer when present.`);
  }
  if (value.callers === undefined) return;
  if (!Array.isArray(value.callers)) throw new Error(`${path}.callers must be an array when present.`);
  for (const [index, frame] of value.callers.entries()) {
    if (!isRecord(frame) || (frame.kind !== "project" && frame.kind !== "package")) {
      throw new Error(`${path}.callers[${index}] must be a project or package frame.`);
    }
    if (frame.kind === "project") {
      assertNonEmptyString(frame.file, `${path}.callers[${index}].file`);
      if (!Number.isSafeInteger(frame.line) || (frame.line as number) < 1) {
        throw new Error(`${path}.callers[${index}].line must be a positive safe integer.`);
      }
      if (frame.column !== undefined && (!Number.isSafeInteger(frame.column) || (frame.column as number) < 1)) {
        throw new Error(`${path}.callers[${index}].column must be a positive safe integer when present.`);
      }
    } else {
      assertNonEmptyString(frame.package, `${path}.callers[${index}].package`);
    }
  }
}

function assertOptionalLoc(value: unknown, path: string): void {
  if (value !== undefined) assertSourceLoc(value, path);
}

function assertSourceOrder(value: unknown, path: string, seen: Map<number, string>): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${path} must be a non-negative safe integer.`);
  }
  const previous = seen.get(value as number);
  if (previous !== undefined) throw new Error(`${path} duplicates sourceOrder ${(value as number)} already used by ${previous}.`);
  seen.set(value as number, path);
}

function assertAttemptError(value: unknown, path: string, evaluatorOnly = false): void {
  if (!isRecord(value)) throw new Error(`${path} must be an AttemptFactError.`);
  const classes = evaluatorOnly ? ["evaluator"] : ["agent", "execution", "author", "evaluator"];
  if (!classes.includes(value.class as string)) throw new Error(`${path}.class is invalid.`);
  assertNonEmptyString(value.code, `${path}.code`);
  if (typeof value.message !== "string") throw new Error(`${path}.message must be a string.`);
}

function assertOptionalIssueReference(value: UnknownRecord, path: string): void {
  if (value.factId !== undefined) assertNonEmptyString(value.factId, `${path}.factId`);
  for (const key of ["useSourceOrder", "legacyJudgeSourceOrder"] as const) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0)) {
      throw new Error(`${path}.${key} must be a non-negative safe integer when present.`);
    }
  }
}

function assertAttemptIssue(value: unknown, path: string, expected?: "unavailable" | "error"): void {
  if (!isRecord(value) || (value.kind !== "unavailable" && value.kind !== "error")) {
    throw new Error(`${path} must be an AttemptFactIssue.`);
  }
  if (expected !== undefined && value.kind !== expected) throw new Error(`${path}.kind must be "${expected}".`);
  assertOptionalIssueReference(value, path);
  if (value.kind === "unavailable") {
    if (typeof value.reason !== "string") throw new Error(`${path}.reason must be a string.`);
  } else {
    assertAttemptError(value.error, `${path}.error`);
  }
}

function assertFactResult(value: unknown, path: string, sourceOrders: Map<number, string>): asserts value is EvaluationFactResult {
  if (!isRecord(value)) throw new Error(`${path} must be an EvaluationFactResult.`);
  assertNonEmptyString(value.factId, `${path}.factId`);
  assertNonEmptyString(value.name, `${path}.name`);
  if (value.groupPath !== undefined && !isStringArray(value.groupPath)) throw new Error(`${path}.groupPath must be a string array when present.`);
  assertOptionalLoc(value.producerLoc, `${path}.producerLoc`);
  assertSourceOrder(value.sourceOrder, `${path}.sourceOrder`, sourceOrders);
  if (!isStringArray(value.dependencyFactIds)) throw new Error(`${path}.dependencyFactIds must be a string array.`);
  assertOptionalString(value.expected, `${path}.expected`);
  assertOptionalString(value.received, `${path}.received`);
  assertOptionalString(value.evidence, `${path}.evidence`);
  if (value.factKind !== "boolean" && value.factKind !== "score") throw new Error(`${path}.factKind is invalid.`);
  switch (value.outcome) {
    case "passed":
    case "failed":
      if (value.factKind !== "boolean") throw new Error(`${path}.${value.outcome} requires factKind "boolean".`);
      assertAbsent(value, path, ["normalizedScore", "reason", "error"]);
      return;
    case "scored":
      if (value.factKind !== "score") throw new Error(`${path}.scored requires factKind "score".`);
      assertUnitScore(value.normalizedScore, `${path}.normalizedScore`);
      assertAbsent(value, path, ["reason", "error"]);
      return;
    case "unavailable":
    case "notReachedByControl":
    case "notReachedByError":
      if (typeof value.reason !== "string") throw new Error(`${path}.reason must be a string.`);
      assertAbsent(value, path, ["normalizedScore", "error"]);
      return;
    case "errored":
      assertAttemptError(value.error, `${path}.error`, true);
      assertAbsent(value, path, ["normalizedScore", "reason"]);
      return;
    default:
      throw new Error(`${path}.outcome is invalid.`);
  }
}

function assertFactUse(value: unknown, path: string, sourceOrders: Map<number, string>): asserts value is FactUseResult {
  if (!isRecord(value) || (value.useKind !== "verdict" && value.useKind !== "score")) {
    throw new Error(`${path} must be a FactUseResult.`);
  }
  if (value.key !== undefined) assertFactUseKey(value.key, `${path}.key`);
  assertOptionalLoc(value.consumerLoc, `${path}.consumerLoc`);
  assertSourceOrder(value.sourceOrder, `${path}.sourceOrder`, sourceOrders);
  if (value.useKind === "verdict") {
    assertAbsent(value, path, ["input", "earned"]);
    if (value.method !== "assert" && value.method !== "require" && value.method !== "assertIfCovered") {
      throw new Error(`${path}.method is invalid.`);
    }
    assertOptionalString(value.label, `${path}.label`);
    if (!isRecord(value.target) || (value.target.kind !== "boolean" && value.target.kind !== "score")) {
      throw new Error(`${path}.target must be a boolean or score Fact target.`);
    }
    assertNonEmptyString(value.target.factId, `${path}.target.factId`);
    if (value.target.kind === "score") assertUnitScore(value.target.atLeast, `${path}.target.atLeast`);
    else assertAbsent(value.target, `${path}.target`, ["atLeast"]);
    switch (value.outcome) {
      case "passed":
      case "failed":
        assertAbsent(value, path, ["reason", "error"]);
        return;
      case "unavailable":
      case "notApplicable":
      case "notReachedByControl":
      case "notReachedByError":
        if (typeof value.reason !== "string") throw new Error(`${path}.reason must be a string.`);
        assertAbsent(value, path, ["error"]);
        return;
      case "errored":
        assertAttemptError(value.error, `${path}.error`, true);
        assertAbsent(value, path, ["reason"]);
        return;
      default:
        throw new Error(`${path}.outcome is invalid.`);
    }
  }

  assertAbsent(value, path, ["target", "method"]);
  assertNonEmptyString(value.label, `${path}.label`);
  if (!isRecord(value.input) || (value.input.kind !== "direct" && value.input.kind !== "fact")) {
    throw new Error(`${path}.input must be a direct or Fact score input.`);
  }
  if (value.input.kind === "direct") {
    assertNonNegativeFinite(value.input.earned, `${path}.input.earned`);
    assertAbsent(value.input, `${path}.input`, ["factId", "max"]);
    if (value.outcome !== "scored") throw new Error(`${path}.input.kind "direct" requires outcome "scored".`);
    assertNonNegativeFinite(value.earned, `${path}.earned`);
    if (value.earned !== value.input.earned) throw new Error(`${path}.earned must equal direct input.earned.`);
    assertAbsent(value, path, ["reason", "error"]);
    return;
  }
  assertNonEmptyString(value.input.factId, `${path}.input.factId`);
  assertAbsent(value.input, `${path}.input`, ["earned"]);
  assertFiniteNumber(value.input.max, `${path}.input.max`);
  if ((value.input.max as number) <= 0) throw new Error(`${path}.input.max must be positive.`);
  switch (value.outcome) {
    case "scored":
      assertNonNegativeFinite(value.earned, `${path}.earned`);
      if ((value.earned as number) > (value.input.max as number)) throw new Error(`${path}.earned cannot exceed input.max.`);
      assertAbsent(value, path, ["reason", "error"]);
      return;
    case "unavailable":
    case "notReachedByControl":
    case "notReachedByError":
      if (typeof value.reason !== "string") throw new Error(`${path}.reason must be a string.`);
      assertAbsent(value, path, ["earned", "error"]);
      return;
    case "errored":
      assertAttemptError(value.error, `${path}.error`, true);
      assertAbsent(value, path, ["earned", "reason"]);
      return;
    default:
      throw new Error(`${path}.outcome is invalid.`);
  }
}

function assertIssueReferences(
  issue: unknown,
  path: string,
  facts: ReadonlyMap<string, UnknownRecord>,
  factUseSourceOrders: ReadonlySet<number>,
  legacyJudgeSourceOrders: ReadonlySet<number>,
): void {
  if (!isRecord(issue)) return; // `assertScoreOutcome` already established the closed issue union.
  if (typeof issue.factId === "string" && !facts.has(issue.factId)) {
    throw new Error(`${path}.factId references a missing Fact id "${issue.factId}".`);
  }
  if (typeof issue.useSourceOrder === "number" && !factUseSourceOrders.has(issue.useSourceOrder)) {
    throw new Error(`${path}.useSourceOrder references no Fact use.`);
  }
  if (typeof issue.legacyJudgeSourceOrder === "number" && !legacyJudgeSourceOrders.has(issue.legacyJudgeSourceOrder)) {
    throw new Error(`${path}.legacyJudgeSourceOrder references no legacy Judge assertion.`);
  }
}

function assertScoreIssueReferences(
  outcome: ScoreFactAttemptOutcome,
  path: string,
  facts: ReadonlyMap<string, UnknownRecord>,
  factUseSourceOrders: ReadonlySet<number>,
  legacyJudgeSourceOrders: ReadonlySet<number>,
): void {
  const validate = (issues: readonly unknown[], field: "issues" | "errors"): void => {
    issues.forEach((issue, index) =>
      assertIssueReferences(issue, `${path}.${field}[${index}]`, facts, factUseSourceOrders, legacyJudgeSourceOrders),
    );
  };
  switch (outcome.status) {
    case "invalid":
    case "unavailable":
      validate(outcome.issues, "issues");
      return;
    case "errored":
      validate(outcome.errors, "errors");
      validate(outcome.issues, "issues");
      return;
    case "scored":
    case "skipped":
      return;
  }
}

function traceEarnedScore(factUses: readonly FactUseResult[], legacyJudges: readonly LegacyJudgeAssertionResult[]): number {
  const factUseEarned = factUses.reduce(
    (total, use) => total + (use.useKind === "score" && use.outcome === "scored" ? use.earned : 0),
    0,
  );
  return legacyJudges.reduce(
    (total, judge) => total + ("earnedPoints" in judge ? judge.earnedPoints : 0),
    factUseEarned,
  );
}

function traceHasHardFailure(factUses: readonly FactUseResult[], legacyJudges: readonly LegacyJudgeAssertionResult[]): boolean {
  return factUses.some((use) => use.useKind === "verdict" && use.outcome === "failed") ||
    legacyJudges.some((judge) => judge.policy.verdict.kind === "gate" && judge.outcome === "failed");
}

/**
 * The pass envelope persists only the four-way Verdict, but that Verdict is
 * still a closed projection of the same Fact trace. Keep this calculation at
 * the Record boundary so a corrupt result.json cannot claim passed while
 * retaining an unavailable Fact or failed gate for show/report to discover
 * later.
 */
function passVerdictFromTrace(
  result: UnknownRecord,
  facts: ReadonlyMap<string, UnknownRecord>,
  factUses: readonly FactUseResult[],
  legacyJudges: readonly LegacyJudgeAssertionResult[],
): Verdict {
  // Runner-originated errors live in the normal Attempt envelope rather than
  // in a Fact node. They retain the same precedence as Fact folding.
  if (result.error !== undefined) return "errored";

  for (const [factId, fact] of facts) {
    if (fact.outcome === "errored") return "errored";
    if (fact.outcome !== "unavailable") continue;
    const consumers = factUses.filter((use) =>
      use.useKind === "verdict"
        ? use.target.factId === factId
        : use.input.kind === "fact" && use.input.factId === factId,
    );
    // A core usage Fact whose direct consumers are all notApplicable is the
    // one unavailable state that does not make the Attempt errored.
    const allNotApplicable = consumers.length > 0 && consumers.every(
      (use) => use.useKind === "verdict" && use.outcome === "notApplicable",
    );
    if (!allNotApplicable) return "errored";
  }

  if (legacyJudges.some((judge) =>
    judge.outcome === "errored" || (judge.outcome === "unavailable" && !judge.policy.optional)
  )) {
    return "errored";
  }
  if (traceHasHardFailure(factUses, legacyJudges)) return "failed";
  if (result.skipReason !== undefined) return "skipped";

  const verdictUses = factUses.filter((use): use is VerdictFactUseResult => use.useKind === "verdict");
  if (verdictUses.length > 0 && verdictUses.every((use) => use.outcome === "notApplicable")) return "skipped";
  return "passed";
}

function assertLegacyJudge(value: unknown, path: string, sourceOrders: Map<number, string>): asserts value is LegacyJudgeAssertionResult {
  if (!isRecord(value)) throw new Error(`${path} must be a LegacyJudgeAssertionResult.`);
  assertNonEmptyString(value.name, `${path}.name`);
  if (!(value.name as string).startsWith("judge:")) throw new Error(`${path}.name must start with "judge:".`);
  if ((value.name as string).length === "judge:".length) throw new Error(`${path}.name must include a Judge name.`);
  if (typeof value.detail !== "string") throw new Error(`${path}.detail must be a string.`);
  if (value.groupPath !== undefined && !isStringArray(value.groupPath)) throw new Error(`${path}.groupPath must be a string array when present.`);
  assertOptionalLoc(value.loc, `${path}.loc`);
  assertSourceOrder(value.sourceOrder, `${path}.sourceOrder`, sourceOrders);
  if (!isRecord(value.policy) || !isRecord(value.policy.verdict) || !isRecord(value.policy.scoring)) {
    throw new Error(`${path}.policy must contain verdict and scoring objects.`);
  }
  if (value.policy.verdict.kind !== "gate" && value.policy.verdict.kind !== "soft") throw new Error(`${path}.policy.verdict.kind is invalid.`);
  if (value.policy.verdict.kind === "gate") assertUnitScore(value.policy.verdict.atLeast, `${path}.policy.verdict.atLeast`);
  if (value.policy.verdict.kind === "soft" && value.policy.verdict.atLeast !== undefined) {
    assertUnitScore(value.policy.verdict.atLeast, `${path}.policy.verdict.atLeast`);
  }
  if (typeof value.policy.optional !== "boolean" || typeof value.policy.stopOnFailure !== "boolean") {
    throw new Error(`${path}.policy.optional and stopOnFailure must be booleans.`);
  }
  if (value.policy.scoring.kind !== "quality" && value.policy.scoring.kind !== "points") {
    throw new Error(`${path}.policy.scoring.kind is invalid.`);
  }
  if (value.policy.scoring.kind === "points") {
    assertFiniteNumber(value.policy.scoring.max, `${path}.policy.scoring.max`);
    if ((value.policy.scoring.max as number) <= 0) throw new Error(`${path}.policy.scoring.max must be positive.`);
  } else {
    assertAbsent(value.policy.scoring, `${path}.policy.scoring`, ["max"]);
  }
  switch (value.outcome) {
    case "passed":
    case "failed":
      assertUnitScore(value.normalizedScore, `${path}.normalizedScore`);
      if (value.policy.scoring.kind === "points") {
        assertNonNegativeFinite(value.earnedPoints, `${path}.earnedPoints`);
        if ((value.earnedPoints as number) > (value.policy.scoring.max as number)) {
          throw new Error(`${path}.earnedPoints cannot exceed policy.scoring.max.`);
        }
      } else {
        assertAbsent(value, path, ["earnedPoints"]);
      }
      assertOptionalString(value.evidence, `${path}.evidence`);
      assertAbsent(value, path, ["reason", "error"]);
      return;
    case "unavailable":
      if (typeof value.reason !== "string") throw new Error(`${path}.reason must be a string.`);
      assertOptionalString(value.evidence, `${path}.evidence`);
      assertAbsent(value, path, ["normalizedScore", "earnedPoints", "error"]);
      return;
    case "errored":
      assertAttemptError(value.error, `${path}.error`, true);
      assertAbsent(value, path, ["normalizedScore", "earnedPoints", "reason", "evidence"]);
      return;
    case "notReachedByControl":
    case "notReachedByError":
      if (typeof value.reason !== "string") throw new Error(`${path}.reason must be a string.`);
      assertAbsent(value, path, ["normalizedScore", "earnedPoints", "error", "evidence"]);
      return;
    default:
      throw new Error(`${path}.outcome is invalid.`);
  }
}

function assertScoreOutcome(value: unknown, path: string): asserts value is ScoreFactAttemptOutcome {
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new Error(`${path} must be a score terminal outcome.`);
  }
  assertNonNegativeFinite(value.earnedScore, `${path}.earnedScore`);
  switch (value.status) {
    case "scored":
      assertNonNegativeFinite(value.creditedScore, `${path}.creditedScore`);
      if (value.creditedScore !== value.earnedScore) throw new Error(`${path}.scored requires creditedScore === earnedScore.`);
      assertAbsent(value, path, ["issues", "errors", "reason"]);
      return;
    case "invalid":
      if (value.creditedScore !== 0 || !Array.isArray(value.issues)) {
        throw new Error(`${path}.invalid requires creditedScore 0 and issues.`);
      }
      value.issues.forEach((issue, index) => assertAttemptIssue(issue, `${path}.issues[${index}]`));
      assertAbsent(value, path, ["errors", "reason"]);
      return;
    case "unavailable":
      if (value.creditedScore !== null || !Array.isArray(value.issues) || value.issues.length === 0) {
        throw new Error(`${path}.unavailable requires creditedScore null and non-empty issues.`);
      }
      value.issues.forEach((issue, index) => assertAttemptIssue(issue, `${path}.issues[${index}]`, "unavailable"));
      assertAbsent(value, path, ["errors", "reason"]);
      return;
    case "errored":
      if (value.creditedScore !== null || !Array.isArray(value.errors) || value.errors.length === 0 || !Array.isArray(value.issues)) {
        throw new Error(`${path}.errored requires creditedScore null, non-empty errors and issues.`);
      }
      value.errors.forEach((issue, index) => assertAttemptIssue(issue, `${path}.errors[${index}]`, "error"));
      value.issues.forEach((issue, index) => assertAttemptIssue(issue, `${path}.issues[${index}]`, "unavailable"));
      assertAbsent(value, path, ["reason"]);
      return;
    case "skipped":
      if (value.creditedScore !== null || typeof value.reason !== "string") {
        throw new Error(`${path}.skipped requires creditedScore null and a reason.`);
      }
      assertAbsent(value, path, ["issues", "errors"]);
      return;
    default:
      throw new Error(`${path}.status "${value.status}" is not a score terminal state.`);
  }
}

/**
 * Validates the Fact graph from Fact-use roots following `dependencyFactIds`.
 * This deliberately does not inspect old assertion fields or infer a graph
 * from them: schema version plus `evaluationAlgorithm` is the only format
 * discriminator.
 */
export function assertFactRecord(value: unknown, context = "Fact Record"): asserts value is FactRecordEnvelope {
  if (!isRecord(value)) throw new Error(`${context} must be a JSON object.`);
  if (value.evaluationAlgorithm !== FACT_USE_EVALUATION_ALGORITHM) {
    throw new Error(`${context}.evaluationAlgorithm must be "${FACT_USE_EVALUATION_ALGORITHM}".`);
  }
  if (value.evaluationKind !== "pass" && value.evaluationKind !== "score") {
    throw new Error(`${context}.evaluationKind must be "pass" or "score".`);
  }
  if (!Array.isArray(value.factResults) || !Array.isArray(value.factUses) || !Array.isArray(value.legacyJudgeAssertions)) {
    throw new Error(`${context} must contain factResults, factUses and legacyJudgeAssertions arrays.`);
  }
  if ("assertions" in value || "scoreEntries" in value || "factTrace" in value) {
    throw new Error(`${context} mixes a schema-16 Fact Record with legacy assertion fields.`);
  }
  if (value.verdict !== "passed" && value.verdict !== "failed" && value.verdict !== "errored" && value.verdict !== "skipped") {
    throw new Error(`${context}.verdict must be a closed Attempt verdict.`);
  }
  assertNonEmptyString(value.id, `${context}.id`);
  if (!Number.isSafeInteger(value.attempt) || (value.attempt as number) < 0) {
    throw new Error(`${context}.attempt must be a non-negative safe integer.`);
  }
  assertNonNegativeFinite(value.durationMs, `${context}.durationMs`);
  assertOptionalString(value.description, `${context}.description`);
  assertOptionalString(value.startedAt, `${context}.startedAt`);
  assertOptionalString(value.fingerprint, `${context}.fingerprint`);
  assertOptionalString(value.configHash, `${context}.configHash`);
  assertOptionalString(value.locator, `${context}.locator`);
  assertOptionalString(value.locatorRunId, `${context}.locatorRunId`);

  const facts = new Map<string, UnknownRecord>();
  const sourceOrders = new Map<number, string>();
  for (const [index, raw] of value.factResults.entries()) {
    assertFactResult(raw, `${context}.factResults[${index}]`, sourceOrders);
    if (new Set(raw.dependencyFactIds).size !== raw.dependencyFactIds.length) {
      throw new Error(`${context}.factResults[${index}].dependencyFactIds contains duplicate Fact ids.`);
    }
    if (facts.has(raw.factId)) {
      throw new Error(`${context} contains duplicate Fact id "${raw.factId}".`);
    }
    facts.set(raw.factId, raw as unknown as UnknownRecord);
  }

  const roots: string[] = [];
  const consumers = new Set<string>();
  const keys = new Set<string>();
  const factUseSourceOrders = new Set<number>();
  const validatedFactUses: FactUseResult[] = [];
  for (const [index, raw] of value.factUses.entries()) {
    assertFactUse(raw, `${context}.factUses[${index}]`, sourceOrders);
    validatedFactUses.push(raw);
    factUseSourceOrders.add(raw.sourceOrder);
    if (raw.key !== undefined) {
      if (keys.has(raw.key)) throw new Error(`${context} contains duplicate Fact use key "${raw.key}".`);
      keys.add(raw.key);
    }
    if (raw.useKind === "verdict") {
      const targetId = factUseTargetId(raw as unknown as UnknownRecord);
      if (targetId === undefined || !facts.has(targetId)) {
        throw new Error(`${context}.factUses[${index}] targets a missing Fact id.`);
      }
      const fact = facts.get(targetId)!;
      if (fact.factKind !== raw.target.kind) {
        throw new Error(`${context}.factUses[${index}].target.kind must match Fact "${targetId}".`);
      }
      const consumer = `verdict:${targetId}`;
      if (consumers.has(consumer)) throw new Error(`${context} has duplicate verdict use for Fact id "${targetId}".`);
      consumers.add(consumer);
      roots.push(targetId);
      continue;
    }
    if (!isRecord(raw.input) || (raw.input.kind !== "fact" && raw.input.kind !== "direct")) {
      throw new Error(`${context}.factUses[${index}].input must be a Fact or direct score input.`);
    }
    if (raw.input.kind === "direct") {
      assertFiniteNumber(raw.input.earned, `${context}.factUses[${index}].input.earned`);
      continue;
    }
    if (typeof raw.input.factId !== "string" || !facts.has(raw.input.factId)) {
      throw new Error(`${context}.factUses[${index}] targets a missing Fact id.`);
    }
    const consumer = `score:${raw.input.factId}`;
    if (consumers.has(consumer)) throw new Error(`${context} has duplicate score use for Fact id "${raw.input.factId}".`);
    consumers.add(consumer);
    roots.push(raw.input.factId);
  }

  const legacyJudgeSourceOrders = new Set<number>();
  const validatedLegacyJudges: LegacyJudgeAssertionResult[] = [];
  for (const [index, raw] of value.legacyJudgeAssertions.entries()) {
    assertLegacyJudge(raw, `${context}.legacyJudgeAssertions[${index}]`, sourceOrders);
    validatedLegacyJudges.push(raw);
    legacyJudgeSourceOrders.add(raw.sourceOrder);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (factId: string): void => {
    if (visited.has(factId)) return;
    if (visiting.has(factId)) throw new Error(`${context} contains a dependency cycle at Fact id "${factId}".`);
    visiting.add(factId);
    const fact = facts.get(factId)!;
    for (const dependencyFactId of fact.dependencyFactIds as readonly string[]) {
      if (!facts.has(dependencyFactId)) {
        throw new Error(`${context} Fact "${factId}" depends on missing Fact id "${dependencyFactId}".`);
      }
      visit(dependencyFactId);
    }
    visiting.delete(factId);
    visited.add(factId);
  };
  for (const root of roots) visit(root);
  for (const factId of facts.keys()) {
    if (!visited.has(factId)) {
      throw new Error(`${context} contains unreachable Fact id "${factId}".`);
    }
  }

  if (value.evaluationKind === "pass") {
    if (validatedFactUses.some((use) => use.useKind === "score")) {
      throw new Error(`${context}.evaluationKind "pass" cannot contain score Fact uses.`);
    }
    const expectedVerdict = passVerdictFromTrace(value, facts, validatedFactUses, validatedLegacyJudges);
    if (value.verdict !== expectedVerdict) {
      throw new Error(`${context}.verdict must match the Fact pass terminal "${expectedVerdict}".`);
    }
    if (value.scoreResult !== undefined) {
      throw new Error(`${context}.scoreResult is only valid for score attempts.`);
    }
  } else {
    assertScoreOutcome(value.scoreResult, `${context}.scoreResult`);
    assertScoreIssueReferences(
      value.scoreResult,
      `${context}.scoreResult`,
      facts,
      factUseSourceOrders,
      legacyJudgeSourceOrders,
    );
    const earnedFromTrace = traceEarnedScore(validatedFactUses, validatedLegacyJudges);
    if (value.scoreResult.earnedScore !== earnedFromTrace) {
      throw new Error(`${context}.scoreResult.earnedScore must equal the scored Fact uses and legacy Judge points.`);
    }
    const hardFailure = traceHasHardFailure(validatedFactUses, validatedLegacyJudges);
    if (hardFailure !== (value.scoreResult.status === "invalid")) {
      throw new Error(`${context}.scoreResult.status must be invalid exactly when a Fact verdict use or legacy Judge gate failed.`);
    }
    const expectedVerdict = sharedVerdictForTerminal(value.scoreResult.status);
    if (value.verdict !== expectedVerdict) {
      throw new Error(`${context}.verdict must match scoreResult.status "${value.scoreResult.status}".`);
    }
  }
}

/** A validated persisted envelope, or undefined for a non-Fact/legacy value. */
function persistedFactRecordOf(value: unknown): FactRecordEnvelope | undefined {
  if (!isRecord(value) || value.evaluationAlgorithm !== FACT_USE_EVALUATION_ALGORITHM) return undefined;
  try {
    assertFactRecord(value);
    return value;
  } catch {
    return undefined;
  }
}

function materializeLiveFactRecord(result: EvalResult): FactRecordResult {
  if (result.evaluationAlgorithm !== FACT_USE_EVALUATION_ALGORITHM || result.factTrace === undefined) {
    throw new Error(`Attempt "${result.id}" is not a complete ${FACT_USE_EVALUATION_ALGORITHM} Fact Record.`);
  }
  if (result.evaluationKind !== "pass" && result.evaluationKind !== "score") {
    throw new Error(`Attempt "${result.id}" has no Fact evaluation kind.`);
  }
  const { factTrace, assertions, scoreEntries, scoreResult, ...base } = result;
  void assertions;
  void scoreEntries;
  const materialized: FactRecordResult = {
    ...base,
    evaluationAlgorithm: FACT_USE_EVALUATION_ALGORITHM,
    evaluationKind: result.evaluationKind,
    factResults: [...factTrace.facts],
    factUses: [...factTrace.uses],
    legacyJudgeAssertions: [...factTrace.legacyJudgeAssertions],
    ...(result.evaluationKind === "score" && scoreResult !== undefined ? { scoreResult } : {}),
  };
  assertFactRecord(materialized, `Attempt "${result.id}"`);
  return materialized;
}

/**
 * A validated Fact envelope for persisted data or a fresh runner result. The
 * latter is materialized without mutating its non-enumerable trace fields.
 */
export function factRecordOf(value: unknown): FactRecordEnvelope | undefined {
  const persisted = persistedFactRecordOf(value);
  if (persisted !== undefined) return persisted;
  if (!isRecord(value) || value.evaluationAlgorithm !== FACT_USE_EVALUATION_ALGORITHM || !("factTrace" in value)) {
    return undefined;
  }
  try {
    return materializeLiveFactRecord(value as unknown as EvalResult);
  } catch {
    return undefined;
  }
}

/**
 * Materializes the runner's non-enumerable Fact trace for serialization and
 * reporter output. It also accepts an already-persisted Fact Record (carry /
 * read paths) without manufacturing a legacy hybrid.
 */
export function materializeFactRecord(result: EvalResult): FactRecordResult {
  const persisted = persistedFactRecordOf(result);
  if (persisted !== undefined) return result as unknown as FactRecordResult;
  return materializeLiveFactRecord(result);
}

/** Exact terminal state exposed by a Fact Record; legacy inputs retain Verdict. */
export function attemptTerminalOf(result: EvalResult | FactRecordResult): AttemptTerminal {
  const fact = factRecordOf(result);
  return sharedAttemptTerminalOf({
    verdict: result.verdict,
    ...(fact?.evaluationKind === "score" && fact.scoreResult !== undefined
      ? { evaluationKind: "score", scoreResult: fact.scoreResult }
      : {}),
  });
}

/** Maps a Fact terminal to the existing four-way Verdict only where required. */
export function verdictForTerminal(result: EvalResult | FactRecordResult): Verdict {
  return sharedVerdictForTerminal(attemptTerminalOf(result));
}

export function scoreOutcomeOf(result: EvalResult | FactRecordResult): ScoreFactAttemptOutcome | undefined {
  const fact = factRecordOf(result);
  return fact?.evaluationKind === "score" ? fact.scoreResult : undefined;
}
