// owner: docs/engineering/testing/e2e/migrate.md#pre-write-invalid-record

import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  copySourceFirstAssertionsV1Fixture,
  e2e,
  recordTreeDigest,
  RUN_ID,
} from "./support.ts";

test("sealed Core 无效时在首个 portable write 前拒绝", async () => {
  await e2e.case("prewrite-invalid", async ({ paths, commands: { candidate } }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copySourceFirstAssertionsV1Fixture(paths.sourceRoot, recordRoot);
    rmSync(join(
      recordRoot,
      "runs",
      RUN_ID,
      "members",
      "slot-0323498ddabf9c4811f59cf08612c5ce40dab60a267271cefdad41aae4add5a8.json",
    ));
    const before = recordTreeDigest(recordRoot);
    const rejected = await candidate.run(["migrate", "--yes"]);
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("record-migration-invalid");
    expect(rejected.stderr, rejected.diagnostic()).not.toContain("Restore command:");
    expect(recordTreeDigest(recordRoot)).toBe(before);
  });
});
