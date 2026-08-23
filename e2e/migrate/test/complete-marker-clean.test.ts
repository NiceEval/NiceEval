// owner: docs/engineering/testing/e2e/migrate.md#strict-complete-marker-clean

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { copySourceFirstAssertionsV1Fixture, e2e } from "./support.ts";

const NON_EMPTY_MARKER_RUN_ID = "11111111-1111-4111-8111-111111111111";
const DIRECTORY_MARKER_RUN_ID = "22222222-2222-4222-8222-222222222222";

test("clean 只把零字节普通文件 complete 视为 Run 已完成", async () => {
  await e2e.case("strict-complete-marker-clean", async ({ paths, commands: { candidate } }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copySourceFirstAssertionsV1Fixture(paths.sourceRoot, recordRoot);
    const migrated = await candidate.run(["migrate", "--yes"]);
    expect(migrated.exitCode, migrated.diagnostic()).toBe(0);
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

    const after = await candidate.run(["clean"]);
    expect(after.exitCode, after.diagnostic()).toBe(0);
    expect(after.stdout, after.diagnostic()).not.toContain(NON_EMPTY_MARKER_RUN_ID);
    expect(after.stdout, after.diagnostic()).not.toContain(DIRECTORY_MARKER_RUN_ID);
  });
});
