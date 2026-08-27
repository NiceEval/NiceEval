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

interface RunnerActivityInterval {
  readonly activityId: string;
  readonly phase: string;
  readonly label: string;
  readonly parentActivityId: string | null;
  readonly outcome: string;
  readonly startOffsetMs: number;
  readonly durationMs: number;
}

interface TimingTraceDocument {
  readonly operation: "attempt.trace";
  readonly issues: readonly unknown[];
  readonly trace: {
    readonly format: "niceeval.inspection.trace/v1";
    readonly timing: {
      readonly state: "complete" | "partial" | "not-recorded" | "invalid";
      readonly activities: readonly RunnerActivityInterval[];
    };
  };
}

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
      const document = queried.json<TimingTraceDocument>();
      expect(document).toMatchObject({
        operation: "attempt.trace",
        issues: [],
        trace: {
          format: "niceeval.inspection.trace/v1",
          timing: { state: "complete" },
        },
      });
      const intervals = document.trace.timing.activities;
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
