// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#turnfromaisdk-deterministic
// rerun: pnpm e2e test --repo adapter/sdk-converters -- --run test/turn-from-ai-sdk.test.ts

import { assertExpEvalOutcomes, exactEval } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { sdkConverterE2E, sdkConverterRecordArtifacts } from "./support.ts";
import { withInspectionRequest } from "@niceeval/testkit";
import { expectAttemptSource } from "./sources.ts";

const EXPECTED = [{
  experimentId: "turn-from-ai-sdk",
  evalId: "turn-from-ai-sdk",
  verdict: "passed",
  attempts: 1,
  passed: 1,
}] as const;

test("turnFromAiSdk 的锁定 AI SDK 输入经 Experiment 和公开 CLI 确定性读回", async () => {
  await sdkConverterE2E.case("turn-from-ai-sdk", sdkConverterRecordArtifacts, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "turn-from-ai-sdk", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const receipt = run.expReceipt();
    expect(receipt.completion, run.diagnostic()).toBe("completed");
    expect(receipt.invocationId, run.diagnostic()).toBeTruthy();
    expect(receipt.createdRunIds, run.diagnostic()).toHaveLength(1);
    const events = assertExpEvalOutcomes(run.expEvalEvents(), EXPECTED, () => run.diagnostic());
    const event = exactEval(events, EXPECTED[0], () => run.diagnostic());

    const summaryReceipt = await withInspectionRequest({
      kind: "run.summary",
      runId: receipt.createdRunIds[0]!,
    }, async (requestPath) => await niceeval.run(["query", "run", "--request", requestPath]));
    expect(summaryReceipt.exitCode, summaryReceipt.diagnostic()).toBe(0);
    const summary = summaryReceipt.runSummary();
    expect(summary).toMatchObject({ protocol: "niceeval.query/v1", operation: "run.summary" });
    expect(summary.selection).toMatchObject({ selectedRunIds: [receipt.createdRunIds[0]!], missingRunIds: [] });
    expect(JSON.stringify(summary.summary)).toContain(event.locator);

    const sourcesReceipt = await withInspectionRequest({
      kind: "attempt.sources",
      locator: event.locator,
    }, async (requestPath) => await niceeval.run(["query", "run", "--request", requestPath]));
    expect(sourcesReceipt.exitCode, sourcesReceipt.diagnostic()).toBe(0);
    const sources = sourcesReceipt.attemptSources();
    expectAttemptSource(sources, {
      path: "evals/turn-from-ai-sdk.eval.ts",
      textIncludes: "export default defineEval({",
    });

    const traceReceipt = await withInspectionRequest({
      kind: "attempt.trace",
      locator: event.locator,
    }, async (requestPath) => await niceeval.run(["query", "run", "--request", requestPath]));
    expect(traceReceipt.exitCode, traceReceipt.diagnostic()).toBe(0);
    const traceDocument = traceReceipt.attemptTrace();
    expect(traceDocument).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
    const trace = JSON.stringify(traceDocument.trace);
    expect(trace).toContain("inventory_lookup");
    expect(trace).toContain("approval_tool");
    expect(trace).toContain("ai-sdk-approved-marker");
    expect(trace).toContain("ai-sdk-rejected-marker");
  });
});
