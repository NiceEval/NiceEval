// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#turnfromaisdk-deterministic

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { command, type ProcessReceipt, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { sdkConverterArtifactStaging, sdkConverterProjectCopy } from "./support.ts";

const EXPERIMENT_ID = "turn-from-ai-sdk";
const EVAL_ID = "turn-from-ai-sdk";
const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  status?: string;
  passed?: number;
  failed?: number;
  errored?: number;
  completion?: string;
}

function expectCliSuccess(receipt: ProcessReceipt): void {
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  expect(receipt.signal, receipt.diagnostic()).toBeNull();
  expect(receipt.timedOut, receipt.diagnostic()).toBe(false);
  expect(receipt.stdout, receipt.diagnostic()).not.toMatch(/[\x1b\x08]/);
}

test("turnFromAiSdk 的真实 AI SDK seam 经 Experiment 和公开 CLI 确定性读回", async () => {
  await withProjectCopy(
    sdkConverterProjectCopy,
    async ({ root }) => {
      await mkdir(join(root, "junit"), { recursive: true });
      const run = await niceeval.run(
        ["exp", EXPERIMENT_ID, "--rerun", "all", "--json", "--junit", "junit/turn-from-ai-sdk.xml"],
        { cwd: root },
      );
      expectCliSuccess(run);
      const events = run.ndjson<ExpEvent>();
      expect(events.at(-1)).toMatchObject({
        event: "result",
        status: "passed",
        passed: 1,
        failed: 0,
        errored: 0,
        completion: "complete",
      });
      const evalEvent = events.find((event) => event.event === "eval" && event.evalId === EVAL_ID && event.locator !== undefined);
      expect(evalEvent, run.diagnostic()).toBeDefined();

      const junit = await readFile(join(root, "junit", "turn-from-ai-sdk.xml"), "utf8");
      expect(junit).toContain("<testsuite");
      expect(junit).not.toContain("<failure");
      expect(junit).not.toContain("<error");

      const board = await niceeval.run(["show", "--exp", EXPERIMENT_ID, "--json"], { cwd: root });
      expectCliSuccess(board);
      expect(board.stdout).toContain(EVAL_ID);

      const history = await niceeval.run(["show", EVAL_ID, "--exp", EXPERIMENT_ID, "--history"], { cwd: root });
      expectCliSuccess(history);
      expect(history.stdout).toContain("passed");
      expect(history.stdout).toContain("@");

      const execution = await niceeval.run(["show", evalEvent!.locator!, "--execution"], { cwd: root });
      expectCliSuccess(execution);
      expect(execution.stdout).toContain("inventory_lookup");
      expect(execution.stdout).toContain("approval_tool");
      expect(execution.stdout).toContain("ai-sdk-approved-marker");
      expect(execution.stdout).toContain("ai-sdk-rejected-marker");
    },
    sdkConverterArtifactStaging("turn-from-ai-sdk"),
  );
});
