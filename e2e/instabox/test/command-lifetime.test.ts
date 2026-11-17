import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { context, verifyMachinesAbsent } from "./context.ts";

// @feature docs/feature/sandbox/README.md
test.concurrent("command cancellation confirms its process tree stopped while sibling processes remain usable", async () => {
  await context.case("command-lifetime", {}, async ({ commands: { niceeval }, paths }) => {
    const machines = join(paths.projectRoot, "machines.txt");
    const result = await niceeval.run(["exp", "cancellation", "--rerun", "all", "--json"], {
      env: {
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(join(paths.projectRoot, "fixtures/machines.mjs")).href}`,
        NICEEVAL_TRANSPORT_MACHINES: machines,
      },
    });
    await verifyMachinesAbsent(machines);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.expEvalEvents()).toEqual([expect.objectContaining({ verdict: "passed" })]);
  });
});
