// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#codex-thread-stream-deterministic

import { join } from "node:path";
import { command, type ExpEvalEvent, type ExpEvent, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { sdkConverterArtifactStaging, sdkConverterProjectCopy } from "./support.ts";

const EXPERIMENT_ID = "codex-thread-stream";
const EVAL_ID = "codex-thread-stream";
const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("createCodexThreadEventStream 的锁定 ThreadEvent 经 Experiment 和公开 CLI 确定性读回", async () => {
  await withProjectCopy(
    sdkConverterProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(
        ["exp", EXPERIMENT_ID, "--rerun", "all", "--json"],
        { cwd: root },
      );
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const events = run.ndjson<ExpEvent>();
      // The terminal stream event is the Record v1 InvocationReceipt; it carries
      // no verdicts, so business results come from each eval event's identity
      // and verdict below (docs/feature/experiments/cli.md).
      const receipt = run.expReceipt();
      expect(receipt.completion).toBe("completed");
      expect(receipt.invocationId, run.diagnostic()).toBeTruthy();
      expect(receipt.runIds, run.diagnostic()).not.toHaveLength(0);
      const evalEvent = events.find(
        (event): event is ExpEvalEvent =>
          "event" in event && event.event === "eval" && event.evalId === EVAL_ID,
      );
      expect(evalEvent, run.diagnostic()).toBeDefined();
      expect(evalEvent).toMatchObject({
        evalId: EVAL_ID,
        experimentId: EXPERIMENT_ID,
        verdict: "passed",
      });
      expect(evalEvent?.locator, run.diagnostic()).toBeTruthy();

      // receipt 的 runId 驱动公开读回(adapter/README.md「Live 验收说明」第 3 步)：
      // 运行已发布为完整 Run、slot included，selection 精确指向本轮 receipt。
      const shown = await niceeval.run(["show", "--run", receipt.runIds[0]!, "--json"], { cwd: root });
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const selection = shown
        .json<{ sample: { selection: { runIds: readonly string[] } } }>()
        .sample.selection;
      expect(selection.runIds, shown.diagnostic()).toEqual([receipt.runIds[0]!]);
      expect(shown.stdout, shown.diagnostic()).toContain('"included"');

      // locator 驱动的公开读回：Attempt 的断言评估证据(含 Eval 内的工具/identity
      // 断言)已经随 Run 落盘，并通过 `show @<locator> --source` 可公开读回。
      const source = await niceeval.run(["show", evalEvent!.locator!, "--source"], { cwd: root });
      expect(source.exitCode, source.diagnostic()).toBe(0);
      expect(source.stdout).toContain("Assertions: available");
    },
    sdkConverterArtifactStaging("codex-thread-stream"),
  );
});
