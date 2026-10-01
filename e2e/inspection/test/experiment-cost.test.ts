// rerun: pnpm e2e test --repo inspection -- --run test/experiment-cost.test.ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("实验总费用包含预览之外的失败 Attempt，部分 Eval 重跑替代旧费用并保留其它结果", async () => {
  await inspectionE2E.case("experiment-cost", { artifacts: inspectionCaseArtifacts() }, async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "experiment-cost", "--rerun", "all", "--json"], {
      env: { NICEEVAL_E2E_EXPERIMENT_COST_PHASE: "initial" },
    });
    expect(run.exitCode, run.diagnostic()).not.toBe(0);
    expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
    expect(run.expEvalEvents(), run.diagnostic()).toEqual(expect.arrayContaining([
      expect.objectContaining({ evalId: "experiment-cost-paid", attempts: 35, passed: 35, verdict: "passed" }),
      expect.objectContaining({ evalId: "experiment-cost-failed", attempts: 35, passed: 0, verdict: "failed" }),
    ]));
    expect(run.expEvalEvents()).toHaveLength(2);
    const originalRunId = only(run.expReceipt().createdRunIds, () => true, run.diagnostic());
    const request = join(paths.projectRoot, "experiment-cost.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "experiment.get", experimentId: "experiment-cost" } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const experiment = read.querySuccess("experiment.get").experiment;
    // 35 × 0.100000001 + 35 × 0.200000002; no float or preview-derived oracle.
    expect(experiment.costSummary).toEqual({
      scope: "latest-recorded-slots",
      totalCosts: { state: "complete", values: [{ currency: "USD", value: "10.500000105", source: "reported" }], missingSources: [] },
      coverage: { selectedSlotCount: 70, resolvedSlotCount: 70, originAttemptCount: 70, completeAttemptCount: 70, partialAttemptCount: 0, unavailableAttemptCount: 0, unresolvedSlotCount: 0 },
    });
    expect(experiment.modelUsage).toMatchObject({ totalAttemptCount: 70, omittedAttemptCount: 6, unresolvedAttemptCount: 0 });
    expect(experiment.modelUsage.attempts).toHaveLength(64);
    expect(experiment.experiment.verdict.tally).toEqual({ passed: 35, failed: 35, errored: 0, skipped: 0 });
    const retained = only(experiment.cells, (cell) => cell.evalId === "experiment-cost-failed", read.diagnostic());
    expect(retained.members).toHaveLength(35);

    const shown = await niceeval.run(["show", "--experiment", "experiment-cost"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    const summary = shown.stdout.match(/Experiment total costs[\s\S]*?(?=Summary|$)/u)?.[0];
    expect(summary, shown.diagnostic()).toBeDefined();
    expect(summary).toMatch(/USD\s+10\.500000105\b/u);
    expect(summary).toMatch(/Scope[^\n]*Latest recorded slots/u);
    expect(summary).toMatch(/Selected slots[^\n]*\b70\b/u);
    expect(summary).toMatch(/Unique origin Attempts[^\n]*\b70\b/u);
    expect(summary).toMatch(/Unresolved slots[^\n]*\b0\b/u);

    const rerun = await niceeval.run(["exp", "experiment-cost", "experiment-cost-paid", "--rerun", "all", "--json"], {
      env: { NICEEVAL_E2E_EXPERIMENT_COST_PHASE: "replacement" },
    });
    expect(rerun.exitCode, rerun.diagnostic()).toBe(0);
    expect(rerun.expReceipt(), rerun.diagnostic()).toMatchObject({ completion: "completed" });
    expect(rerun.expEvalEvents(), rerun.diagnostic()).toEqual([
      expect.objectContaining({ evalId: "experiment-cost-paid", attempts: 35, passed: 35, verdict: "passed" }),
    ]);
    const replacementRunId = only(rerun.expReceipt().createdRunIds, () => true, rerun.diagnostic());
    expect(replacementRunId).not.toBe(originalRunId);
    const reread = await niceeval.run(["query", "run", "--request", request]);
    expect(reread.exitCode, reread.diagnostic()).toBe(0);
    const replaced = reread.querySuccess("experiment.get").experiment;
    // 35 × 0.300000003 + the untouched 35 × 0.200000002, excluding old paid origins.
    expect(replaced.costSummary).toEqual({
      scope: "latest-recorded-slots",
      totalCosts: { state: "complete", values: [{ currency: "USD", value: "17.500000175", source: "reported" }], missingSources: [] },
      coverage: { selectedSlotCount: 70, resolvedSlotCount: 70, originAttemptCount: 70, completeAttemptCount: 70, partialAttemptCount: 0, unavailableAttemptCount: 0, unresolvedSlotCount: 0 },
    });
    expect(replaced.modelUsage).toMatchObject({ totalAttemptCount: 70, omittedAttemptCount: 6, unresolvedAttemptCount: 0 });
    expect(replaced.modelUsage.attempts).toHaveLength(64);
    expect(only(replaced.cells, (cell) => cell.evalId === "experiment-cost-failed", reread.diagnostic()).members).toEqual(retained.members);
    const paid = only(replaced.cells, (cell) => cell.evalId === "experiment-cost-paid", reread.diagnostic());
    expect(paid.members).toHaveLength(35);
    expect(paid.members.every((member) => member.runId === replacementRunId)).toBe(true);
    const reshown = await niceeval.run(["show", "--experiment", "experiment-cost"]);
    expect(reshown.exitCode, reshown.diagnostic()).toBe(0);
    const replacementSummary = reshown.stdout.match(/Experiment total costs[\s\S]*?(?=Summary|$)/u)?.[0];
    expect(replacementSummary, reshown.diagnostic()).toBeDefined();
    expect(replacementSummary).toMatch(/USD\s+17\.500000175\b/u);
    expect(replacementSummary).toMatch(/Scope[^\n]*Latest recorded slots/u);
    expect(replacementSummary).toMatch(/Unique origin Attempts[^\n]*\b70\b/u);
  });
});
