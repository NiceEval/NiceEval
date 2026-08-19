// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#codex-thread-stream-deterministic
// rerun: pnpm e2e --repo adapter/sdk-converters -- --run test/codex-thread-stream.test.ts

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
  experimentId: "codex-thread-stream",
  evalId: "codex-thread-stream",
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
  shared = openSdkConverterCase("codex-thread-stream");
  try {
    context = await shared.context;
    run = await context.commands.niceeval.run([
      "exp", "codex-thread-stream", "--rerun", "all", "--json",
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

test("createCodexThreadEventStream 的锁定 ThreadEvent 以 passed outcome 完成", () => {
  expect(run.exitCode, run.diagnostic()).toBe(0);
  expect(receipt.completion, run.diagnostic()).toBe("completed");
  expect(receipt.runIds, run.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(events, EXPECTED, () => run.diagnostic());
});

test("show --execution 读回 Codex command、file 与 terminal failure 标记", async () => {
  const event = exactEval(events, EXPECTED[0], () => run.diagnostic());
  const execution = await context.commands.niceeval.run([
    "show", event.locator, "--execution", "--json",
  ]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain("codex-sdk-command-marker");
  expect(execution.stdout).toContain("file_change");
  expect(execution.stdout).toContain("codex-sdk-terminal-failure-marker");
  expect(execution.stdout).toContain("conversation-error");
  expect(execution.stdout).toContain("stream-error");
});
