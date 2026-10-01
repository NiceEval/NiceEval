import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectAttempt, inspectAssertionEntries, assertionEntry } from "./inspection.ts";
import { evalE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
// @regression memory/adapter-usage-overview-drops-token-facts.md
test.concurrent("外部调用用量保留失败重试未知值且重复上报不增加计量", async () => {
  await evalE2E.case("external-usage", async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "external-usage", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const event = only(run.expEvalEvents(), (item) => item.evalId === "external-usage", run.diagnostic());
    const attempt = await inspectAttempt(niceeval, paths.projectRoot, event.locator!, "attempt.get");
    const details = await inspectAssertionEntries(niceeval, paths.projectRoot, event.locator!, attempt.document.attempt.assertions!.entries);
    const entries = details.map((detail) => assertionEntry(detail.document, detail.receipt.diagnostic()));
    for (const [label, result] of [["Official usage snapshot", "matched"], ["Unknown token ceiling", "unavailable"], ["Known token floor", "matched"], ["Token ceiling exceeded", "mismatched"], ["Token ceiling unknown", "unavailable"], ["Effective USD ceiling", "matched"], ["Effective USD exceeded", "mismatched"], ["Runtime elapsed", "matched"]]) {
      expect(only(entries, (entry) => entry.display.label === label, run.diagnostic()).decision.result).toBe(result);
    }
    const budget = only(run.expEvalEvents(), (item) => item.evalId === "usage-budget", run.diagnostic());
    const budgetAttempt = await inspectAttempt(niceeval, paths.projectRoot, budget.locator!, "attempt.get");
    const budgetDetails = await inspectAssertionEntries(niceeval, paths.projectRoot, budget.locator!, budgetAttempt.document.attempt.assertions.entries);
    const budgetEntries = budgetDetails.map((detail) => assertionEntry(detail.document, detail.receipt.diagnostic()));
    for (const [label, result] of [["Prior usage snapshot unchanged", "matched"], ["Exact decimal exceeded", "mismatched"], ["Exact decimal within", "matched"], ["Complete tokens", "matched"]]) {
      expect(only(budgetEntries, (entry) => entry.display.label === label, run.diagnostic()).decision.result).toBe(result);
    }
    const mixed = only(run.expEvalEvents(), (item) => item.evalId === "usage-budget-mixed", run.diagnostic());
    const mixedAttempt = await inspectAttempt(niceeval, paths.projectRoot, mixed.locator, "attempt.get");
    const mixedDetails = await inspectAssertionEntries(niceeval, paths.projectRoot, mixed.locator, mixedAttempt.document.attempt.assertions.entries);
    const mixedEntries = mixedDetails.map((detail) => assertionEntry(detail.document, detail.receipt.diagnostic()));
    for (const [label, result] of [["Mixed currency unknown", "unavailable"], ["Mixed currency exceeded", "mismatched"]]) {
      expect(only(mixedEntries, (entry) => entry.display.label === label, run.diagnostic()).decision.result).toBe(result);
    }
    const request = join(paths.projectRoot, "usage.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.querySuccess("attempt.usage").usage;
    expect(usage.totals).not.toHaveProperty("providerCosts");
    expect(usage).toMatchObject({ source: "adapter", coverage: "recorded-calls", state: "partial", turns: [], observations: [], callsTruncated: true, omittedCallCount: 287 });
    expect(usage.calls).toHaveLength(128);
    const shown = await niceeval.run(["show", event.locator, "--usage"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toContain("Recorded calls only");
    expect(shown.stdout).toContain("Input including cache");
    expect(shown.stdout).not.toContain("invalid projection");
    expect(usage.calls).toEqual([
      expect.objectContaining({
        callId: "request-1",
        provider: "typesafe-ai",
        model: "typesafe-ai/jev",
        route: { transportProvider: "vercel", endpointId: "vercel-ai-gateway" },
        cost: {
          amount: "0",
          currency: "USD",
          source: { kind: "reported", id: "vercel-ai-gateway.response" },
        },
        effectiveCost: {
          amount: "0",
          currency: "USD",
          source: { kind: "reported", id: "vercel-ai-gateway.response" },
          state: "complete",
        },
        status: "failed",
        inputTokens: null,
        inputTotalTokens: 100,
        outputTokens: 2,
      }),
      expect.objectContaining({ callId: "request-2", retryOf: "request-1", status: "succeeded", inputTokens: 60, inputTotalTokens: 100 }),
      expect.objectContaining({ callId: "request-3", status: "unknown", inputTokens: null, outputTokens: null }),
      expect.objectContaining({ callId: "request-4", inputTokens: 0, outputTokens: 0 }),
      expect.objectContaining({ callId: "request-5", inputTokens: 60, inputTotalTokens: null, cacheReadTokens: 30, cacheWriteTokens: 10, outputTokens: 20 }),
      ...Array.from({ length: 123 }, () => expect.anything()),
    ]);
    expect(usage.totals).toMatchObject({
      inputTokens: { state: "partial", value: 530, observationCount: 413 },
      inputTotalTokens: { state: "partial", value: 610, observationCount: 413 },
      outputTokens: { state: "partial", value: 440, observationCount: 414 },
      requests: { state: "available", value: 415, observationCount: 415 },
      costs: {
        state: "complete",
        source: "mixed",
        values: [{
          currency: "USD",
          value: "0.0000854",
          source: "mixed",
          coveredCalls: 415,
          reportedCalls: 354,
          estimatedCalls: 61,
        }],
        totalCalls: 415,
      },
    });
    expect(usage.priceReceipts).toHaveLength(61);
    expect(usage.priceReceipts?.[0]).toMatchObject({
      kind: "adapter-call-price-estimate",
      callId: "request-355",
      state: "complete",
      currency: "USD",
      amount: "0.0000014",
      source: {
        kind: "estimated",
        id: "niceeval-e2e-fixed-prices",
      },
      pricing: {
        basis: "catalog-reference",
        requestModel: "openai/gpt-6-luna",
        selector: "openai/gpt-6-luna",
        match: "exact",
        source: {
          kind: "configured-profile",
          id: "niceeval-e2e-fixed-prices",
          asOf: 1_789_718_400_000,
          profileDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        },
        ratesPerMTok: {
          input: "0.2",
          output: "1.2",
          cacheRead: "0.02",
          cacheWrite: "0.25",
        },
      },
      charges: [
        { bucket: "input", tokens: 1, ratePerMTok: "0.2", amount: "0.0000002" },
        { bucket: "output", tokens: 1, ratePerMTok: "1.2", amount: "0.0000012" },
        { bucket: "cache-read", tokens: 0, ratePerMTok: "0.02", amount: "0" },
        { bucket: "cache-write", tokens: 0, ratePerMTok: "0.25", amount: "0" },
      ],
      missing: [],
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
      value: 1_150,
      samples: 1,
      total: 1,
      unit: "tokens",
    });
    expect(cell.costUSD).toMatchObject({
      state: "available",
      value: 0.0000854,
      source: "mixed",
      samples: 1,
      total: 1,
      basis: "slot",
      unit: "USD",
    });
    expect(shown.stdout).toContain("complete; mixed; 0.0000854 USD");
    expect(shown.stdout).toMatch(/415\/415 covered calls;\s+mixed; 61 estimated/u);
  });
});

// @feature docs/feature/adapters/README.md
test.concurrent("调用身份冲突即使被捕获仍公开为执行错误并保留先前事实", async () => {
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
    expect(usage.calls).toEqual([expect.objectContaining({
      callId: "request-1",
      outputTokens: 2,
      cost: expect.objectContaining({ amount: "0", source: { kind: "reported", id: "vercel-ai-gateway.response" } }),
    })]);
  });
});
