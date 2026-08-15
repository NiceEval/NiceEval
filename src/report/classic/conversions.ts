import { passRate, resultBearingAttemptCount, totalAttempts } from "./aggregate.ts";
import { displayClassicExperimentId } from "./experiment-id.ts";
import type {
  AttemptEvidence,
  AttemptListItem,
  AttemptSummaryData,
  CopyBlockContent,
  SampleSummaryContent,
} from "./attempt.ts";
import { classicAttemptLocator, type Sample } from "./sample.ts";

export async function toSummaryItems(sample: Sample): Promise<SampleSummaryContent> {
  const experiments = new Set(sample.units.map((unit) => unit.experimentId));
  const overall = passRate.compute(sample.units);
  return Object.freeze({
    range: Object.freeze({
      earliestStartedAt: sample.earliestRunAt === null ? null : new Date(sample.earliestRunAt).toISOString(),
      latestStartedAt: sample.latestRunAt === null ? null : new Date(sample.latestRunAt).toISOString(),
    }),
    experiments: experiments.size,
    evals: sample.units.length,
    attempts: resultBearingAttemptCount(sample.attempts),
    endToEndPassRate: Object.freeze({
      ...overall,
      unit: "%",
      format: "percent" as const,
    }),
    totalCostUSD: totalAttempts(sample.units, "costUSD", { unit: "USD", better: "lower" }),
  });
}

export async function toAttemptListRows(sample: Sample): Promise<readonly AttemptListItem[]> {
  return Object.freeze(
    sample.attempts.flatMap((attempt) => {
      const locator = classicAttemptLocator(attempt);
      if (locator === undefined) {
        return [];
      }
      const failures = assertionFailures(attempt.assertions);
      return [Object.freeze({
        experimentId: attempt.experimentId,
        evalId: attempt.evalId,
        attempt: attempt.attempt,
        agent: sample.profiles[attempt.experimentId]?.agent ?? null,
        evaluationKind: attempt.evaluationKind,
        verdict: attempt.verdict ?? "unavailable",
        failureSummary: failures === undefined
          ? (attempt.verdict === "failed" || attempt.verdict === "errored" ? attempt.verdict : null)
          : failures[0] ?? (attempt.verdict === "failed" || attempt.verdict === "errored" ? attempt.verdict : null),
        moreFailures: failures === undefined
          ? null
          : Math.max(0, failures.length - 1),
        durationMs: attempt.durationMs,
        costUSD: attempt.costUSD,
        historical: attempt.historical,
        locator,
      })];
    }),
  );
}

function assertionFailures(
  assertions: Sample["attempts"][number]["assertions"],
): readonly string[] | undefined {
  if (assertions.state !== "available") {
    return undefined;
  }
  return assertions.value.flatMap((assertion) => {
    if (assertion.outcome !== "failed" && assertion.outcome !== "errored") {
      return [];
    }
    return [assertion.label ?? assertion.key ?? assertion.outcome];
  });
}

export async function toAttemptSummary(attempt: AttemptEvidence): Promise<AttemptSummaryData> {
  return Object.freeze({
    locator: attempt.locator,
    experimentId: attempt.experimentId,
    evalId: attempt.evalId,
    verdict: attempt.result.verdict ?? "unknown",
  });
}

export async function toAttemptFixPrompt(attempt: AttemptEvidence): Promise<CopyBlockContent | null> {
  if (attempt.result.verdict !== "failed" && attempt.result.verdict !== "errored") {
    return null;
  }
  return [
    `Fix attempt ${attempt.locator}`,
    `experiment: ${displayClassicExperimentId(attempt.experimentId)}`,
    `eval: ${attempt.evalId}`,
    `verdict: ${attempt.result.verdict}`,
  ].join("\n");
}
