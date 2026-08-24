// owner: docs/engineering/testing/e2e/migrate.md#assertions-v1-to-current

import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import {
  copySourceFirstAssertionsV1Fixture,
  e2e,
  RUN_ID,
} from "./support.ts";

test("Assertions v1 只经显式迁移后可由 current reader 读回", async () => {
  await e2e.case("assertions-v1-to-current", async ({ paths, commands: { candidate } }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copySourceFirstAssertionsV1Fixture(paths.sourceRoot, recordRoot);

    const before = await candidate.run(["show", "--run", RUN_ID, "--json"]);
    expect(before.exitCode, before.diagnostic()).toBe(1);
    expect(before.stderr, before.diagnostic()).toContain("record-migration-required");

    const planned = await candidate.run(["migrate"]);
    expect(planned.exitCode, planned.diagnostic()).toBe(1);
    expect(planned.stdout, planned.diagnostic()).toContain("Record migration plan");
    expect(planned.stderr, planned.diagnostic()).toContain("record-migration-confirmation-required");

    const migrated = await candidate.run(["migrate", "--yes"]);
    expect(migrated.exitCode, migrated.diagnostic()).toBe(0);
    expect(migrated.stdout, migrated.diagnostic()).toContain(
      "Record migration migrated: committed 1, skipped 0, failed 0.",
    );

    const repeated = await candidate.run(["migrate", "--yes"]);
    expect(repeated.exitCode, repeated.diagnostic()).toBe(0);
    expect(repeated.stdout, repeated.diagnostic()).toContain("Record migration already-current.");

    const runView = await candidate.run(["show", "--run", RUN_ID, "--json"]);
    expect(runView.exitCode, runView.diagnostic()).toBe(0);

    const member = only(
      runView.json<{ data: { members: readonly { locator: string; verdict: string }[] } }>().data.members,
      () => true,
      runView.diagnostic(),
    );
    expect(member.verdict).toBe("errored");
    const attemptView = await candidate.run(["show", member.locator, "--json"]);
    expect(attemptView.exitCode, attemptView.diagnostic()).toBe(0);
    const attemptDocument = attemptView.json<{
      data: {
        evidence: {
          entries: readonly {
            state: string;
            detail?: {
              verdict: string;
              entries: readonly {
                display: { label?: string };
                decision: {
                  result: string;
                  policy: {
                    requirement: unknown;
                    condition: unknown;
                  };
                };
              }[];
            };
          }[];
        };
      };
    }>();
    const evidence = only(
      attemptDocument.data.evidence.entries,
      (entry) => entry.state === "available" && entry.detail !== undefined,
      attemptView.diagnostic(),
    ).detail!;
    const shown = JSON.stringify(attemptDocument);
    expect(shown).toContain("historical assertion");
    expect(shown).toContain('"reason":"not-recorded"');
    expect(shown).toContain('"result":"matched"');
    expect(shown).not.toContain("recorded v1 fact");
    expect(shown).not.toContain("historical source that migration must discard");
    expect(shown).not.toContain('"answer":42');
    expect(evidence.verdict).toBe("errored");
    const requiredUnavailable = only(
      evidence.entries,
      (entry) => entry.display.label === "historical required unavailable",
      attemptView.diagnostic(),
    );
    expect(requiredUnavailable.decision).toMatchObject({
      result: "unavailable",
      policy: {
        requirement: { state: "available", value: "required" },
        condition: { state: "unavailable", reason: "not-recorded" },
      },
    });

  });
});
