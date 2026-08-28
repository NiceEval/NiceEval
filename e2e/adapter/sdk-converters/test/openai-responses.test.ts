// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#openai-responses-deterministic
// rerun: pnpm e2e test --repo adapter/sdk-converters -- --run test/openai-responses.test.ts

import { assertExpEvalOutcomes, exactEval } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { sdkConverterE2E, sdkConverterRecordArtifacts } from "./support.ts";
import { expectAttemptSource, runInspectionQuery } from "./query.ts";

const EXPECTED = [{
  experimentId: "openai-responses",
  evalId: "openai-responses",
  verdict: "passed",
  attempts: 1,
  passed: 1,
}] as const;

test("turnFromResponses 的 message 与 function_call 输入经 Experiment 和公开 CLI 确定性读回", async () => {
  await sdkConverterE2E.case("openai-responses", sdkConverterRecordArtifacts, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "openai-responses", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const receipt = run.expReceipt();
    expect(receipt.completion, run.diagnostic()).toBe("completed");
    expect(receipt.invocationId, run.diagnostic()).toBeTruthy();
    expect(receipt.runIds, run.diagnostic()).toHaveLength(1);
    const events = assertExpEvalOutcomes(run.expEvalEvents(), EXPECTED, () => run.diagnostic());
    const event = exactEval(events, EXPECTED[0], () => run.diagnostic());

    const summaryReceipt = await runInspectionQuery(niceeval, {
      kind: "run.summary",
      runId: receipt.runIds[0]!,
    });
    expect(summaryReceipt.exitCode, summaryReceipt.diagnostic()).toBe(0);
    const summary = summaryReceipt.runSummary();
    expect(summary).toMatchObject({ protocol: "niceeval.query/v1", operation: "run.summary" });
    expect(summary.selection).toMatchObject({ selectedRunIds: [receipt.runIds[0]!], missingRunIds: [] });
    expect(JSON.stringify(summary.summary)).toContain(event.locator);

    const sourcesReceipt = await runInspectionQuery(niceeval, {
      kind: "attempt.sources",
      locator: event.locator,
    });
    expect(sourcesReceipt.exitCode, sourcesReceipt.diagnostic()).toBe(0);
    const sources = sourcesReceipt.attemptSources();
    expectAttemptSource(sources, {
      path: "evals/openai-responses.eval.ts",
      textIncludes: "export default defineEval({",
    });

    const traceReceipt = await runInspectionQuery(niceeval, {
      kind: "attempt.trace",
      locator: event.locator,
    });
    expect(traceReceipt.exitCode, traceReceipt.diagnostic()).toBe(0);
    const traceDocument = traceReceipt.attemptTrace();
    expect(traceDocument).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
    const trace = JSON.stringify(traceDocument.trace);
    expect(trace).toContain("openai-responses-message-marker");
    expect(trace).toContain("calendar_lookup");
    expect(trace).toContain("2026-08-09");
  });
});
