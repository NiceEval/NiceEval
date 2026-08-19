// owner: docs/engineering/testing/e2e/runner.md#runner-generic-timing
// rerun: pnpm e2e --repo runner -- --run test/timing.test.ts
import {
  assertExpEvalOutcomes,
  decodeShowTiming,
  exactEval,
  only,
} from "@niceeval/testkit";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

const EXPECTED = [
  { experimentId: "timing", evalId: "timing/basic", verdict: "passed", attempts: 1, passed: 1 },
] as const;

test("通用 Runner timing 公开 setup、run 与 send 的完成关系", async () => {
  await runnerE2E.case(
    "generic-timing",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "timing", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const receipt = run.expReceipt();
      expect(receipt.completion, run.diagnostic()).toBe("completed");
      const runId = only(receipt.runIds, () => true, run.diagnostic());
      const events = assertExpEvalOutcomes(run.expEvalEvents(), EXPECTED, () => run.diagnostic());
      const event = exactEval(events, EXPECTED[0], () => run.diagnostic());

      const shown = await niceeval.run(["show", event.locator, "--timing", "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const timingDocument = decodeShowTiming(shown);
      const available = only(
        timingDocument.data.timing,
        () => true,
        shown.diagnostic(),
      );
      if (available.state !== "available") throw new Error(shown.diagnostic());
      expect(available.attempt).toEqual({
        kind: "attempt",
        locator: event.locator,
        originRunId: runId,
      });
      const evalRun = only(
        available.timing.intervals,
        (interval) => interval.phase === "eval.run" && interval.label === "eval.run",
        shown.diagnostic(),
      );
      const agentSetup = only(
        available.timing.intervals,
        (interval) => interval.phase === "attempt.setup" && interval.label === "agent.setup",
        shown.diagnostic(),
      );
      const agentSend = only(
        available.timing.intervals,
        (interval) => interval.phase === "agent.send" && interval.label === "turn1",
        shown.diagnostic(),
      );
      expect(evalRun).toMatchObject({ parentIntervalId: null, outcome: "completed" });
      expect(agentSetup).toMatchObject({ parentIntervalId: null, outcome: "completed" });
      expect(agentSend).toMatchObject({ parentIntervalId: evalRun.intervalId, outcome: "completed" });
    },
  );
});
