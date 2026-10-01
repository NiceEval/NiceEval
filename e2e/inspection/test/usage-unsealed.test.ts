import { only } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @regression memory/adapter-usage-unsealed-zero.md
test.concurrent("应用账本未读的 errored Attempt 保留费用缺口，默认 Show 不声称完整零费用", async () => {
  await inspectionE2E.case("usage-unsealed", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "usage-unsealed", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).not.toBe(0);
    expect(run.signal, run.diagnostic()).toBeNull();
    expect(run.timedOut, run.diagnostic()).toBe(false);
    expect(run.expReceipt().createdRunIds, run.diagnostic()).toHaveLength(1);
    const event = only(run.expEvalEvents(), (item) => item.evalId === "usage-unsealed" && item.experimentId === "usage-unsealed", run.diagnostic());
    expect(event).toMatchObject({ verdict: "errored", attempts: 1 });

    const request = join(projectRoot, "usage-unsealed.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.querySuccess("attempt.usage").usage;
    expect(usage.calls).toEqual([]);
    expect(usage.judgeUsage, read.diagnostic()).toEqual({
      state: "complete",
      coverage: "physical-transmissions",
      collection: { state: "complete", limitations: [] },
      totals: {
        requests: { state: "available", value: 0, observationCount: 0 },
        inputTotalTokens: { state: "available", value: 0, observationCount: 0 },
        outputTokens: { state: "available", value: 0, observationCount: 0 },
        totalTokens: { state: "available", value: 0, observationCount: 0 },
        costs: { state: "complete", source: null, values: [], totalCalls: 0 },
      },
      calls: [],
      callsTruncated: false,
      omittedCallCount: 0,
      priceReceipts: [],
    });
    expect(usage.totalCosts, read.diagnostic()).toEqual({
      state: "unavailable",
      values: [],
      missingSources: ["application"],
    });

    const shown = await niceeval.run(["show", event.locator]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout, shown.diagnostic()).toContain("Known subtotal");
    expect(shown.stdout).toMatch(/Cost coverage[^\n]*Incomplete/u);
    expect(shown.stdout).toMatch(/Missing sources[^\n]*application/u);
    expect(shown.stdout).not.toContain("Total costs");
    expect(shown.stdout).not.toMatch(/Cost coverage[^\n]*\bComplete\b/u);
    expect(shown.stdout).not.toContain("No recorded charges");
  });
});
