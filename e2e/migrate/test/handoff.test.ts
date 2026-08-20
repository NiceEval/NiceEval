// owner: docs/engineering/testing/e2e/migrate.md#observability-v1-to-v2

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { attestLegacyProducer, commitRecord, e2e } from "./support.ts";

test("Git 保存的 npm 0.13.0 Record 自动迁移后显示同一结果并拒绝旧 writer", async () => {
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
      const output = shown.json<{
        selection: { runIds: readonly string[] };
        data: {
          kind: "experiment-group";
          comparison:
            | {
                state: "comparable";
                rows: readonly [{ passRate: { state: string; value: number } }];
              }
            | { state: "non-comparable" };
        };
      }>();
      expect(output.selection.runIds).toEqual([runId]);
      expect(output.data.kind).toBe("experiment-group");
      expect(output.data.comparison.state).toBe("comparable");
      if (output.data.comparison.state !== "comparable") {
        throw new Error("the migrated single-Experiment run is not comparable");
      }
      expect(output.data.comparison.rows[0]?.passRate).toMatchObject({ state: "available", value: 1 });

      const beforeOldWriter = await run(["git", "diff", "--binary", "--", ".niceeval/record"]);
      expect(beforeOldWriter.exitCode, beforeOldWriter.diagnostic()).toBe(0);
      const beforeOldWriterStatus = await run([
        "git", "status", "--porcelain=v1", "--untracked-files=all", "--", ".niceeval/record",
      ]);
      expect(beforeOldWriterStatus.exitCode, beforeOldWriterStatus.diagnostic()).toBe(0);

      const oldWriterRejected = await runLegacyExperiment();
      expect(oldWriterRejected.exitCode, oldWriterRejected.diagnostic()).toBe(1);
      expect(oldWriterRejected.stderr, oldWriterRejected.diagnostic()).toContain("record-format-unsupported");
      expect(oldWriterRejected.stdout, oldWriterRejected.diagnostic()).not.toContain('"event":"run"');

      const afterOldWriter = await run(["git", "diff", "--binary", "--", ".niceeval/record"]);
      expect(afterOldWriter.exitCode, afterOldWriter.diagnostic()).toBe(0);
      expect(afterOldWriter.stdout).toBe(beforeOldWriter.stdout);
      const afterOldWriterStatus = await run([
        "git", "status", "--porcelain=v1", "--untracked-files=all", "--", ".niceeval/record",
      ]);
      expect(afterOldWriterStatus.exitCode, afterOldWriterStatus.diagnostic()).toBe(0);
      expect(afterOldWriterStatus.stdout).toBe(beforeOldWriterStatus.stdout);

      const stillShown = await candidate.run(["show", "--run", runId, "--json"]);
      expect(stillShown.exitCode, stillShown.diagnostic()).toBe(0);
      expect(stillShown.stderr, stillShown.diagnostic()).not.toContain("Record automatically migrated");
      expect(stillShown.json<{ selection: { runIds: readonly string[] } }>().selection.runIds).toEqual([runId]);
    },
  );
});
