import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { FIXTURE_BASE_URL } from "../src/fixture/address.ts";

// 共享断言契约 coding 节：fixture 的 /modes/coding 按序吐出 file_write / file_edit /
// shell / shell 四次真实工具 part 帧（见 src/fixture/server.ts 的 writeCodingStream）。
// Direct Agent 不声明 Sandbox：profile 的 sandboxUnavailable: true 让 tool-match-and-
// sandbox 跳过 t.sandbox 专属段，只对真实工具事件执行完整 ToolMatch。
export default defineExperiment({
  description: "local-protocol contract: coding（真实工具 part 帧）",
  agent: uiMessageStreamAgent({
    name: "local-protocol-contract-coding",
    url: `${FIXTURE_BASE_URL}/modes/coding/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["assertion-contract/tool-match-and-sandbox"],
});
