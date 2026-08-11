// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#claude-sdk-stream-deterministic

import { join } from "node:path";
import { command, type ExpEvalEvent, type ExpEvent, type ExpResultEvent, type ProcessReceipt, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { sdkConverterArtifactStaging, sdkConverterProjectCopy } from "./support.ts";

const EXPERIMENT_ID = "claude-sdk-stream";
const EVAL_ID = "claude-sdk-stream";
const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

function expectCliSuccess(receipt: ProcessReceipt): void {
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
}

test("createClaudeSdkEventStream 的锁定上游帧经 Experiment 和公开 CLI 确定性读回", async () => {
  await withProjectCopy(
    sdkConverterProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(
        ["exp", EXPERIMENT_ID, "--rerun", "all", "--json"],
        { cwd: root },
      );
      expectCliSuccess(run);
      const events = run.ndjson<ExpEvent>();
      const result: ExpResultEvent = run.expResult();
      expect(result).toMatchObject({
        event: "result",
        status: "passed",
        passed: 1,
        failed: 0,
        errored: 0,
        completion: "complete",
      });
      const evalEvent = events.find(
        (event): event is ExpEvalEvent => event.event === "eval" && event.evalId === EVAL_ID,
      );
      expect(evalEvent, run.diagnostic()).toBeDefined();

      const history = await niceeval.run(["show", EVAL_ID, "--exp", EXPERIMENT_ID, "--history"], { cwd: root });
      expectCliSuccess(history);
      expect(history.stdout).toContain("passed");
      expect(history.stdout).toContain("@");

      const execution = await niceeval.run(["show", evalEvent!.locator!, "--execution"], { cwd: root });
      expectCliSuccess(execution);
      expect(execution.stdout).toContain("claude-sdk-assistant-marker");
      expect(execution.stdout).toMatch(/TOOL · (shell|Bash)/);
      expect(execution.stdout).toContain("TOOL · Read");
      expect(execution.stdout).toContain("TOOL · Write");
      expect(execution.stdout).toContain("rejected");
    },
    sdkConverterArtifactStaging("claude-sdk-stream"),
  );
});
