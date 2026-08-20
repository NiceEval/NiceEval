// owner: docs/engineering/testing/e2e/migrate.md#assertions-v1-to-v2

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { commitRecord, copyV1Fixture, e2e, RUN_ID } from "./support.ts";

test("Assertions v1 经统一 maintenance 改写为诚实的 current 语义记录", async () => {
  await e2e.case("assertions-v1-to-v2", async ({ paths, commands: { candidate }, run }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    copyV1Fixture(paths.sourceRoot, recordRoot);
    await commitRecord(run, "fixture: assertions v1");

    const migrated = await candidate.run(["migrate", "--yes"]);
    expect(migrated.exitCode, migrated.diagnostic()).toBe(0);

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
    expect(shown).toContain("recorded v1 fact");
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
      "runs", RUN_ID, "attempts", "ae2047b7-d0ef-4f1d-8a2f-ae2b27e7b4ad",
      "attachments", "niceeval.assertions",
    );
    expect(JSON.parse(readFileSync(join(attachment, "attachment.json"), "utf8"))).toEqual({
      family: "niceeval.assertions",
      schemaVersion: 2,
    });
    const payloadText = readFileSync(join(attachment, "payload.json"), "utf8");
    expect(payloadText).toContain('"materials"');
    expect(payloadText).toContain('"explanationRetention"');
    expect(payloadText).not.toContain('"subject"');
    expect(payloadText).not.toContain('"result":{"state"');
  });
});
