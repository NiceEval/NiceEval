import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { FIXTURE_BASE_URL } from "../src/fixture/address.ts";

// 共享断言契约 conversation 节：fixture 的 /modes/conversation 只回文本 marker，零工具。
export default defineExperiment({
  description: "local-protocol contract: conversation（零工具文本往返）",
  agent: uiMessageStreamAgent({
    name: "local-protocol-contract-conversation",
    url: `${FIXTURE_BASE_URL}/modes/conversation/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["assertion-contract/values-and-no-tools"],
});
