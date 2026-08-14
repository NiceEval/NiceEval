// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#codex-thread-stream-deterministic

import { assertExpEvalOutcomes } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { sdkConverterE2E, sdkConverterRecordArtifacts } from "./support.ts";

const EXPERIMENT_ID = "codex-thread-stream";
const EVAL_ID = "codex-thread-stream";

test("createCodexThreadEventStream 的锁定 ThreadEvent 经 Experiment 和公开 CLI 确定性读回", async () => {
  await sdkConverterE2E.case(
    "codex-thread-stream",
    sdkConverterRecordArtifacts,
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", EXPERIMENT_ID, "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      // The terminal stream event is the Record v1 InvocationReceipt; it carries
      // no verdicts, so business results come from each eval event's identity
      // and verdict below (docs/feature/experiments/cli.md).
      const receipt = run.expReceipt();
      expect(receipt.completion).toBe("completed");
      expect(receipt.invocationId, run.diagnostic()).toBeTruthy();
      expect(receipt.runIds, run.diagnostic()).not.toHaveLength(0);
      const evalEvents = assertExpEvalOutcomes(
        run.expEvalEvents(),
        [
          // Codex Thread stream：锁定事件须保留 command marker 与 file_change；一次转换期望 passed/1。
          {
            evalId: EVAL_ID,
            experimentId: EXPERIMENT_ID,
            verdict: "passed",
            attempts: 1,
            passed: 1,
          },
        ],
        () => run.diagnostic(),
      );
      const evalEvent = evalEvents[0]!;

      // receipt 的 runId 驱动公开读回(adapter/README.md「Live 验收说明」第 3 步)：
      // 运行已发布为完整 Run、slot included，selection 精确指向本轮 receipt。
      const shown = await niceeval.run(["show", "--run", receipt.runIds[0]!, "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const selection = shown
        .json<{ sample: { selection: { runIds: readonly string[] } } }>()
        .sample.selection;
      expect(selection.runIds, shown.diagnostic()).toEqual([receipt.runIds[0]!]);
      expect(shown.stdout, shown.diagnostic()).toContain('"included"');

      // locator 驱动的公开 source 读回：本轮 Eval 的 immutable source snapshot
      // 必须标出 recorded source、source availability，并呈现源码内容。
      const source = await niceeval.run(["show", evalEvent.locator, "--source"]);
      expect(source.exitCode, source.diagnostic()).toBe(0);
      expect(source.stdout).toContain("Recorded source: evals/codex-thread-stream.eval.ts");
      expect(source.stdout).toContain("Sources");
      expect(source.stdout).toContain("available");
      expect(source.stdout).toContain("export default defineEval({");

      const timing = await niceeval.run(["show", evalEvent.locator, "--timing"]);
      expect(timing.exitCode, timing.diagnostic()).toBe(0);
      expect(timing.stdout, timing.diagnostic()).toContain("eval.run");
      expect(timing.stdout, timing.diagnostic()).toMatch(/turn\s+turn1\b/);

      // locator 驱动的真实执行读回(adapter/README.md「Live 验收说明」第 3 步)：
      // execution 页是「适配器收到了什么」的用户可见投影，逐项断言每个真实
      // marker 与工具身份落在公开读面上。
      const execution = await niceeval.run(["show", evalEvent.locator, "--execution"]);
      expect(execution.exitCode, execution.diagnostic()).toBe(0);
      expect(execution.stdout).toContain("codex-sdk-command-marker");
      expect(execution.stdout).toContain("file_change");
      expect(execution.stdout).toContain("codex-sdk-terminal-failure-marker");
      expect(execution.stdout).toMatch(/ERROR\s*\|\s*stream-error/);
    },
  );
});
