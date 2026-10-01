import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defined, only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("调用和模型组预览均漏掉 z 时用途计数仍为 129、1、0", async () => {
  await inspectionE2E.case("model-slots-truncated", { artifacts: inspectionCaseArtifacts() }, async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "model-slots-truncated", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), (entry) => entry.evalId === "model-slots-truncated", run.diagnostic());
    expect(event.verdict).toBe("passed");
    const request = join(paths.projectRoot, "truncated.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.querySuccess("attempt.usage").usage;
    expect(usage.configuredModels).toEqual({ state: "available", bindings: [
      { modelSlot: "a", model: "fixture/requested-a", reasoningEffort: null, recordedCalls: 129 },
      { modelSlot: "unused", model: "fixture/unused", reasoningEffort: null, recordedCalls: 0 },
      { modelSlot: "z", model: "fixture/z", reasoningEffort: null, recordedCalls: 1 },
    ] });
    expect(usage.callsTruncated).toBe(true);
    expect(usage.omittedCallCount).toBe(2);
    expect(usage.calls).toHaveLength(128);
    expect(defined(usage.calls, read.diagnostic()).every((call) => call.modelSlot === "a")).toBe(true);
    expect(usage.modelGroups).toMatchObject({ state: "available", basis: "recorded-calls", totalGroupCount: 130, groupsTruncated: true, omittedGroupCount: 66 });
    expect(usage.modelGroups.groups).toHaveLength(64);
    expect(usage.modelGroups.groups.every((group) => group.modelSlot === "a" && group.recordedCalls === 1)).toBe(true);
    expect(usage.totals.requests).toMatchObject({ state: "available", value: 130, observationCount: 130 });
    expect(usage.totals.inputTotalTokens).toMatchObject({ state: "available", value: 136, observationCount: 130 });
    expect(usage.totals.outputTokens).toMatchObject({ state: "available", value: 132, observationCount: 130 });
    expect(usage.totals.costs).toEqual({ state: "complete", source: "reported", values: [{ currency: "USD", value: "0.5", source: "reported", coveredCalls: 130, reportedCalls: 130, estimatedCalls: 0 }], totalCalls: 130 });
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
    expect(usage.totalCosts).toEqual({ state: "complete", values: [{ currency: "USD", value: "0.5", source: "reported" }], missingSources: [] });
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "overview.get" } }));
    const overviewRead = await niceeval.run(["query", "run", "--request", request]);
    expect(overviewRead.exitCode, overviewRead.diagnostic()).toBe(0);
    const overview = overviewRead.querySuccess("overview.get").overview;
    const cell = only(overview.cells, (item) => item.experimentId === "model-slots-truncated" && item.evalId === "model-slots-truncated", overviewRead.diagnostic());
    expect(cell.costUSD).toMatchObject({ state: "available", value: 0.5, source: "reported", unit: "USD" });
    expect(cell.tokens).toMatchObject({ state: "available", value: 268, unit: "tokens" });
    const aggregate = only(overview.experiments, (item) => item.experimentId === "model-slots-truncated", overviewRead.diagnostic());
    expect(aggregate.costUSD).toMatchObject({ state: "available", value: 0.5, source: "reported", unit: "USD" });
    expect(aggregate.tokens).toMatchObject({ state: "available", value: 268, unit: "tokens" });
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "experiment.get", experimentId: "model-slots-truncated" } }));
    const experimentRead = await niceeval.run(["query", "run", "--request", request]);
    expect(experimentRead.exitCode, experimentRead.diagnostic()).toBe(0);
    const experiment = experimentRead.querySuccess("experiment.get").experiment;
    expect(experiment.experiment.costUSD).toMatchObject({ state: "available", value: 0.5, source: "reported", unit: "USD" });
    expect(experiment.experiment.tokens).toMatchObject({ state: "available", value: 268, unit: "tokens" });
    expect(experiment.modelUsage).toMatchObject({ totalAttemptCount: 1, omittedAttemptCount: 0, unresolvedAttemptCount: 0 });
    const memberUsage = only(experiment.modelUsage.attempts, (item) => item.locator === event.locator, experimentRead.diagnostic());
    expect(memberUsage.originRunId).toBe(only(run.expReceipt().createdRunIds, () => true, run.diagnostic()));
    expect(memberUsage.usage).toEqual({
      state: usage.state, configuredModels: usage.configuredModels, modelGroups: usage.modelGroups,
      judgeUsage: judgeSummary, totalCosts: usage.totalCosts, totals: usage.totals,
    });
    const shown = await niceeval.run(["show", event.locator, "--usage"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toMatch(/\ba\b[^\n]*129/u);
    expect(shown.stdout).toMatch(/\bz\b[^\n]*\b1\b/u);
    expect(shown.stdout).toMatch(/unused[^\n]*no recorded calls/iu);
    expect(shown.stdout).not.toMatch(/\bz\b[^\n]*no recorded calls/iu);
    expect(shown.stdout).toContain("0.5 USD");
  });
});
