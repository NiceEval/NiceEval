import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("按 Experiment 查看时三用途配置与推理强度各自可读", async () => {
  await inspectionE2E.case("model-slots-experiment", { artifacts: inspectionCaseArtifacts() }, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "model-slots", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const shown = await niceeval.run(["show", "--experiment", "model-slots"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    for (const value of ["model-slots", "planner", "reviewer", "unused", "fixture/shared", "fixture/unused", "high"]) expect(shown.stdout).toContain(value);
    expect(shown.stdout).toContain("0.375");
    expect(shown.stdout).toContain("USD");
  });
});
