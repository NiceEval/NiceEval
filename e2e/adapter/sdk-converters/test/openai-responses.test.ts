// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#openai-responses-deterministic
// rerun: pnpm e2e --repo adapter/sdk-converters -- --run test/openai-responses.test.ts

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
  experimentId: "openai-responses",
  evalId: "openai-responses",
  verdict: "passed",
  attempts: 1,
  passed: 1,
}] as const;

let shared: Awaited<ReturnType<typeof openSdkConverterCase>> | undefined;
let run!: ProcessReceipt;
let receipt!: InvocationReceipt;
let events!: ExpEvalEvent[];

beforeAll(async () => {
  shared = await openSdkConverterCase("openai-responses");
  try {
    run = await shared.context.commands.niceeval.run([
      "exp", "openai-responses", "--rerun", "all", "--json",
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

test("turnFromResponses 的 message 与 function_call 输入以 passed outcome 完成", () => {
  expect(run.exitCode, run.diagnostic()).toBe(0);
  expect(receipt.completion, run.diagnostic()).toBe("completed");
  expect(receipt.runIds, run.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(events, EXPECTED, () => run.diagnostic());
});

test("show --execution 读回 Responses 的消息、工具和输入", async () => {
  const event = exactEval(events, EXPECTED[0], () => run.diagnostic());
  const execution = await shared!.context.commands.niceeval.run([
    "show", event.locator, "--execution", "--json",
  ]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain("openai-responses-message-marker");
  expect(execution.stdout).toContain("calendar_lookup");
  expect(execution.stdout).toContain("2026-08-09");
});
