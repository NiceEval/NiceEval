// rerun: pnpm e2e test --repo adapter/sdk-converters -- --run test/claude-sdk-stream.test.ts

import { assertExpEvalOutcomes, exactEval, only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { sdkConverterE2E, sdkConverterRecordArtifacts } from "./support.ts";

import { expectAttemptSource } from "./sources.ts";

const EXPECTED = [
  {
    experimentId: "claude-sdk-stream",
    evalId: "claude-sdk-stream",
    verdict: "passed",
    attempts: 1,
    passed: 1,
  },
] as const;
// @feature docs/feature/adapters/README.md

test("createClaudeSdkEventStream 的锁定上游帧经 Experiment 和公开 CLI 确定性读回", async () => {
  await sdkConverterE2E.case("claude-sdk-stream", sdkConverterRecordArtifacts, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "claude-sdk-stream", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const receipt = run.expReceipt();
    expect(receipt.completion, run.diagnostic()).toBe("completed");
    expect(receipt.invocationId, run.diagnostic()).toBeTruthy();
    expect(receipt.createdRunIds, run.diagnostic()).toHaveLength(1);
    const events = assertExpEvalOutcomes(run.expEvalEvents(), EXPECTED, () => run.diagnostic());
    const event = exactEval(events, EXPECTED[0], () => run.diagnostic());

    const summaryReceipt = await niceeval.run(["show", `run:${receipt.createdRunIds[0]!}`, "--json"]);
    expect(summaryReceipt.exitCode, summaryReceipt.diagnostic()).toBe(0);
    const summary = summaryReceipt.run();
    expect(summary).toMatchObject({ operation: "run.get" });
    expect(summary.selection).toMatchObject({
      selectedRunIds: [receipt.createdRunIds[0]!],
      missingRunIds: [],
    });
    expect(JSON.stringify(summary.run)).toContain(event.locator);

    const sourcesReceipt = await niceeval.run(["show", event.locator, "source", "--json"]);
    expect(sourcesReceipt.exitCode, sourcesReceipt.diagnostic()).toBe(0);
    const sources = sourcesReceipt.attemptSources();
    expectAttemptSource(sources, {
      path: "evals/claude-sdk-stream.eval.ts",
      textIncludes: "export default defineEval({",
    });

    const traceReceipt = await niceeval.run(["show", event.locator, "execution", "--json"]);
    expect(traceReceipt.exitCode, traceReceipt.diagnostic()).toBe(0);
    const traceDocument = traceReceipt.attemptTrace();
    expect(traceDocument).toMatchObject({ operation: "attempt.trace" });
    const trace = JSON.stringify(traceDocument.trace);
    expect(trace).toContain("claude-sdk-assistant-marker");
    expect(trace).toMatch(/"tool":"(?:shell|Bash)"/);
    expect(trace).toContain('"tool":"Read"');
    expect(trace).toContain('"tool":"Write"');
    expect(trace).toContain("rejected");
    const usageReceipt = await niceeval.run(["show", event.locator, "usage", "--json"]);
    expect(usageReceipt.exitCode, usageReceipt.diagnostic()).toBe(0);
    const { usage } = usageReceipt.attemptUsage();
    expect(usage).toMatchObject({ hasMore: false, omittedObservationCount: 0 });
    const usageTurn = only(
      usage.turns,
      () => true,
      () => usageReceipt.diagnostic(),
    );
    expect(
      usage.observations.filter(
        (observation) =>
          observation.turnId === usageTurn.turnId &&
          observation.kind === "request" &&
          observation.requestKind === "model",
      ),
    ).toHaveLength(2);
    expect(usage.totals.requests).toMatchObject({ state: "available", value: 2, observationCount: 2 });
  });
});
