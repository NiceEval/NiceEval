// owner: docs/engineering/testing/e2e/migrate.md#observability-v1-to-v2
// regression: memory/results-schema-version-history.md#observability-family-1--2

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ATTEMPT_ID, commitRecord, copyV1Fixture, e2e, RUN_ID, sha256 } from "./support.ts";

test("Observability v1 Record 经过显式迁移后由当前 candidate 完整读取", async () => {
  await e2e.case(
    "observability-v1",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths, commands: { candidate, producer }, run }) => {
      const recordRoot = join(paths.projectRoot, ".niceeval", "record");
      copyV1Fixture(paths.sourceRoot, recordRoot);
      const attemptAttachment = join(recordRoot, "runs", RUN_ID, "attempts", ATTEMPT_ID, "attachments", "niceeval.observability");
      const runAttachment = join(recordRoot, "runs", RUN_ID, "attachments", "niceeval.observability");
      const sourceNavigationAttachment = join(recordRoot, "runs", RUN_ID, "attempts", ATTEMPT_ID, "attachments", "niceeval.source-navigation");
      const attemptPayloadBefore = sha256(join(attemptAttachment, "payload.json"));
      const runPayloadBefore = sha256(join(runAttachment, "payload.json"));
      const sourceNavigationBefore = sha256(join(sourceNavigationAttachment, "payload.json"));
      const unknownPath = join(recordRoot, "runs", RUN_ID, "attachments", "example.future", "opaque.txt");
      const unknownBefore = readFileSync(unknownPath, "utf8");
      const draftEnvelope = join(recordRoot, "runs", "draft-run", "attachments", "niceeval.observability", "attachment.json");
      const draftBefore = readFileSync(draftEnvelope, "utf8");

      const blockedRead = await candidate.run(["show", "--run", RUN_ID, "--json"]);
      expect(blockedRead.exitCode, blockedRead.diagnostic()).toBe(0);
      expect(blockedRead.stdout, blockedRead.diagnostic()).toContain('"state":"migration-required"');
      expect(blockedRead.stdout, blockedRead.diagnostic()).toContain('"code":"analysis-migration-required"');
      expect(blockedRead.stdout, blockedRead.diagnostic()).not.toContain('"domain":"source-navigation","state":"invalid"');

      const blockedNavigation = await candidate.run(["show", "--run", RUN_ID, "--report", "./reports/source-navigation.tsx", "--page", "/source-navigation", "--json"]);
      expect(blockedNavigation.exitCode, blockedNavigation.diagnostic()).toBe(0);
      expect(blockedNavigation.stdout, blockedNavigation.diagnostic()).toContain("source-navigation:migration-required");

      const blockedCost = await candidate.run(["show", "--run", RUN_ID, "--report", "./reports/cost-state.tsx", "--page", "/cost-state"]);
      expect(blockedCost.exitCode, blockedCost.diagnostic()).toBe(0);
      expect(blockedCost.stdout, blockedCost.diagnostic()).toContain("cost:migration-required:0/1");
      expect(blockedCost.stdout, blockedCost.diagnostic()).toContain("cost projection requires migration — run niceeval migrate");

      const currentRun = await producer.run(["exp", "handoff", "--rerun", "all", "--json"]);
      expect(currentRun.exitCode, currentRun.diagnostic()).toBe(0);
      const currentRunId = currentRun.expReceipt().runIds[0]!;
      const mixedCost = await candidate.run(["show", "--run", RUN_ID, "--run", currentRunId, "--report", "./reports/cost-state.tsx", "--page", "/cost-state"]);
      expect(mixedCost.exitCode, mixedCost.diagnostic()).toBe(0);
      expect(mixedCost.stdout, mixedCost.diagnostic()).toContain("cost:partial:1/2");

      const currentAttemptId = readdirSync(join(recordRoot, "runs", currentRunId, "attempts"))[0]!;
      const currentObservability = join(
        recordRoot,
        "runs",
        currentRunId,
        "attempts",
        currentAttemptId,
        "attachments",
        "niceeval.observability",
        "payload.json",
      );
      const currentPayload = JSON.parse(readFileSync(currentObservability, "utf8")) as {
        "usage-data": { observations: unknown[] };
      };
      currentPayload["usage-data"].observations = [];
      writeFileSync(currentObservability, JSON.stringify(currentPayload));
      const mixedMissing = await candidate.run([
        "show",
        "--run",
        RUN_ID,
        "--run",
        currentRunId,
        "--report",
        "./reports/tokens-state.tsx",
        "--page",
        "/tokens-state",
      ]);
      expect(mixedMissing.exitCode, mixedMissing.diagnostic()).toBe(0);
      expect(mixedMissing.stdout, mixedMissing.diagnostic()).toContain("tokens:partial:0/2");
      expect(mixedMissing.stdout, mixedMissing.diagnostic()).not.toContain("requires migration");

      await commitRecord(run, "fixture: observability v1");
      const confirmation = await candidate.run(["migrate"]);
      const restoreCommit = await run(["git", "rev-parse", "HEAD"]);
      expect(restoreCommit.exitCode, restoreCommit.diagnostic()).toBe(0);
      expect(confirmation.exitCode, confirmation.diagnostic()).toBe(1);
      expect(confirmation.stdout, confirmation.diagnostic()).toContain("attachments: 2");
      expect(confirmation.stdout, confirmation.diagnostic()).toContain("backup: git-restore-point");
      expect(confirmation.stderr, confirmation.diagnostic()).toContain("record-migration-confirmation-required");

      const migrated = await candidate.run(["migrate", "--yes"]);
      expect(migrated.exitCode, migrated.diagnostic()).toBe(0);
      expect(migrated.stdout, migrated.diagnostic()).toContain("Record migration migrated.");
      expect(JSON.parse(readFileSync(join(attemptAttachment, "attachment.json"), "utf8"))).toEqual({ family: "niceeval.observability", schemaVersion: 2 });
      expect(JSON.parse(readFileSync(join(runAttachment, "attachment.json"), "utf8"))).toEqual({ family: "niceeval.observability", schemaVersion: 2 });
      expect(sha256(join(attemptAttachment, "payload.json"))).toBe(attemptPayloadBefore);
      expect(sha256(join(runAttachment, "payload.json"))).toBe(runPayloadBefore);
      expect(sha256(join(sourceNavigationAttachment, "payload.json"))).toBe(sourceNavigationBefore);
      expect(readFileSync(unknownPath, "utf8")).toBe(unknownBefore);
      expect(readFileSync(draftEnvelope, "utf8")).toBe(draftBefore);

      const changed = await run(["git", "diff", "--name-only"]);
      expect(changed.exitCode, changed.diagnostic()).toBe(0);
      expect(changed.stdout.trim().split("\n").sort()).toEqual([
        `.niceeval/record/runs/${RUN_ID}/attachments/niceeval.observability/attachment.json`,
        `.niceeval/record/runs/${RUN_ID}/attempts/${ATTEMPT_ID}/attachments/niceeval.observability/attachment.json`,
      ].sort());
      const shown = await candidate.run(["show", "--run", RUN_ID, "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.json<{ selection: { runIds: readonly string[] } }>().selection.runIds).toEqual([RUN_ID]);
      const idempotent = await candidate.run(["migrate", "--yes"]);
      expect(idempotent.exitCode, idempotent.diagnostic()).toBe(0);
      expect(idempotent.stdout, idempotent.diagnostic()).toContain("already-current");
    },
  );
});
