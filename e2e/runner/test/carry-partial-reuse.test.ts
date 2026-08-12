// owner: docs/engineering/testing/e2e/runner.md#runner-carry-partial-reuse
// rerun: pnpm e2e --repo runner -- --run test/carry-partial-reuse.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { only } from "@niceeval/testkit";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

interface DryTarget {
  experimentId: string;
  evalId: string;
  slots: Array<{ state: "reused" | "gap" }>;
  readbacks: Array<{
    source: { attemptId: string };
    verdict: string | { state: string; value?: string };
  }>;
}

interface DryPlan {
  total: number;
  reused: number;
  matrix: DryTarget[];
}

interface ExpEvent {
  event: string;
  reused?: number;
  total?: number;
  evalId?: string;
  verdict?: string;
  locator?: string;
}

test("改变一个 Eval 后只重新派发该 identity，未改变的 Eval 继续携带", async () => {
  await runnerE2E.case(
    "carry-partial-reuse",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const root = paths.projectRoot;
    const baseline = await niceeval.run(["exp", "carry", "--rerun", "all", "--json"]);
    expect(baseline.exitCode, baseline.diagnostic()).toBe(0);
    const baselineStart = only(baseline.ndjson<ExpEvent>(), (event) => event.event === "start", baseline.diagnostic());
    expect(baselineStart).toMatchObject({ event: "start", reused: 0 });
    const baselineEvents = baseline.ndjson<ExpEvent>();
    const baselineAlpha = only(
      baselineEvents,
      (event) => event.event === "eval" && event.evalId === "simple/alpha",
      baseline.diagnostic(),
    );
    const baselineBeta = only(
      baselineEvents,
      (event) => event.event === "eval" && event.evalId === "simple/beta",
      baseline.diagnostic(),
    );
    expect(baselineAlpha).toMatchObject({ event: "eval", verdict: "passed" });
    expect(baselineBeta).toMatchObject({ event: "eval", verdict: "passed" });
    const baselineAlphaLocator = baselineAlpha.locator!;
    const baselineBetaLocator = baselineBeta.locator!;
    expect(baselineAlphaLocator).toMatch(/^@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(baselineBetaLocator).toMatch(/^@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const alphaPath = join(root, "evals", "simple", "alpha.eval.ts");
    const alphaSource = readFileSync(alphaPath, "utf8");
    expect(alphaSource).toContain('description: "runner carry alpha"');
    writeFileSync(
      alphaPath,
      alphaSource.replace('description: "runner carry alpha"', 'description: "runner carry alpha changed"'),
      "utf8",
    );

    const changedOnly = await niceeval.run(["exp", "carry", "simple/alpha", "--dry", "--json"]);
    expect(changedOnly.exitCode, changedOnly.diagnostic()).toBe(0);
    const changedPlan = changedOnly.json<DryPlan>();
    expect(changedPlan).toMatchObject({ total: 1, reused: 0 });
    const changedAlpha = changedPlan.matrix.find((row) => row.evalId === "simple/alpha");
    expect(changedAlpha).toBeDefined();
    expect(changedAlpha!.slots.map((slot) => slot.state)).toEqual(["gap"]);
    expect(changedAlpha!.readbacks).toHaveLength(1);
    expect(`@${changedAlpha!.readbacks[0]!.source.attemptId}`).toBe(baselineAlphaLocator);
    expect(changedAlpha!.readbacks[0]!.verdict).toMatchObject({ state: "available", value: "passed" });

    const changedDispatch = await niceeval.run(["exp", "carry", "simple/alpha", "--json"]);
    expect(changedDispatch.exitCode, changedDispatch.diagnostic()).toBe(0);
    const changedDispatchStart = only(
      changedDispatch.ndjson<ExpEvent>(),
      (event) => event.event === "start",
      changedDispatch.diagnostic(),
    );
    expect(changedDispatchStart).toMatchObject({ event: "start", total: 1, reused: 0 });
    const changedAlphaResult = only(
      changedDispatch.ndjson<ExpEvent>(),
      (event) => event.event === "eval" && event.evalId === "simple/alpha",
      changedDispatch.diagnostic(),
    );
    expect(changedAlphaResult).toMatchObject({ event: "eval", verdict: "passed" });
    const changedAlphaLocator = changedAlphaResult.locator!;
    expect(changedAlphaLocator).toMatch(/^@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(changedAlphaLocator).not.toBe(baselineAlphaLocator);

    const fullDry = await niceeval.run(["exp", "carry", "--dry", "--json"]);
    expect(fullDry.exitCode, fullDry.diagnostic()).toBe(0);
    const fullPlan = fullDry.json<DryPlan>();
    expect(fullPlan).toMatchObject({ total: 2, reused: 2 });
    const carriedAlpha = fullPlan.matrix.find((row) => row.evalId === "simple/alpha");
    expect(carriedAlpha).toBeDefined();
    expect(carriedAlpha!.slots.map((slot) => slot.state)).toEqual(["reused"]);
    expect(carriedAlpha!.readbacks).toHaveLength(1);
    expect(`@${carriedAlpha!.readbacks[0]!.source.attemptId}`).toBe(changedAlphaLocator);
    expect(carriedAlpha!.readbacks[0]!.verdict).toBe("passed");
    const carriedBeta = fullPlan.matrix.find((row) => row.evalId === "simple/beta");
    expect(carriedBeta).toBeDefined();
    expect(carriedBeta!.slots.map((slot) => slot.state)).toEqual(["reused"]);
    expect(carriedBeta!.readbacks).toHaveLength(1);
    expect(`@${carriedBeta!.readbacks[0]!.source.attemptId}`).toBe(baselineBetaLocator);
    expect(carriedBeta!.readbacks[0]!.verdict).toBe("passed");

    const fullDispatch = await niceeval.run(["exp", "carry", "--json"]);
    expect(fullDispatch.exitCode, fullDispatch.diagnostic()).toBe(0);
    const fullDispatchEvents = fullDispatch.ndjson<ExpEvent>();
    const fullDispatchStart = only(fullDispatchEvents, (event) => event.event === "start", fullDispatch.diagnostic());
    expect(fullDispatchStart).toMatchObject({ event: "start", total: 2, reused: 2 });
    expect(fullDispatch.expReceipt()).toMatchObject({ completion: "completed" });
    },
  );
});