// owner: docs/engineering/testing/e2e/adapter/openai-compat.md#responses-live

import { beforeAll, expect, test } from "vitest";
import {
  runOpenAiLiveEvidence,
  showOpenAiLiveEvidence,
  type OpenAiLiveEvidence,
} from "./support.ts";

let evidence!: OpenAiLiveEvidence;

beforeAll(async () => {
  evidence = await runOpenAiLiveEvidence({
    experimentId: "responses-live",
    evalId: "responses-live",
    caseName: "responses-live",
    executionMarkers: ["lookup_live_responses_fixture", "responses-live-20260809"],
  });
}, 5 * 60_000);

test("真实 OpenAI Responses 一次请求以通过 verdict 完成", () => {
  const receipt = evidence.receipt.expReceipt();
  expect(receipt.completion).toBe("completed");
  expect(receipt.runIds, evidence.receipt.diagnostic()).not.toHaveLength(0);
  expect(evidence.evalEvent).toMatchObject({
    evalId: evidence.evalId,
    experimentId: evidence.experimentId,
    verdict: "passed",
    attempts: 1,
  });
});

test("show --execution 读回 OpenAI Responses 的代表性证据", async () => {
  const history = await showOpenAiLiveEvidence(evidence, [
    evidence.evalId,
    "--exp",
    evidence.experimentId,
    "--history",
  ]);
  expect(history.exitCode, history.diagnostic()).toBe(0);
  expect(history.stdout).toContain("passed");
  expect(history.stdout).toContain("@");

  const execution = await showOpenAiLiveEvidence(evidence, [
    evidence.evalEvent.locator!,
    "--execution",
  ]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  for (const marker of evidence.executionMarkers) expect(execution.stdout).toContain(marker);
});

test("show --timing 读回 OpenAI Responses 的 runner 阶段", async () => {
  const timing = await showOpenAiLiveEvidence(evidence, [
    evidence.evalEvent.locator!,
    "--timing",
  ]);
  expect(timing.exitCode, timing.diagnostic()).toBe(0);
  expect(timing.stdout, timing.diagnostic()).toContain("eval.run");
  expect(timing.stdout, timing.diagnostic()).toMatch(/turn\s+turn1\b/);

});
