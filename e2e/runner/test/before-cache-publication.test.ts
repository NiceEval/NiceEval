// rerun: pnpm e2e test --candidate source --repo runner -- --run test/before-cache-publication.test.ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { withSnapshotInfrastructure } from "../fixtures/remote-snapshot/infrastructure.ts";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/sandbox/README.md
test.concurrent("同频率线性准备链只发布配对终端，修改中间 action 后重新执行未发布前缀", async () => {
  await runnerE2E.case("before-cache-publication", async (context) => {
    await withSnapshotInfrastructure(context, async ({ env, filter }) => {
      const experiment = (version: string) => `import { defineExperiment } from "niceeval";
import { shell } from "niceeval/sandbox";
import { snapshotAgent, snapshotSandbox } from "../agents/remote-snapshot.ts";
export default defineExperiment({ adapter: snapshotAgent, evals: ["snapshot-shared"], sandbox: snapshotSandbox.before(
  shell({ id: "middle", command: "printf ${version} > /tmp/middle" })).before(
  shell({ id: "terminal", command: "test -s /tmp/shared-prefix && test -s /tmp/middle" }),
) });`;
      for (const [index, version] of ["first", "first", "changed"].entries()) {
        await writeFile(join(context.paths.projectRoot, "experiments/snapshot-first.ts"), experiment(version));
        const result = await context.commands.niceeval.run(["exp", "snapshot-first", "--rerun", "all", "--json"], {
          env: env,
          timeoutMs: 120_000,
        });
        expect(result.exitCode, result.diagnostic()).toBe(0);
        expect(result.expEvalEvents().map(({ verdict }) => verdict)).toEqual(["passed"]);
        const images = await context.run([
          "docker",
          "images",
          "-aq",
          "--filter",
          filter,
          "--filter",
          "label=niceeval.snapshot-id",
        ]);
        expect(images.exitCode, images.diagnostic()).toBe(0);
        expect(new Set(images.stdout.trim().split(/\s+/u).filter(Boolean)).size).toBe(1);
        const settled = result
          .expEvents()
          .filter((event) => "event" in event && event.event === "prepare" && event.phase === "settled");
        expect(settled).toHaveLength(3);
        expect(result.expTerminal().summary.beforeCaches).toMatchObject({
          total: 3,
          hit: index === 1 ? 3 : 0,
          degraded: 0,
          failed: 0,
        });
      }
    });
  });
});
