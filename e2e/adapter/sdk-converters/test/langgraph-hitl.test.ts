// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#langgraph-hitl-deterministic
// rerun: pnpm e2e --repo adapter/sdk-converters -- --run test/langgraph-hitl.test.ts

import {
  assertExpEvalOutcomes,
  exactEval,
  type ExpEvalEvent,
  type InvocationReceipt,
  type ProcessReceipt,
} from "@niceeval/testkit";
import { afterAll, beforeAll, expect, test } from "vitest";
import { closeSdkConverterCaseAfterFailure, openSdkConverterCase } from "./support.ts";

const EXPECTED = [{
  experimentId: "langgraph-hitl",
  evalId: "langgraph-hitl",
  verdict: "passed",
  attempts: 1,
  passed: 1,
}] as const;

let shared: ReturnType<typeof openSdkConverterCase> | undefined;
let context!: Awaited<ReturnType<typeof openSdkConverterCase>["context"]>;
let run!: ProcessReceipt;
let receipt!: InvocationReceipt;
let events!: ExpEvalEvent[];

beforeAll(async () => {
  shared = openSdkConverterCase("langgraph-hitl");
  try {
    context = await shared.context;
    run = await context.commands.niceeval.run([
      "exp", "langgraph-hitl", "--rerun", "all", "--json",
    ]);
    events = run.expEvalEvents();
    receipt = run.expReceipt();
  } catch (error) {
    const failed = shared;
    shared = undefined;
    await closeSdkConverterCaseAfterFailure(failed, error);
  }
});

afterAll(async () => await shared?.close());

test("createLangGraphEventStream 的 interrupt/resume 以 passed outcome 完成", () => {
  expect(run.exitCode, run.diagnostic()).toBe(0);
  expect(receipt.completion, run.diagnostic()).toBe("completed");
  expect(receipt.runIds, run.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(events, EXPECTED, () => run.diagnostic());
});

test("show --execution 读回 LangGraph 批准、拒绝与同一工具标记", async () => {
  const event = exactEval(events, EXPECTED[0], () => run.diagnostic());
  const execution = await context.commands.niceeval.run([
    "show", event.locator, "--execution", "--json",
  ]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain("approve_change");
  expect(execution.stdout).toContain("langgraph-hitl-approved-marker");
  expect(execution.stdout).toContain("langgraph-hitl-rejected-marker");
  expect(execution.stdout).toContain("rejected");
});
