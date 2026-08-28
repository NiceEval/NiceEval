// owner: docs/engineering/testing/e2e/adapter/openai-compat.md#responses-live

import { beforeAll, expect, test } from "vitest";
import { assertExpEvalOutcomes } from "@niceeval/testkit";
import {
  runOpenAiLiveEvidence,
  queryOpenAiLiveEvidence,
  type OpenAiLiveEvidence,
} from "./support.ts";

let evidence!: OpenAiLiveEvidence;

beforeAll(async () => {
  evidence = await runOpenAiLiveEvidence({
    experimentId: "responses-live",
    evalId: "responses-live",
    caseName: "responses-live",
    traceMarkers: ["lookup_live_responses_fixture", "responses-live-20260809"],
  });
}, 5 * 60_000);

test("真实 OpenAI Responses 一次请求以通过 verdict 完成", () => {
  const receipt = evidence.receipt.expReceipt();
  expect(receipt.completion).toBe("completed");
  expect(receipt.runIds, evidence.receipt.diagnostic()).not.toHaveLength(0);
  assertExpEvalOutcomes(
    evidence.evalEvents,
    [
      // Responses：真实一次请求须调用 fixture 工具并公开读回 marker；因此期望 passed/1。
      {
        evalId: "responses-live",
        experimentId: "responses-live",
        verdict: "passed",
        attempts: 1,
        passed: 1,
      },
    ],
    () => evidence.receipt.diagnostic(),
  );
});

test("attempt.trace 读回 OpenAI Responses 的代表性证据", async () => {
  const queried = await queryOpenAiLiveEvidence(evidence, {
    kind: "attempt.trace",
    locator: evidence.evalEvent.locator,
  });
  expect(queried.exitCode, queried.diagnostic()).toBe(0);
  const document = queried.attemptTrace();
  expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
  const trace = JSON.stringify(document.trace);
  for (const marker of evidence.traceMarkers) expect(trace).toContain(marker);
});
