// owner: docs/engineering/testing/e2e/migrate.md#pre-write-invalid-record

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { commitRecord, copyV1Fixture, e2e, RUN_ID } from "./support.ts";

test("sealed Core 无效时在首个 portable write 前拒绝", async () => {
  await e2e.case("prewrite-invalid", async ({ paths, commands: { candidate }, run }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copyV1Fixture(paths.sourceRoot, recordRoot);
    rmSync(join(recordRoot, "runs", RUN_ID, "members", "slot-0323498ddabf9c4811f59cf08612c5ce40dab60a267271cefdad41aae4add5a8.json"));
    await commitRecord(run, "fixture: invalid sealed core");
    const rejected = await candidate.run(["migrate", "--yes"]);
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("record-migration-invalid");
    expect(rejected.stderr, rejected.diagnostic()).not.toContain("Restore command:");
    expect(existsSync(join(recordRoot, "migration.in-progress"))).toBe(false);
    expect(JSON.parse(readFileSync(join(recordRoot, "runs", RUN_ID, "attachments", "niceeval.observability", "attachment.json"), "utf8"))).toEqual({ family: "niceeval.observability", schemaVersion: 1 });
  });
});
