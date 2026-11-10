import { expect, test } from "vitest";
import { adapterEvidenceUnavailable } from "./attempt-resources.ts";
import { AdapterUsageCollector, retainAdapterUsage } from "./adapter-usage.ts";
import { filterSummary, summarize } from "./report.ts";
import { EVALUATION_ALGORITHM, type EvalResult } from "./types.ts";

function result(id: string, state: "complete" | "partial", calls: number): EvalResult {
  const result: EvalResult = {
    id, adapter: { name: "fixture", contract: "fixture", behaviorRevision: null },
    verdict: "passed", evaluationKind: "pass", evaluationAlgorithm: EVALUATION_ALGORITHM,
    attempt: 1, durationMs: 1, factResults: [], factUses: [],
    evidenceCoverage: adapterEvidenceUnavailable,
    // The sealed capture is authoritative even when legacy usage says zero.
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  const collector = new AdapterUsageCollector(() => {}, undefined);
  for (let index = 0; index < calls; index += 1) {
    collector.record({ callId: `call-${index}`, model: "fixture", provider: "fixture",
      status: "succeeded", inputTokens: 70, cacheReadTokens: 30,
      inputTotalTokens: 100, outputTokens: 20 });
  }
  collector.seal(state === "complete" ? { state } : { state, reason: "missing-call" });
  retainAdapterUsage(result, collector.close());
  return result;
}

// @feature docs/feature/experiments/README.md
test("invocation and scoped summaries sum sealed adapter calls across attempts without double counting cached input", () => {
  const summary = summarize([result("first", "complete", 2), result("second", "complete", 1)], [], "2026-01-01T00:00:00Z", 2);
  expect(summary.usage).toEqual({ inputTokens: 210, outputTokens: 60 });
  expect(filterSummary(summary, new Set(["first"])).usage).toEqual({ inputTokens: 140, outputTokens: 40 });
});

// @feature docs/feature/experiments/README.md
test("partial adapter usage keeps invocation totals unknown instead of falling back to legacy zero", () => {
  const summary = summarize([result("first", "complete", 1), result("second", "partial", 1)], [], "2026-01-01T00:00:00Z", 2);
  expect(summary.usage).toEqual({ inputTokens: undefined, outputTokens: undefined });
});
