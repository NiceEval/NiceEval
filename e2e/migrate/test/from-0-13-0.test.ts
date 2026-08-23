// owner: docs/engineering/testing/e2e/migrate.md#npm-0130-beta-cutover

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { attestLegacyProducer, e2e } from "./support.ts";

test("npm 0.13.0 aggregate Record 被 current 明确拒绝且不转换 provenance", async () => {
  await e2e.case(
    "legacy-aggregate-cutover",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths, commands: { candidate, legacyProducer } }) => {
      attestLegacyProducer(paths.projectRoot);

      const configPath = join(paths.projectRoot, "niceeval.config.ts");
      const currentConfig = readFileSync(configPath, "utf8");
      const hiddenDefinitions = [
        "evals/handoff.eval.ts",
        "experiments/handoff.ts",
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

      let produced;
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
        produced = await legacyProducer.run(["exp", "legacy-handoff", "--rerun", "all", "--json"]);
      } finally {
        writeFileSync(configPath, currentConfig);
        for (const [disabled, active] of legacyDefinitions.toReversed()) renameSync(active, disabled);
        for (const [source, hidden] of hiddenDefinitions.toReversed()) renameSync(hidden, source);
      }

      expect(produced.exitCode, produced.diagnostic()).toBe(0);
      const receipt = produced.expReceipt();
      expect(receipt.completion, produced.diagnostic()).toBe("completed");
      expect(receipt.runIds, produced.diagnostic()).toHaveLength(1);
      expect(produced.stdout, produced.diagnostic()).toContain('"evalId":"legacy-handoff"');
      expect(produced.stdout, produced.diagnostic()).toContain('"verdict":"passed"');

      const migration = await candidate.run(["migrate"]);
      expect(migration.exitCode, migration.diagnostic()).toBe(1);
      expect(migration.stdout, migration.diagnostic()).toContain(
        "Record migration plan: unsupported-format\nformat: niceeval.record\n",
      );
      expect(migration.stderr, migration.diagnostic()).toContain("record-format-unsupported");
      expect(migration.stderr, migration.diagnostic()).toContain(
        "Install a NiceEval version that supports this Record format.",
      );
      expect(migration.stdout + migration.stderr, migration.diagnostic()).not.toContain("automatically migrated");

      const shown = await candidate.run(["show", "--run", receipt.runIds[0]!, "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(1);
      expect(shown.stderr, shown.diagnostic()).toContain("record-format-unsupported");
      expect(shown.stdout, shown.diagnostic()).not.toContain('"selection"');
    },
  );
});
