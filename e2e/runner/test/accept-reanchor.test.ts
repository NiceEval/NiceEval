// owner: docs/engineering/testing/e2e/runner.md#runner-accept-reanchor
// rerun: pnpm e2e --repo runner -- --run test/accept-reanchor.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface ExpPlanRow {
  experimentId: string;
  evalId: string;
  reused: boolean;
  prior?: Array<{
    locator: string;
    verdict: "passed" | "failed" | "errored" | "skipped";
    acceptance: "available" | "legacy-locator";
    evidenceState: string;
  }>;
  dispatch?: Array<{
    gate: string;
    attempts: number[];
    comparison?: {
      kind: string;
      deltas?: Array<{ selector: string; kind: string; from?: string; to?: string }>;
    };
  }>;
}

interface ExpPlanDocument {
  format: "niceeval.exp-plan";
  schemaVersion: number;
  total: number;
  reused: number;
  matrix: ExpPlanRow[];
}

interface ExpEvent {
  event: string;
  total?: number;
  reused?: number;
  locator?: string;
  experimentId?: string;
  evalId?: string;
  verdict?: string;
  attempts?: number;
  passed?: number;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-runner-accept-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("审阅变更后 accept 旧结果重锚可继续 carry，新结果保留 verdict/evidence 与 acceptedFrom 审计", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const initial = await niceeval.run(["exp", "accept", "--json"], { cwd: root });
    expect(initial.exitCode, initial.diagnostic()).toBe(0);
    const initialEvents = initial.ndjson<ExpEvent>();
    const initialStart = only(initialEvents, (event) => event.event === "start", initial.diagnostic());
    expect(initialStart).toMatchObject({ event: "start", total: 1, reused: 0 });
    const initialEval = only(initialEvents, (event) => event.event === "eval", initial.diagnostic());
    expect(initialEval).toMatchObject({
      event: "eval",
      experimentId: "accept",
      evalId: "accept/accept-target",
      verdict: "passed",
      attempts: 1,
      passed: 1,
    });
    expect(initial.expReceipt()).toMatchObject({ completion: "completed" });
    const oldLocator = initialEval.locator!;
    expect(oldLocator).toMatch(/^@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const evalPath = join(root, "evals", "accept", "accept-target.eval.ts");
    const evalSource = readFileSync(evalPath, "utf8");
    expect(evalSource).toContain('await t.send("accept")');
    writeFileSync(evalPath, evalSource.replace('await t.send("accept")', 'await t.send("accept after review")'), "utf8");

    const humanDry = await niceeval.run(["exp", "accept", "--dry"], { cwd: root });
    expect(humanDry.exitCode, humanDry.diagnostic()).toBe(0);
    expect(humanDry.stdout).toMatch(/previous-result passed/);
    expect(humanDry.stdout).toContain("source:evals/accept/accept-target.eval.ts changed");
    expect(humanDry.stdout).toContain(`  prior:  ${oldLocator} (passed · evidence available)`);
    expect(humanDry.stdout).toContain(`  accept: niceeval accept ${oldLocator}`);

    const jsonDry = await niceeval.run(["exp", "accept", "--dry", "--json"], { cwd: root });
    expect(jsonDry.exitCode, jsonDry.diagnostic()).toBe(0);
    const plan = jsonDry.json<ExpPlanDocument>();
    expect(plan).toMatchObject({ format: "niceeval.exp-plan", schemaVersion: 3, total: 1, reused: 0 });
    expect(plan.matrix).toHaveLength(1);
    expect(plan.matrix[0]).toMatchObject({
      experimentId: "accept",
      evalId: "accept/accept-target",
      reused: false,
      prior: [{ locator: oldLocator, verdict: "passed", acceptance: "available" }],
      dispatch: [{ gate: "fingerprint", attempts: [0] }],
    });
    expect(plan.matrix[0]!.dispatch![0]!.comparison).toMatchObject({
      kind: "changed",
      deltas: [{ selector: "source:evals/accept/accept-target.eval.ts", kind: "changed" }],
    });
    const delta = plan.matrix[0]!.dispatch![0]!.comparison!.deltas![0]!;
    expect(delta.from).toBeDefined();
    expect(delta.to).toBeDefined();

    const accepted = await niceeval.run(["accept", oldLocator], { cwd: root });
    expect(accepted.exitCode, accepted.diagnostic()).toBe(0);
    expect(accepted.stdout).toContain(`Accepted ${oldLocator}.`);
    const newLocatorMatch = accepted.stdout.match(/New result locator: (@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    expect(newLocatorMatch, accepted.diagnostic()).not.toBeNull();
    const newLocator = newLocatorMatch![1]!;
    expect(newLocator).not.toBe(oldLocator);

    const carriedDry = await niceeval.run(["exp", "accept", "--dry", "--json"], { cwd: root });
    expect(carriedDry.exitCode, carriedDry.diagnostic()).toBe(0);
    const carriedPlan = carriedDry.json<ExpPlanDocument>();
    expect(carriedPlan).toMatchObject({ format: "niceeval.exp-plan", schemaVersion: 3, total: 1, reused: 1 });
    expect(carriedPlan.matrix[0]).toMatchObject({
      experimentId: "accept",
      evalId: "accept/accept-target",
      reused: true,
    });
    expect(carriedPlan.matrix[0]!.dispatch).toBeUndefined();

    const rerun = await niceeval.run(["exp", "accept", "--json"], { cwd: root });
    expect(rerun.exitCode, rerun.diagnostic()).toBe(0);
    const rerunEvents = rerun.ndjson<ExpEvent>();
    const rerunStart = only(rerunEvents, (event) => event.event === "start", rerun.diagnostic());
    expect(rerunStart).toMatchObject({ event: "start", total: 1, reused: 1 });
    const rerunEval = only(rerunEvents, (event) => event.event === "eval", rerun.diagnostic());
    expect(rerunEval).toMatchObject({
      event: "eval",
      experimentId: "accept",
      evalId: "accept/accept-target",
      verdict: "passed",
      attempts: 1,
      passed: 1,
    });
    expect(rerun.expReceipt()).toMatchObject({ completion: "completed" });
  });
});
