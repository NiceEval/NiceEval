import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

test.concurrent("外部调用用量保留失败重试未知值且重复上报不增加计量 [necase_920FSWMBVEP3090H]", async () => {
  await evalE2E.case("external-usage", async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "external-usage", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), (item) => item.evalId === "external-usage", run.diagnostic());
    const request = join(paths.projectRoot, "usage.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.querySuccess("attempt.usage").usage;
    expect(usage).toMatchObject({ source: "adapter", coverage: "recorded-calls", state: "partial", turns: [], observations: [], callsTruncated: true, omittedCallCount: 3 });
    expect(usage.calls).toHaveLength(128);
    const shown = await niceeval.run(["show", event.locator, "--usage"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toContain("Recorded calls only");
    expect(shown.stdout).toContain("Input including cache");
    expect(usage.calls).toEqual([
      expect.objectContaining({ callId: "request-1", provider: null, model: null, status: "failed", inputTokens: null, inputTotalTokens: 100, outputTokens: 2 }),
      expect.objectContaining({ callId: "request-2", retryOf: "request-1", status: "succeeded", inputTokens: 60, inputTotalTokens: 100 }),
      expect.objectContaining({ callId: "request-3", status: "unknown", inputTokens: null, outputTokens: null }),
      expect.objectContaining({ callId: "request-4", inputTokens: 0, outputTokens: 0 }),
      expect.objectContaining({ callId: "request-5", inputTokens: 60, inputTotalTokens: null, cacheReadTokens: 30, cacheWriteTokens: 10, outputTokens: 20 }),
      ...Array.from({ length: 123 }, () => expect.anything()),
    ]);
    expect(usage.totals).toMatchObject({
      inputTokens: { state: "partial", value: 246, observationCount: 129 },
      inputTotalTokens: { state: "partial", value: 326, observationCount: 129 },
      outputTokens: { state: "partial", value: 156, observationCount: 130 },
      requests: { state: "available", value: 131, observationCount: 131 },
      providerCosts: { state: "unavailable", values: [] },
    });

    const overviewRequest = join(paths.projectRoot, "overview.request.json");
    await writeFile(overviewRequest, JSON.stringify({
      protocol: "niceeval.query/v1",
      operation: { kind: "overview.get" },
    }));
    const overview = await niceeval.run(["query", "run", "--request", overviewRequest]);
    expect(overview.exitCode, overview.diagnostic()).toBe(0);
    const cell = only(
      overview.querySuccess("overview.get").overview.cells,
      (candidate) => candidate.experimentId === "external-usage" && candidate.evalId === "external-usage",
      overview.diagnostic(),
    );
    expect(cell.tokens).toMatchObject({
      state: "partial",
      value: 582,
      samples: 1,
      total: 1,
      unit: "tokens",
    });
  });
});

test.concurrent("调用身份冲突即使被捕获仍公开为执行错误并保留先前事实 [necase_P73V11ADFDNYEXTH]", async () => {
  await evalE2E.case("conflicting-usage", async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "conflicting-usage", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const event = only(run.expEvalEvents(), (item) => item.evalId === "conflicting-usage", run.diagnostic());
    expect(event.verdict).toBe("errored");
    const request = join(paths.projectRoot, "usage.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.querySuccess("attempt.usage").usage;
    expect(usage.state).toBe("partial");
    expect(usage.calls).toEqual([expect.objectContaining({ callId: "request-1", outputTokens: 2 })]);
  });
});
