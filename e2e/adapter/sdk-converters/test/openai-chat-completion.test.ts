// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#openai-chat-completion-deterministic
// rerun: pnpm e2e --repo adapter/sdk-converters -- --run test/openai-chat-completion.test.ts

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
  experimentId: "openai-chat-completion",
  evalId: "openai-chat-completion",
  verdict: "passed",
  attempts: 1,
  passed: 1,
}] as const;

let shared: Awaited<ReturnType<typeof openSdkConverterCase>> | undefined;
let run!: ProcessReceipt;
let receipt!: InvocationReceipt;
let events!: ExpEvalEvent[];

beforeAll(async () => {
  shared = await openSdkConverterCase("openai-chat-completion");
  try {
    run = await shared.context.commands.niceeval.run([
      "exp", "openai-chat-completion", "--rerun", "all", "--json",
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

test("turnFromChatCompletion 的 function 与 custom tool 输入以 passed outcome 完成", () => {
  expect(run.exitCode, run.diagnostic()).toBe(0);
  expect(receipt.completion, run.diagnostic()).toBe("completed");
  expect(receipt.runIds, run.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(events, EXPECTED, () => run.diagnostic());
});

test("show --execution 读回 Chat Completions 的消息与工具参数", async () => {
  const event = exactEval(events, EXPECTED[0], () => run.diagnostic());
  const execution = await shared!.context.commands.niceeval.run([
    "show", event.locator, "--execution", "--json",
  ]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain("openai-chat-completion-message-marker");
  expect(execution.stdout).toContain("weather_lookup");
  expect(execution.stdout).toContain("grammar_query");
  expect(execution.stdout).toContain("SELECT fixture_marker");
});
