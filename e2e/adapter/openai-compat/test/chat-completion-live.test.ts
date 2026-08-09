// owner: docs/engineering/testing/e2e/adapter/openai-compat.md#chat-completion-live

import { test } from "vitest";
import { proveOpenAiLiveOwner } from "./support.ts";

test("真实 OpenAI Chat Completion 一次请求经 converter 与公开 CLI 读回", async () => {
  await proveOpenAiLiveOwner({
    experimentId: "chat-completion-live",
    evalId: "chat-completion-live",
    caseName: "chat-completion-live",
    executionMarkers: ["lookup_live_chat_fixture", "chat-live-20260809"],
  });
});
