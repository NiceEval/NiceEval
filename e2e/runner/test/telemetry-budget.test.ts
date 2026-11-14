import { expect, test } from "vitest";
import { command } from "@niceeval/testkit";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("large Sandbox telemetry exposes settle, read, decode and map without changing the Verdict", async () => {
  await runnerE2E.case("telemetry-budget", {}, async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "telemetry-budget", "--rerun", "all", "--json"], { timeoutMs: 120_000 });
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.expEvalEvents()).toEqual([expect.objectContaining({ verdict: "passed" })]);
    const locator = result.expEvalEvents()[0]!.locator!;
    const timing = await niceeval.run(["show", locator, "timing"]);
    expect(timing.exitCode, timing.diagnostic()).toBe(0);
    for (const activity of ["telemetry.settle", "telemetry.read", "telemetry.decode", "telemetry.map"]) {
      expect(timing.stdout, timing.diagnostic()).toContain(activity);
    }
  });
});

// @feature docs/feature/adapters/README.md
test.concurrent("a slow telemetry read retains the decoded prefix as partial, preserves the Verdict and releases the Sandbox", async () => {
  await runnerE2E.case("telemetry-slow", {}, async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "telemetry-budget", "--rerun", "all", "--json"], {
      env: { NICEEVAL_TELEMETRY_SLOW: "1" }, timeoutMs: 90_000,
    });
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.expEvalEvents()).toEqual([expect.objectContaining({ verdict: "passed" })]);
    const locator = result.expEvalEvents()[0]!.locator!;
    const queried = await niceeval.run(["show", locator, "execution", "--json"]);
    expect(queried.exitCode, queried.diagnostic()).toBe(0);
    const trace = queried.attemptTrace().trace;
    expect(trace.execution.traces).toEqual(expect.arrayContaining([expect.objectContaining({
      collection: { state: "partial", limitations: [expect.objectContaining({ code: "telemetry-budget-exceeded" })] },
      eventCount: 1,
    })]));
    expect(trace.diagnostics.items).toEqual(expect.arrayContaining([expect.objectContaining({ code: "telemetry-budget-exceeded" })]));
    const shown = await niceeval.run(["show", locator, "timing"]);
    expect(shown.stdout, shown.diagnostic()).toContain("telemetry.map");
    const containers = await command(["docker"]).run(["ps", "-aq", "--filter", `label=niceeval.run_id=${result.expReceipt().createdRunIds[0]}`]);
    expect(containers.stdout.trim(), containers.diagnostic()).toBe("");
  });
});
