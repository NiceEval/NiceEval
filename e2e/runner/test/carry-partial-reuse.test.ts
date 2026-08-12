// owner: docs/engineering/testing/e2e/runner.md#runner-carry-partial-reuse
// rerun: pnpm e2e --repo runner -- --run test/carry-partial-reuse.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface ExpPlanDocument {
  format: "niceeval.exp-plan";
  schemaVersion: number;
  total: number;
  reused: number;
  matrix: Array<{ experimentId: string; evalId: string; reused: boolean }>;
}

interface ExpEvent {
  event: string;
  reused?: number;
  total?: number;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-runner-carry-partial-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("改变一个 Eval 后只重新派发该 identity，未改变的 Eval 继续携带", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const baseline = await niceeval.run(["exp", "carry", "--rerun", "all", "--json"], { cwd: root });
    expect(baseline.exitCode, baseline.diagnostic()).toBe(0);
    const baselineStart = only(baseline.ndjson<ExpEvent>(), (event) => event.event === "start", baseline.diagnostic());
    expect(baselineStart).toMatchObject({ event: "start", reused: 0 });

    const alphaPath = join(root, "evals", "simple", "alpha.eval.ts");
    const alphaSource = readFileSync(alphaPath, "utf8");
    expect(alphaSource).toContain('description: "runner carry alpha"');
    writeFileSync(
      alphaPath,
      alphaSource.replace('description: "runner carry alpha"', 'description: "runner carry alpha changed"'),
      "utf8",
    );

    const changedOnly = await niceeval.run(["exp", "carry", "simple/alpha", "--dry", "--json"], { cwd: root });
    expect(changedOnly.exitCode, changedOnly.diagnostic()).toBe(0);
    const changedPlan = changedOnly.json<ExpPlanDocument>();
    expect(changedPlan).toMatchObject({ format: "niceeval.exp-plan", schemaVersion: 3, total: 1, reused: 0 });
    expect(changedPlan.matrix).toHaveLength(1);
    expect(changedPlan.matrix).toMatchObject([
      { experimentId: "carry", evalId: "simple/alpha", reused: false },
    ]);

    const changedDispatch = await niceeval.run(["exp", "carry", "simple/alpha", "--json"], { cwd: root });
    expect(changedDispatch.exitCode, changedDispatch.diagnostic()).toBe(0);
    const changedDispatchStart = only(
      changedDispatch.ndjson<ExpEvent>(),
      (event) => event.event === "start",
      changedDispatch.diagnostic(),
    );
    expect(changedDispatchStart).toMatchObject({ event: "start", total: 1, reused: 0 });

    const fullDry = await niceeval.run(["exp", "carry", "--dry", "--json"], { cwd: root });
    expect(fullDry.exitCode, fullDry.diagnostic()).toBe(0);
    const fullPlan = fullDry.json<ExpPlanDocument>();
    expect(fullPlan).toMatchObject({ format: "niceeval.exp-plan", schemaVersion: 3, total: 2, reused: 2 });
    expect(fullPlan.matrix).toEqual([
      { experimentId: "carry", evalId: "simple/alpha", reused: true },
      { experimentId: "carry", evalId: "simple/beta", reused: true },
    ]);

    const fullDispatch = await niceeval.run(["exp", "carry", "--json"], { cwd: root });
    expect(fullDispatch.exitCode, fullDispatch.diagnostic()).toBe(0);
    const fullDispatchEvents = fullDispatch.ndjson<ExpEvent>();
    const fullDispatchStart = only(fullDispatchEvents, (event) => event.event === "start", fullDispatch.diagnostic());
    expect(fullDispatchStart).toMatchObject({ event: "start", total: 2, reused: 2 });
    expect(fullDispatch.expReceipt()).toMatchObject({ completion: "completed" });
  });
});
