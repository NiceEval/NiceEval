// owner: docs/engineering/testing/e2e/migrate.md#future-known-family

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ATTEMPT_ID, copyV1Fixture, e2e, RUN_ID } from "./support.ts";

test("known family 的 future version 报 unsupported 而非 invalid", async () => {
  await e2e.case("future-known-family", async ({ paths, commands: { candidate } }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copyV1Fixture(paths.sourceRoot, recordRoot);
    writeFileSync(join(recordRoot, "runs", RUN_ID, "attempts", ATTEMPT_ID, "attachments", "niceeval.observability", "attachment.json"), '{"family":"niceeval.observability","schemaVersion":3}\n');
    const rejected = await candidate.run(["migrate", "--yes"]);
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("record-format-unsupported");
    expect(rejected.stderr, rejected.diagnostic()).toContain("Install a NiceEval version that supports this Record format.");
    expect(rejected.stderr, rejected.diagnostic()).not.toContain("record-migration-invalid");
    expect(existsSync(join(recordRoot, "migration.in-progress"))).toBe(false);
  });
});
