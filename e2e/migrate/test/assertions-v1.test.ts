// owner: docs/engineering/testing/e2e/migrate.md#assertions-v1-to-v2

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import {
  ATTEMPT_ID,
  commitRecord,
  copyAssertionsV1Fixture,
  e2e,
  RUN_ID,
} from "./support.ts";

test("Assertions v1 经统一 maintenance 改写为诚实的 current 语义记录", async () => {
  await e2e.case("assertions-v1-to-v2", async ({ paths, commands: { candidate }, run }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    const { discardedBlobPath } = copyAssertionsV1Fixture(paths.sourceRoot, recordRoot);
    const rootBefore = readFileSync(join(recordRoot, "record.json"), "utf8");
    await commitRecord(run, "fixture: assertions v1");

    const migrated = await candidate.run(["migrate", "--yes"]);
    expect(migrated.exitCode, migrated.diagnostic()).toBe(0);
    expect(migrated.stdout, migrated.diagnostic()).toContain("impact niceeval.assertions@1->2");
    expect(migrated.stdout, migrated.diagnostic()).toContain("dropped facts: criterion, subject, evidence");
    expect(migrated.stdout, migrated.diagnostic()).toContain("Rerun the affected evaluation");
    expect(readFileSync(join(recordRoot, "record.json"), "utf8")).toBe(rootBefore);
    expect(existsSync(discardedBlobPath)).toBe(false);

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

    const attachment = join(
      recordRoot,
      "runs", RUN_ID, "attempts", ATTEMPT_ID,
      "attachments", "niceeval.assertions",
    );
    expect(JSON.parse(readFileSync(join(attachment, "attachment.json"), "utf8"))).toEqual({
      family: "niceeval.assertions",
      schemaVersion: 2,
    });
    const payloadText = readFileSync(join(attachment, "payload.json"), "utf8");
    expect(payloadText).toContain('"materials"');
    expect(payloadText).toContain('"explanationRetention"');
    expect(payloadText).toContain('"source":{"kind":"unavailable","reason":"not-recorded"}');
    expect(payloadText).toContain('"evidence":[]');
    expect(payloadText).not.toContain('"subject"');
    expect(payloadText).not.toContain("historical-match");
    expect(payloadText).not.toContain("recorded v1 fact");
    expect(payloadText).not.toContain('"result":{"state"');
  });
});
