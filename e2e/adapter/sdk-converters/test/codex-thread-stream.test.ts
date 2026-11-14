// rerun: pnpm e2e test --repo adapter/sdk-converters -- --run test/codex-thread-stream.test.ts

import { assertExpEvalOutcomes, exactEval, only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { createCodexThreadEventStream } from "niceeval/adapter";
import { sdkConverterE2E, sdkConverterRecordArtifacts } from "./support.ts";

import { expectAttemptSource } from "./sources.ts";

const EXPECTED = [{
  experimentId: "codex-thread-stream",
  evalId: "codex-thread-stream",
  verdict: "passed",
  attempts: 1,
  passed: 1,
}] as const;
// @feature docs/feature/adapters/README.md
// @regression memory/codex-thread-diagnostics-confused-with-terminal-failure.md

test("createCodexThreadEventStream 的锁定 ThreadEvent 经 Experiment 和公开 CLI 确定性读回", async () => {
  await sdkConverterE2E.case(
    "codex-thread-stream",
    sdkConverterRecordArtifacts,
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run([
        "exp", "codex-thread-stream", "--rerun", "all", "--json",
      ]);
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
        path: "evals/codex-thread-stream.eval.ts",
        textIncludes: "export default defineEval({",
      });

      const traceReceipt = await niceeval.run(["show", event.locator, "execution", "--json"]);
      expect(traceReceipt.exitCode, traceReceipt.diagnostic()).toBe(0);
      const traceDocument = traceReceipt.attemptTrace();
      expect(traceDocument).toMatchObject({ operation: "attempt.trace" });
      const trace = JSON.stringify(traceDocument.trace);
      expect(trace).toContain("codex-sdk-command-marker");
      expect(trace).toContain("file_change");
      expect(trace).toContain("codex-sdk-terminal-failure-marker");
      expect(trace).toContain("codex-sdk-nonfatal-diagnostic-marker");
      expect(trace).toContain("conversation-error");
      expect(trace).toContain("stream-error");
      const completedTurn = only(
        traceDocument.trace.conversation.turns,
        (turn) => traceDocument.trace.conversation.items.some((item) =>
          item.turnId === turn.turnId && item.kind === "message" &&
          item.role === "user" && item.text === "codex completed fixture"),
        () => traceReceipt.diagnostic(),
      );
      const usageReceipt = await niceeval.run(["show", event.locator, "usage", "--json"]);
      expect(usageReceipt.exitCode, usageReceipt.diagnostic()).toBe(0);
      const { usage } = usageReceipt.attemptUsage();
      expect(usage).toMatchObject({ hasMore: false, omittedObservationCount: 0 });
      const reasoning = only(usage.observations, (observation) =>
        observation.turnId === completedTurn.turnId &&
        observation.kind === "token-bucket" && observation.bucket === "reasoning",
        () => usageReceipt.diagnostic());
      expect(reasoning).toMatchObject({
        turnId: completedTurn.turnId,
        kind: "token-bucket",
        bucket: "reasoning",
        tokens: 5,
      });
    },
  );
  // The installed public converter reports fatal stream errors; a real Agent
  // must still propagate execution failure instead of fabricating a Turn.
  for (const message of ["codex-sdk-fatal-error-marker", ""]) {
    const converter = createCodexThreadEventStream();
    expect(converter.add({ type: "error", message })).toEqual([{ type: "error", message }]);
    expect(converter.failed).toBe(true);
    converter.add({ type: "turn.completed" });
    expect(converter.failed).toBe(true);
  }
});
