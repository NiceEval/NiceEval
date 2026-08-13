// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#transport-owner

import { test } from "vitest";
import { proveLocalProtocolOwner } from "./support.ts";

test("uiMessageStreamAgent 完整 SSE transport 可经公开 execution 与 timing 回读", async () => {
  await proveLocalProtocolOwner("transport");
});
