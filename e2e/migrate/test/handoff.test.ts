// owner: docs/engineering/testing/e2e/migrate.md#observability-v1-to-v2
// regression: memory/results-schema-version-history.md#observability-family-1--2

import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  commands: { candidate: installedNiceeval, producer: installedNiceeval },
});

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("Observability v1 Record 经过显式迁移后由当前 candidate 完整读取", async () => {
  await e2e.case(
    "observability-v1",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths, commands: { candidate, producer }, run }) => {
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
      const blockedCost = await candidate.run([
        "show",
        "--run",
        RUN_ID,
        "--report",
        "./reports/cost-state.tsx",
        "--page",
        "/cost-state",
      ]);
      expect(blockedCost.exitCode, blockedCost.diagnostic()).toBe(0);
      expect(blockedCost.stdout, blockedCost.diagnostic()).toContain("cost:migration-required:0/1");

      const currentRun = await producer.run(["exp", "handoff", "--rerun", "all", "--json"]);
      expect(currentRun.exitCode, currentRun.diagnostic()).toBe(0);
      const currentRunId = currentRun.expReceipt().runIds[0]!;
      const mixedCost = await candidate.run([
        "show",
        "--run",
        RUN_ID,
        "--run",
        currentRunId,
        "--report",
        "./reports/cost-state.tsx",
        "--page",
        "/cost-state",
      ]);
      expect(mixedCost.exitCode, mixedCost.diagnostic()).toBe(0);
      expect(mixedCost.stdout, mixedCost.diagnostic()).toContain("cost:partial:1/2");

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

      writeFileSync(
        join(recordRoot, "migration.in-progress"),
        `${JSON.stringify({ restoreCommit: restoreCommit.stdout.trim() })}\n`,
      );
      const interrupted = await candidate.run(["migrate", "--yes"]);
      expect(interrupted.exitCode, interrupted.diagnostic()).toBe(1);
      expect(interrupted.stderr, interrupted.diagnostic()).toContain("record-migration-interrupted");
      expect(interrupted.stderr, interrupted.diagnostic()).toContain(
        `git -C '${recordRoot}' restore --source='${restoreCommit.stdout.trim()}' --staged --worktree -- .`,
      );
      const restored = await run([
        "git",
        "-C",
        recordRoot,
        "restore",
        `--source=${restoreCommit.stdout.trim()}`,
        "--staged",
        "--worktree",
        "--",
        ".",
      ]);
      expect(restored.exitCode, restored.diagnostic()).toBe(0);
      const verifiedWorktree = await run([
        "git", "-C", recordRoot, "diff", "--quiet", restoreCommit.stdout.trim(), "--", ".",
      ]);
      expect(verifiedWorktree.exitCode, verifiedWorktree.diagnostic()).toBe(0);
      const verifiedIndex = await run([
        "git", "-C", recordRoot, "diff", "--cached", "--quiet", restoreCommit.stdout.trim(), "--", ".",
      ]);
      expect(verifiedIndex.exitCode, verifiedIndex.diagnostic()).toBe(0);
      rmSync(join(recordRoot, "migration.in-progress"));
      const retried = await candidate.run(["migrate", "--yes"]);
      expect(retried.exitCode, retried.diagnostic()).toBe(0);
      expect(retried.stdout, retried.diagnostic()).toContain("Record migration migrated.");
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

  await e2e.case("invalid-cross-family-join", async ({ paths, commands: { candidate }, run }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    cpSync(join(paths.sourceRoot, "fixtures", "observability-v1-record"), recordRoot, {
      recursive: true,
    });
    const navigationPath = join(
      recordRoot,
      "runs",
      RUN_ID,
      "attempts",
      ATTEMPT_ID,
      "attachments",
      "niceeval.source-navigation",
      "payload.json",
    );
    const navigation = JSON.parse(readFileSync(navigationPath, "utf8")) as {
      "rows-data": Array<{ turnId: string }>;
    };
    navigation["rows-data"][0]!.turnId = "turn_00000000000000000000000000";
    writeFileSync(navigationPath, `${JSON.stringify(navigation)}\n`);
    for (const args of [
      ["init", "-q"],
      ["config", "user.email", "e2e@niceeval.local"],
      ["config", "user.name", "NiceEval E2E"],
      ["add", "-f", ".niceeval/record"],
      ["commit", "-qm", "fixture: invalid cross-family join"],
    ] as const) {
      const git = await run(["git", ...args]);
      expect(git.exitCode, git.diagnostic()).toBe(0);
    }

    const rejected = await candidate.run(["migrate", "--yes"]);
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("record-migration-invalid");
    expect(rejected.stderr, rejected.diagnostic()).toContain("Restore command: git -C");
    expect(existsSync(join(recordRoot, "migration.in-progress"))).toBe(true);
  });

  await e2e.case("future-known-family", async ({ paths, commands: { candidate } }) => {
    const recordRoot = join(paths.projectRoot, ".niceeval", "record");
    cpSync(join(paths.sourceRoot, "fixtures", "observability-v1-record"), recordRoot, {
      recursive: true,
    });
    writeFileSync(
      join(
        recordRoot,
        "runs",
        RUN_ID,
        "attempts",
        ATTEMPT_ID,
        "attachments",
        "niceeval.observability",
        "attachment.json",
      ),
      '{"family":"niceeval.observability","schemaVersion":3}\n',
    );

    const rejected = await candidate.run(["migrate", "--yes"]);
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("record-format-unsupported");
    expect(rejected.stderr, rejected.diagnostic()).toContain(
      "Install a NiceEval version that supports this Record format.",
    );
    expect(rejected.stderr, rejected.diagnostic()).not.toContain("record-migration-invalid");
    expect(existsSync(join(recordRoot, "migration.in-progress"))).toBe(false);
  });

  for (const [caseName, historicalLabel] of [
    ["historical-leading-zero-label", "turn01"],
    ["historical-large-integer-label", "turn999999999999999999999"],
  ] as const) {
    await e2e.case(caseName, async ({ paths, commands: { candidate }, run }) => {
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
      const payloadPath = join(attemptAttachment, "payload.json");
      const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as {
        "timing-data": { intervals: Array<{ phase: string; label: string }> };
      };
      const send = payload["timing-data"].intervals.find((interval) => interval.phase === "agent.send");
      expect(send).toBeDefined();
      send!.label = historicalLabel;
      writeFileSync(payloadPath, `${JSON.stringify(payload)}\n`);
      const payloadBefore = sha256(payloadPath);

      for (const args of [
        ["init", "-q"],
        ["config", "user.email", "e2e@niceeval.local"],
        ["config", "user.name", "NiceEval E2E"],
        ["add", "-f", ".niceeval/record"],
        ["commit", "-qm", `fixture: ${caseName}`],
      ] as const) {
        const git = await run(["git", ...args]);
        expect(git.exitCode, git.diagnostic()).toBe(0);
      }

      const migrated = await candidate.run(["migrate", "--yes"]);
      expect(migrated.exitCode, migrated.diagnostic()).toBe(0);
      expect(sha256(payloadPath)).toBe(payloadBefore);
      expect(JSON.parse(readFileSync(payloadPath, "utf8"))["timing-data"].intervals).toContainEqual(
        expect.objectContaining({ phase: "agent.send", label: historicalLabel }),
      );
      expect(JSON.parse(readFileSync(join(runAttachment, "attachment.json"), "utf8"))).toEqual({
        family: "niceeval.observability",
        schemaVersion: 2,
      });
    });
  }
});
