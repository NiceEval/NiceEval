// owner: docs/engineering/testing/e2e/migrate.md#interrupted-migration-recovery

import { join } from "node:path";
import { waitForOutput } from "@niceeval/testkit";
import { expect, test } from "vitest";
import {
  copySourceFirstAssertionsV1Fixture,
  e2e,
  RUN_ID,
} from "./support.ts";

test("maintenance owner 被杀后下一次显式迁移可回收租约", async () => {
  await e2e.case("interrupted-recovery", async ({
    paths,
    commands: { candidate },
    start,
  }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copySourceFirstAssertionsV1Fixture(paths.sourceRoot, recordRoot);

    const holder = start([
      process.execPath,
      join(paths.projectRoot, "scripts", "hold-record-maintenance.mjs"),
      recordRoot,
    ]);
    await waitForOutput(holder, "stdout", /maintenance-ready/, {
      timeoutMs: 10_000,
      label: "maintenance holder acquires the lease",
    });
    expect(holder.signal("SIGKILL")).toBe(true);
    await holder.done;

    const migrated = await candidate.run(["migrate", "--yes"]);
    expect(migrated.exitCode, migrated.diagnostic()).toBe(0);
    expect(migrated.stdout, migrated.diagnostic()).toContain("Record migration migrated:");

    const shown = await candidate.run(["show", "--run", RUN_ID, "--json"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
  });
});
