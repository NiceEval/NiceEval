// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#turnfromaisdk-deterministic

import { join } from "node:path";
import { command, type ExpEvalEvent, type ExpEvent, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { sdkConverterArtifactStaging, sdkConverterProjectCopy } from "./support.ts";

const EXPERIMENT_ID = "turn-from-ai-sdk";
const EVAL_ID = "turn-from-ai-sdk";
const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("turnFromAiSdk 的真实 AI SDK seam 经 Experiment 和公开 CLI 确定性读回", async () => {
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

      const history = await niceeval.run(["show", EVAL_ID, "--exp", EXPERIMENT_ID, "--history"], { cwd: root });
      expect(history.exitCode, history.diagnostic()).toBe(0);
      expect(history.stdout).toContain("passed");
      expect(history.stdout).toContain("@");

      const execution = await niceeval.run(["show", evalEvent!.locator!, "--execution"], { cwd: root });
      expect(execution.exitCode, execution.diagnostic()).toBe(0);
      expect(execution.stdout).toContain("inventory_lookup");
      expect(execution.stdout).toContain("approval_tool");
      expect(execution.stdout).toContain("ai-sdk-approved-marker");
      expect(execution.stdout).toContain("ai-sdk-rejected-marker");
    },
    sdkConverterArtifactStaging("turn-from-ai-sdk"),
  );
});
