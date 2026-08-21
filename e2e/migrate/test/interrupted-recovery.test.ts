// owner: docs/engineering/testing/e2e/migrate.md#interrupted-migration-recovery

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

    const concurrentEdit = join(recordRoot, "concurrent-edit.txt");
    writeFileSync(concurrentEdit, "preserve me\n");
    const unsafeRecovery = await candidate.run(["migrate", "--yes"]);
    expect(unsafeRecovery.exitCode, unsafeRecovery.diagnostic()).toBe(1);
    expect(unsafeRecovery.stderr, unsafeRecovery.diagnostic()).toContain("record-migration-interrupted");
    expect(unsafeRecovery.stderr, unsafeRecovery.diagnostic()).toContain("no automatic Git restore command is safe");
    expect(unsafeRecovery.stderr, unsafeRecovery.diagnostic()).not.toContain("Restore command:");
    expect(readFileSync(concurrentEdit, "utf8")).toBe("preserve me\n");
    rmSync(concurrentEdit);

    const migratedEnvelope = join(
      recordRoot,
      "runs",
      "2ce48d15-5278-46f7-a512-7235a3362c24",
      "attachments",
      "niceeval.observability",
      "attachment.json",
    );
    const migratedEnvelopeBytes = readFileSync(migratedEnvelope);
    const migratedEnvelopeRelative = migratedEnvelope.slice(paths.projectRoot.length + 1);
    expect((await run(["git", "add", "-f", "--", migratedEnvelopeRelative])).exitCode).toBe(0);
    const stagedRecovery = await candidate.run(["migrate", "--yes"]);
    expect(stagedRecovery.exitCode, stagedRecovery.diagnostic()).toBe(1);
    expect(stagedRecovery.stderr, stagedRecovery.diagnostic()).toContain("no automatic Git restore command is safe");
    expect(stagedRecovery.stderr, stagedRecovery.diagnostic()).not.toContain("Restore command:");
    expect(readFileSync(migratedEnvelope)).toEqual(migratedEnvelopeBytes);
    expect((await run(["git", "restore", "--staged", "--", migratedEnvelopeRelative])).exitCode).toBe(0);

    writeFileSync(join(recordRoot, "migration.in-progress"), `${JSON.stringify({
      restoreCommit,
      expectedRelativePaths: [
        "runs/2ce48d15-5278-46f7-a512-7235a3362c24/attachments/niceeval.observability/attachment.json",
        "runs/2ce48d15-5278-46f7-a512-7235a3362c24/attempts/ae2047b7-d0ef-4f1d-8a2f-ae2b27e7b4ad/attachments/niceeval.observability/attachment.json",
        "runs/2ce48d15-5278-46f7-a512-7235a3362c24/attempts/ae2047b7-d0ef-4f1d-8a2f-ae2b27e7b4ad/attachments/niceeval.assertions/attachment.json",
        "runs/2ce48d15-5278-46f7-a512-7235a3362c24/attempts/ae2047b7-d0ef-4f1d-8a2f-ae2b27e7b4ad/attachments/niceeval.assertions/payload.json",
      ],
    })}\n`);
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
