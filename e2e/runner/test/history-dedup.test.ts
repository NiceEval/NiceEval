// owner: docs/engineering/testing/e2e/runner.md#runner-history-dedup
// rerun: pnpm e2e --repo runner -- --run test/history-dedup.test.ts
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

interface ExpEvent {
  event: string;
  total?: number;
  reused?: number;
  locator?: string;
  evalId?: string;
  verdict?: string;
  attempts?: number;
  passed?: number;
}

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

test("强制重跑追加 identity，carry run 不在 history 复制旧 attempt", async () => {
  await runnerE2E.case(
    "history-dedup",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const root = paths.projectRoot;
    const first = await niceeval.run(["exp", "history", "--rerun", "all", "--json"]);
    expect(first.exitCode, first.diagnostic()).toBe(0);
    const firstEval = only(first.ndjson<ExpEvent>(), (event) => event.event === "eval", first.diagnostic());
    expect(firstEval).toMatchObject({
      event: "eval",
      evalId: "suite/stable",
      verdict: "passed",
      attempts: 1,
      passed: 1,
    });
    const firstLocator = firstEval.locator!;
    expect(firstLocator).toMatch(/^@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const forced = await niceeval.run(["exp", "history", "--rerun", "all", "--json"]);
    expect(forced.exitCode, forced.diagnostic()).toBe(0);
    const forcedEval = only(forced.ndjson<ExpEvent>(), (event) => event.event === "eval", forced.diagnostic());
    expect(forcedEval).toMatchObject({
      event: "eval",
      evalId: "suite/stable",
      verdict: "passed",
      attempts: 1,
      passed: 1,
    });
    const forcedLocator = forcedEval.locator!;
    expect(forcedLocator).not.toBe(firstLocator);

    const currentDry = await niceeval.run(["exp", "history", "--dry", "--json"]);
    expect(currentDry.exitCode, currentDry.diagnostic()).toBe(0);
    const currentPlan = currentDry.json<DryPlan>();
    expect(currentPlan).toMatchObject({ total: 1, reused: 1 });
    const currentTarget = currentPlan.matrix.find((row) => row.evalId === "suite/stable");
    expect(currentTarget).toBeDefined();
    expect(currentTarget!.slots.map((slot) => slot.state)).toEqual(["reused"]);
    expect(currentTarget!.readbacks).toHaveLength(1);
    expect(`@${currentTarget!.readbacks[0]!.source.attemptId}`).toBe(forcedLocator);
    expect(currentTarget!.readbacks[0]!.verdict).toBe("passed");

    const carried = await niceeval.run(["exp", "history", "--json"]);
    expect(carried.exitCode, carried.diagnostic()).toBe(0);
    const carriedEvents = carried.ndjson<ExpEvent>();
    const carriedStart = only(carriedEvents, (event) => event.event === "start", carried.diagnostic());
    expect(carriedStart).toMatchObject({ event: "start", total: 1, reused: 1 });
    const carriedReceipt = carried.expReceipt();
    expect(carriedReceipt).toMatchObject({ completion: "completed" });
    expect(carriedReceipt.runIds).toHaveLength(1);

    const current = await niceeval.run(["show", "--latest", "--json"]);
    expect(current.exitCode, current.diagnostic()).toBe(0);
    expect(current.stdout).toContain(carriedReceipt.runIds[0]!);
    const forcedEvidence = await niceeval.run(["show", forcedLocator, "--execution"]);
    expect(forcedEvidence.exitCode, forcedEvidence.diagnostic()).toBe(0);
    expect(forcedEvidence.stdout).toContain("runner-fixture-ok");
    },
  );
});