import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("large Sandbox telemetry exposes settle, read, decode and map without changing the Verdict", async () => {
  await runnerE2E.case("telemetry-budget", {}, async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "telemetry-budget", "--rerun", "all", "--json"], { timeoutMs: 120_000 });
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.expEvalEvents()).toEqual([expect.objectContaining({ verdict: "passed" })]);
    const locator = result.expEvalEvents()[0]!.locator!;
    const timing = await niceeval.run(["show", locator, "--timing"]);
    expect(timing.exitCode, timing.diagnostic()).toBe(0);
    for (const activity of ["telemetry.settle", "telemetry.read", "telemetry.decode", "telemetry.map"]) {
      expect(timing.stdout, timing.diagnostic()).toContain(activity);
    }
  });
});
