// owner: docs/engineering/testing/e2e/migrate.md#npm-0130-to-current

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { attestLegacyProducer, commitRecord, e2e } from "./support.ts";

test("Git 保存的 npm 0.13.0 Record 可由 current 逐次迁移并继续往返追加", async () => {
  await e2e.case(
    "observability-v1-auto-migrate",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths, commands: { candidate, legacyProducer }, run }) => {
      attestLegacyProducer(paths.projectRoot);

      const configPath = join(paths.projectRoot, "niceeval.config.ts");
      const currentConfig = readFileSync(configPath, "utf8");
      const hiddenDefinitions = [
        "evals/handoff.eval.ts",
        "experiments/handoff.ts",
        "experiments/missing-usage.ts",
      ].map((relativePath) => [
        join(paths.projectRoot, relativePath),
        join(paths.projectRoot, `${relativePath}.current-disabled`),
      ] as const);
      const legacyDefinitions = [
        "evals/legacy-handoff.eval.ts",
        "experiments/legacy-handoff.ts",
      ].map((relativePath) => [
        join(paths.projectRoot, `${relativePath}.legacy-disabled`),
        join(paths.projectRoot, relativePath),
      ] as const);
      const runLegacyExperiment = async () => {
        try {
          for (const [source, hidden] of hiddenDefinitions) renameSync(source, hidden);
          for (const [disabled, active] of legacyDefinitions) renameSync(disabled, active);
          writeFileSync(configPath, [
            'import { defineConfig } from "niceeval-legacy-0-13";',
            "export default defineConfig({",
            '  name: "e2e: persisted legacy Record",',
            "  timeoutMs: 60_000,",
            "  maxConcurrency: 1,",
            "});",
            "",
          ].join("\n"));
          return await legacyProducer.run(["exp", "legacy-handoff", "--rerun", "all", "--json"]);
        } finally {
          writeFileSync(configPath, currentConfig);
          for (const [disabled, active] of legacyDefinitions.toReversed()) renameSync(active, disabled);
          for (const [source, hidden] of hiddenDefinitions.toReversed()) renameSync(hidden, source);
        }
      };
      const produced = await runLegacyExperiment();
      expect(produced.exitCode, produced.diagnostic()).toBe(0);
      const receipt = produced.expReceipt();
      expect(receipt.completion, produced.diagnostic()).toBe("completed");
      expect(receipt.runIds, produced.diagnostic()).toHaveLength(1);
      const runId = receipt.runIds[0]!;
      expect(produced.stdout, produced.diagnostic()).toContain('"evalId":"legacy-handoff"');
      expect(produced.stdout, produced.diagnostic()).toContain('"verdict":"passed"');

      const unsaved = await candidate.run(["show", "--run", runId, "--json"]);
      expect(unsaved.exitCode, unsaved.diagnostic()).toBe(1);
      expect(unsaved.stderr, unsaved.diagnostic()).toContain("record-auto-migration-git-save-required");
      expect(unsaved.stderr, unsaved.diagnostic()).toContain("git add");
      expect(unsaved.stdout, unsaved.diagnostic()).not.toContain('"selection"');

      await commitRecord(run, "record: save npm 0.13.0 run");

      const shown = await candidate.run(["show", "--run", runId, "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stderr, shown.diagnostic()).toContain("Record automatically migrated");
      expect(shown.stderr, shown.diagnostic()).toContain("restore commit");
      expect(shown.stderr, shown.diagnostic()).toContain("Dropped facts: criterion, subject, evidence");
      expect(shown.stderr, shown.diagnostic()).toContain("Rerun the affected evaluation");
      const output = shown.json<{
        selection: { runIds: readonly string[] };
        data: {
          kind: "run-membership";
          members: readonly [{ eval: string; locator: string; verdict: string }];
        };
      }>();
      expect(output.selection.runIds).toEqual([runId]);
      expect(output.data.kind).toBe("run-membership");
      expect(output.data.members).toEqual([
        expect.objectContaining({ eval: "legacy-handoff", locator: expect.stringMatching(/^@/), verdict: "passed" }),
      ]);

      const attempt = await candidate.run(["show", output.data.members[0].locator, "--json"]);
      expect(attempt.exitCode, attempt.diagnostic()).toBe(0);
      const attemptJson = attempt.json<{
        data: {
          evidence: {
            entries: readonly {
              state: string;
              detail?: {
                entries: readonly {
                  display: { label?: string };
                  source: unknown;
                  explanation: unknown;
                  decision: { result: string };
                }[];
              };
            }[];
          };
        };
      }>();
      const migratedEntries = attemptJson.data.evidence.entries
        .flatMap((entry) => entry.detail?.entries ?? []);
      expect(migratedEntries.map((entry) => entry.display.label)).toEqual([
        "legacy turn succeeded",
        "legacy includes match",
        "legacy excludes match",
        "legacy called tool",
        "legacy not-called tool",
      ]);
      expect(migratedEntries.map((entry) => entry.decision.result)).toEqual([
        "matched", "matched", "matched", "matched", "matched",
      ]);
      const migratedAssertionsText = JSON.stringify(migratedEntries);
      expect(migratedAssertionsText).not.toContain("persisted-handoff:handoff-input");
      expect(migratedAssertionsText).not.toContain("legacy_lookup");
      expect(migratedAssertionsText).not.toContain("forbidden_tool");
      expect(migratedAssertionsText).toContain('"reason":"not-recorded"');

      const appended = await runLegacyExperiment();
      expect(appended.exitCode, appended.diagnostic()).toBe(0);
      const appendedReceipt = appended.expReceipt();
      expect(appendedReceipt.completion, appended.diagnostic()).toBe("completed");
      expect(appendedReceipt.runIds, appended.diagnostic()).toHaveLength(1);
      const appendedRunId = appendedReceipt.runIds[0]!;
      expect(appendedRunId).not.toBe(runId);
      await commitRecord(run, "record: save second npm 0.13.0 run");

      const appendedShown = await candidate.run(["show", "--run", appendedRunId, "--json"]);
      expect(appendedShown.exitCode, appendedShown.diagnostic()).toBe(0);
      expect(appendedShown.stderr, appendedShown.diagnostic()).toContain("Record automatically migrated");
      expect(appendedShown.json<{ selection: { runIds: readonly string[] } }>().selection.runIds)
        .toEqual([appendedRunId]);

      const stillShown = await candidate.run(["show", "--run", runId, "--json"]);
      expect(stillShown.exitCode, stillShown.diagnostic()).toBe(0);
      expect(stillShown.stderr, stillShown.diagnostic()).not.toContain("Record automatically migrated");
      expect(stillShown.json<{ selection: { runIds: readonly string[] } }>().selection.runIds).toEqual([runId]);
    },
  );
});
