// rerun: pnpm e2e test --repo runner -- --run test/before-cache-replacement-warning.test.ts
import { expect, test } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runnerE2E } from "./context.ts";
import { withSnapshotInfrastructure } from "../fixtures/remote-snapshot/infrastructure.ts";

// @feature docs/feature/sandbox/architecture/before-cache.md
test.concurrent.each(["docker", "e2b"])("不同 Eval 的同名 action 独立缓存，同一 Eval 内容换代后取代旧 artifact（%s）", async (provider) => {
  await runnerE2E.case("before-cache-replacement-owner", {}, async (context) => {
    await withSnapshotInfrastructure(context, async ({ filter, env }) => {
      const environment = { ...env, NICEEVAL_SNAPSHOT_FIXTURE_PROVIDER: provider };
      const evalSource = (value: string) => `import { defineEval } from "niceeval";
import { sandboxLayer, shell } from "niceeval/sandbox";
import { includes } from "niceeval/expect";
export default defineEval({ sandbox: sandboxLayer().before(shell({ id: "version", command: "printf ${value} > /tmp/version" })), async test(t) {
  const turn = await t.send("read shared prefix");
  await turn.succeeded().orStop();
  t.check(await t.sandbox.readText("/tmp/version"), includes("${value}"));
} });
`;
      await writeFile(join(context.paths.projectRoot, "evals/snapshot-owner-a.eval.ts"), evalSource("first"));
      await writeFile(join(context.paths.projectRoot, "evals/snapshot-owner-b.eval.ts"), evalSource("second"));
      await writeFile(join(context.paths.projectRoot, "experiments/snapshot-owner.ts"), `import { defineExperiment } from "niceeval";
import { snapshotAgent, snapshotSandbox } from "../agents/remote-snapshot.ts";
export default defineExperiment({ adapter: snapshotAgent, sandbox: snapshotSandbox, evals: ["snapshot-owner-a", "snapshot-owner-b"] });
`);
      const invoke = () => context.commands.niceeval.run(["exp", "--experiment", "snapshot-owner", "--rerun", "all", "--json"], { env: environment, timeoutMs: 120_000 });
      const cold = await invoke();
      expect(cold.exitCode, cold.diagnostic()).toBe(0);
      expect(cold.expEvalEvents().map((event) => event.verdict), cold.diagnostic()).toEqual(["passed", "passed"]);
      expect(cold.expEvents().filter((event) => "code" in event && event.code === "before-cache-replacement-conflict"), cold.diagnostic()).toEqual([]);
      const warm = await invoke();
      expect(warm.exitCode, warm.diagnostic()).toBe(0);
      expect(warm.expEvalEvents().map((event) => event.verdict), warm.diagnostic()).toEqual(["passed", "passed"]);
      if (provider !== "docker") expect(warm.expTerminal().summary.beforeCaches).toEqual({ total: 3, hit: 3, prepared: 0, degraded: 0, failed: 0 });
      const imagesBefore = await context.run(["docker", "images", "-q", "--filter", filter]);
      expect(imagesBefore.exitCode, imagesBefore.diagnostic()).toBe(0);
      await writeFile(join(context.paths.projectRoot, "evals/snapshot-owner-a.eval.ts"), evalSource("changed"));
      const changed = await invoke();
      expect(changed.exitCode, changed.diagnostic()).toBe(0);
      expect(changed.expEvalEvents().map((event) => event.verdict), changed.diagnostic()).toEqual(["passed", "passed"]);
      if (provider !== "docker") expect(changed.expTerminal().summary.beforeCaches).toEqual({ total: 3, hit: 2, prepared: 1, degraded: 0, failed: 0 });
      const imagesAfter = await context.run(["docker", "images", "-q", "--filter", filter]);
      const ids = (output: string) => new Set(output.trim().split(/\s+/u).filter(Boolean));
      expect(imagesAfter.exitCode, imagesAfter.diagnostic()).toBe(0);
      expect([...ids(imagesBefore.stdout)].filter((id) => !ids(imagesAfter.stdout).has(id))).toHaveLength(1);
      const containers = await context.run(["docker", "ps", "-aq", "--filter", filter]);
      expect(containers.stdout.trim(), containers.diagnostic()).toBe("");
    });
  });
});
