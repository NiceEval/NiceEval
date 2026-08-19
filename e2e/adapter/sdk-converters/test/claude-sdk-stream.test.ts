// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#claude-sdk-stream-deterministic
// rerun: pnpm e2e --repo adapter/sdk-converters -- --run test/claude-sdk-stream.test.ts

import {
  assertExpEvalOutcomes,
  exactEval,
  type ExpEvalEvent,
  type InvocationReceipt,
  type ProcessReceipt,
} from "@niceeval/testkit";
import { afterAll, beforeAll, expect, test } from "vitest";
import { openSdkConverterCase } from "./support.ts";

const EXPECTED = [{
  experimentId: "claude-sdk-stream",
  evalId: "claude-sdk-stream",
  verdict: "passed",
  attempts: 1,
  passed: 1,
}] as const;

let shared: Awaited<ReturnType<typeof openSdkConverterCase>> | undefined;
let run!: ProcessReceipt;
let receipt!: InvocationReceipt;
let events!: ExpEvalEvent[];

beforeAll(async () => {
  shared = await openSdkConverterCase("claude-sdk-stream");
  try {
    run = await shared.context.commands.niceeval.run([
      "exp", "claude-sdk-stream", "--rerun", "all", "--json",
    ]);
    events = run.expEvalEvents();
    receipt = run.expReceipt();
  } catch (error) {
    await shared.close();
    shared = undefined;
    throw error;
  }
});

afterAll(async () => await shared?.close());

test("createClaudeSdkEventStream 的锁定上游帧以 passed outcome 完成", () => {
  expect(run.exitCode, run.diagnostic()).toBe(0);
  expect(receipt.completion, run.diagnostic()).toBe("completed");
  expect(receipt.runIds, run.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(events, EXPECTED, () => run.diagnostic());
});

test("show --execution 读回 Claude 工具身份与拒绝结果", async () => {
  const event = exactEval(events, EXPECTED[0], () => run.diagnostic());
  const execution = await shared!.context.commands.niceeval.run([
    "show", event.locator, "--execution", "--json",
  ]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain("claude-sdk-assistant-marker");
  expect(execution.stdout).toMatch(/"tool":"(?:shell|Bash)"/);
  expect(execution.stdout).toContain('"tool":"Read"');
  expect(execution.stdout).toContain('"tool":"Write"');
  expect(execution.stdout).toContain("rejected");
});
