// owner: docs/engineering/testing/e2e/runner.md#runner-carry-dry-dispatch
// rerun: pnpm e2e --repo runner -- --run test/carry-dry-dispatch.test.ts

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
  prefix: "niceeval-e2e-runner-carry-dry-dispatch-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("dry plan 与随后 dispatch 对同一 carry 基线报告一致的复用数量", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const baseline = await niceeval.run(["exp", "carry", "--rerun", "all", "--json"], { cwd: root });
    expect(baseline.exitCode, baseline.diagnostic()).toBe(0);
    const baselineStart = only(baseline.ndjson<ExpEvent>(), (event) => event.event === "start", baseline.diagnostic());
    expect(baselineStart).toMatchObject({ event: "start", reused: 0 });

    const dry = await niceeval.run(["exp", "carry", "--dry", "--json"], { cwd: root });
    expect(dry.exitCode, dry.diagnostic()).toBe(0);
    const plan = dry.json<ExpPlanDocument>();
    expect(plan).toMatchObject({ format: "niceeval.exp-plan", schemaVersion: 3, total: 2, reused: 2 });
    expect(plan.matrix).toEqual([
      { experimentId: "carry", evalId: "simple/alpha", reused: true },
      { experimentId: "carry", evalId: "simple/beta", reused: true },
    ]);

    const dispatched = await niceeval.run(["exp", "carry", "--json"], { cwd: root });
    expect(dispatched.exitCode, dispatched.diagnostic()).toBe(0);
    const dispatchedEvents = dispatched.ndjson<ExpEvent>();
    const dispatchedStart = only(dispatchedEvents, (event) => event.event === "start", dispatched.diagnostic());
    const dispatchedResult = only(dispatchedEvents, (event) => event.event === "result", dispatched.diagnostic());
    expect(dispatchedStart).toMatchObject({ event: "start", total: 2, reused: 2 });
    expect(dispatchedResult).toMatchObject({ event: "result", reused: 2 });
  });
});
