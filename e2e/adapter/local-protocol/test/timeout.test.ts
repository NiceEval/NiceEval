// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#timeout-owner

import { test } from "vitest";
import { proveLocalProtocolOwner } from "./support.ts";

test("uiMessageStreamAgent 的挂起响应受 attempt timeout 约束", async () => {
  await proveLocalProtocolOwner("timeout");
});
