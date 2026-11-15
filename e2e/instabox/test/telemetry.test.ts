import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { access } from "node:fs/promises";
import { expect, test } from "vitest";
import { context, verifyMachinesAbsent } from "./context.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("remote telemetry fits the collection budget and preserves every exported span", async () => {
  await context.case("telemetry", {}, async ({ commands: { niceeval }, paths }) => {
    const machines = join(paths.projectRoot, "machines.txt");
    const result = await niceeval.run(["exp", "telemetry", "--rerun", "all", "--json"], {
      env: {
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(join(paths.projectRoot, "fixtures/machines.mjs")).href}`,
        NICEEVAL_TRANSPORT_MACHINES: machines,
      },
      timeoutMs: 180_000,
    });
    if (
      await access(machines).then(
        () => true,
        () => false,
      )
    )
      await verifyMachinesAbsent(machines);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.expEvalEvents()).toEqual([expect.objectContaining({ verdict: "passed" })]);
    const locator = result.expEvalEvents()[0]!.locator!;
    const execution = await niceeval.run(["show", locator, "execution", "--json"]);
    expect(execution.exitCode, execution.diagnostic()).toBe(0);
    const trace = execution.attemptTrace().trace;
    const timing = await niceeval.run(["show", locator, "timing"]);
    console.info(timing.stdout);
    expect(trace.diagnostics.items.filter((item) => item.code.startsWith("telemetry-"))).toEqual([]);
    expect(trace.execution.traces).toEqual([
      expect.objectContaining({ eventCount: 16000, collection: { state: "complete", limitations: [] } }),
    ]);
  });
});
