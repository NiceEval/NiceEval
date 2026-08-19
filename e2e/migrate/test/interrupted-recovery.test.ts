// owner: docs/engineering/testing/e2e/migrate.md#interrupted-migration-recovery

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { commitRecord, copyV1Fixture, e2e } from "./support.ts";

const NON_EMPTY_MARKER_RUN_ID = "11111111-1111-4111-8111-111111111111";
const DIRECTORY_MARKER_RUN_ID = "22222222-2222-4222-8222-222222222222";

test("迁移中断后按 sentinel commit 恢复、验证并重试", async () => {
  await e2e.case("interrupted-recovery", async ({ paths, commands: { candidate }, run }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copyV1Fixture(paths.sourceRoot, recordRoot);
    await commitRecord(run, "fixture: interrupted migration");
    const restoreCommit = (await run(["git", "rev-parse", "HEAD"])).stdout.trim();
    const migrated = await candidate.run(["migrate", "--yes"]);
    expect(migrated.exitCode, migrated.diagnostic()).toBe(0);
    writeFileSync(join(recordRoot, "migration.in-progress"), `${JSON.stringify({ restoreCommit })}\n`);

    const concurrentEdit = join(recordRoot, "concurrent-edit.txt");
    writeFileSync(concurrentEdit, "preserve me\n");
    const unsafeRecovery = await candidate.run(["migrate", "--yes"]);
    expect(unsafeRecovery.exitCode, unsafeRecovery.diagnostic()).toBe(1);
    expect(unsafeRecovery.stderr, unsafeRecovery.diagnostic()).toContain("record-migration-interrupted");
    expect(unsafeRecovery.stderr, unsafeRecovery.diagnostic()).toContain("no automatic Git restore command is safe");
    expect(unsafeRecovery.stderr, unsafeRecovery.diagnostic()).not.toContain("Restore command:");
    expect(readFileSync(concurrentEdit, "utf8")).toBe("preserve me\n");
    rmSync(concurrentEdit);

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

    const runs = join(recordRoot, "runs");
    mkdirSync(join(runs, NON_EMPTY_MARKER_RUN_ID), { recursive: true });
    writeFileSync(join(runs, NON_EMPTY_MARKER_RUN_ID, "complete"), "not sealed\n");
    mkdirSync(join(runs, DIRECTORY_MARKER_RUN_ID, "complete"), { recursive: true });

    const listed = await candidate.run(["clean"]);
    expect(listed.exitCode, listed.diagnostic()).toBe(1);
    expect(listed.stdout, listed.diagnostic()).toContain(NON_EMPTY_MARKER_RUN_ID);
    expect(listed.stdout, listed.diagnostic()).toContain(DIRECTORY_MARKER_RUN_ID);
    expect(listed.stderr, listed.diagnostic()).toContain("record-clean-confirmation-required");

    const cleaned = await candidate.run(["clean", "--yes"]);
    expect(cleaned.exitCode, cleaned.diagnostic()).toBe(0);
    expect(cleaned.stdout, cleaned.diagnostic()).toContain(`deleted: ${NON_EMPTY_MARKER_RUN_ID}`);
    expect(cleaned.stdout, cleaned.diagnostic()).toContain(`deleted: ${DIRECTORY_MARKER_RUN_ID}`);
  });
});
