// rerun: pnpm e2e test --repo inspection -- --run test/experiment-cost-incomplete.test.ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("实验已知零费用保留另一 Eval 的缺费来源，Query 与 Show 不声称完整总额", async () => {
  await inspectionE2E.case("experiment-cost-incomplete", { artifacts: inspectionCaseArtifacts() }, async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "experiment-cost-incomplete", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(run.expEvalEvents(), run.diagnostic()).toEqual(expect.arrayContaining([
      expect.objectContaining({ evalId: "experiment-cost-zero", attempts: 1, verdict: "passed" }),
      expect.objectContaining({ evalId: "experiment-cost-missing", attempts: 1, verdict: "passed" }),
    ]));
    expect(run.expEvalEvents()).toHaveLength(2);
    const request = join(paths.projectRoot, "experiment-cost-incomplete.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "experiment.get", experimentId: "experiment-cost-incomplete" } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const experiment = read.querySuccess("experiment.get").experiment;
    expect(experiment.costSummary).toEqual({
      scope: "latest-recorded-slots",
      totalCosts: { state: "partial", values: [{ currency: "USD", value: "0", source: "reported" }], missingSources: ["application"] },
      coverage: { selectedSlotCount: 2, resolvedSlotCount: 2, originAttemptCount: 2, completeAttemptCount: 1, partialAttemptCount: 0, unavailableAttemptCount: 1, unresolvedSlotCount: 0 },
    });
    expect(experiment.modelUsage).toMatchObject({ totalAttemptCount: 2, omittedAttemptCount: 0, unresolvedAttemptCount: 0 });
    const zeroLocator = only(run.expEvalEvents(), (event) => event.evalId === "experiment-cost-zero", run.diagnostic()).locator;
    const missingLocator = only(run.expEvalEvents(), (event) => event.evalId === "experiment-cost-missing", run.diagnostic()).locator;
    expect(only(experiment.modelUsage.attempts, (attempt) => attempt.locator === zeroLocator, read.diagnostic()).usage.totalCosts).toEqual({
      state: "complete", values: [{ currency: "USD", value: "0", source: "reported" }], missingSources: [],
    });
    expect(only(experiment.modelUsage.attempts, (attempt) => attempt.locator === missingLocator, read.diagnostic()).usage.totalCosts).toEqual({
      state: "unavailable", values: [], missingSources: ["application"],
    });
    const shown = await niceeval.run(["show", "--experiment", "experiment-cost-incomplete"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    const summary = shown.stdout.match(/Experiment known subtotal[\s\S]*?(?=Summary|$)/u)?.[0];
    expect(summary, shown.diagnostic()).toBeDefined();
    expect(summary).toMatch(/USD\s+0\b/u);
    expect(summary).toContain("Incomplete");
    expect(summary).toMatch(/Missing sources[^\n]*application/u);
    expect(summary).toMatch(/Scope[^\n]*Latest recorded slots/u);
    expect(summary).toMatch(/Attempts with complete costs[^\n]*\b1\b/u);
    expect(summary).toMatch(/Attempts with unavailable costs[^\n]*\b1\b/u);
    expect(shown.stdout).not.toContain("Experiment total costs");
  });
});
