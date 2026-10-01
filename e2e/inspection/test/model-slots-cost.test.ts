import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("375 次调用的已知小计保留 19 次费用缺口并公开覆盖分母", async () => {
  await inspectionE2E.case("model-slots-cost", { artifacts: inspectionCaseArtifacts() }, async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "model-slots-cost", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), (entry) => entry.evalId === "model-slots-cost", run.diagnostic());
    const request = join(paths.projectRoot, "cost.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.querySuccess("attempt.usage").usage;
    expect(usage.totals.costs).toEqual({ state: "partial", source: "reported", values: [{ currency: "USD", value: "0.071083152", source: "reported", coveredCalls: 356, reportedCalls: 356, estimatedCalls: 0 }], totalCalls: 375 });
    expect(usage.configuredModels).toMatchObject({ state: "available", bindings: [
      { modelSlot: "planner", recordedCalls: 356 }, { modelSlot: "reviewer", recordedCalls: 19 }, { modelSlot: "unused", recordedCalls: 0 },
    ] });
    expect(usage.modelGroups).toMatchObject({ totalGroupCount: 2, groups: [
      { modelSlot: "planner", recordedCalls: 356, costs: { state: "complete", totalCalls: 356, values: [{ value: "0.071083152", coveredCalls: 356 }] } },
      { modelSlot: "reviewer", recordedCalls: 19, costs: { state: "unavailable", totalCalls: 19, values: [] } },
    ] });
    expect(usage.callsTruncated).toBe(true);
    expect(usage.omittedCallCount).toBe(247);
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
    expect(usage.totalCosts).toEqual({ state: "partial", values: [{ currency: "USD", value: "0.071083152", source: "reported" }], missingSources: ["application"] });
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "overview.get" } }));
    const overviewRead = await niceeval.run(["query", "run", "--request", request]);
    expect(overviewRead.exitCode, overviewRead.diagnostic()).toBe(0);
    const overview = overviewRead.querySuccess("overview.get").overview;
    const cell = only(overview.cells, (item) => item.experimentId === "model-slots-cost" && item.evalId === "model-slots-cost", overviewRead.diagnostic());
    expect(cell.costUSD).toMatchObject({ state: "partial", value: 0.071083152, source: "reported", unit: "USD" });
    expect(cell.tokens).toMatchObject({ state: "available", value: 750, unit: "tokens" });
    const aggregate = only(overview.experiments, (item) => item.experimentId === "model-slots-cost", overviewRead.diagnostic());
    expect(aggregate.costUSD).toMatchObject({ state: "partial", value: 0.071083152, source: "reported", unit: "USD" });
    expect(aggregate.tokens).toMatchObject({ state: "available", value: 750, unit: "tokens" });
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "experiment.get", experimentId: "model-slots-cost" } }));
    const experimentRead = await niceeval.run(["query", "run", "--request", request]);
    expect(experimentRead.exitCode, experimentRead.diagnostic()).toBe(0);
    const experiment = experimentRead.querySuccess("experiment.get").experiment;
    expect(experiment.experiment.costUSD).toMatchObject({ state: "partial", value: 0.071083152, source: "reported", unit: "USD" });
    expect(experiment.experiment.tokens).toMatchObject({ state: "available", value: 750, unit: "tokens" });
    expect(experiment.modelUsage).toMatchObject({ totalAttemptCount: 1, omittedAttemptCount: 0, unresolvedAttemptCount: 0 });
    const memberUsage = only(experiment.modelUsage.attempts, (item) => item.locator === event.locator, experimentRead.diagnostic());
    expect(memberUsage.originRunId).toBe(only(run.expReceipt().createdRunIds, () => true, run.diagnostic()));
    expect(memberUsage.usage).toEqual({
      state: usage.state, configuredModels: usage.configuredModels, modelGroups: usage.modelGroups,
      judgeUsage: judgeSummary, totalCosts: usage.totalCosts, totals: usage.totals,
    });
    const shown = await niceeval.run(["show", event.locator, "--usage"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toContain("0.071083152 USD");
    expect(shown.stdout).toContain("356/375 covered calls");
    expect(shown.stdout.slice(shown.stdout.indexOf("Known subtotal"), shown.stdout.indexOf("Application usage"))).toContain("Incomplete");
    expect(shown.stdout).toContain("No Judge calls");
  });
});
