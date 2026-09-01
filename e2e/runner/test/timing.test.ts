// rerun: pnpm e2e test --repo runner -- --run test/timing.test.ts
import {
  assertExpEvalOutcomes,
  exactEval,
  only,
} from "@niceeval/testkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E, writeInspectionRequest } from "./context.ts";

const EXPECTED = [
  { experimentId: "timing", evalId: "timing/basic", verdict: "passed", attempts: 1, passed: 1 },
] as const;

async function receiptLines(root: string, name: string): Promise<string[]> {
  return (await readFile(join(root, name), "utf8"))
    .split("\n")
    .filter((line) => line !== "");
}

test("通用 Runner 公开 Agent setup、send、teardown 的完成与失败关系 [necase_21VCRD4WKW8K1E66]", async () => {
  await runnerE2E.case(
    "generic-timing",
    {
      artifacts: [
        { source: ".niceeval", target: ".niceeval", optional: true },
        { source: "timing-setup-failure.ndjson", target: "timing-setup-failure.ndjson" },
        { source: "timing-no-setup.ndjson", target: "timing-no-setup.ndjson" },
        {
          source: "timing-setup-teardown-failure.ndjson",
          target: "timing-setup-teardown-failure.ndjson",
        },
        {
          source: "timing-send-teardown-failure.ndjson",
          target: "timing-send-teardown-failure.ndjson",
        },
      ],
    },
    async ({ commands: { niceeval }, paths }) => {
      const run = await niceeval.run(["exp", "timing", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const receipt = run.expReceipt();
      expect(receipt.completion, run.diagnostic()).toBe("completed");
      const events = assertExpEvalOutcomes(run.expEvalEvents(), EXPECTED, () => run.diagnostic());
      const event = exactEval(events, EXPECTED[0], () => run.diagnostic());

      const request = await writeInspectionRequest(paths.projectRoot, "timing-attempt-timing", {
        kind: "attempt.timing", locator: event.locator,
      });
      const queried = await niceeval.run(["query", "run", "--request", request]);
      expect(queried.exitCode, queried.diagnostic()).toBe(0);
      const document = queried.attemptTiming();
      expect(document).toMatchObject({
        operation: "attempt.timing",
        issues: [],
        timing: { state: "complete" },
      });
      const intervals = document.timing.activities;
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

      const setupFailure = await niceeval.run([
        "exp", "timing-setup-failure", "--rerun", "all", "--json",
      ]);
      expect(setupFailure.exitCode, setupFailure.diagnostic()).toBe(1);
      const setupFailureEval = only(
        setupFailure.expEvalEvents(),
        (item) => item.experimentId === "timing-setup-failure",
        setupFailure.diagnostic(),
      );
      expect(setupFailureEval).toMatchObject({ verdict: "errored", attempts: 1, passed: 0 });
      const setupFailureError = only(
        setupFailure.expErrorEvents(),
        (item) => item.event === "error" && item.experimentId === "timing-setup-failure",
        setupFailure.diagnostic(),
      );
      expect(setupFailureError).toMatchObject({ phase: "agent.setup" });
      expect(setupFailureError.reason).toContain("runner lifecycle setup primary failure");
      expect(await receiptLines(paths.projectRoot, "timing-setup-failure.ndjson")).toEqual([
        "setup",
        "teardown",
      ]);

      const noSetup = await niceeval.run([
        "exp", "timing-no-setup", "--rerun", "all", "--json",
      ]);
      expect(noSetup.exitCode, noSetup.diagnostic()).toBe(0);
      expect(noSetup.expEvalEvents()).toContainEqual(expect.objectContaining({
        experimentId: "timing-no-setup",
        verdict: "passed",
        attempts: 1,
        passed: 1,
      }));
      expect(await receiptLines(paths.projectRoot, "timing-no-setup.ndjson")).toEqual([
        "send",
        "teardown",
      ]);

      for (const failure of [
        {
          experimentId: "timing-setup-teardown-failure",
          receipt: "timing-setup-teardown-failure.ndjson",
          primaryPhase: "agent.setup",
          primary: "runner lifecycle setup retained failure",
          events: ["setup", "teardown"],
        },
        {
          experimentId: "timing-send-teardown-failure",
          receipt: "timing-send-teardown-failure.ndjson",
          primaryPhase: "eval.run",
          primary: "runner lifecycle send retained failure",
          events: ["send", "teardown"],
        },
      ] as const) {
        const result = await niceeval.run([
          "exp", failure.experimentId, "--rerun", "all", "--json",
        ]);
        expect(result.exitCode, result.diagnostic()).toBe(1);
        const evalEvent = only(
          result.expEvalEvents(),
          (item) => item.experimentId === failure.experimentId,
          result.diagnostic(),
        );
        expect(evalEvent).toMatchObject({ verdict: "errored", attempts: 1, passed: 0 });
        const primaryError = only(
          result.expErrorEvents(),
          (item) => item.event === "error" && item.experimentId === failure.experimentId,
          result.diagnostic(),
        );
        expect(primaryError.phase).toBe(failure.primaryPhase);
        expect(primaryError.reason).toContain(failure.primary);
        expect(primaryError.reason).not.toContain("runner lifecycle teardown secondary failure");
        expect(await receiptLines(paths.projectRoot, failure.receipt)).toEqual(failure.events);

        const traceRequest = await writeInspectionRequest(
          paths.projectRoot,
          `${failure.experimentId}-trace`,
          { kind: "attempt.trace", locator: evalEvent.locator },
        );
        const trace = await niceeval.run(["query", "run", "--request", traceRequest]);
        expect(trace.exitCode, trace.diagnostic()).toBe(0);
        const traceDocument = trace.attemptTrace();
        expect(traceDocument).toMatchObject({ operation: "attempt.trace", issues: [] });
        const teardownDiagnostic = only(
          traceDocument.trace.diagnostics.items,
          (item) => item.phase === "attempt.teardown",
          trace.diagnostic(),
        );
        expect(teardownDiagnostic.summary).toContain("runner lifecycle teardown secondary failure");
      }
    },
  );
});

test("Run 终态持久化失败时已发布 locator 仍可公开检查 [necase_EP0HS2HD783EN64J]", async () => {
  await runnerE2E.case(
    "completion-persistence-failure",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const run = await niceeval.run([
        "exp", "completion-persistence-failure", "--rerun", "all", "--json",
      ]);
      expect(run.exitCode, run.diagnostic()).toBe(1);

      const terminalOutput = `${run.stdout}\n${run.stderr}`;
      const leakedLocator = terminalOutput.match(/@1[0-9A-HJKMNP-TV-Z]{12}/)?.[0];
      expect(leakedLocator, run.diagnostic()).toBeDefined();
      const request = await writeInspectionRequest(
        paths.projectRoot,
        "published-attempt-trace",
        { kind: "attempt.trace", locator: leakedLocator! },
      );
      const queried = await niceeval.run(["query", "run", "--request", request]);
      expect(queried.exitCode, queried.diagnostic()).toBe(0);
      expect(queried.attemptTrace().outcome).toBe("success");
      expect(terminalOutput).toMatch(/publication|persistence/i);
    },
  );
});
