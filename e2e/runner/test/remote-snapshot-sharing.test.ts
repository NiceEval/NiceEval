// rerun: pnpm e2e test --repo runner -- --run test/remote-snapshot-sharing.test.ts
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @use-case docs/feature/sandbox/use-case/sandbox-cloud-before-cache.md
test.concurrent("同一次 Invocation 的 Experiment 共享远端准备前缀且不降级", async () => {
  await runnerE2E.case("remote-snapshot-sharing", {}, async ({ commands: { niceeval }, paths, run }) => {
    const id = randomUUID();
    const filter = `label=niceeval.snapshot-fixture=${id}`;
    try {
      const image = `niceeval-snapshot-fixture:${id}`;
      const build = await run(["docker", "build", "--label", `niceeval.snapshot-fixture=${id}`, "-t", image, "fixtures/remote-snapshot"], { timeoutMs: 120_000 });
      expect(build.exitCode, build.diagnostic()).toBe(0);
      const result = await niceeval.run(["exp", "--experiment", "snapshot-first", "--experiment", "snapshot-second", "--rerun", "all", "--json"], {
        env: {
          E2B_API_KEY: "local-fixture-only",
          NICEEVAL_HOME: join(paths.projectRoot, ".snapshot-home"),
          NICEEVAL_SNAPSHOT_FIXTURE_ID: id,
          NICEEVAL_SNAPSHOT_FIXTURE_IMAGE: image,
          NODE_OPTIONS: `--import=${join(paths.projectRoot, "fixtures/remote-snapshot/preload.mjs")}`,
        }, timeoutMs: 120_000,
      });
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(result.expReceipt().createdRunIds).toHaveLength(2);
      expect(result.expTerminal().summary.beforeCaches).toEqual({ total: 1, hit: 0, prepared: 1, degraded: 0, failed: 0 });
      expect(result.expEvalEvents().map(({ experimentId, verdict }) => ({ experimentId, verdict })).sort((a, b) => a.experimentId.localeCompare(b.experimentId))).toEqual([
        { experimentId: "snapshot-first", verdict: "passed" },
        { experimentId: "snapshot-second", verdict: "passed" },
      ]);
      expect(result.expEvents().filter((event) => "code" in event && event.code === "cache-degraded"), result.diagnostic()).toEqual([]);
      const containers = await run(["docker", "ps", "-aq", "--filter", filter]);
      expect(containers.stdout.trim(), containers.diagnostic()).toBe("");
    } finally {
      for (const [kind, list] of [["container", ["ps", "-aq"]], ["image", ["images", "-q"]]] as const) {
        const resources = await run(["docker", ...list, "--filter", filter]);
        const ids = resources.stdout.trim().split(/\s+/u).filter(Boolean);
        if (ids.length) {
          const removed = await run(["docker", kind, "rm", "-f", ...ids]);
          expect(removed.exitCode, removed.diagnostic()).toBe(0);
        }
      }
    }
  });
});
