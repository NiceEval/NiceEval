// owner: docs/engineering/testing/e2e/runner.md#runner-generic-timing
// rerun: pnpm e2e test --repo runner -- --run test/timing.test.ts
import {
  assertExpEvalOutcomes,
  exactEval,
  only,
} from "@niceeval/testkit";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E, writeInspectionRequest } from "./context.ts";

const EXPECTED = [
  { experimentId: "timing", evalId: "timing/basic", verdict: "passed", attempts: 1, passed: 1 },
] as const;

test("通用 Runner timing 公开 setup、run 与 send 的完成关系", async () => {
  await runnerE2E.case(
    "generic-timing",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const run = await niceeval.run(["exp", "timing", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const receipt = run.expReceipt();
      expect(receipt.completion, run.diagnostic()).toBe("completed");
      const events = assertExpEvalOutcomes(run.expEvalEvents(), EXPECTED, () => run.diagnostic());
      const event = exactEval(events, EXPECTED[0], () => run.diagnostic());

      const snapshot = join(paths.projectRoot, "timing.record-snapshot.sqlite");
      const exported = await niceeval.run(["record", "snapshot", "--output", snapshot]);
      expect(exported.exitCode, exported.diagnostic()).toBe(0);
      const request = await writeInspectionRequest(paths.projectRoot, "timing-attempt-trace", {
        kind: "attempt.trace", locator: event.locator,
      });
      const queried = await niceeval.run(["query", "run", "--record", snapshot, "--request", request]);
      expect(queried.exitCode, queried.diagnostic()).toBe(0);
      const document = queried.json<{ readonly operation: string; readonly issues: readonly unknown[]; readonly trace: unknown }>();
      expect(document).toMatchObject({ operation: "attempt.trace", issues: [] });
      const intervals = runnerActivityIntervals(document.trace);
      const evalRun = only(intervals, (interval) => interval.phase === "eval.run" && interval.label === "eval.run", queried.diagnostic());
      const agentSetup = only(intervals, (interval) => interval.phase === "attempt.setup" && interval.label === "agent.setup", queried.diagnostic());
      const agentSend = only(intervals, (interval) => interval.phase === "agent.send" && interval.label === "turn1", queried.diagnostic());
      expect(evalRun).toMatchObject({ parentActivityId: null, outcome: "completed" });
      expect(agentSetup).toMatchObject({ parentActivityId: null, outcome: "completed" });
      expect(agentSend).toMatchObject({ parentActivityId: evalRun.activityId, outcome: "completed" });
      expect(agentSend.startOffsetMs).toBeGreaterThanOrEqual(evalRun.startOffsetMs);
      expect(agentSend.startOffsetMs + agentSend.durationMs).toBeLessThanOrEqual(
        evalRun.startOffsetMs + evalRun.durationMs,
      );
    },
  );
});

interface RunnerActivityInterval {
  readonly activityId: string;
  readonly phase: string;
  readonly label: string;
  readonly parentActivityId: string | null;
  readonly outcome: string;
  readonly startOffsetMs: number;
  readonly durationMs: number;
}

function runnerActivityIntervals(trace: unknown): readonly RunnerActivityInterval[] {
  if (typeof trace !== "object" || trace === null || Array.isArray(trace)) return [];
  const activities = (trace as Record<string, unknown>)["niceeval.runner-activities"];
  if (typeof activities !== "object" || activities === null || Array.isArray(activities)) return [];
  const value = (activities as Record<string, unknown>).value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const segments = (value as Record<string, unknown>)["segments-data"];
  if (!Array.isArray(segments)) return [];
  return segments.filter((interval): interval is RunnerActivityInterval => {
    if (typeof interval !== "object" || interval === null || Array.isArray(interval)) return false;
    const value = interval as Record<string, unknown>;
    return typeof value.activityId === "string" && typeof value.phase === "string" &&
      typeof value.label === "string" && typeof value.outcome === "string" &&
      (typeof value.parentActivityId === "string" || value.parentActivityId === null) &&
      typeof value.startOffsetMs === "number" && typeof value.durationMs === "number";
  });
}
