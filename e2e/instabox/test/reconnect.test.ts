import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { context, verifyMachinesAbsent } from "./context.ts";
// @feature docs/feature/sandbox/README.md
test("an EOF command resumes after client disconnection with one reconnect diagnostic", async () => {
  await context.case("transport-reconnect", {}, async ({ commands: { niceeval }, paths }) => {
    const machines = join(paths.projectRoot, "machines.txt");
    const connections = join(paths.projectRoot, "connections.txt");
    const result = await niceeval.run(["exp", "reconnect", "--rerun", "all", "--json"], { env: {
      NODE_OPTIONS: `--import=${pathToFileURL(join(paths.projectRoot, "fixtures/machines.mjs")).href} --import=${pathToFileURL(join(paths.projectRoot, "fixtures/reconnect.mjs")).href}`,
      NICEEVAL_TRANSPORT_MACHINES: machines,
      NICEEVAL_TRANSPORT_CONNECTIONS: connections,
    } });
    await verifyMachinesAbsent(machines);
    const log = await readFile(connections, "utf8");
    expect(log).toContain("client-destroyed");
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(log.match(/^connect /gm)).toHaveLength(2);
    const locator = result.expEvalEvents()[0]?.locator;
    expect(locator).toBeDefined();
    const trace = await niceeval.run(["show", locator!, "--execution"]);
    expect(trace.exitCode, trace.diagnostic()).toBe(0);
    expect(trace.stdout).toContain("sandbox-transport-reconnected");
  });
});
