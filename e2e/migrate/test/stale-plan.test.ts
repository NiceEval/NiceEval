// owner: docs/engineering/testing/e2e/migrate.md#plan-change-preserves-concurrent-edit

import { join } from "node:path";
import { Effect, Either } from "effect";
import {
  makeRecordRoot,
  NodeRecordLive,
  recordHost,
} from "niceeval/record";
import { expect, test } from "vitest";
import { copySourceFirstAssertionsV1Fixture, e2e } from "./support.ts";

test("已封口 plan 遇到另一调用完成迁移时返回 stale", async () => {
  await e2e.case("stale-plan", async ({ paths, commands: { candidate } }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copySourceFirstAssertionsV1Fixture(paths.sourceRoot, recordRoot);
    const root = makeRecordRoot(recordRoot);
    if (Either.isLeft(root)) throw new Error("fixture Record root invalid");

    const planned = await Effect.runPromise(
      recordHost.maintenance.planMigrate({ root: root.right }).pipe(Effect.provide(NodeRecordLive)),
    );
    expect(planned._tag).toBe("RecordMigrationReady");
    if (planned._tag !== "RecordMigrationReady") throw new Error("migration plan is not ready");

    const migrated = await candidate.run(["migrate", "--yes"]);
    expect(migrated.exitCode, migrated.diagnostic()).toBe(0);

    const stale = await Effect.runPromise(Effect.either(
      recordHost.maintenance.applyMigrate({
        root: root.right,
        plan: planned,
      }).pipe(Effect.provide(NodeRecordLive)),
    ));
    expect(Either.isLeft(stale)).toBe(true);
    if (Either.isLeft(stale)) {
      expect(stale.left).toEqual({
        _tag: "RecordMigrationPlanStale",
        code: "record-migration-plan-stale",
      });
    }

    const current = await candidate.run(["migrate", "--yes"]);
    expect(current.exitCode, current.diagnostic()).toBe(0);
    expect(current.stdout, current.diagnostic()).toContain("Record migration already-current.");
  });
});
