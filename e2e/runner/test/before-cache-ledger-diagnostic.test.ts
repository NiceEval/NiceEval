// rerun: pnpm e2e test --candidate source --repo runner -- --run test/before-cache-ledger-diagnostic.test.ts
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { withSnapshotInfrastructure } from "../fixtures/remote-snapshot/infrastructure.ts";
import { runnerE2E } from "./context.ts";

async function createUnsupportedLedger(projectRoot: string) {
  const home = join(projectRoot, ".unsupported-home");
  await mkdir(home);
  const databasePath = join(home, "niceeval.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE old_format (value TEXT)");
  database.close();
  return { home, databasePath, original: await readFile(databasePath) };
}

// @feature docs/feature/sandbox/data-model.md#user-database-preflight
test.concurrent("不受支持的远端缓存账本在派发前给出一次修复诊断", async () => {
  await runnerE2E.case("before-cache-ledger-diagnostic", async (context) => {
    await withSnapshotInfrastructure(context, async ({ env }) => {
      const { projectRoot } = context.paths;
      const { niceeval } = context.commands;
      const { home, databasePath, original } = await createUnsupportedLedger(projectRoot);
      const options = { env: { ...env, NICEEVAL_HOME: home }, timeoutMs: 180_000 };
      const args = ["exp", "--experiment", "snapshot-first", "--experiment", "snapshot-second", "--rerun", "all"];
      const result = await niceeval.run([...args, "--json"], options);
      expect(result.exitCode, result.diagnostic()).toBe(1);
      expect(result.stderr).toBe("");
      const message =
        `User database ${databasePath} was written by an older NiceEval or has an unsupported format. ` +
        `Stop its consumers, reconcile retained provider artifacts and holds, then remove ${databasePath} and rerun. ` +
        "The database has not been migrated or cleared.";
      expect(result.json<unknown>()).toEqual({
        event: "warning",
        level: "error",
        code: "user-database-unsupported",
        message,
      });

      const preview = await niceeval.run([...args, "--dry", "--json"], options);
      expect(preview.exitCode, preview.diagnostic()).toBe(1);
      expect(preview.stderr).toBe("");
      expect(preview.json<unknown>()).toEqual(result.json<unknown>());

      const human = await niceeval.run(args, options);
      expect(human.exitCode, human.diagnostic()).toBe(1);
      expect(human.stdout).toBe("");
      expect(human.stderr.replace(/\s+/gu, " ")).toContain(message);
      expect(human.stderr.match(/user-database-unsupported/gu)).toHaveLength(1);
      expect(existsSync(join(projectRoot, ".niceeval", "record.sqlite"))).toBe(false);
      expect(await readFile(databasePath)).toEqual(original);
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

// @feature docs/feature/sandbox/data-model.md#user-database-preflight
test.concurrent("不受支持的 Docker 缓存账本拒绝启动 Invocation，并保留修复提示", async () => {
  await runnerE2E.case("docker-before-cache-ledger-diagnostic", async (context) => {
    await withSnapshotInfrastructure(context, async ({ env }) => {
      const { projectRoot } = context.paths;
      const { home, databasePath, original } = await createUnsupportedLedger(projectRoot);
      const result = await context.commands.niceeval.run(["exp", "snapshot-first", "--json"], {
        env: { ...env, NICEEVAL_HOME: home, NICEEVAL_SNAPSHOT_FIXTURE_PROVIDER: "docker" },
        timeoutMs: 180_000,
      });
      expect(result.exitCode, result.diagnostic()).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.json<unknown>()).toEqual({
        event: "warning",
        level: "error",
        code: "user-database-unsupported",
        message: expect.stringContaining(`then remove ${databasePath} and rerun`),
      });
      expect(existsSync(join(projectRoot, ".niceeval", "record.sqlite"))).toBe(false);
      expect(await readFile(databasePath)).toEqual(original);
    });
  });
});
