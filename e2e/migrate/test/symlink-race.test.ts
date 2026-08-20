// owner: docs/engineering/testing/e2e/migrate.md#migration-no-follow-replace
// regression: migration writes must never follow a raced symlink outside Record

import { chmodSync, existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { expect, test } from "vitest";
import { commitRecord, copyV1Fixture, e2e, RUN_ID } from "./support.ts";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

test("migration replace 在目标被换成 symlink 时 fail closed", async () => {
  await e2e.case("migration-symlink-race", async ({ paths, commands: { candidate }, run }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copyV1Fixture(paths.sourceRoot, recordRoot);
    await commitRecord(run, "fixture: migration symlink race");

    const envelope = join(recordRoot, "runs", RUN_ID, "attachments", "niceeval.observability", "attachment.json");
    const expectedEnvelope = readFileSync(envelope);
    const outside = join(paths.projectRoot, "outside-envelope.json");
    writeFileSync(outside, expectedEnvelope);

    const realGit = (await run(["sh", "-c", "command -v git"])).stdout.trim();
    const shimRoot = join(paths.projectRoot, ".git-shim");
    const shim = join(shimRoot, "git");
    const counter = join(shimRoot, "status-count");
    await run(["mkdir", "-p", shimRoot]);
    writeFileSync(shim, `#!/bin/sh\ncount_file=${shellQuote(counter)}\nif [ "$1" = "status" ]; then\n  count=0\n  [ ! -f "$count_file" ] || count=$(cat "$count_file")\n  count=$((count + 1))\n  printf '%s\\n' "$count" > "$count_file"\n  if [ "$count" -eq 3 ]; then\n    ${shellQuote(realGit)} "$@"\n    result=$?\n    rm -f ${shellQuote(envelope)}\n    ln -s ${shellQuote(outside)} ${shellQuote(envelope)}\n    exit "$result"\n  fi\nfi\nexec ${shellQuote(realGit)} "$@"\n`);
    chmodSync(shim, 0o755);

    const rejected = await candidate.run(["migrate", "--yes"], {
      env: { ...process.env, PATH: `${shimRoot}${delimiter}${process.env.PATH ?? ""}` },
    });
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("record-migration-recovery-required");
    expect(readFileSync(outside)).toEqual(expectedEnvelope);
    expect(lstatSync(envelope).isSymbolicLink()).toBe(true);
    expect(existsSync(join(recordRoot, "migration.in-progress"))).toBe(true);
  });
});
