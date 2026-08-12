// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#langgraph-hitl-deterministic

import { test } from "vitest";
import { proveSdkConverterOwner } from "./support.ts";

test("createLangGraphEventStream 以新实例覆盖真实 interrupt/Command resume 与官方 HITL", async () => {
  await proveSdkConverterOwner({
    experimentId: "langgraph-hitl",
    evalId: "langgraph-hitl",
    caseName: "langgraph-hitl",
  });
});
