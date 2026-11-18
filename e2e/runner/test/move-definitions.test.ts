import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @use-case docs/feature/experiments/use-case/move-files.md
test.concurrent("移动评估和实验文件后沿用同一次执行，修改判分后重跑", async () => {
  await runnerE2E.case("move-definitions", async ({ commands: { niceeval }, paths }) => {
    const evals = join(paths.projectRoot, "evals/simple");
    const experiments = join(paths.projectRoot, "experiments");
    const original = join(evals, "alpha.eval.ts");
    const source = readFileSync(original, "utf8");
    writeFileSync(join(evals, "expected.ts"), 'export const expected = "runner-fixture-ok";');
    writeFileSync(
      original,
      'import { expected } from "./expected.ts";\n' +
        source.replace('includes("runner-fixture-ok")', "includes(expected)"),
    );
    const select = ["exp", "--experiment", "carry", "simple/alpha"];
    const run = await niceeval.run([...select, "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const before = await niceeval.run([...select, "--dry", "--json"]);
    const baseline = decodeExpPlanDocument(before.json());
    expect(baseline.reused).toBe(1);
    const locator = baseline.matrix[0]!.readbacks[0]!.source.locator;

    mkdirSync(join(evals, "payments"));
    const moved = join(evals, "payments/refund.eval.ts");
    renameSync(original, moved);
    writeFileSync(
      moved,
      'export const id = "simple/alpha";\n' + readFileSync(moved, "utf8").replace("./expected.ts", "../expected.ts"),
    );
    mkdirSync(join(experiments, "archive"));
    const experiment = join(experiments, "archive/baseline.ts");
    renameSync(join(experiments, "carry.ts"), experiment);
    writeFileSync(
      experiment,
      'export const id = "carry";\n' + readFileSync(experiment, "utf8").replace("../agents/", "../../agents/"),
    );

    for (const selector of ["carry", "archive/"]) {
      const result = await niceeval.run(["exp", "--experiment", selector, "simple/alpha", "--dry", "--json"]);
      expect(result.exitCode, result.diagnostic()).toBe(0);
      const plan = decodeExpPlanDocument(result.json());
      expect(plan.reused).toBe(1);
      expect(plan.matrix[0]!.readbacks[0]!.source.locator).toBe(locator);
    }

    const movedExperiment = readFileSync(experiment, "utf8");
    writeFileSync(experiment, movedExperiment.replace("carry and partial rerun", "Refunds after the move"));
    const relabeled = await niceeval.run([...select, "--dry", "--json"]);
    expect(relabeled.exitCode, relabeled.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(relabeled.json()).matrix[0]!.readbacks[0]!.source.locator).toBe(locator);

    const copy = join(experiments, "archive/comparison.ts");
    writeFileSync(copy, movedExperiment.replace('id = "carry"', 'id = "comparison"'));
    const independent = await niceeval.run(["exp", "comparison", "simple/alpha", "--dry", "--json"]);
    expect(independent.exitCode, independent.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(independent.json()).reused).toBe(0);

    writeFileSync(join(evals, "expected.ts"), 'export const expected = "a different reply";');
    const edited = await niceeval.run([...select, "--dry", "--json"]);
    expect(edited.exitCode, edited.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(edited.json()).matrix[0]!.slots).toMatchObject([
      { state: "gap", reason: "identity-mismatch" },
    ]);

    writeFileSync(join(evals, "expected.ts"), 'export const expected = "runner-fixture-ok";');
    writeFileSync(moved, readFileSync(moved, "utf8").replace('t.send("alpha")', "t.send(import.meta.url)"));
    const visible = await niceeval.run([...select, "--json"]);
    expect(visible.exitCode, visible.diagnostic()).toBe(0);
    renameSync(moved, join(evals, "payments/location.eval.ts"));
    const relocated = await niceeval.run([...select, "--dry", "--json"]);
    expect(relocated.exitCode, relocated.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(relocated.json()).matrix[0]!.slots).toMatchObject([
      { state: "gap", reason: "identity-mismatch" },
    ]);
  });
});
