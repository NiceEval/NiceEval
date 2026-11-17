import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { context, verifyMachinesAbsent } from "./context.ts";
// @feature docs/feature/sandbox/README.md
test.concurrent.each(["success", "fail"])("commands and open stdin preserve their outcome after token rejection and refresh %s", async (refresh) => {
  await context.case("transport-reconnect", {}, async ({ commands: { niceeval }, paths }) => {
    const machines = join(paths.projectRoot, "machines.txt");
    const connections = join(paths.projectRoot, "connections.txt");
    const result = await niceeval.run(["exp", "reconnect", "--rerun", "all", "--json"], {
      env: {
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(join(paths.projectRoot, "fixtures/machines.mjs")).href} --import=${pathToFileURL(join(paths.projectRoot, "fixtures/reconnect.mjs")).href}`,
        NICEEVAL_TRANSPORT_MACHINES: machines,
        NICEEVAL_TOKEN_REFRESH: refresh,
        NICEEVAL_TRANSPORT_CONNECTIONS: connections,
      },
    });
    console.info(result.diagnostic());
    await verifyMachinesAbsent(machines);
    const log = await readFile(connections, "utf8");
    console.info("Instabox command timing (single ms, total20 ms):", log.match(/^timing (.+)$/m)?.[1]);
    console.info("Instabox connection evidence:\n" + log);
    expect(log, result.diagnostic()).toContain("client-destroyed");
    expect(log).toContain("token-rejected");
    expect(log.match(/^token-request /gm), result.diagnostic()).toHaveLength(2);
    if (refresh === "fail") {
      expect(result.exitCode, result.diagnostic()).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("SSH token renewal failed");
      expect(result.stdout + result.stderr).toContain("tokenRequests=2");
      return;
    }
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(log).toContain("write-ack-destroyed");
    expect(log).toContain("eof-ack-destroyed");
    expect(log.match(/^connect /gm)).toHaveLength(6);
    expect(log.match(/^reconnect-reset /gm)).toHaveLength(1);
    const locator = result.expEvalEvents()[0]?.locator;
    expect(locator).toBeDefined();

    const trace = await niceeval.run(["show", locator, "execution", "--json"]);
    expect(trace.exitCode, trace.diagnostic()).toBe(0);
    expect(JSON.stringify(trace.inspectionSuccess("attempt.trace").trace)).toContain("sandbox-transport-reconnected");
  });
});
