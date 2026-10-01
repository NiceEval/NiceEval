import { only } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { judgeUsageHttp } from "../fixtures/judge-usage-http.ts";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("完整空材料证明没有 Judge 发送，应用费用与总费用仍可读", async () => {
  await inspectionE2E.case("judge-usage-empty", {
    artifacts: [...inspectionCaseArtifacts(), { source: "judge-usage-http-cleanup.json", target: "judge-usage-http-cleanup.json", optional: true }],
  }, async ({ paths, commands: { niceeval } }) => {
    const fixture = judgeUsageHttp([]);
    let bodyError: unknown;
    try {
      const baseUrl = await fixture.listen();
      const env = { NICEEVAL_E2E_JUDGE_USAGE_URL: baseUrl };
      const run = await niceeval.run(["exp", "judge-usage-empty", "--rerun", "all", "--json"], { env });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt().completion).toBe("completed");
      const event = only(run.expEvalEvents(), (item) => item.evalId === "judge-usage-empty" && item.experimentId === "judge-usage-empty", run.diagnostic());
      expect(event.verdict).toBe("passed");
      expect(fixture.requests).toHaveLength(0);
      const request = join(paths.projectRoot, "judge-usage.request.json");
      await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
      const read = await niceeval.run(["query", "run", "--request", request]);
      expect(read.exitCode, read.diagnostic()).toBe(0);
      const usage = read.querySuccess("attempt.usage").usage;
      const judge = usage.judgeUsage;
      // This checkpoint must kill the old candidate which reports only unavailable.
      expect(judge.state, read.diagnostic()).toBe("complete");
      if (judge.state !== "complete") throw new Error("Expected the sealed physical Judge ledger");
      expect(judge).toMatchObject({
        coverage: "physical-transmissions", collection: { state: "complete", limitations: [] },
        callsTruncated: false, omittedCallCount: 0,
      });
      expect(judge.totals).toEqual({
        requests: { state: "available", value: 0, observationCount: 0 },
        inputTotalTokens: { state: "available", value: 0, observationCount: 0 },
        outputTokens: { state: "available", value: 0, observationCount: 0 },
        totalTokens: { state: "available", value: 0, observationCount: 0 },
        costs: { state: "complete", source: null, values: [], totalCalls: 0 },
      });
      expect(judge.calls).toHaveLength(0);

      expect(judge.calls).toEqual([]);
      expect(judge.priceReceipts).toEqual([]);
      expect(usage.calls).toHaveLength(1);
      expect(usage.calls).toEqual([expect.objectContaining({ callId: "application-1", provider: "offline-application", model: "application-model" })]);
      expect(usage.totals.requests).toEqual({ state: "available", value: 1, observationCount: 1 });
      expect(usage.totals.inputTotalTokens).toEqual({ state: "available", value: 4, observationCount: 1 });
      expect(usage.totals.outputTokens).toEqual({ state: "available", value: 1, observationCount: 1 });
      expect(usage.totals.costs).toEqual({ state: "complete", source: "reported", values: [{ currency: "USD", value: "0.25", source: "reported", coveredCalls: 1, reportedCalls: 1, estimatedCalls: 0 }], totalCalls: 1 });
      expect(usage.totalCosts).toEqual({ state: "complete", values: [{ currency: "USD", value: "0.25", source: "reported" }], missingSources: [] });

      await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "experiment.get", experimentId: "judge-usage-empty" } }));
      const experimentRead = await niceeval.run(["query", "run", "--request", request]);
      expect(experimentRead.exitCode, experimentRead.diagnostic()).toBe(0);
      const experiment = experimentRead.querySuccess("experiment.get").experiment;
      expect(experiment.experiment.costUSD).toMatchObject({ state: "available", value: 0.25, source: "reported", unit: "USD" });
      expect(experiment.experiment.tokens).toMatchObject({ state: "available", value: 5, unit: "tokens" });
      expect(experiment.modelUsage).toMatchObject({ totalAttemptCount: 1, omittedAttemptCount: 0, unresolvedAttemptCount: 0 });
      const origin = only(experiment.modelUsage.attempts, (item) => item.locator === event.locator, experimentRead.diagnostic());
      expect(origin.originRunId).toBe(only(run.expReceipt().createdRunIds, () => true, run.diagnostic()));
      expect(origin.usage.judgeUsage).toEqual({
        state: "complete", coverage: "physical-transmissions", collection: { state: "complete", limitations: [] },
        totals: {
        requests: { state: "available", value: 0, observationCount: 0 },
        inputTotalTokens: { state: "available", value: 0, observationCount: 0 },
        outputTokens: { state: "available", value: 0, observationCount: 0 },
        totalTokens: { state: "available", value: 0, observationCount: 0 },
        costs: { state: "complete", source: null, values: [], totalCalls: 0 },
      },
      });
      expect(origin.usage.judgeUsage).not.toHaveProperty("calls");
      expect(origin.usage.judgeUsage).not.toHaveProperty("priceReceipts");
      expect(origin.usage.totalCosts).toEqual({ state: "complete", values: [{ currency: "USD", value: "0.25", source: "reported" }], missingSources: [] });
      const attemptShown = await niceeval.run(["show", event.locator], { env });
      expect(attemptShown.exitCode, attemptShown.diagnostic()).toBe(0);
      expect(attemptShown.stdout).toContain("Total costs");
      expect(attemptShown.stdout).toMatch(/USD[^\n]*0\.25\b/u);
      expect(attemptShown.stdout).toMatch(/Cost coverage[^\n]*Complete/u);
      expect(attemptShown.stdout).not.toContain("Known subtotal");
      expect(attemptShown.stdout).not.toContain("Missing sources");
      expect(attemptShown.stdout).not.toContain("judge-usage-offline-key");
      const shown = await niceeval.run(["show", event.locator, "--usage"], { env });
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const experimentShown = await niceeval.run(["show", "--experiment", "judge-usage-empty"], { env });
      expect(experimentShown.exitCode, experimentShown.diagnostic()).toBe(0);
      for (const text of [shown.stdout, experimentShown.stdout]) {
        expect(text).toContain("Judge usage");
        expect(text).toContain("0.25");
        expect(text).not.toContain("judge-usage-offline-key");
      }

      expect(shown.stdout).toContain("No Judge calls");
      expect(experimentShown.stdout).toContain("No Judge calls");
      expect(fixture.requests).toHaveLength(0);
      expect(JSON.stringify(judge)).not.toContain("judge-usage-offline-key");
      expect(JSON.stringify(judge)).not.toContain("The answer names Paris.");
    } catch (error) {
      bodyError = error;
      throw error;
    } finally {
      try {
        const cleanup = await fixture.close();
        await writeFile(join(paths.projectRoot, "judge-usage-http-cleanup.json"), JSON.stringify({ ...cleanup, requestCount: fixture.requests.length }));
        expect(cleanup).toEqual({ listening: false, openConnections: 0 });
      } catch (cleanupError) {
        if (bodyError !== undefined) throw new AggregateError([bodyError, cleanupError], "Judge usage journey and HTTP cleanup failed", { cause: bodyError });
        throw cleanupError;
      }
    }
  });
});
