import { only } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { judgeUsageChatResponse, judgeUsageHttp } from "../fixtures/judge-usage-http.ts";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// OpenRouter receipt fields and reported-cost precedence follow
// docs/design/judge-physical-usage/plans/plan-1/architecture.md.
// @feature docs/feature/inspection/README.md
test.concurrent("OpenRouter 已报告费用与明确零覆盖两次传输，整局费用完整并可追查", async () => {
  await inspectionE2E.case("judge-usage-reported", {
    artifacts: [...inspectionCaseArtifacts(), { source: "judge-usage-http-cleanup.json", target: "judge-usage-http-cleanup.json", optional: true }],
  }, async ({ paths, commands: { niceeval } }) => {
    const fixture = judgeUsageHttp([
      { status: 503, body: { error: { message: "Private provider failure detail" }, model: "judge-usage-served", provider: "router-serving",
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 }, cost: "0.002" } } },
      { status: 200, body: judgeUsageChatResponse({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 }, cost: 0 }, { provider: "router-serving" }) },
    ]);
    let bodyError: unknown;
    try {
      const baseUrl = await fixture.listen();
      const env = { NICEEVAL_E2E_JUDGE_USAGE_URL: baseUrl };
      const run = await niceeval.run(["exp", "judge-usage-reported", "--rerun", "all", "--json"], { env });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt().completion).toBe("completed");
      const event = only(run.expEvalEvents(), (item) => item.evalId === "judge-usage-qa" && item.experimentId === "judge-usage-reported", run.diagnostic());
      expect(event.verdict).toBe("passed");
      expect(fixture.requests).toHaveLength(2);
      for (const sent of fixture.requests) {
        expect(sent).toMatchObject({ method: "POST", path: "/v1/chat/completions" });
      }
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
        requests: { state: "available", value: 2, observationCount: 2 },
        inputTotalTokens: { state: "available", value: 240, observationCount: 2 },
        outputTokens: { state: "available", value: 60, observationCount: 2 },
        totalTokens: { state: "available", value: 300, observationCount: 2 },
        costs: { state: "complete", source: "reported", values: [{ currency: "USD", value: "0.002", source: "reported", coveredCalls: 2, reportedCalls: 2, estimatedCalls: 0 }], totalCalls: 2 },
      });
      expect(judge.calls).toHaveLength(2);

      expect(judge.calls).toEqual([
        expect.objectContaining({ callId: "judge:0:1:1", entryIndex: 0, logicalOrdinal: 1, transmissionOrdinal: 1, status: "failed", httpStatus: 503,
          cost: expect.objectContaining({ amount: "0.002", currency: "USD", source: expect.objectContaining({ kind: "reported" }) }),
          receipt: expect.objectContaining({ state: "available", fields: expect.arrayContaining([{ path: "usage.cost", value: "0.002" }]) }) }),
        expect.objectContaining({ callId: "judge:0:1:2", entryIndex: 0, logicalOrdinal: 1, transmissionOrdinal: 2, status: "succeeded", httpStatus: 200,
          cost: expect.objectContaining({ amount: "0", currency: "USD", source: expect.objectContaining({ kind: "reported" }) }),
          receipt: expect.objectContaining({ state: "available", fields: expect.arrayContaining([{ path: "usage.cost", value: 0 }]) }) }),
      ]);
      for (const call of judge.calls) expect(call).toMatchObject({
        operation: "classify", requestModel: "inspection-fixture-v1", transportProvider: "openrouter",
        provider: "router-serving", model: "judge-usage-served", inputTokens: 90, inputTotalTokens: 120,
        outputTokens: 30, cacheReadTokens: 20, cacheWriteTokens: 10,
      });
      // Both receipts have cost, including the explicit zero; configured pricing
      // must not produce either an extra charge or an estimate for these calls.
      expect(judge.priceReceipts).toEqual([]);
      expect(JSON.stringify(judge)).not.toContain("Private provider failure detail");
      expect(usage.calls).toHaveLength(1);
      expect(usage.calls).toEqual([expect.objectContaining({ callId: "application-1", provider: "offline-application", model: "application-model" })]);
      expect(usage.totals.requests).toEqual({ state: "available", value: 1, observationCount: 1 });
      expect(usage.totals.inputTotalTokens).toEqual({ state: "available", value: 4, observationCount: 1 });
      expect(usage.totals.outputTokens).toEqual({ state: "available", value: 1, observationCount: 1 });
      expect(usage.totals.costs).toEqual({ state: "complete", source: "reported", values: [{ currency: "USD", value: "0.25", source: "reported", coveredCalls: 1, reportedCalls: 1, estimatedCalls: 0 }], totalCalls: 1 });
      expect(usage.totalCosts).toEqual({ state: "complete", values: [{ currency: "USD", value: "0.252", source: "reported" }], missingSources: [] });

      // The ledger's formal entryId is consumed by the public detail operation.
      await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.get", locator: event.locator } }));
      const attemptRead = await niceeval.run(["query", "run", "--request", request]);
      expect(attemptRead.exitCode, attemptRead.diagnostic()).toBe(0);
      const entry = only(attemptRead.querySuccess("attempt.get").attempt.assertions.entries, (item) => item.display.label === "Answer QA", attemptRead.diagnostic());
      for (const call of judge.calls) {
        expect(call.entryId).toBe(entry.entryId);
        await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.assertion.detail", locator: event.locator, entryId: call.entryId } }));
        const detailRead = await niceeval.run(["query", "run", "--request", request]);
        expect(detailRead.exitCode, detailRead.diagnostic()).toBe(0);
        expect(detailRead.querySuccess("attempt.assertion.detail").assertion).toMatchObject({
          entryId: entry.entryId, display: { label: "Answer QA" }, check: { state: "matched" },
        });
      }
      await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "experiment.get", experimentId: "judge-usage-reported" } }));
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
        requests: { state: "available", value: 2, observationCount: 2 },
        inputTotalTokens: { state: "available", value: 240, observationCount: 2 },
        outputTokens: { state: "available", value: 60, observationCount: 2 },
        totalTokens: { state: "available", value: 300, observationCount: 2 },
        costs: { state: "complete", source: "reported", values: [{ currency: "USD", value: "0.002", source: "reported", coveredCalls: 2, reportedCalls: 2, estimatedCalls: 0 }], totalCalls: 2 },
      },
      });
      expect(origin.usage.judgeUsage).not.toHaveProperty("calls");
      expect(origin.usage.judgeUsage).not.toHaveProperty("priceReceipts");
      expect(origin.usage.totalCosts).toEqual({ state: "complete", values: [{ currency: "USD", value: "0.252", source: "reported" }], missingSources: [] });
      const attemptShown = await niceeval.run(["show", event.locator], { env });
      expect(attemptShown.exitCode, attemptShown.diagnostic()).toBe(0);
      const shown = await niceeval.run(["show", event.locator, "--usage"], { env });
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const experimentShown = await niceeval.run(["show", "--experiment", "judge-usage-reported"], { env });
      expect(experimentShown.exitCode, experimentShown.diagnostic()).toBe(0);
      for (const text of [attemptShown.stdout, shown.stdout, experimentShown.stdout]) {
        expect(text).toContain("Total costs");
        expect(text).toMatch(/USD[^\n]*0\.252\b/u);
        expect(text).toMatch(/Cost coverage[^\n]*Complete/u);
        expect(text).not.toContain("Known subtotal");
        expect(text).not.toContain("Missing sources");
        expect(text).not.toContain("judge-usage-offline-key");
      }
      for (const text of [shown.stdout, experimentShown.stdout]) {
        expect(text).toContain("Judge usage");
        expect(text).toContain("0.25");
        expect(text).not.toContain("judge-usage-offline-key");
      }

      for (const text of [shown.stdout, experimentShown.stdout]) {
        expect(text).toContain("0.002");
        expect(text).toContain("0.252");
        expect(text).toContain("USD");
        expect(text).toContain("2/2");
      }
      expect(fixture.requests).toHaveLength(2);
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
