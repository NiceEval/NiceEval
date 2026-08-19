// owner: docs/engineering/testing/e2e/migrate.md#post-write-invalid-record

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ATTEMPT_ID, commitRecord, copyV1Fixture, e2e, RUN_ID } from "./support.ts";

test("post-write cross-family 校验失败时只提示真实恢复动作", async () => {
  await e2e.case("postwrite-invalid", async ({ paths, commands: { candidate }, run }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copyV1Fixture(paths.sourceRoot, recordRoot);
    const navigationPath = join(recordRoot, "runs", RUN_ID, "attempts", ATTEMPT_ID, "attachments", "niceeval.source-navigation", "payload.json");
    const navigation = JSON.parse(readFileSync(navigationPath, "utf8")) as { "rows-data": Array<{ turnId: string }> };
    navigation["rows-data"][0]!.turnId = "turn_00000000000000000000000000";
    writeFileSync(navigationPath, `${JSON.stringify(navigation)}\n`);
    await commitRecord(run, "fixture: invalid cross-family join");
    const restoreCommit = (await run(["git", "rev-parse", "HEAD"])).stdout.trim();
    const rejected = await candidate.run(["migrate", "--yes"]);
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("record-migration-recovery-required");
    expect(rejected.stderr, rejected.diagnostic()).toContain("Cause: record-migration-invalid");
    expect(rejected.stderr, rejected.diagnostic()).toContain(`Restore command: git -C '${recordRoot}' restore --source='${restoreCommit}'`);
    expect(existsSync(join(recordRoot, "migration.in-progress"))).toBe(true);
  });
});
