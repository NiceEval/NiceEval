// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#openai-responses-deterministic

import { test } from "vitest";
import { proveSdkConverterOwner } from "./support.ts";

test("turnFromResponses 零投影接收官方 SDK 的 message 与 function_call", async () => {
  await proveSdkConverterOwner({
    experimentId: "openai-responses",
    evalId: "openai-responses",
    caseName: "openai-responses",
  });
});
