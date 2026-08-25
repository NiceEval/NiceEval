// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#langgraph-core-deterministic
// rerun: pnpm e2e test --repo adapter/sdk-converters -- --run test/langgraph-core.test.ts

import { assertExpEvalOutcomes, exactEval } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { sdkConverterE2E, sdkConverterRecordArtifacts } from "./support.ts";
import { expectAttemptSource, runInspectionQuery, type InspectionDocument } from "./query.ts";

const EXPECTED = [{
  experimentId: "langgraph-core",
  evalId: "langgraph-core",
  verdict: "passed",
  attempts: 1,
  passed: 1,
}] as const;

test("createLangGraphEventStream 的真实 v3 runtime 经 Experiment 和公开 CLI 确定性读回", async () => {
  await sdkConverterE2E.case("langgraph-core", sdkConverterRecordArtifacts, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "langgraph-core", "--rerun", "all", "--json"]);
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
    const summary = summaryReceipt.json<InspectionDocument>();
    expect(summary).toMatchObject({ protocol: "niceeval.query/v1", operation: "run.summary" });
    expect(summary.selection).toMatchObject({ selectedRunIds: [receipt.runIds[0]!], missingRunIds: [] });
    expect(JSON.stringify(summary.summary)).toContain(event.locator);

    const sourcesReceipt = await runInspectionQuery(niceeval, {
      kind: "attempt.sources",
      locator: event.locator,
    });
    expect(sourcesReceipt.exitCode, sourcesReceipt.diagnostic()).toBe(0);
    const sources = sourcesReceipt.json<InspectionDocument>();
    expectAttemptSource(sources, {
      path: "evals/langgraph-core.eval.ts",
      textIncludes: "export default defineEval({",
    });

    const traceReceipt = await runInspectionQuery(niceeval, {
      kind: "attempt.trace",
      locator: event.locator,
    });
    expect(traceReceipt.exitCode, traceReceipt.diagnostic()).toBe(0);
    const traceDocument = traceReceipt.json<InspectionDocument>();
    expect(traceDocument).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
    const trace = JSON.stringify(traceDocument.trace);
    expect(trace).toContain("langgraph-runtime-methods:lifecycle");
    expect(trace).toContain("graph_lookup");
    expect(trace).toContain("langgraph-core-tool-output");
  });
});
