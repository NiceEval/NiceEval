import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { context, verifyMachinesAbsent } from "./context.ts";

// @feature docs/feature/sandbox/library/operations.md#命令-timeout-与取消
test.concurrent.each([false, true])(
  "command cancellation confirms its process tree stopped while sibling processes remain usable (disconnect=%s)",
  async (disconnect) => {
    await context.case("command-lifetime", {}, async ({ commands: { niceeval }, paths }) => {
      const machines = join(paths.projectRoot, "machines.txt");
      const result = await niceeval.run(["exp", "cancellation", "--rerun", "all", "--json"], {
        env: {
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(join(paths.projectRoot, "fixtures/machines.mjs")).href}${disconnect ? ` --import=${pathToFileURL(join(paths.projectRoot, "fixtures/cancellation.mjs")).href}` : ""}`,
          NICEEVAL_TRANSPORT_MACHINES: machines,
          NICEEVAL_TRANSPORT_FAULT_RECEIPT: join(paths.projectRoot, "fault.txt"),
        },
      });
      await verifyMachinesAbsent(machines);
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(result.expEvalEvents()).toEqual([expect.objectContaining({ verdict: "passed" })]);
      if (disconnect) expect(await readFile(join(paths.projectRoot, "fault.txt"), "utf8")).toBe("client-destroyed\n");
    });
  },
);
