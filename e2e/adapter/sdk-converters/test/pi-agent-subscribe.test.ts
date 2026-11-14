// rerun: pnpm e2e test --repo adapter/sdk-converters -- --run test/pi-agent-subscribe.test.ts

import { assertExpEvalOutcomes, exactEval } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { sdkConverterE2E, sdkConverterRecordArtifacts } from "./support.ts";

import { expectAttemptSource } from "./sources.ts";

const EXPECTED = [{
  experimentId: "pi-agent-subscribe",
  evalId: "pi-agent-subscribe",
  verdict: "passed",
  attempts: 1,
  passed: 1,
}] as const;
// @feature docs/feature/adapters/README.md

test("createPiAgentEventStream 的 subscribe 回调经 Experiment 和公开 CLI 确定性读回", async () => {
  await sdkConverterE2E.case("pi-agent-subscribe", sdkConverterRecordArtifacts, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "pi-agent-subscribe", "--rerun", "all", "--json"]);
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
      path: "evals/pi-agent-subscribe.eval.ts",
      textIncludes: "export default defineEval({",
    });

    const traceReceipt = await niceeval.run(["show", event.locator, "execution", "--json"]);
    expect(traceReceipt.exitCode, traceReceipt.diagnostic()).toBe(0);
    const traceDocument = traceReceipt.attemptTrace();
    expect(traceDocument).toMatchObject({ operation: "attempt.trace" });
    const trace = JSON.stringify(traceDocument.trace);
    expect(trace).toContain("pi-agent-subscribe-success-marker");
    expect(trace).toContain("inventory_lookup");
    expect(trace).toContain("pi-agent-tool-result-marker");
    expect(trace).toContain("pi-agent-terminal-failure-marker");
  });
});
