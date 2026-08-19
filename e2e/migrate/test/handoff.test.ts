// owner: docs/engineering/testing/e2e/migrate.md#observability-v1-to-v2
// regression: memory/results-schema-version-history.md#observability-family-1--2

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createE2EContext } from "@niceeval/testkit";
import { expect, test } from "vitest";

const RUN_ID = "2ce48d15-5278-46f7-a512-7235a3362c24";
const ATTEMPT_ID = "ae2047b7-d0ef-4f1d-8a2f-ae2b27e7b4ad";
const installedNiceeval = [join(process.cwd(), "node_modules", ".bin", "niceeval")] as const;
const e2e = createE2EContext({
  repoId: "migrate",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-migrate-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { candidate: installedNiceeval },
});

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("Observability v1 Record 经过显式迁移后由当前 candidate 完整读取", async () => {
  await e2e.case(
    "observability-v1",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths, commands: { candidate }, run }) => {
      const recordRoot = join(paths.projectRoot, ".niceeval", "record");
      cpSync(join(paths.sourceRoot, "fixtures", "observability-v1-record"), recordRoot, {
        recursive: true,
      });

      const attemptAttachment = join(
        recordRoot,
        "runs",
        RUN_ID,
        "attempts",
        ATTEMPT_ID,
        "attachments",
        "niceeval.observability",
      );
      const runAttachment = join(
        recordRoot,
        "runs",
        RUN_ID,
        "attachments",
        "niceeval.observability",
      );
      const attemptPayloadBefore = sha256(join(attemptAttachment, "payload.json"));
      const runPayloadBefore = sha256(join(runAttachment, "payload.json"));
      const sourceNavigationAttachment = join(
        recordRoot,
        "runs",
        RUN_ID,
        "attempts",
        ATTEMPT_ID,
        "attachments",
        "niceeval.source-navigation",
      );
      const sourceNavigationBefore = sha256(join(sourceNavigationAttachment, "payload.json"));
      const unknownPath = join(recordRoot, "runs", RUN_ID, "attachments", "example.future", "opaque.txt");
      const unknownBefore = readFileSync(unknownPath, "utf8");
      const draftEnvelope = join(
        recordRoot,
        "runs",
        "draft-run",
        "attachments",
        "niceeval.observability",
        "attachment.json",
      );
      const draftBefore = readFileSync(draftEnvelope, "utf8");

      const blockedRead = await candidate.run(["show", "--run", RUN_ID, "--json"]);
      expect(blockedRead.exitCode, blockedRead.diagnostic()).toBe(0);
      expect(blockedRead.stdout, blockedRead.diagnostic()).toContain('"state":"migration-required"');
      expect(blockedRead.stdout, blockedRead.diagnostic()).not.toContain(
        '"domain":"source-navigation","state":"invalid"',
      );
      expect(blockedRead.stdout, blockedRead.diagnostic()).toContain(
        '"code":"analysis-migration-required"',
      );
      const blockedNavigation = await candidate.run([
        "show",
        "--run",
        RUN_ID,
        "--report",
        "./reports/source-navigation.tsx",
        "--page",
        "/source-navigation",
        "--json",
      ]);
      expect(blockedNavigation.exitCode, blockedNavigation.diagnostic()).toBe(0);
      expect(blockedNavigation.stdout, blockedNavigation.diagnostic()).toContain(
        "source-navigation:migration-required",
      );
      expect(blockedNavigation.stdout, blockedNavigation.diagnostic()).not.toContain(
        "source-navigation:invalid",
      );

      for (const args of [
        ["init", "-q"],
        ["config", "user.email", "e2e@niceeval.local"],
        ["config", "user.name", "NiceEval E2E"],
        ["add", "-f", ".niceeval/record"],
        ["commit", "-qm", "fixture: observability v1"],
      ] as const) {
        const git = await run(["git", ...args]);
        expect(git.exitCode, git.diagnostic()).toBe(0);
      }

      const confirmation = await candidate.run(["migrate"]);
      const restoreCommit = await run(["git", "rev-parse", "HEAD"]);
      expect(restoreCommit.exitCode, restoreCommit.diagnostic()).toBe(0);
      expect(confirmation.exitCode, confirmation.diagnostic()).toBe(1);
      expect(confirmation.stdout, confirmation.diagnostic()).toContain("attachments: 2");
      expect(confirmation.stdout, confirmation.diagnostic()).toContain("backup: git-restore-point");
      expect(confirmation.stdout, confirmation.diagnostic()).toContain(
        `restore commit: ${restoreCommit.stdout.trim()}`,
      );
      expect(confirmation.stderr, confirmation.diagnostic()).toContain(
        "record-migration-confirmation-required",
      );

      writeFileSync(join(recordRoot, "dirty-proof.txt"), "dirty\n");
      const dirty = await candidate.run(["migrate", "--yes"]);
      expect(dirty.exitCode, dirty.diagnostic()).toBe(1);
      expect(dirty.stderr, dirty.diagnostic()).toContain("record-migration-git-restore-required");
      rmSync(join(recordRoot, "dirty-proof.txt"));

      const migrated = await candidate.run(["migrate", "--yes"]);
      expect(migrated.exitCode, migrated.diagnostic()).toBe(0);
      expect(migrated.stdout, migrated.diagnostic()).toContain("Record migration migrated.");

      expect(JSON.parse(readFileSync(join(attemptAttachment, "attachment.json"), "utf8"))).toEqual({
        family: "niceeval.observability",
        schemaVersion: 2,
      });
      expect(JSON.parse(readFileSync(join(runAttachment, "attachment.json"), "utf8"))).toEqual({
        family: "niceeval.observability",
        schemaVersion: 2,
      });
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
      expect(
        shown.json<{ selection: { runIds: readonly string[] } }>().selection.runIds,
        shown.diagnostic(),
      ).toEqual([RUN_ID]);

      const idempotent = await candidate.run(["migrate", "--yes"]);
      expect(idempotent.exitCode, idempotent.diagnostic()).toBe(0);
      expect(idempotent.stdout, idempotent.diagnostic()).toContain("already-current");

      mkdirSync(join(recordRoot, "migration.in-progress"), { recursive: false });
      const interrupted = await candidate.run(["migrate", "--yes"]);
      expect(interrupted.exitCode, interrupted.diagnostic()).toBe(1);
      expect(interrupted.stderr, interrupted.diagnostic()).toContain("record-migration-interrupted");
      rmSync(join(recordRoot, "migration.in-progress"), { recursive: true });
    },
  );

  await e2e.case("invalid-sealed-core", async ({ paths, commands: { candidate }, run }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    cpSync(join(paths.sourceRoot, "fixtures", "observability-v1-record"), recordRoot, {
      recursive: true,
    });
    rmSync(join(
      recordRoot,
      "runs",
      RUN_ID,
      "members",
      "slot-0323498ddabf9c4811f59cf08612c5ce40dab60a267271cefdad41aae4add5a8.json",
    ));
    for (const args of [
      ["init", "-q"],
      ["config", "user.email", "e2e@niceeval.local"],
      ["config", "user.name", "NiceEval E2E"],
      ["add", "-f", ".niceeval/record"],
      ["commit", "-qm", "fixture: invalid sealed core"],
    ] as const) {
      const git = await run(["git", ...args]);
      expect(git.exitCode, git.diagnostic()).toBe(0);
    }

    const rejected = await candidate.run(["migrate", "--yes"]);
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("record-migration-invalid");
    expect(existsSync(join(recordRoot, "migration.in-progress"))).toBe(false);
    expect(JSON.parse(readFileSync(join(
      recordRoot,
      "runs",
      RUN_ID,
      "attachments",
      "niceeval.observability",
      "attachment.json",
    ), "utf8"))).toEqual({ family: "niceeval.observability", schemaVersion: 1 });
  });

  for (const [caseName, invalidLabel] of [
    ["main-session-alias", "session1/turn1"],
    ["session-overflow", "session999999999999999999999/turn1"],
    ["turn-overflow", "turn999999999999999999999"],
    ["leading-zero", "turn01"],
  ] as const) {
    await e2e.case(caseName, async ({ paths, commands: { candidate } }) => {
      const recordRoot = join(paths.projectRoot, ".niceeval", "record");
      cpSync(join(paths.sourceRoot, "fixtures", "observability-v1-record"), recordRoot, {
        recursive: true,
      });
      const attemptAttachment = join(
        recordRoot,
        "runs",
        RUN_ID,
        "attempts",
        ATTEMPT_ID,
        "attachments",
        "niceeval.observability",
      );
      const runAttachment = join(
        recordRoot,
        "runs",
        RUN_ID,
        "attachments",
        "niceeval.observability",
      );
      writeFileSync(
        join(attemptAttachment, "attachment.json"),
        '{"family":"niceeval.observability","schemaVersion":2}\n',
      );
      writeFileSync(
        join(runAttachment, "attachment.json"),
        '{"family":"niceeval.observability","schemaVersion":2}\n',
      );
      const payloadPath = join(attemptAttachment, "payload.json");
      const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as {
        "timing-data": { intervals: Array<{ phase: string; label: string }> };
      };
      const send = payload["timing-data"].intervals.find((interval) => interval.phase === "agent.send");
      expect(send).toBeDefined();
      send!.label = invalidLabel;
      writeFileSync(payloadPath, `${JSON.stringify(payload)}\n`);

      const shown = await candidate.run(["show", "--run", RUN_ID, "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout, shown.diagnostic()).toContain("niceeval.attempt-latency-ms is invalid");
      expect(shown.stdout, shown.diagnostic()).not.toContain('"state":"migration-required"');
    });
  }
});
