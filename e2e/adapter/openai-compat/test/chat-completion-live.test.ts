// owner: docs/engineering/testing/e2e/adapter/openai-compat.md#chat-completion-live

import { beforeAll, expect, test } from "vitest";
import { assertExpEvalOutcomes } from "@niceeval/testkit";
import {
  runOpenAiLiveEvidence,
  showOpenAiLiveEvidence,
  type OpenAiLiveEvidence,
} from "./support.ts";

let evidence!: OpenAiLiveEvidence;

beforeAll(async () => {
  evidence = await runOpenAiLiveEvidence({
    experimentId: "chat-completion-live",
    evalId: "chat-completion-live",
    caseName: "chat-completion-live",
    executionMarkers: ["lookup_live_chat_fixture", "chat-live-20260809"],
  });
}, 5 * 60_000);

test("真实 OpenAI Chat Completion 一次请求以通过 verdict 完成", () => {
  const receipt = evidence.receipt.expReceipt();
  expect(receipt.completion).toBe("completed");
  expect(receipt.runIds, evidence.receipt.diagnostic()).not.toHaveLength(0);
  assertExpEvalOutcomes(
    evidence.evalEvents,
    [
      {
        evalId: "chat-completion-live",
        experimentId: "chat-completion-live",
        verdict: "passed",
        attempts: 1,
        passed: 1,
      },
    ],
    () => evidence.receipt.diagnostic(),
  );
});

test("show --execution 读回 OpenAI Chat Completion 的代表性证据", async () => {
  const execution = await showOpenAiLiveEvidence(evidence, [
    evidence.evalEvent.locator!,
    "--execution",
  ]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  for (const marker of evidence.executionMarkers) expect(execution.stdout).toContain(marker);
});
