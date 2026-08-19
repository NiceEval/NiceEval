// owner: docs/engineering/testing/e2e/migrate.md#plan-change-preserves-concurrent-edit

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { expect, test } from "vitest";
import { commitRecord, copyV1Fixture, e2e } from "./support.ts";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

test("plan 后出现的并发编辑触发 stale 且不提示或执行恢复", async () => {
  await e2e.case("stale-plan", async ({ paths, commands: { candidate }, run }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copyV1Fixture(paths.sourceRoot, recordRoot);
    await commitRecord(run, "fixture: stale migration plan");
    const realGit = (await run(["which", "git"])).stdout.trim();
    const shimRoot = join(paths.projectRoot, ".git-shim");
    const shim = join(shimRoot, "git");
    const counter = join(shimRoot, "status-count");
    const concurrentEdit = join(recordRoot, "record.json");
    await run(["mkdir", "-p", shimRoot]);
    writeFileSync(shim, `#!/bin/sh\ncount_file=${shellQuote(counter)}\nif [ "$1" = "status" ]; then\n  count=0\n  [ ! -f "$count_file" ] || count=$(cat "$count_file")\n  count=$((count + 1))\n  printf '%s\\n' "$count" > "$count_file"\n  if [ "$count" -eq 2 ]; then\n    ${shellQuote(realGit)} "$@"\n    result=$?\n    printf '%s\\n' '{"format":"niceeval.record","recordId":"11111111-1111-4111-8111-111111111111","schemaVersion":1}' > ${shellQuote(concurrentEdit)}\n    exit "$result"\n  fi\nfi\nexec ${shellQuote(realGit)} "$@"\n`);
    chmodSync(shim, 0o755);

    const rejected = await candidate.run(["migrate", "--yes"], {
      env: { ...process.env, PATH: `${shimRoot}${delimiter}${process.env.PATH ?? ""}` },
    });
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("record-migration-plan-stale");
    expect(rejected.stderr, rejected.diagnostic()).not.toContain("Restore command:");
    expect(JSON.parse(readFileSync(concurrentEdit, "utf8"))).toEqual({
      format: "niceeval.record",
      recordId: "11111111-1111-4111-8111-111111111111",
      schemaVersion: 1,
    });
    expect(existsSync(join(recordRoot, "migration.in-progress"))).toBe(false);
  });
});
