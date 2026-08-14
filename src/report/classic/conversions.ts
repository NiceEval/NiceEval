import { passRate, totalAttempts } from "./aggregate.ts";
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
  const scored = sample.attempts.filter((attempt) =>
    attempt.verdict === "passed" || attempt.verdict === "failed" || attempt.verdict === "errored"
  );
  const overall = passRate.compute(sample.units);
  return Object.freeze({
    range: Object.freeze({
      earliestStartedAt: sample.earliestRunAt === null ? null : new Date(sample.earliestRunAt).toISOString(),
      latestStartedAt: sample.latestRunAt === null ? null : new Date(sample.latestRunAt).toISOString(),
    }),
    experiments: experiments.size,
    evals: sample.units.length,
    attempts: scored.length,
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
      return [Object.freeze({
        experimentId: attempt.experimentId,
        evalId: attempt.evalId,
        attempt: attempt.attempt,
        agent: sample.profiles[attempt.experimentId]?.agent ?? "unknown",
        evaluationKind: "pass" as const,
        verdict: attempt.verdict ?? "skipped",
        failureSummary: attempt.verdict === "failed" || attempt.verdict === "errored"
          ? attempt.verdict
          : null,
        moreFailures: 0,
        durationMs: attempt.durationMs,
        costUSD: attempt.costUSD,
        historical: false,
        locator,
      })];
    }),
  );
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
    `experiment: ${attempt.experimentId}`,
    `eval: ${attempt.evalId}`,
    `verdict: ${attempt.result.verdict}`,
  ].join("\n");
}
