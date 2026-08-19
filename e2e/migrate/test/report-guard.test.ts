// owner: docs/engineering/testing/e2e/migrate.md#report-migration-metric-guard

import { join } from "node:path";
import { expect, test } from "vitest";
import { copyV1Fixture, e2e, RUN_ID } from "./support.ts";

test("Report 拒绝零分母 migration-required metric", async () => {
  await e2e.case("report-zero-denominator", async ({ paths, commands: { candidate } }) => {
    copyV1Fixture(paths.sourceRoot, join(paths.projectRoot, ".niceeval", "record"));
    const rejected = await candidate.run(["show", "--run", RUN_ID, "--report", "./reports/invalid-migration-metric.tsx", "--page", "/invalid-migration-metric"]);
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("Table rows[0].metric has unsupported object type");
  });
});
