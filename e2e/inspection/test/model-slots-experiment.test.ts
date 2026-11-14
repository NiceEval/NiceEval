import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("按 Experiment 查看时三用途配置与推理强度各自可读", async () => {
  await inspectionE2E.case("model-roles-experiment", { artifacts: inspectionCaseArtifacts() }, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "model-roles", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const shown = await niceeval.run(["show", `exp:${"model-roles"}`]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    for (const value of ["model-roles", "planner", "reviewer", "unused", "fixture/shared", "fixture/unused", "high"]) expect(shown.stdout).toContain(value);
    expect(shown.stdout).toContain("0.375");
    expect(shown.stdout).toContain("USD");
  });
});
