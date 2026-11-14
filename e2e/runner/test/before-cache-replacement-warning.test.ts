// rerun: pnpm e2e test --repo runner -- --run test/before-cache-replacement-warning.test.ts
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";
import { withSnapshotInfrastructure } from "../fixtures/remote-snapshot/infrastructure.ts";

// @feature docs/feature/sandbox/architecture/before-cache.md
test.concurrent("本地 Docker 的不同准备内容共用 action id 时提示声明冲突与独立命名", async () => {
  await runnerE2E.case("before-cache-replacement-warning", {}, async (context) => {
    await withSnapshotInfrastructure(context, async ({ filter, env }) => {
      const result = await context.commands.niceeval.run(["exp", "--experiment", "snapshot-first", "--experiment", "snapshot-second", "--rerun", "all", "--json"], {
        env: { ...env, NICEEVAL_SNAPSHOT_FIXTURE_PROVIDER: "docker", NICEEVAL_SNAPSHOT_COLLISION: "1" }, timeoutMs: 120_000,
      });
      expect(result.exitCode, result.diagnostic()).toBe(0);
      const warnings = result.expEvents().filter((event) => "code" in event && event.code === "before-cache-replacement-conflict");
      expect(warnings, result.diagnostic()).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ message: expect.stringContaining('Before action "version"') });
      expect(warnings[0]).toMatchObject({ message: expect.stringContaining("experiment:snapshot-first, experiment:snapshot-second") });
      expect(warnings[0]).toMatchObject({ message: expect.stringContaining("Use different action ids") });
      const containers = await context.run(["docker", "ps", "-aq", "--filter", filter]);
      expect(containers.stdout.trim(), containers.diagnostic()).toBe("");
    });
  });
});
