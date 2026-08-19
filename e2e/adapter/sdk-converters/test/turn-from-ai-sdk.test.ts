// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#turnfromaisdk-deterministic
// rerun: pnpm e2e --repo adapter/sdk-converters -- --run test/turn-from-ai-sdk.test.ts

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
  experimentId: "turn-from-ai-sdk",
  evalId: "turn-from-ai-sdk",
  verdict: "passed",
  attempts: 1,
  passed: 1,
}] as const;

let shared: Awaited<ReturnType<typeof openSdkConverterCase>> | undefined;
let run!: ProcessReceipt;
let receipt!: InvocationReceipt;
let events!: ExpEvalEvent[];

beforeAll(async () => {
  shared = await openSdkConverterCase("turn-from-ai-sdk");
  try {
    run = await shared.context.commands.niceeval.run([
      "exp", "turn-from-ai-sdk", "--rerun", "all", "--json",
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

test("turnFromAiSdk 的锁定 AI SDK 输入以 passed outcome 完成", () => {
  expect(run.exitCode, run.diagnostic()).toBe(0);
  expect(receipt.completion, run.diagnostic()).toBe("completed");
  expect(receipt.runIds, run.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(events, EXPECTED, () => run.diagnostic());
});

test("show --execution 读回 AI SDK 工具与审批标记", async () => {
  const event = exactEval(events, EXPECTED[0], () => run.diagnostic());
  const execution = await shared!.context.commands.niceeval.run([
    "show", event.locator, "--execution", "--json",
  ]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain("inventory_lookup");
  expect(execution.stdout).toContain("approval_tool");
  expect(execution.stdout).toContain("ai-sdk-approved-marker");
  expect(execution.stdout).toContain("ai-sdk-rejected-marker");
});
