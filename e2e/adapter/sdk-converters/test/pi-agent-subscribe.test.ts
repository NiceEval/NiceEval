// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#pi-agent-subscribe-deterministic

import { test } from "vitest";
import { proveSdkConverterOwner } from "./support.ts";

test("createPiAgentEventStream 接收真实 Agent.subscribe 回调并公开成功与 terminal failure", async () => {
  await proveSdkConverterOwner({
    experimentId: "pi-agent-subscribe",
    evalId: "pi-agent-subscribe",
    caseName: "pi-agent-subscribe",
    executionMarkers: [
      "pi-agent-subscribe-success-marker",
      "inventory_lookup",
      "pi-agent-tool-result-marker",
      "pi-agent-terminal-failure-marker",
    ],
  });
});
