import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { context, verifyMachinesAbsent } from "./context.ts";
// @feature docs/feature/sandbox/architecture/providers/instabox.md
test.concurrent.each(["success", "fail", "wrong-machine", "rejected"])(
  "commands and open stdin preserve their outcome after token rejection and refresh %s",
  async (refresh) => {
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
      console.info("Instabox connection evidence:\n" + log);
      expect(log, result.diagnostic()).toContain("client-destroyed");
      expect(log).toContain("token-rejected");
      expect(log.match(/^token-request /gm), result.diagnostic()).toHaveLength(2);
      if (refresh !== "success") {
        expect(result.exitCode, result.diagnostic()).not.toBe(0);
        expect(result.stdout + result.stderr).toContain("SSH connection closed by peer");
        expect(result.stdout + result.stderr).toContain("SSH token rejected");
        if (refresh === "fail") expect(result.stdout + result.stderr).toContain("SSH token renewal failed");
        if (refresh === "wrong-machine") {
          expect(result.stdout + result.stderr).toContain("SSH grant belongs to another Machine");
          expect(log.match(/^connect /gm)).toHaveLength(3);
        }
        expect(result.stdout + result.stderr).toContain("tokenRequests=2");
      } else {
        expect(result.exitCode, result.diagnostic()).toBe(0);
        expect(log).toContain("write-ack-destroyed");
        expect(log).toContain("eof-ack-destroyed");
        expect(log.match(/^connect /gm)).toHaveLength(6);
        expect(log.match(/^reconnect-reset /gm)).toHaveLength(1);
        const locator = result.expEvalEvents()[0]?.locator;
        expect(locator).toBeDefined();

        const trace = await niceeval.run(["show", locator, "execution", "--json"]);
        expect(trace.exitCode, trace.diagnostic()).toBe(0);
        expect(JSON.stringify(trace.inspectionSuccess("attempt.trace").trace)).toContain(
          "sandbox-transport-reconnected",
        );
      }
      const timing = log.match(/^timing ([\d.]+) ([\d.]+) ([\d.]+)$/m);
      expect(timing, "Instabox timing receipt (single, round trip, total20 in ms)").not.toBeNull();
      const [, single, roundTrip, total] = timing!;
      expect(Number(total), `Instabox timing receipt: ${timing![0]}`).toBeLessThanOrEqual(
        Number(single) + 20 * Number(roundTrip),
      );
    });
  },
);
