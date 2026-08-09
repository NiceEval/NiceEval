// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#disconnect-owner

import { test } from "vitest";
import { proveLocalProtocolOwner } from "./support.ts";

test("uiMessageStreamAgent 将半截 SSE 断流呈现为可行动的公开错误", async () => {
  await proveLocalProtocolOwner("disconnect");
});
