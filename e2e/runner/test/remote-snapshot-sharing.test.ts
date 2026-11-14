// rerun: pnpm e2e test --repo runner -- --run test/remote-snapshot-sharing.test.ts
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";
import { withSnapshotInfrastructure } from "../fixtures/remote-snapshot/infrastructure.ts";

// @use-case docs/feature/sandbox/use-case/sandbox-cloud-before-cache.md
test.concurrent.each(["e2b", "instabox", "opensandbox"])("同一次 Invocation 的 Experiment 共享远端准备前缀且不降级（%s）", async (provider) => {
  await runnerE2E.case("remote-snapshot-sharing", {}, async (context) => {
    await withSnapshotInfrastructure(context, async ({ filter, env }) => {
      const result = await context.commands.niceeval.run(["exp", "--experiment", "snapshot-first", "--experiment", "snapshot-second", "--rerun", "all", "--json"], {
        env: { ...env, NICEEVAL_SNAPSHOT_FIXTURE_PROVIDER: provider }, timeoutMs: 120_000,
      });
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(result.expReceipt().createdRunIds).toHaveLength(2);
      expect(result.expTerminal().summary.beforeCaches).toEqual({ total: 3, hit: 0, prepared: 3, degraded: 0, failed: 0 });
      expect(result.expEvalEvents().map(({ experimentId, verdict }) => ({ experimentId, verdict })).sort((a, b) => a.experimentId.localeCompare(b.experimentId))).toEqual([
        { experimentId: "snapshot-first", verdict: "passed" },
        { experimentId: "snapshot-second", verdict: "passed" },
      ]);
      expect(result.expEvents().filter((event) => "code" in event && event.code === "cache-degraded"), result.diagnostic()).toEqual([]);
      const containers = await context.run(["docker", "ps", "-aq", "--filter", filter]);
      expect(containers.stdout.trim(), containers.diagnostic()).toBe("");
    });
  });
});
