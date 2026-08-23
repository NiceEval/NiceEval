// owner: docs/engineering/testing/e2e/migrate.md#future-or-unknown-family

import { join } from "node:path";
import { expect, test } from "vitest";
import {
  copySourceFirstAssertionsFutureFixture,
  copySourceFirstUnknownFamilyFixture,
  e2e,
  RUN_ID,
} from "./support.ts";

test("known family 的 future version 报 unsupported 而非 invalid", async () => {
  await e2e.case("future-known-family", async ({ paths, commands: { candidate } }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copySourceFirstAssertionsFutureFixture(paths.sourceRoot, recordRoot);
    const rejected = await candidate.run(["migrate", "--yes"]);
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("record-format-unsupported");
    expect(rejected.stderr, rejected.diagnostic()).toContain("Install a NiceEval version that supports this Record format.");
    expect(rejected.stderr, rejected.diagnostic()).not.toContain("record-migration-invalid");

    const shown = await candidate.run(["show", "--run", RUN_ID, "--json"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(1);
    expect(shown.stderr, shown.diagnostic()).toContain("record-migration-required");
    expect(shown.stdout, shown.diagnostic()).not.toContain('"selection"');
  });
});

test("unknown future family 要求显式贡献 definition", async () => {
  await e2e.case("unknown-future-family", async ({ paths, commands: { candidate } }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copySourceFirstUnknownFamilyFixture(paths.sourceRoot, recordRoot);

    const migrated = await candidate.run(["migrate", "--yes"]);
    expect(migrated.exitCode, migrated.diagnostic()).toBe(1);
    expect(migrated.stderr, migrated.diagnostic()).toContain("family-definition-required");
    expect(migrated.stderr, migrated.diagnostic()).not.toContain("record-migration-invalid");

    const shown = await candidate.run(["show", "--run", RUN_ID, "--json"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(1);
    expect(shown.stderr, shown.diagnostic()).toContain("record-migration-required");
    expect(shown.stderr, shown.diagnostic()).not.toContain("record-bootstrap-invalid");
    expect(shown.stdout, shown.diagnostic()).not.toContain('"selection"');
  });
});
