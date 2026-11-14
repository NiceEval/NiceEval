import { only } from "@niceeval/testkit";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { appendFile, rename, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @use-case docs/feature/experiments/use-case/cache-adopt-migrated-config.md

test.concurrent("删除旧实验后明确采用指定 Run，保留来源并持续沿用", async () => {
  await runnerE2E.case(
    "rename-exact-source",
    {
      artifacts: [
        { source: "unproven-plan.json", target: "unproven-plan.json", optional: true },
        { source: "human-output.txt", target: "human-output.txt", optional: true },
      ],
    },
    async ({ commands: { niceeval }, paths }) => {
      const first = await niceeval.run(["exp", "history", "--rerun", "all", "--json"]);
      expect(first.exitCode, first.diagnostic()).toBe(0);
      const sourceRunId = only(first.expReceipt().createdRunIds, () => true, first.diagnostic());
      const sourceLocator = only(first.expEvalEvents(), () => true, first.diagnostic()).locator!;
      const later = await niceeval.run(["exp", "history", "--rerun", "all", "--json"]);
      expect(later.exitCode, later.diagnostic()).toBe(0);
      const laterLocator = only(later.expEvalEvents(), () => true, later.diagnostic()).locator!;
      expect(laterLocator).not.toBe(sourceLocator);

      const targetPath = join(paths.projectRoot, "experiments", "renamed.ts");
      await rename(join(paths.projectRoot, "experiments", "history.ts"), targetPath);

      const sourceBefore = await niceeval.run(["show", `run:${sourceRunId}`, "--json"]);
      expect(sourceBefore.exitCode, sourceBefore.diagnostic()).toBe(0);
      const sourceFacts = sourceBefore.run().run;

      const preview = await niceeval.run(["exp", "rename", "renamed", "--run", sourceRunId, "--dry"]);
      expect(preview.exitCode, preview.diagnostic()).toBe(0);
      expect(preview.stdout).toContain(sourceRunId);
      expect(preview.stdout).toContain(sourceLocator);
      expect(preview.stdout).not.toContain(laterLocator);
      const unadopted = await niceeval.run(["exp", "renamed", "--dry", "--json"]);
      expect(unadopted.exitCode, unadopted.diagnostic()).toBe(0);
      expect(decodeExpPlanDocument(unadopted.json())).toMatchObject({ total: 1, reused: 0 });

      const existing = await niceeval.run(["exp", "renamed", "--rerun", "all", "--json"]);
      expect(existing.exitCode, existing.diagnostic()).toBe(0);
      const existingRunId = only(existing.expReceipt().createdRunIds, () => true, existing.diagnostic());

      const adopted = await niceeval.run(["exp", "rename", "renamed", "--run", sourceRunId]);
      expect(adopted.exitCode, adopted.diagnostic()).toBe(0);
      expect(adopted.stdout).toContain(sourceLocator);
      const adoptedRunId = adopted.stdout.match(/Accepted into new Run ([0-9a-f-]{36})\./)?.[1];
      expect(adoptedRunId, adopted.diagnostic()).toBeDefined();
      const next = await niceeval.run(["exp", "renamed", "--dry", "--json"]);
      expect(next.exitCode, next.diagnostic()).toBe(0);
      const nextPlan = decodeExpPlanDocument(next.json());
      expect(nextPlan).toMatchObject({ total: 1, reused: 1 });
      expect(nextPlan.matrix[0]!.readbacks[0]!.source.locator).toBe(sourceLocator);
      const carried = await niceeval.run(["exp", "renamed", "--json"]);
      expect(carried.exitCode, carried.diagnostic()).toBe(0);
      expect(only(carried.expEvents(), (event) => event.event === "start", carried.diagnostic())).toMatchObject({
        reused: 1,
      });
      const afterCarry = await niceeval.run(["exp", "renamed", "--dry", "--json"]);
      expect(afterCarry.exitCode, afterCarry.diagnostic()).toBe(0);
      expect(decodeExpPlanDocument(afterCarry.json())).toMatchObject({ total: 1, reused: 1 });

      const carriedAgain = await niceeval.run(["exp", "renamed", "--json"]);
      expect(carriedAgain.exitCode, carriedAgain.diagnostic()).toBe(0);
      expect(
        only(carriedAgain.expEvents(), (event) => event.event === "start", carriedAgain.diagnostic()),
      ).toMatchObject({ reused: 1 });

      const existingHistory = await niceeval.run(["show", `run:${existingRunId}`, "--json"]);
      expect(existingHistory.exitCode, existingHistory.diagnostic()).toBe(0);
      expect(JSON.stringify(existingHistory.run())).toContain(existingRunId);

      const sourceAfter = await niceeval.run(["show", `run:${sourceRunId}`, "--json"]);
      expect(sourceAfter.exitCode, sourceAfter.diagnostic()).toBe(0);
      expect(sourceAfter.run().run).toEqual(sourceFacts);

      const definition = await readFile(targetPath, "utf8");

      const beforeRejected = await niceeval.run(["show", "runs", "--json"]);
      expect(beforeRejected.exitCode, beforeRejected.diagnostic()).toBe(0);
      await writeFile(targetPath, definition.replace("defineExperiment({", "defineExperiment({ attempts: 2,"));
      const wider = await niceeval.run(["exp", "rename", "renamed", "--run", sourceRunId]);
      expect(wider.exitCode, wider.diagnostic()).not.toBe(0);
      expect(`${wider.stdout}${wider.stderr}`).toContain("rename-run-not-closed");
      await writeFile(
        targetPath,
        definition.replace("defineExperiment({", "defineExperiment({ flags: { changed: true },"),
      );
      const changed = await niceeval.run(["exp", "rename", "renamed", "--run", sourceRunId]);
      expect(changed.exitCode, changed.diagnostic()).not.toBe(0);
      expect(`${changed.stdout}${changed.stderr}`).toContain("identity");
      const changedPlan = await niceeval.run(["exp", "renamed", "--dry", "--json"]);
      expect(changedPlan.exitCode, changedPlan.diagnostic()).toBe(0);
      expect(decodeExpPlanDocument(changedPlan.json())).toMatchObject({ total: 1, reused: 0 });
      const afterRejected = await niceeval.run(["show", "runs", "--json"]);
      expect(afterRejected.exitCode, afterRejected.diagnostic()).toBe(0);
      expect(afterRejected.runsList().runs).toEqual(beforeRejected.runsList().runs);

      await writeFile(targetPath, definition);
      const deletedWitness = await niceeval.run(["run", "delete", adoptedRunId!, "--yes"]);
      expect(deletedWitness.exitCode, deletedWitness.diagnostic()).toBe(0);
      const unproven = await niceeval.run(["exp", "renamed", "--dry", "--json"]);
      expect(unproven.exitCode, unproven.diagnostic()).toBe(0);
      const unprovenPlan = decodeExpPlanDocument(unproven.json());
      await writeFile(join(paths.projectRoot, "unproven-plan.json"), unproven.stdout, "utf8");
      expect(unprovenPlan).toMatchObject({ total: 1, reused: 0 });
      expect(JSON.stringify(unprovenPlan.matrix[0]!.slots)).toContain("adoption-unproven");
      const unprovenComparison = unprovenPlan.matrix[0]!.slots[0]!.comparisons.find(
        (comparison) => comparison.recordedClaim === "execution-identity",
      );
      expect(unprovenComparison).toMatchObject({
        result: "mismatch",
        explanation: {
          kind: "changed",
          deltas: expect.arrayContaining([
            expect.objectContaining({
              selector: "plan:physical",
              kind: "changed",
              from: expect.stringContaining('"experimentId":"history"'),
              to: expect.stringContaining('"experimentId":"renamed"'),
            }),
          ]),
        },
      });
      // The intermediate carried Run has the current target identity. The
      // explanation must still reach the original Run, which predates the rename.
      expect(unprovenPlan.matrix[0]!.readbacks[0]!.source.origin.runId).toBe(sourceRunId);
      const humanUnproven = await niceeval.run(["exp", "renamed", "--dry"]);
      await appendFile(
        join(paths.projectRoot, "human-output.txt"),
        `\nexp --dry (adoption-unproven)\n${humanUnproven.stdout}`,
        "utf8",
      );
      expect(humanUnproven.exitCode, humanUnproven.diagnostic()).toBe(0);
      expect(humanUnproven.stdout).toContain("gap 0:adoption-unproven: plan:physical");
      expect(humanUnproven.stdout).not.toMatch(/"comparisons"|"explanation"|\n\s*[{[]/u);

      const current = await niceeval.run(["show", "--json"]);
      expect(current.exitCode, current.diagnostic()).toBe(0);
      const unprovenCurrent = current
        .inspectionSuccess("project.get")
        .project.plannedAttempts.find((slot) => slot.evalId === "suite/stable");
      expect(unprovenCurrent).toMatchObject({
        state: "gap",
        reason: "adoption-unproven",
        explanation: unprovenComparison!.explanation,
      });
      expect(unprovenCurrent).not.toHaveProperty("comparisons");
      if (unprovenCurrent!.state === "gap")
        expect(JSON.stringify(unprovenCurrent!.issues)).not.toContain("comparisons");

      const withHook =
        'import { writeFile } from "node:fs/promises";\n' +
        definition.replace(
          "defineExperiment({",
          'defineExperiment({ before: async () => { await writeFile("hook-ran.txt", "yes"); },',
        );
      await writeFile(targetPath, withHook);
      const hooked = await niceeval.run(["exp", "renamed", "--rerun", "all", "--json"]);
      expect(hooked.exitCode, hooked.diagnostic()).toBe(0);
      expect(await readFile(join(paths.projectRoot, "hook-ran.txt"), "utf8")).toBe("yes");
      const hookedRunId = only(hooked.expReceipt().createdRunIds, () => true, hooked.diagnostic());
      await writeFile(targetPath, definition);
      await rename(targetPath, join(paths.projectRoot, "experiments", "hook-free.ts"));
      const removedHook = await niceeval.run(["exp", "rename", "hook-free", "--run", hookedRunId]);
      expect(removedHook.exitCode, removedHook.diagnostic()).not.toBe(0);
      expect(`${removedHook.stdout}${removedHook.stderr}`).toContain("rename-behavior-unproven");
    },
  );
});
