

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("用途与实际模型分列，零费用与未知费用保留且裁判缺口可读", async () => {
  await inspectionE2E.case("model-roles-usage", { artifacts: inspectionCaseArtifacts() }, async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "model-roles", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), (entry) => entry.evalId === "model-roles", run.diagnostic());
    expect(event.verdict).toBe("passed");

    const read = await niceeval.run(["show", event.locator, "usage", "--json"]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.inspectionSuccess("attempt.usage").usage;
    expect(usage.configuredModels).toEqual({ state: "available", bindings: [
      { modelRole: "planner", model: "fixture/shared", reasoningEffort: "high", recordedCalls: 2 },
      { modelRole: "reviewer", model: "fixture/shared", reasoningEffort: null, recordedCalls: 1 },
      { modelRole: "unused", model: "fixture/unused", reasoningEffort: null, recordedCalls: 0 },
    ] });
    expect(usage.calls).toHaveLength(4);
    expect(usage.calls).toEqual([
      expect.objectContaining({ callId: "planner-1", modelRole: "planner", status: "failed", effectiveCost: expect.objectContaining({ amount: "0", source: { kind: "reported", id: "offline.response" } }) }),
      expect.objectContaining({ callId: "planner-2", modelRole: "planner", retryOf: "planner-1", provider: null, model: "fixture/fallback" }),
      expect.objectContaining({ callId: "reviewer-1", modelRole: "reviewer", model: "fixture/shared" }),
      expect.objectContaining({ callId: "unattributed-1", modelRole: null, provider: null, effectiveCost: null }),
    ]);
    expect(usage.modelGroups).toMatchObject({ state: "available", basis: "recorded-calls", totalGroupCount: 4, groupsTruncated: false, omittedGroupCount: 0 });
    expect(usage.modelGroups.groups).toEqual([
      expect.objectContaining({ modelRole: null, provider: null, model: "fixture/unpriced", recordedCalls: 1, costs: { state: "unavailable", source: null, values: [], totalCalls: 1 } }),
      expect.objectContaining({ modelRole: "planner", provider: null, model: "fixture/fallback", recordedCalls: 1, costs: expect.objectContaining({ values: [expect.objectContaining({ currency: "USD", value: "0.125" })] }) }),
      expect.objectContaining({ modelRole: "planner", provider: "fixture-provider", model: "fixture/shared", recordedCalls: 1, costs: expect.objectContaining({ values: [expect.objectContaining({ currency: "USD", value: "0", reportedCalls: 1 })] }) }),
      expect.objectContaining({ modelRole: "reviewer", provider: "fixture-provider", model: "fixture/shared", recordedCalls: 1, costs: expect.objectContaining({ values: [expect.objectContaining({ currency: "USD", value: "0.25" })] }) }),
    ]);
    expect(usage.totals.costs).toEqual({ state: "partial", source: "reported", values: [{ currency: "USD", value: "0.375", source: "reported", coveredCalls: 3, reportedCalls: 3, estimatedCalls: 0 }], totalCalls: 4 });
    const judgeSummary = {
      state: "complete", coverage: "physical-transmissions", collection: { state: "complete", limitations: [] },
      totals: {
        requests: { state: "available", value: 0, observationCount: 0 },
        inputTotalTokens: { state: "available", value: 0, observationCount: 0 },
        outputTokens: { state: "available", value: 0, observationCount: 0 },
        totalTokens: { state: "available", value: 0, observationCount: 0 },
        costs: { state: "complete", source: null, values: [], totalCalls: 0 },
      },
    };
    expect(usage.judgeUsage).toEqual({ ...judgeSummary, calls: [], callsTruncated: false, omittedCallCount: 0, priceReceipts: [] });
    expect(usage.totalCosts).toEqual({ state: "partial", values: [{ currency: "USD", value: "0.375", source: "reported" }], missingSources: ["application"] });

    const overviewRead = await niceeval.run(["show", "--record", ".niceeval/record.sqlite", "--json"]);
    expect(overviewRead.exitCode, overviewRead.diagnostic()).toBe(0);
    const overview = overviewRead.inspectionSuccess("overview.get").overview;
    const cell = only(overview.cells, (item) => item.experimentId === "model-roles" && item.evalId === "model-roles", overviewRead.diagnostic());
    expect(cell.costUSD).toMatchObject({ state: "partial", value: 0.375, source: "reported", unit: "USD" });
    expect(cell.tokens).toMatchObject({ state: "partial", value: 40, unit: "tokens" });
    const aggregate = only(overview.experiments, (item) => item.experimentId === "model-roles", overviewRead.diagnostic());
    expect(aggregate.costUSD).toMatchObject({ state: "partial", value: 0.375, source: "reported", unit: "USD" });
    expect(aggregate.tokens).toMatchObject({ state: "partial", value: 40, unit: "tokens" });

    const experimentRead = await niceeval.run(["show", `exp:${"model-roles"}`, "--json"]);
    expect(experimentRead.exitCode, experimentRead.diagnostic()).toBe(0);
    const experiment = experimentRead.inspectionSuccess("experiment.get").experiment;
    expect(experiment.experiment.costUSD).toMatchObject({ state: "partial", value: 0.375, source: "reported", unit: "USD" });
    expect(experiment.experiment.tokens).toMatchObject({ state: "partial", value: 40, unit: "tokens" });
    expect(experiment.modelUsage).toMatchObject({ totalAttemptCount: 1, omittedAttemptCount: 0, unresolvedAttemptCount: 0 });
    const memberUsage = only(experiment.modelUsage.attempts, (item) => item.locator === event.locator, experimentRead.diagnostic());
    expect(memberUsage.originRunId).toBe(only(run.expReceipt().createdRunIds, () => true, run.diagnostic()));
    expect(memberUsage.usage).toEqual({
      state: usage.state, configuredModels: usage.configuredModels, modelGroups: usage.modelGroups,
      judgeUsage: judgeSummary, totalCosts: usage.totalCosts, totals: usage.totals,
    });
    const shown = await niceeval.run(["show", event.locator, "usage"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    for (const value of ["planner", "reviewer", "unused", "fixture/shared", "fixture/fallback", "fixture/unused", "0.375", "USD"]) expect(shown.stdout).toContain(value);
    expect(shown.stdout).toContain("Judge usage");
    expect(shown.stdout).toContain("No Judge calls");
    expect(shown.stdout.slice(shown.stdout.indexOf("Judge usage"))).toContain("complete");
    expect(shown.stdout.slice(shown.stdout.indexOf("Known subtotal"), shown.stdout.indexOf("Application usage"))).toContain("Incomplete");
    expect(shown.stdout).toMatch(/unused[^\n]*no recorded calls/iu);
  });
});
