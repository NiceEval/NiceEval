// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#http-error-owner

import { test } from "vitest";
import { proveLocalProtocolOwner } from "./support.ts";

test("uiMessageStreamAgent 将 HTTP 500 呈现为含状态码的公开错误", async () => {
  await proveLocalProtocolOwner("http-error");
});
