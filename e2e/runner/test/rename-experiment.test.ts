import { only } from "@niceeval/testkit";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { rename, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E, writeInspectionRequest } from "./context.ts";

// @concord-case necase_GW2Q0HTFQYKTXY3R
// @concord-owner docs/engineering/testing/e2e/runner.md#runner-rename-exact-source
// @concord-test-file e2e/runner/test/rename-experiment.test.ts
test.concurrent("删除旧实验后明确采用指定 Run，保留来源并持续沿用 [necase_GW2Q0HTFQYKTXY3R]", async () => {
  await runnerE2E.case("rename-exact-source", {}, async ({ commands: { niceeval }, paths }) => {
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
    const sourceQuery = await writeInspectionRequest(paths.projectRoot, "source", { kind: "run.overview", runId: sourceRunId });
    const sourceBefore = await niceeval.run(["query", "run", "--request", sourceQuery]);
    expect(sourceBefore.exitCode, sourceBefore.diagnostic()).toBe(0);
    const sourceFacts = sourceBefore.runOverview().runOverview;

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
    expect(only(carried.expEvents(), (event) => event.event === "start", carried.diagnostic())).toMatchObject({ reused: 1 });
    const afterCarry = await niceeval.run(["exp", "renamed", "--dry", "--json"]);
    expect(afterCarry.exitCode, afterCarry.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(afterCarry.json())).toMatchObject({ total: 1, reused: 1 });

    const carriedAgain = await niceeval.run(["exp", "renamed", "--json"]);
    expect(carriedAgain.exitCode, carriedAgain.diagnostic()).toBe(0);
    expect(only(carriedAgain.expEvents(), (event) => event.event === "start", carriedAgain.diagnostic())).toMatchObject({ reused: 1 });
    const existingQuery = await writeInspectionRequest(paths.projectRoot, "existing-target", { kind: "run.overview", runId: existingRunId });
    const existingHistory = await niceeval.run(["query", "run", "--request", existingQuery]);
    expect(existingHistory.exitCode, existingHistory.diagnostic()).toBe(0);
    expect(JSON.stringify(existingHistory.runOverview())).toContain(existingRunId);

    const sourceAfter = await niceeval.run(["query", "run", "--request", sourceQuery]);
    expect(sourceAfter.exitCode, sourceAfter.diagnostic()).toBe(0);
    expect(sourceAfter.runOverview().runOverview).toEqual(sourceFacts);

    const definition = await readFile(targetPath, "utf8");
    const listQuery = await writeInspectionRequest(paths.projectRoot, "runs", { kind: "runs.list" });
    const beforeRejected = await niceeval.run(["query", "run", "--request", listQuery]);
    expect(beforeRejected.exitCode, beforeRejected.diagnostic()).toBe(0);
    await writeFile(targetPath, definition.replace("defineExperiment({", "defineExperiment({ attempts: 2,"));
    const wider = await niceeval.run(["exp", "rename", "renamed", "--run", sourceRunId]);
    expect(wider.exitCode, wider.diagnostic()).not.toBe(0);
    expect(`${wider.stdout}${wider.stderr}`).toContain("rename-run-not-closed");
    await writeFile(targetPath, definition.replace("defineExperiment({", "defineExperiment({ flags: { changed: true },"));
    const changed = await niceeval.run(["exp", "rename", "renamed", "--run", sourceRunId]);
    expect(changed.exitCode, changed.diagnostic()).not.toBe(0);
    expect(`${changed.stdout}${changed.stderr}`).toContain("identity");
    const changedPlan = await niceeval.run(["exp", "renamed", "--dry", "--json"]);
    expect(changedPlan.exitCode, changedPlan.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(changedPlan.json())).toMatchObject({ total: 1, reused: 0 });
    const afterRejected = await niceeval.run(["query", "run", "--request", listQuery]);
    expect(afterRejected.exitCode, afterRejected.diagnostic()).toBe(0);
    expect(afterRejected.runsList().runs).toEqual(beforeRejected.runsList().runs);

    await writeFile(targetPath, definition);
    const deletedWitness = await niceeval.run(["run", "delete", adoptedRunId!, "--yes"]);
    expect(deletedWitness.exitCode, deletedWitness.diagnostic()).toBe(0);
    const unproven = await niceeval.run(["exp", "renamed", "--dry", "--json"]);
    expect(unproven.exitCode, unproven.diagnostic()).toBe(0);
    const unprovenPlan = decodeExpPlanDocument(unproven.json());
    expect(unprovenPlan).toMatchObject({ total: 1, reused: 0 });
    expect(JSON.stringify(unprovenPlan.matrix[0]!.slots)).toContain("adoption-unproven");

    const withHook = 'import { writeFile } from "node:fs/promises";\n' + definition.replace(
      "defineExperiment({",
      'defineExperiment({ setup: async () => { await writeFile("hook-ran.txt", "yes"); },',
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

  });
});
