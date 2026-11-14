// rerun: pnpm e2e test --repo runner -- --run test/before-cache-replacement-warning.test.ts
import { expect, test } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runnerE2E } from "./context.ts";
import { withSnapshotInfrastructure } from "../fixtures/remote-snapshot/infrastructure.ts";

// @feature docs/feature/sandbox/README.md
test.concurrent.each(["docker", "e2b"])("不同 Eval 的同名 action 独立缓存，同一 Eval 内容换代后取代旧 artifact（%s）", async (provider) => {
  await runnerE2E.case("before-cache-replacement-owner", {}, async (context) => {
    await withSnapshotInfrastructure(context, async ({ filter, env }) => {
      await writeFile(join(context.paths.projectRoot, "niceeval.config.ts"), 'import { defineConfig } from "niceeval"; export default defineConfig({ timeoutMs: 180_000, maxConcurrency: 4 });\n');
      const environment = { ...env, NICEEVAL_SNAPSHOT_FIXTURE_PROVIDER: provider };
      const evalSource = (value: string) => `import { defineEval } from "niceeval";
import { sandboxLayer, shell } from "niceeval/sandbox";
import { includes } from "niceeval/expect";
export default defineEval({ sandbox: sandboxLayer().before(shell({ id: "version", command: "printf ${value} > /tmp/version" })), async test(t) {
  t.check(await t.sandbox.readText("/tmp/version"), includes("${value}"));
} });
`;
      await writeFile(join(context.paths.projectRoot, "evals/snapshot-owner-a.eval.ts"), evalSource("first"));
      await writeFile(join(context.paths.projectRoot, "evals/snapshot-owner-b.eval.ts"), evalSource("second"));
      await writeFile(join(context.paths.projectRoot, "experiments/snapshot-owner.ts"), `import { defineExperiment } from "niceeval";
import { snapshotAgent, snapshotSandbox } from "../agents/remote-snapshot.ts";
import { dockerSandbox } from "niceeval/sandbox";
const sandbox = process.env.NICEEVAL_SNAPSHOT_FIXTURE_PROVIDER === "docker" ? dockerSandbox({ source: { type: "image", image: process.env.NICEEVAL_SNAPSHOT_FIXTURE_IMAGE! }, user: "root" }) : snapshotSandbox;
export default defineExperiment({ adapter: snapshotAgent, sandbox, evals: ["snapshot-owner-a", "snapshot-owner-b"] });
`);
      const invoke = () => context.commands.niceeval.run(["exp", "--experiment", "snapshot-owner", "--rerun", "all", "--json"], { env: environment, timeoutMs: 240_000 });
      const cold = await invoke();
      expect(cold.exitCode, cold.diagnostic()).toBe(0);
      expect(cold.expEvalEvents().map((event) => event.verdict), cold.diagnostic()).toEqual(["passed", "passed"]);
      expect(cold.expEvents().filter((event) => "code" in event && event.code === "before-cache-replacement-conflict"), cold.diagnostic()).toEqual([]);
      if (provider !== "docker") expect(cold.expTerminal().summary.beforeCaches, cold.diagnostic()).toEqual({ total: 3, hit: 0, prepared: 3, degraded: 0, failed: 0 });
      const artifactFilter = provider === "docker" ? "label=io.niceeval.cache.kind=sandbox-before-cache" : "label=niceeval.snapshot-id";
      const coldImages = await context.run(["docker", "images", "-aq", "--filter", filter, "--filter", artifactFilter]);
      expect(coldImages.exitCode, coldImages.diagnostic()).toBe(0);
      expect(new Set(coldImages.stdout.trim().split(/\s+/u)).size).toBe(provider === "docker" ? 2 : 3);
      const warm = await invoke();
      expect(warm.exitCode, warm.diagnostic()).toBe(0);
      expect(warm.expEvalEvents().map((event) => event.verdict), warm.diagnostic()).toEqual(["passed", "passed"]);
      if (provider !== "docker") expect(warm.expTerminal().summary.beforeCaches, warm.diagnostic()).toEqual({ total: 3, hit: 3, prepared: 0, degraded: 0, failed: 0 });
      const imagesBefore = await context.run(["docker", "images", "-aq", "--filter", filter, "--filter", artifactFilter]);
      expect(imagesBefore.exitCode, imagesBefore.diagnostic()).toBe(0);
      expect(new Set(imagesBefore.stdout.trim().split(/\s+/u))).toEqual(new Set(coldImages.stdout.trim().split(/\s+/u)));
      await writeFile(join(context.paths.projectRoot, "evals/snapshot-owner-a.eval.ts"), evalSource("changed"));
      const changed = await invoke();
      expect(changed.exitCode, changed.diagnostic()).toBe(0);
      expect(changed.expEvalEvents().map((event) => event.verdict), changed.diagnostic()).toEqual(["passed", "passed"]);
      if (provider !== "docker") expect(changed.expTerminal().summary.beforeCaches, changed.diagnostic()).toEqual({ total: 3, hit: 2, prepared: 1, degraded: 0, failed: 0 });
      const imagesAfter = await context.run(["docker", "images", "-aq", "--filter", filter, "--filter", artifactFilter]);
      const ids = (output: string) => new Set(output.trim().split(/\s+/u).filter(Boolean));
      expect(imagesAfter.exitCode, imagesAfter.diagnostic()).toBe(0);
      expect([...ids(imagesBefore.stdout)].filter((id) => !ids(imagesAfter.stdout).has(id))).toHaveLength(1);
      const containers = await context.run(["docker", "ps", "-aq", "--filter", filter]);
      expect(containers.stdout.trim(), containers.diagnostic()).toBe("");
    });
  });
}, 600_000);

// @feature docs/feature/sandbox/README.md
test.concurrent("同一个 Eval 在相同替换位置依赖不同前缀内容时发出声明冲突 warning", async () => {
  await runnerE2E.case("before-cache-replacement-warning", {}, async (context) => {
    await writeFile(join(context.paths.projectRoot, "niceeval.config.ts"), 'import { defineConfig } from "niceeval"; export default defineConfig({ timeoutMs: 180_000, maxConcurrency: 4 });\n');
    await withSnapshotInfrastructure(context, async ({ env }) => {
      await writeFile(join(context.paths.projectRoot, "evals/snapshot-shared.eval.ts"), `import { defineEval } from "niceeval";
import { sandboxLayer, shell } from "niceeval/sandbox";
export default defineEval({ sandbox: sandboxLayer().before(shell({ id: "eval-tail", command: "true" })), async test(t) {
} });
`);
      const result = await context.commands.niceeval.run(["exp", "--experiment", "snapshot-first", "--experiment", "snapshot-second", "--rerun", "all", "--json"], {
        env: { ...env, NICEEVAL_SNAPSHOT_FIXTURE_PROVIDER: "e2b", NICEEVAL_SNAPSHOT_COLLISION: "1" }, timeoutMs: 240_000,
      });
      expect(result.exitCode, result.diagnostic()).toBe(0);
      const warnings = result.expEvents().filter((event) => "code" in event && event.code === "before-cache-replacement-conflict");
      expect(warnings, result.diagnostic()).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ message: expect.stringContaining('Before action "eval-tail"') });
      expect(warnings[0]).toMatchObject({ message: expect.stringContaining("eval:snapshot-shared") });
    });
  });
});
