import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { context, verifyMachinesAbsent } from "./context.ts";
// @feature docs/feature/sandbox/README.md
test("retired commands explain the SSH failure and delivered bytes", async () => {
  await context.case("transport-diagnostics", {}, async ({ commands: { niceeval }, paths }) => {
    const receipt = join(paths.projectRoot, "fault.txt");
    const result = await niceeval.run(["exp", "transport", "--rerun", "all"], { env: {
      NODE_OPTIONS: `--import=${pathToFileURL(join(paths.projectRoot, "fixtures/machines.mjs")).href} --import=${pathToFileURL(join(paths.projectRoot, "fixtures/disconnect.mjs")).href}`,
      NICEEVAL_TRANSPORT_FAULT_RECEIPT: receipt,
      NICEEVAL_TRANSPORT_MACHINES: join(paths.projectRoot, "machines.txt"),
    } });
    await verifyMachinesAbsent(join(paths.projectRoot, "machines.txt"));
    expect(await readFile(receipt, "utf8").catch(() => result.diagnostic())).toBe("client-destroyed\n");
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});
