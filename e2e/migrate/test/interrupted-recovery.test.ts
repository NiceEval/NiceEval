// owner: docs/engineering/testing/e2e/migrate.md#interrupted-migration-recovery

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { commitRecord, copyV1Fixture, e2e } from "./support.ts";

test("迁移中断后按 sentinel commit 恢复、验证并重试", async () => {
  await e2e.case("interrupted-recovery", async ({ paths, commands: { candidate }, run }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copyV1Fixture(paths.sourceRoot, recordRoot);
    await commitRecord(run, "fixture: interrupted migration");
    const restoreCommit = (await run(["git", "rev-parse", "HEAD"])).stdout.trim();
    const migrated = await candidate.run(["migrate", "--yes"]);
    expect(migrated.exitCode, migrated.diagnostic()).toBe(0);
    writeFileSync(join(recordRoot, "migration.in-progress"), `${JSON.stringify({ restoreCommit })}\n`);

    const interrupted = await candidate.run(["migrate", "--yes"]);
    expect(interrupted.exitCode, interrupted.diagnostic()).toBe(1);
    expect(interrupted.stderr, interrupted.diagnostic()).toContain("record-migration-interrupted");
    expect(interrupted.stderr, interrupted.diagnostic()).toContain(
      `git -C '${recordRoot}' restore --source='${restoreCommit}' --staged --worktree -- .`,
    );
    const restored = await run(["git", "-C", recordRoot, "restore", `--source=${restoreCommit}`, "--staged", "--worktree", "--", "."]);
    expect(restored.exitCode, restored.diagnostic()).toBe(0);
    expect((await run(["git", "-C", recordRoot, "diff", "--quiet", restoreCommit, "--", "."])).exitCode).toBe(0);
    expect((await run(["git", "-C", recordRoot, "diff", "--cached", "--quiet", restoreCommit, "--", "."])).exitCode).toBe(0);
    expect(existsSync(join(recordRoot, "migration.in-progress"))).toBe(true);
    rmSync(join(recordRoot, "migration.in-progress"));
    const retried = await candidate.run(["migrate", "--yes"]);
    expect(retried.exitCode, retried.diagnostic()).toBe(0);
    expect(retried.stdout, retried.diagnostic()).toContain("Record migration migrated.");
  });
});
