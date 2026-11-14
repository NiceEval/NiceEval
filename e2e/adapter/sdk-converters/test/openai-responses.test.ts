// rerun: pnpm e2e test --repo adapter/sdk-converters -- --run test/openai-responses.test.ts

import { assertExpEvalOutcomes, exactEval, only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { sdkConverterE2E, sdkConverterRecordArtifacts } from "./support.ts";

import { expectAttemptSource } from "./sources.ts";

const EXPECTED = [
  {
    experimentId: "openai-responses",
    evalId: "openai-responses",
    verdict: "passed",
    attempts: 1,
    passed: 1,
  },
] as const;
// @feature docs/feature/adapters/README.md

test("turnFromResponses 的 message 与 function_call 输入经 Experiment 和公开 CLI 确定性读回", async () => {
  await sdkConverterE2E.case("openai-responses", sdkConverterRecordArtifacts, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "openai-responses", "--rerun", "all", "--json"]);
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
    expect(summary.selection).toMatchObject({ selectedRunIds: [receipt.createdRunIds[0]!], missingRunIds: [] });
    expect(JSON.stringify(summary.run)).toContain(event.locator);

    const sourcesReceipt = await niceeval.run(["show", event.locator, "source", "--json"]);
    expect(sourcesReceipt.exitCode, sourcesReceipt.diagnostic()).toBe(0);
    const sources = sourcesReceipt.attemptSources();
    expectAttemptSource(sources, {
      path: "evals/openai-responses.eval.ts",
      textIncludes: "export default defineEval({",
    });

    const traceReceipt = await niceeval.run(["show", event.locator, "execution", "--json"]);
    expect(traceReceipt.exitCode, traceReceipt.diagnostic()).toBe(0);
    const traceDocument = traceReceipt.attemptTrace();
    expect(traceDocument).toMatchObject({ operation: "attempt.trace" });
    const trace = JSON.stringify(traceDocument.trace);
    expect(trace).toContain("openai-responses-message-marker");
    expect(trace).toContain("calendar_lookup");
    expect(trace).toContain("2026-08-09");
    const usageReceipt = await niceeval.run(["show", event.locator, "usage", "--json"]);
    expect(usageReceipt.exitCode, usageReceipt.diagnostic()).toBe(0);
    const { usage } = usageReceipt.attemptUsage();
    expect(usage).toMatchObject({ hasMore: false, omittedObservationCount: 0 });
    const usageTurn = only(
      usage.turns,
      () => true,
      () => usageReceipt.diagnostic(),
    );
    const reasoning = only(
      usage.observations,
      (observation) =>
        observation.turnId === usageTurn.turnId &&
        observation.kind === "token-bucket" &&
        observation.bucket === "reasoning",
      () => usageReceipt.diagnostic(),
    );
    expect(reasoning).toMatchObject({
      turnId: usageTurn.turnId,
      kind: "token-bucket",
      bucket: "reasoning",
      tokens: 3,
    });
  });
});
