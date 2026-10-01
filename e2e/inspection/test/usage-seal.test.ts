import { only } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("显式完整空应用账本交付完整零费用，默认 Show 确认没有收费", async () => {
  await inspectionE2E.case("usage-seal-empty", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "usage-seal-empty", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), (item) => item.evalId === "usage-seal-empty" && item.experimentId === "usage-seal-empty", run.diagnostic());
    expect(event.verdict).toBe("passed");
    const request = join(projectRoot, "usage-seal-empty.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.querySuccess("attempt.usage").usage;
    expect(usage.totals.requests).toEqual({ state: "available", value: 0, observationCount: 0 });
    expect(usage.calls).toEqual([]);
    expect(usage.totalCosts, read.diagnostic()).toEqual({ state: "complete", values: [], missingSources: [] });
    const shown = await niceeval.run(["show", event.locator]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toContain("Total costs");
    expect(shown.stdout).toMatch(/Cost coverage[^\n]*Complete/u);
    expect(shown.stdout).toContain("No recorded charges");
    expect(shown.stdout).not.toContain("Missing sources");
  });
});

// @feature docs/feature/inspection/README.md
test.concurrent("显式 partial 应用账本保留已知费用，默认 Show 仍标记费用缺口", async () => {
  await inspectionE2E.case("usage-seal-partial", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "usage-seal-partial", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), (item) => item.evalId === "usage-seal-partial" && item.experimentId === "usage-seal-partial", run.diagnostic());
    expect(event.verdict).toBe("passed");
    const request = join(projectRoot, "usage-seal-partial.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.querySuccess("attempt.usage").usage;
    expect(usage.state).toBe("partial");
    expect(usage.totals.requests).toEqual({ state: "partial", value: 1, observationCount: 1 });
    expect(usage.calls).toEqual([expect.objectContaining({ callId: "accepted", cost: { amount: "0.125", currency: "USD", source: { kind: "reported", id: "offline.response" } } })]);
    expect(usage.totalCosts, read.diagnostic()).toEqual({ state: "partial", values: [{ currency: "USD", value: "0.125", source: "reported" }], missingSources: ["application"] });
    const shown = await niceeval.run(["show", event.locator]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toContain("Known subtotal");
    expect(shown.stdout).toMatch(/USD[^\n]*0\.125\b/u);
    expect(shown.stdout).toMatch(/Cost coverage[^\n]*Incomplete/u);
    expect(shown.stdout).toMatch(/Missing sources[^\n]*application/u);
    expect(shown.stdout).not.toContain("Total costs");
  });
});

// @feature docs/feature/inspection/README.md
test.concurrent("封存后写入被 catch 仍发布 errored Attempt，保留已接纳费用且拒绝新费用", async () => {
  await inspectionE2E.case("usage-seal-caught-write", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "usage-seal-caught-write", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const event = only(run.expEvalEvents(), (item) => item.evalId === "usage-seal-caught-write" && item.experimentId === "usage-seal-caught-write", run.diagnostic());
    expect(event.verdict).toBe("errored");
    const request = join(projectRoot, "usage-seal-caught-write.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.get", locator: event.locator } }));
    const attempt = await niceeval.run(["query", "run", "--request", request]);
    expect(attempt.exitCode, attempt.diagnostic()).toBe(0);
    expect(attempt.querySuccess("attempt.get").attempt).toMatchObject({ core: { outcome: "errored" }, verdict: "errored" });
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.querySuccess("attempt.usage").usage;
    expect(usage.state).toBe("partial");
    expect(usage.totals.requests).toEqual({ state: "partial", value: 1, observationCount: 1 });
    expect(usage.calls).toEqual([expect.objectContaining({ callId: "accepted", cost: { amount: "0.125", currency: "USD", source: { kind: "reported", id: "offline.response" } } })]);
    expect(usage.totalCosts, read.diagnostic()).toEqual({ state: "partial", values: [{ currency: "USD", value: "0.125", source: "reported" }], missingSources: ["application"] });
  });
});
