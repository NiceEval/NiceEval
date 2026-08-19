// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#approval-owner

import { test } from "vitest";
import { proveLocalProtocolOwner } from "./support.ts";

test("uiMessageStreamAgent 审批等待、批准与拒绝保持同一 call 生命周期", async () => {
  await proveLocalProtocolOwner("approval");
});
