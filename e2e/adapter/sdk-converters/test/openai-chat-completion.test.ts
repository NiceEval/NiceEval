// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#openai-chat-completion-deterministic

import { test } from "vitest";
import { proveSdkConverterOwner } from "./support.ts";

test("turnFromChatCompletion 零投影接收官方 SDK 的 function 与 custom tool call", async () => {
  await proveSdkConverterOwner({
    experimentId: "openai-chat-completion",
    evalId: "openai-chat-completion",
    caseName: "openai-chat-completion",
  });
});
