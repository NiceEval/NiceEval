import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { context, verifyMachinesAbsent } from "./context.ts";
// @feature docs/feature/sandbox/README.md
test.concurrent("commands and open stdin resume together after client disconnection without losing bytes", async () => {
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
    console.info("Instabox command timing (single ms, total20 ms):", log.match(/^timing (.+)$/m)?.[1]);
    expect(log, result.diagnostic()).toContain("client-destroyed");
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(log).toContain("write-ack-destroyed");
    expect(log).toContain("eof-ack-destroyed");
    expect(log.match(/^connect /gm)).toHaveLength(6);
    expect(log.match(/^reconnect-reset /gm)).toHaveLength(2);
    const locator = result.expEvalEvents()[0]?.locator;
    expect(locator).toBeDefined();
    const request = join(paths.projectRoot, "trace.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "attempt.trace", locator } }));
    const trace = await niceeval.run(["query", "run", "--request", request]);
    expect(trace.exitCode, trace.diagnostic()).toBe(0);
    expect(JSON.stringify(trace.querySuccess("attempt.trace").trace)).toContain("sandbox-transport-reconnected");
  });
});
