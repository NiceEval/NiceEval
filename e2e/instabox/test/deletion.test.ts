import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { context, verifyMachinesAbsent } from "./context.ts";

// @feature docs/feature/sandbox/README.md
test.concurrent.each(["delayed", "absent", "conflict"])(
  "teardown confirms remote deletion before settling (%s)",
  async (mode) => {
    await context.case("deletion", {}, async ({ commands: { niceeval }, paths }) => {
      const machines = join(paths.projectRoot, "machines.txt");
      const receipt = join(paths.projectRoot, "delete.txt");
      const result = await niceeval.run(["exp", "deletion", "--rerun", "all", "--json"], {
        env: {
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(join(paths.projectRoot, "fixtures/machines.mjs")).href} --import=${pathToFileURL(join(paths.projectRoot, "fixtures/deletion.mjs")).href}`,
          NICEEVAL_TRANSPORT_MACHINES: machines,
          NICEEVAL_DELETE_MODE: mode,
          NICEEVAL_DELETE_RECEIPT: receipt,
        },
        timeoutMs: 210_000,
      });
      await verifyMachinesAbsent(machines);
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(result.expEvalEvents()).toEqual([expect.objectContaining({ verdict: "passed" })]);
      const observations = await readFile(receipt, "utf8");
      expect(observations).toContain("delete-accepted\n");
      expect(observations).toContain("operation-running\n");
      if (mode === "absent") expect(observations).toContain("machine-check\n");
    });
  },
);
