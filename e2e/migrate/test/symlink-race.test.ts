// owner: docs/engineering/testing/e2e/migrate.md#migration-no-follow-replace

import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  ATTEMPT_ID,
  copySourceFirstAssertionsV1Fixture,
  e2e,
  RUN_ID,
} from "./support.ts";

test("migration 对指向 Record 外的 Attachment symlink fail closed", async () => {
  await e2e.case("migration-symlink", async ({ paths, commands: { candidate } }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copySourceFirstAssertionsV1Fixture(paths.sourceRoot, recordRoot);

    const envelope = join(
      recordRoot,
      "runs",
      RUN_ID,
      "attempts",
      ATTEMPT_ID,
      "attachments",
      "niceeval.assertions",
      "attachment.json",
    );
    const expectedEnvelope = readFileSync(envelope);
    const outside = join(paths.projectRoot, "outside-envelope.json");
    writeFileSync(outside, expectedEnvelope);
    rmSync(envelope);
    symlinkSync(outside, envelope);

    const rejected = await candidate.run(["migrate", "--yes"]);
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("record-path-type-invalid");
    expect(readFileSync(outside)).toEqual(expectedEnvelope);
  });
});
