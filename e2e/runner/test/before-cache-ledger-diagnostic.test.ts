// rerun: pnpm e2e test --candidate source --repo runner -- --run test/before-cache-ledger-diagnostic.test.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { withSnapshotInfrastructure } from "../fixtures/remote-snapshot/infrastructure.ts";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/sandbox/README.md
test.concurrent("账本格式不受支持时共享一次可修复的 Run 诊断，并保留节点降级原因", async () => {
  await runnerE2E.case("before-cache-ledger-diagnostic", async (context) => {
    await withSnapshotInfrastructure(context, async ({ env }) => {
      const {
        paths,
        commands: { niceeval },
      } = context;
      const home = join(paths.projectRoot, ".unsupported-home");
      await mkdir(home);
      const database = new DatabaseSync(join(home, "niceeval.sqlite"));
      database.exec("CREATE TABLE old_format (value TEXT)");
      database.close();
      await writeFile(
        join(paths.projectRoot, "experiments/snapshot-second.ts"),
        `
import { defineExperiment } from "niceeval";
import { e2bSandbox, shell } from "niceeval/sandbox";
import { snapshotAgent } from "../agents/remote-snapshot.ts";
export default defineExperiment({ adapter: snapshotAgent, evals: ["snapshot-shared"],
  sandbox: e2bSandbox({ template: "fixture" }).before(
    shell({ id: "independent-root", command: "printf shared > /tmp/shared-prefix" })).before(
    shell({ id: "independent-child", command: "true" })),
});


`,
      );
      const invocationEnv = {
        ...env,
        NICEEVAL_HOME: home,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} ${env.NODE_OPTIONS}`,
      };
      const args = ["exp", "--experiment", "snapshot-first", "--experiment", "snapshot-second", "--rerun", "all"];
      const result = await niceeval.run([...args, "--json"], { env: invocationEnv, timeoutMs: 180_000 });
      expect(result.exitCode, result.diagnostic()).toBe(0);
      const warnings = result.expEvents().filter((event) => "code" in event && event.code === "cache-degraded");
      expect(warnings, result.diagnostic()).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ message: expect.stringContaining("user-database-unsupported") });
      expect(warnings[0]).toMatchObject({ message: expect.stringContaining("then remove") });
      expect(warnings[0]).toMatchObject({ message: expect.stringContaining("and rerun") });
      for (const runId of result.expReceipt().createdRunIds) {
        const shownRun = await niceeval.run(["show", `run:${runId}`, "--json"]);
        expect(shownRun.exitCode, shownRun.diagnostic()).toBe(0);
        const diagnostics = shownRun.run().run.diagnostics.filter((item) => item.code === "cache-degraded");
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]!.summary).toContain("then remove");
      }
      expect(result.expEvalEvents()).toHaveLength(2);
      for (const event of result.expEvalEvents()) {
        expect(event.verdict, result.diagnostic()).toBe("passed");
        const trace = await niceeval.run(["show", event.locator, "execution", "--json"]);
        expect(trace.exitCode, trace.diagnostic()).toBe(0);
        const nodes = trace.attemptTrace().trace.diagnostics.items.filter((item) => item.code === "cache-degraded");
        expect(nodes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ summary: expect.stringContaining("user-database-unsupported") }),
            expect.objectContaining({ summary: expect.stringContaining("parent-unavailable") }),
          ]),
        );
        const human = await niceeval.run(["show", event.locator, "execution"]);
        expect(human.exitCode, human.diagnostic()).toBe(0);
        expect(human.stdout).toContain("then remove");
        const root = nodes.find((item) => item.summary.includes("user-database-unsupported"));
        if (root === undefined) throw new Error("Missing ledger failure diagnostic");
        const detail = await niceeval.run(["show", event.locator, root.diagnosticId, "--json"]);
        expect(detail.exitCode, detail.diagnostic()).toBe(0);
        expect(detail.attemptTraceDetail().detail).toMatchObject({
          kind: "diagnostic",
          summary: expect.stringContaining("and rerun"),
        });
      }
      const human = await niceeval.run(args, { env: invocationEnv, timeoutMs: 180_000 });
      expect(human.exitCode, human.diagnostic()).toBe(0);
      expect(human.stdout).toContain("user-database-unsupported");
      // Human feedback repeats its one warning in the completion panel.
      expect(human.stdout).not.toMatch(/cache-degraded ×[2-9]/u);
    });
  });
});

// @feature docs/feature/sandbox/README.md
test.concurrent("staging 状态读取失败归类为 staging-failed，并隐藏外部私有失败载荷", async () => {
  await runnerE2E.case("before-cache-staging-diagnostic", async (context) => {
    await withSnapshotInfrastructure(context, async ({ env }) => {
      const { niceeval } = context.commands;
      const result = await niceeval.run(["exp", "snapshot-first", "--json"], {
        env: {
          ...env,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} ${env.NODE_OPTIONS}`,
          NICEEVAL_SNAPSHOT_FIXTURE_FAIL_MOUNTS: "1",
        },
        timeoutMs: 180_000,
      });
      expect(result.exitCode, result.diagnostic()).toBe(0);
      const events = result.expEvalEvents();
      expect(events).toHaveLength(1);
      expect(events[0]!.verdict).toBe("passed");
      const trace = await niceeval.run(["show", events[0]!.locator, "execution", "--json"]);
      expect(trace.exitCode, trace.diagnostic()).toBe(0);
      const diagnostics = trace.attemptTrace().trace.diagnostics.items;
      expect(diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ summary: expect.stringContaining("staging-failed") })]),
      );
      expect(JSON.stringify(diagnostics)).not.toContain("ledger-unavailable");
      expect(JSON.stringify(diagnostics)).not.toContain("private-token-must-not-leak");
    });
  });
});

// @feature docs/feature/sandbox/README.md
test.concurrent("Docker before 缓存账本失败保留数据库修复提示", async () => {
  await runnerE2E.case("docker-before-cache-ledger-diagnostic", async (context) => {
    await withSnapshotInfrastructure(context, async ({ env }) => {
      const home = join(context.paths.projectRoot, ".unsupported-home");
      await mkdir(home);
      const database = new DatabaseSync(join(home, "niceeval.sqlite"));
      database.exec("CREATE TABLE old_format (value TEXT)");
      database.close();
      const result = await context.commands.niceeval.run(["exp", "snapshot-first", "--json"], {
        env: {
          ...env,
          NICEEVAL_HOME: home,
          NICEEVAL_SNAPSHOT_FIXTURE_PROVIDER: "docker",
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} ${env.NODE_OPTIONS}`,
        },
        timeoutMs: 180_000,
      });
      expect(result.exitCode, result.diagnostic()).toBe(0);
      const events = result.expEvalEvents();
      expect(events).toHaveLength(1);
      expect(events[0]!.verdict).toBe("passed");
      const trace = await context.commands.niceeval.run(["show", events[0]!.locator, "execution", "--json"]);
      expect(trace.exitCode, trace.diagnostic()).toBe(0);
      expect(trace.attemptTrace().trace.diagnostics.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ summary: expect.stringContaining("user-database-unsupported") }),
          expect.objectContaining({ summary: expect.stringContaining("then remove") }),
        ]),
      );
    });
  });
});
