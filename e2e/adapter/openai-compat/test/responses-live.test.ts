// owner: docs/engineering/testing/e2e/adapter/openai-compat.md#responses-live

import { test } from "vitest";
import { proveOpenAiLiveOwner } from "./support.ts";

test("真实 OpenAI Responses 一次请求经 converter 与公开 CLI 读回", async () => {
  await proveOpenAiLiveOwner({
    experimentId: "responses-live",
    evalId: "responses-live",
    caseName: "responses-live",
    executionMarkers: ["lookup_live_responses_fixture", "responses-live-20260809"],
  });
});
