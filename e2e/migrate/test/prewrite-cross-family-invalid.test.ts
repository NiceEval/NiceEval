// owner: docs/engineering/testing/e2e/migrate.md#pre-write-cross-family-invalid-record

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ATTEMPT_ID, commitRecord, copyV1Fixture, e2e, RUN_ID } from "./support.ts";

test("cross-family 校验失败时在首个迁移写入前拒绝", async () => {
  await e2e.case("prewrite-cross-family-invalid", async ({ paths, commands: { candidate }, run }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copyV1Fixture(paths.sourceRoot, recordRoot);
    const navigationPath = join(recordRoot, "runs", RUN_ID, "attempts", ATTEMPT_ID, "attachments", "niceeval.source-navigation", "payload.json");
    const navigation = JSON.parse(readFileSync(navigationPath, "utf8")) as { "rows-data": Array<{ turnId: string }> };
    navigation["rows-data"][0]!.turnId = "turn_00000000000000000000000000";
    writeFileSync(navigationPath, `${JSON.stringify(navigation)}\n`);
    await commitRecord(run, "fixture: invalid cross-family join");

    const before = await run(["git", "status", "--porcelain=v1", "--untracked-files=all", "--", ".niceeval/record"]);
    expect(before.exitCode, before.diagnostic()).toBe(0);
    const rejected = await candidate.run(["migrate", "--yes"]);
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("record-migration-invalid");
    expect(rejected.stderr, rejected.diagnostic()).not.toContain("record-migration-recovery-required");
    expect(existsSync(join(recordRoot, "migration.in-progress"))).toBe(false);

    const after = await run(["git", "status", "--porcelain=v1", "--untracked-files=all", "--", ".niceeval/record"]);
    expect(after.exitCode, after.diagnostic()).toBe(0);
    expect(after.stdout).toBe(before.stdout);
  });
});
